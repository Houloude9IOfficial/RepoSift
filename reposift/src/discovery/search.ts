import { request } from "undici";
import type { SearchSource } from "../config/schema.js";
import type { RepoRecord } from "../metadata/repoRecord.js";
import { RateLimiter } from "./rateLimiter.js";

interface SearchResponse {
  items: Array<{
    full_name: string;
    name: string;
    owner: { login: string };
    stargazers_count: number;
    language: string | null;
    license: { spdx_id: string } | null;
    description: string | null;
    default_branch: string;
    html_url: string;
  }>;
  total_count: number;
}

export async function searchRepos(
  source: SearchSource,
  token: string,
  limiter: RateLimiter,
  signal?: AbortSignal,
): Promise<RepoRecord[]> {
  const repos: RepoRecord[] = [];
  const perPage = 100;
  const maxPages = Math.ceil(source.limit / perPage);

  for (let page = 1; page <= maxPages; page++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", source.query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");

    await limiter.waitForToken();

    const resp = await request(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "reposift/1.0.0",
        Accept: "application/vnd.github+json",
      },
      signal,
      headersTimeout: 30_000,
      bodyTimeout: 60_000,
    });

    // Update rate limiter from response headers
    const remaining = resp.headers["x-ratelimit-remaining"];
    const reset = resp.headers["x-ratelimit-reset"];
    limiter.updateFromHeaders(
      remaining ? Number(remaining) : null,
      reset ? Number(reset) : null,
    );

    if (resp.statusCode === 403) {
      // Rate limited — wait until reset
      const resetTime = reset ? Number(reset) * 1000 : Date.now() + 60000;
      const waitMs = resetTime - Date.now();
      if (waitMs > 0) {
        console.error(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs + 1000));
      }
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      continue;
    }

    if (resp.statusCode !== 200) {
      const body = await resp.body.text();
      throw new Error(`GitHub Search API returned ${resp.statusCode}: ${body}`);
    }

    const data = JSON.parse(await resp.body.text()) as SearchResponse;
    for (const item of data.items) {
      repos.push({
        owner: item.owner.login,
        repo: item.name,
        fullName: item.full_name,
        stars: item.stargazers_count,
        language: item.language ?? undefined,
        license: item.license?.spdx_id ?? undefined,
        description: item.description ?? undefined,
        defaultBranch: item.default_branch,
        url: item.html_url,
      });
    }

    if (data.items.length < perPage) break; // last page
  }

  return repos;
}

import { request } from "undici";
import type { RepoRecord } from "../metadata/repoRecord.js";
import { RateLimiter } from "./rateLimiter.js";

interface UserRepoResponse {
  full_name: string;
  name: string;
  owner: { login: string };
  stargazers_count: number;
  language: string | null;
  license: { spdx_id: string } | null;
  description: string | null;
  default_branch: string;
  html_url: string;
  fork: boolean;
}

export async function reposByUsers(
  users: string[],
  token: string,
  limiter: RateLimiter,
  perUserLimit: number,
  signal?: AbortSignal,
  onProgress?: (user: string, page: number, count: number) => void,
): Promise<RepoRecord[]> {
  const repos: RepoRecord[] = [];
  const perPage = 100;
  const maxPages = Math.ceil(perUserLimit / perPage);

  for (const user of users) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let userCount = 0;
    let page = 1;
    while (page <= maxPages) {
      const url = new URL(`https://api.github.com/users/${encodeURIComponent(user)}/repos`);
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "stars");
      url.searchParams.set("direction", "desc");
      url.searchParams.set("type", "public");

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

      const remaining = resp.headers["x-ratelimit-remaining"];
      const reset = resp.headers["x-ratelimit-reset"];
      limiter.updateFromHeaders(
        remaining ? Number(remaining) : null,
        reset ? Number(reset) : null,
      );

      if (resp.statusCode === 403) {
        const resetTime = reset ? Number(reset) * 1000 : Date.now() + 60000;
        const waitMs = resetTime - Date.now();
        if (waitMs > 0) {
          console.error(`Rate limited on user "${user}". Waiting ${Math.ceil(waitMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, waitMs + 1000));
        }
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        continue;
      }

      if (resp.statusCode !== 200) {
        const body = await resp.body.text();
        throw new Error(`GitHub User Repos API returned ${resp.statusCode} for "${user}": ${body}`);
      }

      const data = JSON.parse(await resp.body.text()) as UserRepoResponse[];
      if (data.length === 0) break;

      for (const item of data) {
        if (item.fork) continue; // skip forks

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
        userCount++;

        if (userCount >= perUserLimit) break;
      }

      onProgress?.(user, page, userCount);

      if (data.length < perPage || userCount >= perUserLimit) break;
      page++;
    }
  }

  return repos;
}

import { request } from "undici";
import type { RepoRecord } from "../metadata/repoRecord.js";
import { RateLimiter } from "./rateLimiter.js";

interface RepoResponse {
  full_name: string;
  name: string;
  owner: { login: string };
  stargazers_count: number;
  language: string | null;
  license: { spdx_id: string } | null;
  description: string | null;
  default_branch: string;
  html_url: string;
}

export async function explicitRepos(
  repos: string[],
  token: string,
  limiter: RateLimiter,
  signal?: AbortSignal,
): Promise<RepoRecord[]> {
  const results: RepoRecord[] = [];

  for (const repo of repos) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    await limiter.waitForToken();

    // Split into owner/name to avoid encoding the slash
    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      console.error(`Invalid repo format "${repo}". Expected "owner/repo". Skipping.`);
      continue;
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

    const resp = await request(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "reposift/0.1.0",
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

    if (resp.statusCode === 404) {
      console.error(`Repo "${repo}" not found. Skipping.`);
      continue;
    }

    if (resp.statusCode !== 200) {
      const body = await resp.body.text();
      throw new Error(`GitHub Repo API returned ${resp.statusCode} for "${repo}": ${body}`);
    }

    const item = JSON.parse(await resp.body.text()) as RepoResponse;
    results.push({
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

  return results;
}

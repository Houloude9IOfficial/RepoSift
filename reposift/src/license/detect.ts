import { request } from "undici";
import { RateLimiter } from "../discovery/rateLimiter.js";

interface LicenseResponse {
  license: { spdx_id: string; key: string } | null;
}

/**
 * Fetch the GitHub-detected license for a repo.
 * Returns the SPDX id or null if not detected.
 */
export async function detectLicense(
  fullName: string,
  token: string,
  limiter: RateLimiter,
): Promise<string | null> {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return null;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/license`;

  await limiter.waitForToken();

  const resp = await request(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "reposift/1.0.0",
      Accept: "application/vnd.github+json",
    },
    headersTimeout: 10_000,
    bodyTimeout: 20_000,
  });

  const remaining = resp.headers["x-ratelimit-remaining"];
  const reset = resp.headers["x-ratelimit-reset"];
  limiter.updateFromHeaders(
    remaining ? Number(remaining) : null,
    reset ? Number(reset) : null,
  );

  if (resp.statusCode === 404) return null;
  if (resp.statusCode !== 200) {
    const body = await resp.body.text();
    throw new Error(`GitHub License API returned ${resp.statusCode} for "${fullName}": ${body}`);
  }

  const data = JSON.parse(await resp.body.text()) as LicenseResponse;
  return data.license?.spdx_id ?? null;
}

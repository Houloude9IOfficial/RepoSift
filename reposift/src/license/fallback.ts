import { request } from "undici";
import { RateLimiter } from "../discovery/rateLimiter.js";

/**
 * Known SPDX identifiers and their identifying keywords.
 * A simple heuristic-based license detector.
 */
const LICENSE_PATTERNS: Array<{ spdx: string; keywords: string[] }> = [
  { spdx: "MIT", keywords: ["permission is hereby granted", "the software", "the authors"] },
  { spdx: "Apache-2.0", keywords: ["apache license", "version 2.0", "apache"] },
  { spdx: "BSD-3-Clause", keywords: ["redistribution and use", "this list of conditions", "3-clause"] },
  { spdx: "BSD-2-Clause", keywords: ["redistribution and use", "this list of conditions", "2-clause"] },
  { spdx: "GPL-3.0", keywords: ["gnu general public license", "version 3"] },
  { spdx: "GPL-2.0", keywords: ["gnu general public license", "version 2"] },
  { spdx: "LGPL-3.0", keywords: ["gnu lesser general public license", "version 3"] },
  { spdx: "MPL-2.0", keywords: ["mozilla public license", "version 2.0"] },
  { spdx: "Unlicense", keywords: ["this is free and unencumbered software", "public domain"] },
  { spdx: "ISC", keywords: ["isc license", "permission to use"] },
  { spdx: "0BSD", keywords: ["zero-clause", "no copyright"] },
];

/**
 * Try to detect the license by fetching and scanning LICENSE / LICENSE.md
 * content from the repo's default branch.
 */
export async function fallbackDetectLicense(
  fullName: string,
  defaultBranch: string,
  token: string,
  limiter: RateLimiter,
): Promise<string | null> {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return null;
  const filenames = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

  for (const filename of filenames) {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(defaultBranch)}/${encodeURIComponent(filename)}`;

    await limiter.waitForToken();

    try {
      const resp = await request(url, {
        method: "GET",
        headers: {
          "User-Agent": "reposift/1.0.0",
        },
        headersTimeout: 15_000,
        bodyTimeout: 30_000,
      });

      const remaining = resp.headers["x-ratelimit-remaining"];
      const reset = resp.headers["x-ratelimit-reset"];
      limiter.updateFromHeaders(
        remaining ? Number(remaining) : null,
        reset ? Number(reset) : null,
      );

      if (resp.statusCode !== 200) continue;

      const content = await resp.body.text();
      const detected = matchLicenseByContent(content);
      if (detected) return detected;
    } catch {
      continue;
    }
  }

  return null;
}

function matchLicenseByContent(content: string): string | null {
  const lower = content.toLowerCase();
  for (const { spdx, keywords } of LICENSE_PATTERNS) {
    const matches = keywords.filter((kw) => lower.includes(kw));
    if (matches.length >= 2) return spdx;
  }
  return null;
}

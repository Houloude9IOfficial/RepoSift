import { request } from "undici";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export async function downloadTarball(
  fullName: string,
  defaultBranch: string,
  destPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const [owner, name] = fullName.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format "${fullName}". Expected "owner/repo".`);
  }
  const url = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tar.gz/${encodeURIComponent(defaultBranch)}`;

  const resp = await request(url, {
    method: "GET",
    headers: {
      "User-Agent": "reposift/0.1.0",
    },
    signal,
    headersTimeout: 30_000,
    bodyTimeout: 120_000,
  });

  if (resp.statusCode !== 200) {
    const body = await resp.body.text();
    throw new Error(`Tarball download failed with status ${resp.statusCode} for "${fullName}": ${body}`);
  }

  const dest = createWriteStream(destPath);
  await pipeline(resp.body, dest);
}

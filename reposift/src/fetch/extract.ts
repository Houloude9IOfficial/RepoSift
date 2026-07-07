import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";

/**
 * Extract a tarball to a temporary directory.
 * Returns the path to the extracted root (strip=1 removes the outer folder).
 */
export async function extractTarball(
  tarballPath: string,
  stripComponents: number = 1,
): Promise<string> {
  const extractDir = mkdtempSync(join(tmpdir(), "reposift-"));
  
  await tar.x({
    file: tarballPath,
    cwd: extractDir,
    strip: stripComponents,
    C: extractDir,
  });

  return extractDir;
}

/**
 * Simply list the root directory of the extracted tarball.
 */
export function getExtractedRoot(extractDir: string): string {
  return extractDir;
}

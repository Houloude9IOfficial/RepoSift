import { minimatch } from "minimatch";

/**
 * Check if a file path matches any of the exclusion patterns.
 * Supports glob patterns via minimatch.
 */
export function isPathExcluded(
  filePath: string,
  excludePatterns: string[],
): boolean {
  for (const pattern of excludePatterns) {
    if (minimatch(filePath, pattern, { dot: true, matchBase: true })) {
      return true;
    }
    if (minimatch(filePath, `**/${pattern}`, { dot: true })) {
      return true;
    }
    if (minimatch(filePath, `**/${pattern}/**`, { dot: true })) {
      return true;
    }
  }
  return false;
}

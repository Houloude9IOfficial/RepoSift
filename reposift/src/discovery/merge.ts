import type { RepoRecord } from "../metadata/repoRecord.js";

export function mergeCandidates(...sources: RepoRecord[][]): RepoRecord[] {
  const seen = new Set<string>();
  const merged: RepoRecord[] = [];

  for (const batch of sources) {
    for (const repo of batch) {
      if (!seen.has(repo.fullName)) {
        seen.add(repo.fullName);
        merged.push(repo);
      }
    }
  }

  return merged;
}

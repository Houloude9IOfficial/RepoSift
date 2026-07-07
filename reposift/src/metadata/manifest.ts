import type { RepoRecord, FileMetadata } from "./repoRecord.js";

export interface RepoManifest {
  owner: string;
  repo: string;
  fullName: string;
  stars: number;
  license?: string;
  language?: string;
  description?: string;
  defaultBranch: string;
  url: string;
  fileCount: number;
  totalBytes: number;
}

export interface DatasetStats {
  name: string;
  totalRepos: number;
  totalFiles: number;
  totalBytes: number;
  totalSizeGB: number;
  licenseBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  duplicatesSkipped: number;
}

export class ManifestBuilder {
  private repos: Map<string, RepoManifest> = new Map();
  private fileCount = 0;
  private totalBytes = 0;
  private licenseBreakdown: Record<string, number> = {};
  private languageBreakdown: Record<string, number> = {};
  private duplicatesSkipped = 0;

  addRepo(repo: RepoRecord, filesProcessed: number, bytesProcessed: number): void {
    this.repos.set(repo.fullName, {
      owner: repo.owner,
      repo: repo.repo,
      fullName: repo.fullName,
      stars: repo.stars,
      license: repo.license,
      language: repo.language,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      url: repo.url,
      fileCount: filesProcessed,
      totalBytes: bytesProcessed,
    });

    // Update breakdowns
    if (repo.license) {
      this.licenseBreakdown[repo.license] = (this.licenseBreakdown[repo.license] || 0) + 1;
    } else {
      this.licenseBreakdown["unknown"] = (this.licenseBreakdown["unknown"] || 0) + 1;
    }
    if (repo.language) {
      this.languageBreakdown[repo.language] = (this.languageBreakdown[repo.language] || 0) + 1;
    } else {
      this.languageBreakdown["unknown"] = (this.languageBreakdown["unknown"] || 0) + 1;
    }
  }

  addFile(sizeBytes: number): void {
    this.fileCount++;
    this.totalBytes += sizeBytes;
  }

  addDuplicate(): void {
    this.duplicatesSkipped++;
  }

  buildManifest(): RepoManifest[] {
    return Array.from(this.repos.values());
  }

  buildStats(name: string): DatasetStats {
    return {
      name,
      totalRepos: this.repos.size,
      totalFiles: this.fileCount,
      totalBytes: this.totalBytes,
      totalSizeGB: this.totalBytes / (1024 * 1024 * 1024),
      licenseBreakdown: { ...this.licenseBreakdown },
      languageBreakdown: { ...this.languageBreakdown },
      duplicatesSkipped: this.duplicatesSkipped,
    };
  }
}

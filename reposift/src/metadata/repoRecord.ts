export interface RepoRecord {
  owner: string;
  repo: string;
  fullName: string;
  stars: number;
  language?: string;
  license?: string;
  description?: string;
  defaultBranch: string;
  url: string;
}

export interface FilteredFile {
  relativePath: string;
  content: Buffer;
  sizeBytes: number;
}

export interface FileMetadata {
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  license?: string;
  language?: string;
  stars: number;
}

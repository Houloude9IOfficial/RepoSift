import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

export interface CheckpointState {
  completedRepos: string[];
  totalFilesProcessed: number;
  totalBytesProcessed: number;
  lastUpdated: string;
}

export class CheckpointManager {
  private checkpointPath: string;
  private state: CheckpointState;

  constructor(datasetName: string, outputDir?: string) {
    const dir = outputDir ?? join(tmpdir(), "reposift-checkpoints");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.checkpointPath = join(dir, `${datasetName}.checkpoint.json`);

    if (existsSync(this.checkpointPath)) {
      try {
        const raw = readFileSync(this.checkpointPath, "utf-8");
        this.state = JSON.parse(raw) as CheckpointState;
      } catch {
        this.state = this.emptyState();
      }
    } else {
      this.state = this.emptyState();
    }
  }

  private emptyState(): CheckpointState {
    return {
      completedRepos: [],
      totalFilesProcessed: 0,
      totalBytesProcessed: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  isRepoCompleted(fullName: string): boolean {
    return this.state.completedRepos.includes(fullName);
  }

  markRepoCompleted(fullName: string, filesProcessed: number, bytesProcessed: number): void {
    this.state.completedRepos.push(fullName);
    this.state.totalFilesProcessed += filesProcessed;
    this.state.totalBytesProcessed += bytesProcessed;
    this.state.lastUpdated = new Date().toISOString();
    this.save();
  }

  getState(): CheckpointState {
    return { ...this.state };
  }

  private save(): void {
    writeFileSync(this.checkpointPath, JSON.stringify(this.state, null, 2));
  }
}

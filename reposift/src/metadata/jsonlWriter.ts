import { createWriteStream, type WriteStream } from "node:fs";
import type { FileMetadata } from "./repoRecord.js";

export class JsonlWriter {
  private stream: WriteStream;
  private linesWritten = 0;

  constructor(outputPath: string) {
    this.stream = createWriteStream(outputPath, { flags: "a" });
  }

  write(metadata: FileMetadata): void {
    this.stream.write(JSON.stringify(metadata) + "\n");
    this.linesWritten++;
  }

  get count(): number {
    return this.linesWritten;
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream.end((err: Error | undefined) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

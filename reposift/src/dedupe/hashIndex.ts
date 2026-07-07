import { createHash } from "node:crypto";

export class HashIndex {
  private seen = new Set<string>();
  private hashCount = 0;
  private duplicateCount = 0;

  /**
   * Compute SHA256 hash of a buffer.
   */
  static hashBuffer(buf: Buffer): string {
    return createHash("sha256").update(buf).digest("hex");
  }

  /**
   * Check if content is a duplicate. Returns true if already seen.
   */
  isDuplicate(content: Buffer): boolean {
    const hash = HashIndex.hashBuffer(content);
    if (this.seen.has(hash)) {
      this.duplicateCount++;
      return true;
    }
    this.seen.add(hash);
    this.hashCount++;
    return false;
  }

  get stats() {
    return {
      uniqueHashes: this.hashCount,
      duplicateFiles: this.duplicateCount,
    };
  }
}

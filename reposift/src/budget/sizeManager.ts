export class SizeManager {
  private totalBytes = 0;
  private readonly maxBytes: number;
  private exceeded = false;

  constructor(maxSizeGB: number) {
    this.maxBytes = maxSizeGB * 1024 * 1024 * 1024;
  }

  /**
   * Try to add bytes to the running total.
   * Returns true if the bytes were added (within budget).
   * Returns false if adding would exceed the budget.
   */
  tryAdd(bytes: number): boolean {
    if (this.exceeded) return false;
    if (this.totalBytes + bytes > this.maxBytes) {
      this.exceeded = true;
      return false;
    }
    this.totalBytes += bytes;
    return true;
  }

  get isExceeded(): boolean {
    return this.exceeded;
  }

  get usedBytes(): number {
    return this.totalBytes;
  }

  get maxBytesValue(): number {
    return this.maxBytes;
  }

  get usedGB(): number {
    return this.totalBytes / (1024 * 1024 * 1024);
  }

  get remainingGB(): number {
    return Math.max(0, this.maxBytes - this.totalBytes) / (1024 * 1024 * 1024);
  }

  get usagePercent(): number {
    return (this.totalBytes / this.maxBytes) * 100;
  }
}

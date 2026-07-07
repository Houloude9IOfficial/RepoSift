export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private readonly refillIntervalMs: number;
  private readonly refillAmount: number;

  constructor(maxRequestsPerSecond: number = 5) {
    this.maxTokens = maxRequestsPerSecond;
    this.tokens = maxRequestsPerSecond;
    this.lastRefill = Date.now();
    this.refillIntervalMs = 1000;
    this.refillAmount = maxRequestsPerSecond;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const earned = Math.floor(elapsed / this.refillIntervalMs) * this.refillAmount;
    if (earned > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + earned);
      this.lastRefill = now;
    }
  }

  async waitForToken(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.refill();
      if (this.tokens > 0) {
        this.tokens--;
        return;
      }
      const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 0)));
    }
  }

  updateFromHeaders(remaining: number | null, _resetTimestamp: number | null): void {
    // Only ever cap the current bucket — never reduce maxTokens.
    // MaxTokens determines the refill ceiling (requests per second).
    // If we set maxTokens = 0 when GitHub returns remaining: 0,
    // the rate limiter is permanently stuck.
    if (remaining !== null && remaining < this.tokens) {
      this.tokens = remaining;
    }
  }
}

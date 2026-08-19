interface LoginAttempt {
  count: number;
  windowStartedAt: number;
}

/**
 * Bounds failed-login tracking by both time and entry count.
 *
 * This limiter is intentionally process-local for the single-instance MVP.
 * A distributed deployment must replace it with a shared rate-limit store.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttempt>();

  public constructor(
    private readonly windowMs = 60_000,
    private readonly maxAttempts = 5,
    private readonly maxTrackedKeys = 10_000,
    private readonly now: () => number = Date.now
  ) {}

  public isBlocked(key: string): boolean {
    const timestamp = this.now();
    this.pruneExpired(timestamp);
    return (this.attempts.get(key)?.count ?? 0) >= this.maxAttempts;
  }

  public recordFailure(key: string): void {
    const timestamp = this.now();
    this.pruneExpired(timestamp);
    const current = this.attempts.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    if (this.attempts.size >= this.maxTrackedKeys) {
      const oldestKey = this.attempts.keys().next().value;
      if (oldestKey !== undefined) {
        this.attempts.delete(oldestKey);
      }
    }
    this.attempts.set(key, {
      count: 1,
      windowStartedAt: timestamp
    });
  }

  public reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Exposed for deterministic capacity tests and operational diagnostics. */
  public trackedKeyCount(): number {
    return this.attempts.size;
  }

  private pruneExpired(timestamp: number): void {
    for (const [key, attempt] of this.attempts) {
      if (timestamp - attempt.windowStartedAt >= this.windowMs) {
        this.attempts.delete(key);
      }
    }
  }
}

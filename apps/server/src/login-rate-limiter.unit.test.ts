import { describe, expect, it } from "vitest";

import { LoginRateLimiter } from "./login-rate-limiter.js";

describe("LoginRateLimiter", () => {
  it("blocks repeated failures and expires the window", () => {
    let now = 0;
    const limiter = new LoginRateLimiter(1_000, 2, 10, () => now);

    limiter.recordFailure("client");
    expect(limiter.isBlocked("client")).toBe(false);
    limiter.recordFailure("client");
    expect(limiter.isBlocked("client")).toBe(true);

    now = 1_000;
    expect(limiter.isBlocked("client")).toBe(false);
    expect(limiter.trackedKeyCount()).toBe(0);
  });

  it("evicts the oldest key when capacity is reached", () => {
    let now = 0;
    const limiter = new LoginRateLimiter(10_000, 5, 2, () => now);

    limiter.recordFailure("first");
    now += 1;
    limiter.recordFailure("second");
    now += 1;
    limiter.recordFailure("third");

    expect(limiter.trackedKeyCount()).toBe(2);
    expect(limiter.isBlocked("first")).toBe(false);
  });
});

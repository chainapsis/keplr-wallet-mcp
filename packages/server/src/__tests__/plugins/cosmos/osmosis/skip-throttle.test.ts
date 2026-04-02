import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkipThrottle } from "../../../../plugins/cosmos/osmosis/skip-throttle.js";

describe("SkipThrottle", () => {
  let throttle: SkipThrottle;

  beforeEach(() => {
    vi.useFakeTimers();
    throttle = new SkipThrottle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow first request immediately", async () => {
    const start = Date.now();
    await throttle.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should delay consecutive requests by 500ms", async () => {
    await throttle.acquire();
    const start = Date.now();

    const promise = throttle.acquire();
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
  });

  it("should enter 60s cooldown on markRateLimited", async () => {
    throttle.markRateLimited();
    expect(throttle.isRateLimited()).toBe(true);

    const promise = throttle.acquire();
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(throttle.isRateLimited()).toBe(false);
  });

  it("should report isRateLimited correctly", () => {
    expect(throttle.isRateLimited()).toBe(false);
    throttle.markRateLimited();
    expect(throttle.isRateLimited()).toBe(true);
  });

  it("should allow request without delay after interval elapses", async () => {
    await throttle.acquire();
    await vi.advanceTimersByTimeAsync(500);

    const start = Date.now();
    await throttle.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should serialize concurrent acquire() calls", async () => {
    const timestamps: number[] = [];

    const p1 = throttle.acquire().then(() => timestamps.push(Date.now()));
    const p2 = throttle.acquire().then(() => timestamps.push(Date.now()));
    const p3 = throttle.acquire().then(() => timestamps.push(Date.now()));

    await vi.advanceTimersByTimeAsync(1500);
    await Promise.all([p1, p2, p3]);

    expect(timestamps).toHaveLength(3);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(500);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(500);
  });

  it("should pass without delay when minIntervalMs is 0 (API key mode)", async () => {
    const apiKeyThrottle = new SkipThrottle({
      minIntervalMs: 0,
      cooldownMs: 10_000,
    });

    await apiKeyThrottle.acquire();
    const start = Date.now();
    await apiKeyThrottle.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should reset state with _reset()", () => {
    throttle.markRateLimited();
    expect(throttle.isRateLimited()).toBe(true);
    throttle._reset();
    expect(throttle.isRateLimited()).toBe(false);
  });
});

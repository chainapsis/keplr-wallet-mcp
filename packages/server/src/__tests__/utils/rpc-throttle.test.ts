import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcThrottle } from "../../utils/rpc-throttle.js";

describe("RpcThrottle", () => {
  let throttle: RpcThrottle;

  beforeEach(() => {
    vi.useFakeTimers();
    throttle = new RpcThrottle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow first request immediately", async () => {
    const start = Date.now();
    await throttle.acquire("rpc.example.com");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should delay same-host requests within 200ms interval", async () => {
    await throttle.acquire("rpc.example.com");
    const start = Date.now();

    const promise = throttle.acquire("rpc.example.com");
    // Advance time to cover the remaining interval
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it("should not delay requests to different hosts", async () => {
    await throttle.acquire("host-a.com");
    const start = Date.now();
    await throttle.acquire("host-b.com");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should apply 30s cooldown on markRateLimited", async () => {
    throttle.markRateLimited("rpc.example.com");
    expect(throttle.isAvailable("rpc.example.com")).toBe(false);

    const promise = throttle.acquire("rpc.example.com");
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(throttle.isAvailable("rpc.example.com")).toBe(true);
  });

  it("should report unavailable host during cooldown", () => {
    throttle.markRateLimited("rpc.example.com");
    expect(throttle.isAvailable("rpc.example.com")).toBe(false);
    expect(throttle.isAvailable("other.com")).toBe(true);
  });

  it("should allow request after interval elapses", async () => {
    await throttle.acquire("rpc.example.com");
    await vi.advanceTimersByTimeAsync(200);

    const start = Date.now();
    await throttle.acquire("rpc.example.com");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should serialize concurrent acquire() calls to the same host", async () => {
    const timestamps: number[] = [];

    // Launch 3 concurrent acquire() calls to the same host
    const p1 = throttle.acquire("rpc.example.com").then(() => {
      timestamps.push(Date.now());
    });
    const p2 = throttle.acquire("rpc.example.com").then(() => {
      timestamps.push(Date.now());
    });
    const p3 = throttle.acquire("rpc.example.com").then(() => {
      timestamps.push(Date.now());
    });

    // Advance enough time for all 3 to resolve (200ms interval each)
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([p1, p2, p3]);

    expect(timestamps).toHaveLength(3);
    // Each subsequent call must be at least MIN_INTERVAL_MS (200ms) after the previous
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(200);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(200);
  });

  it("should not block concurrent acquire() calls to different hosts", async () => {
    const timestamps: number[] = [];

    const p1 = throttle.acquire("host-a.com").then(() => {
      timestamps.push(Date.now());
    });
    const p2 = throttle.acquire("host-b.com").then(() => {
      timestamps.push(Date.now());
    });
    const p3 = throttle.acquire("host-c.com").then(() => {
      timestamps.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([p1, p2, p3]);

    expect(timestamps).toHaveLength(3);
    // All should complete almost simultaneously (no inter-host blocking)
    const spread = Math.max(...timestamps) - Math.min(...timestamps);
    expect(spread).toBeLessThan(50);
  });

  it("should clean up orphaned cooldown entries", async () => {
    // markRateLimited without a prior acquire() creates an orphan
    throttle.markRateLimited("orphan-host.com");
    expect(throttle.isAvailable("orphan-host.com")).toBe(false);

    // Advance past cooldown (30s)
    await vi.advanceTimersByTimeAsync(30_000);

    // Force cleanup by making 50 requests to another host
    for (let i = 0; i < 50; i++) {
      await throttle.acquire("cleanup-trigger.com");
      await vi.advanceTimersByTimeAsync(200);
    }

    // Orphaned cooldown should now be cleaned up
    expect(throttle.isAvailable("orphan-host.com")).toBe(true);
  });
});

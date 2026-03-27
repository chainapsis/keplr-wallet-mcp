/**
 * Per-host request throttle for RPC/LCD endpoints.
 *
 * Prevents IP bans by enforcing minimum intervals between requests
 * to the same host and backing off on 429 responses.
 */

const MIN_INTERVAL_MS = 200;
const COOLDOWN_MS = 30_000;
const STALE_MS = 300_000; // 5 minutes

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RpcThrottle {
  private lastRequestTime = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  private pendingAcquire = new Map<string, Promise<void>>();
  private cleanupCounter = 0;

  /**
   * Acquire a slot for the given host.
   * Concurrent calls to the same host are serialized via a per-host promise chain
   * to prevent race conditions where multiple callers bypass the throttle.
   */
  async acquire(host: string): Promise<void> {
    const prev = this.pendingAcquire.get(host) ?? Promise.resolve();
    const next = prev.then(
      () => this.doAcquire(host),
      () => this.doAcquire(host),
    );
    this.pendingAcquire.set(host, next);
    await next;
  }

  private async doAcquire(host: string): Promise<void> {
    const now = Date.now();

    // Wait for cooldown if rate-limited
    const cooldownEnd = this.cooldownUntil.get(host);
    if (cooldownEnd && now < cooldownEnd) {
      await sleep(cooldownEnd - now);
    }

    // Enforce minimum interval between requests to the same host
    const lastTime = this.lastRequestTime.get(host);
    if (lastTime) {
      const elapsed = Date.now() - lastTime;
      if (elapsed < MIN_INTERVAL_MS) {
        await sleep(MIN_INTERVAL_MS - elapsed);
      }
    }

    this.lastRequestTime.set(host, Date.now());

    // Periodic cleanup every 50 requests
    if (++this.cleanupCounter % 50 === 0) {
      this.cleanup();
    }
  }

  markRateLimited(host: string): void {
    this.cooldownUntil.set(host, Date.now() + COOLDOWN_MS);
  }

  isAvailable(host: string): boolean {
    const cooldownEnd = this.cooldownUntil.get(host);
    return !cooldownEnd || Date.now() >= cooldownEnd;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [host, time] of this.lastRequestTime) {
      if (now - time > STALE_MS) {
        this.lastRequestTime.delete(host);
        this.cooldownUntil.delete(host);
        this.pendingAcquire.delete(host);
      }
    }
    // Remove expired cooldowns that have no corresponding lastRequestTime entry
    for (const [host, until] of this.cooldownUntil) {
      if (now >= until) {
        this.cooldownUntil.delete(host);
      }
    }
  }
}

export const rpcThrottle = new RpcThrottle();

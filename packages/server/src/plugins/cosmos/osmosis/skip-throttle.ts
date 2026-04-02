/**
 * Skip API request throttle.
 *
 * Enforces minimum intervals between requests and backs off on 429 responses.
 * Policy varies by API key presence (unauthenticated users share a global rate limit).
 */

import { SKIP_API_KEY } from "./constants.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- Policy by API key ---

export const MAX_RETRIES = SKIP_API_KEY ? 1 : 3;

export interface SkipThrottleConfig {
  minIntervalMs: number;
  cooldownMs: number;
}

const defaultConfig: SkipThrottleConfig = {
  minIntervalMs: SKIP_API_KEY ? 0 : 500,
  cooldownMs: SKIP_API_KEY ? 10_000 : 60_000,
};

export class SkipThrottle {
  private readonly config: SkipThrottleConfig;
  private lastRequestTime = 0;
  private cooldownUntil = 0;
  private pendingAcquire: Promise<void> = Promise.resolve();

  constructor(config: SkipThrottleConfig = defaultConfig) {
    this.config = config;
  }

  /** Wait for minimum interval and any active cooldown before making a request. */
  async acquire(): Promise<void> {
    const prev = this.pendingAcquire;
    const next = prev.then(
      () => this.doAcquire(),
      () => this.doAcquire(),
    );
    this.pendingAcquire = next;
    await next;
  }

  private async doAcquire(): Promise<void> {
    const now = Date.now();

    if (now < this.cooldownUntil) {
      await sleep(this.cooldownUntil - now);
    }

    if (this.config.minIntervalMs > 0 && this.lastRequestTime > 0) {
      const elapsed = Date.now() - this.lastRequestTime;
      if (elapsed < this.config.minIntervalMs) {
        await sleep(this.config.minIntervalMs - elapsed);
      }
    }

    this.lastRequestTime = Date.now();
  }

  /** Mark that a 429 was received — enters cooldown. */
  markRateLimited(): void {
    this.cooldownUntil = Date.now() + this.config.cooldownMs;
  }

  /** Whether the throttle is currently in cooldown. */
  isRateLimited(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  /** Reset internal state (testing only). */
  _reset(): void {
    this.lastRequestTime = 0;
    this.cooldownUntil = 0;
    this.pendingAcquire = Promise.resolve();
  }
}

export const skipThrottle = new SkipThrottle();

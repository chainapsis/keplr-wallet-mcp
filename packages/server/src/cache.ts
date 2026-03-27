/**
 * Simple in-memory TTL cache for expensive operations.
 *
 * Use cases:
 * - Chain registry lookups
 * - Balance queries
 * - Token metadata
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * Create a new TTL cache.
   * @param defaultTtlMs Default time-to-live in milliseconds (default: 60 seconds)
   * @param cleanupIntervalMs Interval for automatic cleanup (default: 30 seconds)
   */
  constructor(defaultTtlMs = 60_000, cleanupIntervalMs = 30_000) {
    this.defaultTtlMs = defaultTtlMs;

    // Start background cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    // Don't prevent process exit
    this.cleanupTimer.unref();
  }

  /**
   * Get a value from the cache.
   * Returns undefined if the key doesn't exist or has expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * @param key Cache key
   * @param value Value to store
   * @param ttlMs Optional TTL override in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Get a value from the cache, or compute and store it if not present.
   * @param key Cache key
   * @param compute Function to compute the value if not cached
   * @param ttlMs Optional TTL override in milliseconds
   */
  async getOrSet(
    key: string,
    compute: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key from the cache.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a prefix.
   * @param prefix Key prefix to match
   * @returns Number of keys deleted
   */
  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries from the cache.
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Stop the background cleanup timer.
   * Call this when disposing of the cache.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

// Pre-configured cache instances for common use cases

/**
 * Cache for balance queries (30 second TTL).
 * Balances change frequently, so use a short TTL.
 */
export const balanceCache = new TTLCache<unknown>(30_000);

/**
 * Cache for chain registry data (5 minute TTL).
 * Chain config rarely changes.
 */
export const chainCache = new TTLCache<unknown>(5 * 60_000);

/**
 * Cache for token metadata (10 minute TTL).
 * Token info is relatively static.
 */
export const tokenCache = new TTLCache<unknown>(10 * 60_000);

/**
 * Helper to create a cache key from multiple parts.
 * @example cacheKey('balance', 'cosmos', 'cosmos1abc...') => 'balance:cosmos:cosmos1abc...'
 */
export function cacheKey(...parts: string[]): string {
  return parts.join(":");
}

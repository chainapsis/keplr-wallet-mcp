/**
 * Balance Enricher Registry
 *
 * Plugin hook for enriching balance data after the standard
 * formatBalances → enrichIbcDenoms pipeline. Plugins (e.g., Osmosis)
 * can register enrichers that resolve unresolved token metadata
 * (symbol, decimals) using external data sources.
 *
 * @example
 * ```typescript
 * balanceEnricherRegistry.register({
 *   id: "osmosis-skip",
 *   chainIds: ["osmosis-1"],
 *   enrich: async (balances, chainId) => {
 *     // resolve unresolved denoms via Skip API
 *     return enrichedBalances;
 *   },
 * });
 * ```
 */

import type { BalanceResult } from "../clients/cosmos.js";

/**
 * A balance enricher that can resolve additional token metadata.
 */
export interface BalanceEnricher {
  /** Unique identifier for this enricher. */
  id: string;

  /** Chain IDs this enricher handles. Empty array means all chains. */
  chainIds: string[];

  /**
   * Enrich balance results with additional metadata.
   * Must return a new array (or the same array if no changes).
   */
  enrich(balances: BalanceResult[], chainId: string): Promise<BalanceResult[]>;
}

/**
 * Registry for balance enrichers.
 */
export class BalanceEnricherRegistry {
  private enrichers: BalanceEnricher[] = [];

  /**
   * Register a balance enricher.
   *
   * @param enricher - Enricher to register
   * @throws Error if an enricher with the same id already exists
   */
  register(enricher: BalanceEnricher): void {
    if (this.enrichers.some((e) => e.id === enricher.id)) {
      throw new Error(
        `Balance enricher "${enricher.id}" is already registered.`,
      );
    }
    this.enrichers.push(enricher);
  }

  /**
   * Unregister an enricher by id.
   *
   * @returns true if the enricher was found and removed
   */
  unregister(id: string): boolean {
    const before = this.enrichers.length;
    this.enrichers = this.enrichers.filter((e) => e.id !== id);
    return this.enrichers.length < before;
  }

  /**
   * Run all applicable enrichers on the given balances.
   * Enrichers are applied sequentially in registration order.
   * If an enricher throws, it is skipped and the previous result is used.
   */
  async enrich(
    balances: BalanceResult[],
    chainId: string,
  ): Promise<BalanceResult[]> {
    let result = balances;

    for (const enricher of this.enrichers) {
      if (
        enricher.chainIds.length > 0 &&
        !enricher.chainIds.includes(chainId)
      ) {
        continue;
      }
      try {
        result = await enricher.enrich(result, chainId);
      } catch (error) {
        console.warn(
          `[balance-enricher] Enricher "${enricher.id}" failed for chain "${chainId}":`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return result;
  }

  /**
   * Get all registered enrichers (for debugging/testing).
   */
  getEnrichers(): BalanceEnricher[] {
    return [...this.enrichers];
  }

  /**
   * Clear all registered enrichers.
   * Useful for testing.
   */
  clear(): void {
    this.enrichers = [];
  }
}

/**
 * Global balance enricher registry instance.
 */
export const balanceEnricherRegistry = new BalanceEnricherRegistry();

/**
 * MCP Completions
 *
 * Provides autocompletion support for prompt and resource arguments.
 * Enables intelligent suggestions for chain names, account names, etc.
 */

import { listAccounts } from "../accounts.js";
import {
  getStakeDenom,
  getStakeMinimalDenom,
  listChains,
} from "../chains/cosmos.js";

/**
 * Completion provider function type
 */
export type CompletionProvider = (
  value: string,
  context?: { arguments?: Record<string, string> },
) => string[] | Promise<string[]>;

/**
 * Chain name/ID completion provider
 * Returns matching chain IDs and names
 */
export const chainCompletionProvider: CompletionProvider = async (value) => {
  const chains = listChains();
  const lowerValue = value.toLowerCase();

  const matches = chains.filter(
    (c) =>
      c.chainId.toLowerCase().includes(lowerValue) ||
      c.chainName.toLowerCase().includes(lowerValue) ||
      getStakeDenom(c).toLowerCase().includes(lowerValue),
  );

  // Return both chainId and chainName for flexibility
  const results: string[] = [];
  for (const chain of matches.slice(0, 20)) {
    if (!results.includes(chain.chainId)) {
      results.push(chain.chainId);
    }
    if (
      !results.includes(chain.chainName) &&
      chain.chainName !== chain.chainId
    ) {
      results.push(chain.chainName);
    }
  }

  return results.slice(0, 10);
};

/**
 * Account name completion provider
 * Returns matching account names
 */
export const accountCompletionProvider: CompletionProvider = async (value) => {
  const config = await listAccounts();
  const lowerValue = value.toLowerCase();

  return Object.keys(config.accounts)
    .filter((name) => name.toLowerCase().includes(lowerValue))
    .slice(0, 10);
};

/**
 * Token denom completion provider for a specific chain
 * Uses context.arguments.chain to determine which chain's tokens to suggest
 */
export const tokenDenomCompletionProvider: CompletionProvider = async (
  value,
  context,
) => {
  // Get chain from context if available
  const chainInput = context?.arguments?.chain;
  if (!chainInput) {
    // Return common denoms if no chain specified
    return ["uatom", "uosmo", "ustars", "uakt", "ujuno"].filter((d) =>
      d.includes(value.toLowerCase()),
    );
  }

  // Find the chain and return its native denom
  const chains = listChains();
  const lowerChain = chainInput.toLowerCase();
  const chain = chains.find(
    (c) =>
      c.chainId.toLowerCase() === lowerChain ||
      c.chainName.toLowerCase() === lowerChain,
  );

  if (chain) {
    const suggestions = [getStakeMinimalDenom(chain), getStakeDenom(chain)];
    return suggestions.filter((s) =>
      s.toLowerCase().includes(value.toLowerCase()),
    );
  }

  return [];
};

/**
 * Validator address completion provider
 * Returns validator addresses for a specific chain
 * Note: This is a placeholder - full implementation would query chain
 */
export const validatorCompletionProvider: CompletionProvider = async (
  _value,
  _context,
) => {
  // This would ideally query the chain for validators
  // For now, just return empty (user types full address)
  return [];
};

/**
 * Common completion providers registry
 */
export const COMPLETION_PROVIDERS = {
  chain: chainCompletionProvider,
  account: accountCompletionProvider,
  denom: tokenDenomCompletionProvider,
  validator: validatorCompletionProvider,
} as const;

/**
 * Create a fuzzy matcher for completion
 */
export function createFuzzyMatcher(items: string[]): CompletionProvider {
  return async (value) => {
    const lowerValue = value.toLowerCase();
    return items
      .filter((item) => item.toLowerCase().includes(lowerValue))
      .slice(0, 10);
  };
}

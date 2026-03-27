import type { ChainInfo } from "@keplr-wallet/types";
import { findAllChainsByName, getChainConfig } from "../chains/cosmos.js";

export const VALID_WORD_COUNTS = [12, 15, 18, 21, 24];

export const CHAIN_PARAM_DESC =
  "Chain ID or chain name. " +
  "IMPORTANT: If unsure of the exact chain ID, call list-cosmos-chains first. " +
  "Do NOT guess — chain IDs are often non-obvious (e.g., 'nyx' not 'nym-1', 'phoenix-1' not 'terra-2').";

export const resolveChain = (chainIdOrName: string): ChainInfo => {
  const exact = getChainConfig(chainIdOrName);
  if (exact) return exact;

  const allMatches = findAllChainsByName(chainIdOrName);
  if (allMatches.length === 1) return allMatches[0];

  if (allMatches.length > 1) {
    const candidates = allMatches
      .map((c) => `"${c.chainId}" (${c.chainName})`)
      .join(", ");
    throw new Error(
      `Ambiguous chain: "${chainIdOrName}" matches multiple chains: ${candidates}. ` +
        `Please specify the exact chain ID. Use list-cosmos-chains to see all supported chains.`,
    );
  }

  throw new Error(
    `Unknown chain: "${chainIdOrName}". ` +
      `Use the list-cosmos-chains tool to look up the correct chain ID.`,
  );
};

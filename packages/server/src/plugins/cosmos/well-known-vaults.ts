/**
 * Well-known vault contracts per chain.
 *
 * These are curated DeFi vault/bonding contracts whose positions don't
 * appear in native staking queries. The registry lets `get-staking-info`
 * and `get-portfolio` probe them automatically so the agent can discover
 * and act on vault positions without knowing contract addresses upfront.
 */

import type { SuggestedAction } from "../../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultDefinition {
  /** Protocol name (e.g. "Neutron DAO") */
  protocol: string;
  /** Human-readable description */
  description: string;
  /** Contract address */
  contractAddress: string;
  /** Minimal denom of the bonded asset */
  bondDenom: string;
  /** Build the smart-query message to check user's bonded position */
  buildPositionQuery: (address: string) => Record<string, unknown>;
  /** Extract bonded amount (in minimal denom) from query result. Returns "0" if none. */
  extractBondedAmount: (data: unknown) => string;
  /** Build the execute message to unbond */
  buildUnbondMsg: (amount: string) => string;
}

export interface VaultPosition {
  protocol: string;
  description: string;
  contractAddress: string;
  bondedAmount: string;
  bondDenom: string;
  displayAmount?: string;
  displayDenom?: string;
  priceUsd?: number | null;
  valueUsd?: number | null;
  suggestedActions: SuggestedAction[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const WELL_KNOWN_VAULTS: Record<string, VaultDefinition[]> = {
  "neutron-1": [
    {
      protocol: "Neutron DAO",
      description:
        "NTRN governance vault — bonded NTRN for on-chain voting power",
      contractAddress:
        "neutron1qeyjez6a9dwlghf9d6cy44fxmsajztw257586akk6xn6k88x0gus5djz4e",
      bondDenom: "untrn",
      buildPositionQuery: (address) => ({
        voting_power_at_height: { address },
      }),
      extractBondedAmount: (data) => {
        const r = data as { power?: string } | undefined;
        return r?.power ?? "0";
      },
      buildUnbondMsg: (amount) => JSON.stringify({ unbond: { amount } }),
    },
  ],
};

/** Get vault definitions for a chain. Returns `[]` when none are registered. */
export const getWellKnownVaults = (chainId: string): VaultDefinition[] =>
  WELL_KNOWN_VAULTS[chainId] ?? [];

// ---------------------------------------------------------------------------
// Probing helper
// ---------------------------------------------------------------------------

/** Minimal interface required by vault probing — avoids importing the full CosmosClient. */
export interface VaultQueryClient {
  queryContract: (
    chain: unknown,
    contractAddress: string,
    queryMsg: Record<string, unknown>,
  ) => Promise<{ data: unknown }>;
}

/**
 * Query well-known vault contracts for a user's bonded positions.
 * Each vault is probed independently — failures are silently skipped
 * so they never break the main staking flow.
 */
export const probeWellKnownVaults = async (
  client: VaultQueryClient,
  chain: { chainId: string },
  address: string,
): Promise<VaultPosition[]> => {
  const vaults = getWellKnownVaults(chain.chainId);
  if (vaults.length === 0) return [];

  const results = await Promise.allSettled(
    vaults.map(async (v): Promise<VaultPosition | null> => {
      const result = await client.queryContract(
        chain,
        v.contractAddress,
        v.buildPositionQuery(address),
      );
      const amount = v.extractBondedAmount(result.data);
      if (!amount || amount === "0") return null;

      return {
        protocol: v.protocol,
        description: v.description,
        contractAddress: v.contractAddress,
        bondedAmount: amount,
        bondDenom: v.bondDenom,
        suggestedActions: [
          {
            tool: "cosmwasm-execute",
            reason: `Unbond ${amount} ${v.bondDenom} from ${v.protocol}`,
            params: {
              chain: chain.chainId,
              contractAddress: v.contractAddress,
              executeMsg: v.buildUnbondMsg(amount),
            },
            priority: 1,
          },
        ],
      };
    }),
  );

  const positions: VaultPosition[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      positions.push(r.value);
    }
  }
  return positions;
};

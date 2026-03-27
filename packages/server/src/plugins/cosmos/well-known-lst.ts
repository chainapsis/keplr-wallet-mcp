/**
 * Well-known liquid staking tokens (LSTs) per chain.
 *
 * These tokens represent liquid-staked positions where direct unstaking via
 * the issuing contract is either impossible or uses non-obvious message
 * formats (e.g. Drop Protocol's factory contract only exposes admin variants).
 *
 * The registry lets `get-portfolio` and `get-balances` annotate matching
 * balances with exit strategies (typically DEX swap or IBC transfer) so the
 * agent doesn't waste tool calls trying to unstake through the factory.
 */

import type { SuggestedAction } from "../../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LstDefinition {
  /** Protocol name (e.g. "Drop Protocol") */
  protocol: string;
  /** Human-readable description */
  description: string;
  /** Underlying asset symbol (e.g. "NTRN") */
  underlyingAsset: string;
  /** Match displayDenom (case-insensitive). When omitted, matching relies solely on denomContains. */
  displayDenom?: string;
  /** Alternative: match substring in raw denom (case-insensitive) */
  denomContains?: string;
  /** Frontend URL for manual exit when MCP tool is unavailable */
  frontendUrl?: string;
  /** Build exit strategy actions for this token */
  buildExitActions: (
    chainId: string,
    displayAmount: string,
    denom: string,
    rawAmount: string,
  ) => SuggestedAction[];
}

export interface LstPosition {
  protocol: string;
  description: string;
  underlyingAsset: string;
  displayDenom: string;
  displayAmount: string;
  denom: string;
  frontendUrl?: string;
  suggestedActions: SuggestedAction[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const makeSupervaultDef = (
  pairName: string,
  contractAddress: string,
): LstDefinition => ({
  protocol: `Neutron Supervault (${pairName})`,
  description: `${pairName} supervault LP — withdraw to reclaim underlying tokens`,
  underlyingAsset: pairName,
  denomContains: contractAddress,
  frontendUrl: "https://app.neutron.org/supervaults",
  buildExitActions: (chainId, displayAmount, _denom, rawAmount) => [
    {
      tool: "cosmwasm-execute",
      reason: `Withdraw ${displayAmount} LP from ${pairName} supervault`,
      params: {
        chain: chainId,
        contractAddress,
        executeMsg: JSON.stringify({ withdraw: { amount: rawAmount } }),
      },
      priority: 1,
    },
  ],
});

const WELL_KNOWN_LSTS: Record<string, LstDefinition[]> = {
  "neutron-1": [
    {
      protocol: "Drop Protocol",
      description:
        "Liquid staked NTRN — direct unstaking not available via factory contract. Swap on DEX or IBC transfer to exit position.",
      underlyingAsset: "NTRN",
      displayDenom: "dNTRN",
      denomContains: "udntrn",
      frontendUrl: "https://app.drop-protocol.org",
      buildExitActions: (chainId, displayAmount, denom, _rawAmount) => [
        {
          tool: "ibc-transfer",
          reason: `Transfer ${displayAmount} dNTRN to Osmosis via IBC, then swap to NTRN using osmosis-swap`,
          params: { chain: chainId, denom },
          priority: 1,
        },
        {
          tool: "send-tokens",
          reason: `Send dNTRN to another address on ${chainId}`,
          params: { chain: chainId, denom },
          priority: 2,
        },
      ],
    },
    makeSupervaultDef(
      "NTRN-USDC",
      "neutron16jdl03kz2ggrdm90lu3t4hdqj3tpc808r06nrcpnf0xun9wuqaws7qw42x",
    ),
    makeSupervaultDef(
      "wBTC-USDC",
      "neutron1z4qky902yes9zl5eruwgdd2pgtlyeglunc0escf0a7n2xeyw97gqcr7u5u",
    ),
    makeSupervaultDef(
      "maxBTC-USDC",
      "neutron1tamvnzeq9e4w6leav38htqutz4ht8jhm8ujp6s3sfsg9yu69kqeq7ygf9a",
    ),
    makeSupervaultDef(
      "maxBTC-wBTC",
      "neutron1r8qcd94anqhrfzmjyppk45pew5kzedrxz8mgk82kmwadqyndvwtstp9yrn",
    ),
    makeSupervaultDef(
      "TIA-USDC",
      "neutron17h00r4czrapkrm6lvhy8rxsuchzlslee8wfhff735ylg7pnymtmszmrtlh",
    ),
    makeSupervaultDef(
      "dATOM-ATOM",
      "neutron18ua532r8lpy8scvysrgcjneyrwuj4x0ne4t2azphxksya596l4cq23lkp9",
    ),
    makeSupervaultDef(
      "dATOM-USDC",
      "neutron1cg4rqufqex62xj5sk2sg0rh5sl7n7wgvjw6e8qxku7z0mmlgc5rqeppwlp",
    ),
    makeSupervaultDef(
      "DYDX-USDC",
      "neutron1y8x2965xxh9rmhdhm0yyt60z3mqplxnffkacq5w7zdm0vfazr6asfazt9l",
    ),
    makeSupervaultDef(
      "SolvBTC-maxBTC",
      "neutron1tu3hvmn3ssmr8weqfxszkk7yuaxeuj7ngag27dkhclm5eqqzctrsx9smwq",
    ),
    makeSupervaultDef(
      "uniBTC-wBTC",
      "neutron1704tmu9nvgk0l8xmpua0su6dq3r89mht0adlx8gxte695qapstks6lzmma",
    ),
    makeSupervaultDef(
      "SolvBTC-wBTC",
      "neutron1vve4kr2j8ftydrh3gjqpns4p86l8x5unpvvheqdwlhpvawarea2suu8972",
    ),
    makeSupervaultDef(
      "eBTC-wBTC",
      "neutron1s8k6gcrnsfrs9rj3j8757w4e0ttmzsdmjvwfwxruhu2t8xjgwxaqegzjgt",
    ),
    makeSupervaultDef(
      "uniBTC-maxBTC",
      "neutron19v7gd733gjuh8h5v7vfxh4kqmhjzpcfe8u6uwrr55zsf9605ccmqch9kv2",
    ),
    makeSupervaultDef(
      "eBTC-maxBTC",
      "neutron15h557a0twgf8dj5nur2e33n45ezmgj5zjrdvwvl7rrx4nvnea8vsfh2r8k",
    ),
  ],
};

/** Get LST definitions for a chain. Returns `[]` when none are registered. */
export const getWellKnownLsts = (chainId: string): LstDefinition[] =>
  WELL_KNOWN_LSTS[chainId] ?? [];

// ---------------------------------------------------------------------------
// Matching helper
// ---------------------------------------------------------------------------

/**
 * Identify well-known LSTs among the given balances and return enriched
 * positions with exit strategies. Skips zero-amount balances.
 */
export const matchLstBalances = (
  chainId: string,
  balances: ReadonlyArray<{
    denom: string;
    amount: string;
    displayDenom: string;
    displayAmount: string;
  }>,
): LstPosition[] => {
  const defs = getWellKnownLsts(chainId);
  if (defs.length === 0) return [];

  const positions: LstPosition[] = [];

  for (const balance of balances) {
    if (balance.amount === "0" || balance.amount === "") continue;

    for (const def of defs) {
      const matchByDisplay = def.displayDenom
        ? def.displayDenom.toLowerCase() === balance.displayDenom.toLowerCase()
        : false;
      const matchByDenom = def.denomContains
        ? balance.denom.toLowerCase().includes(def.denomContains.toLowerCase())
        : false;

      if (matchByDisplay || matchByDenom) {
        positions.push({
          protocol: def.protocol,
          description: def.description,
          underlyingAsset: def.underlyingAsset,
          displayDenom: balance.displayDenom,
          displayAmount: balance.displayAmount,
          denom: balance.denom,
          frontendUrl: def.frontendUrl,
          suggestedActions: def.buildExitActions(
            chainId,
            balance.displayAmount,
            balance.denom,
            balance.amount,
          ),
        });
        break; // One match per balance
      }
    }
  }

  return positions;
};

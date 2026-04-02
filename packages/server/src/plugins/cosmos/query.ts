import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getActiveMnemonic } from "../../accounts.js";
import {
  getBech32Prefix,
  getStakeDenom,
  listChains,
} from "../../chains/cosmos.js";
import {
  getAllFeeTokens,
  hasDynamicFeeTokens,
} from "../../chains/fee-tokens.js";
import type { CosmosClient } from "../../clients/cosmos.js";
import {
  classifyError,
  createSetupRequiredResponse,
  formatClassifiedError,
  isSetupRequiredError,
  type SuggestedAction,
} from "../../errors.js";
import { chainCompletionProvider } from "../../mcp-features/completions.js";
import { pickTip } from "../../tips.js";
import { getGasAdjustment } from "../../utils/format.js";
import { sanitizeString } from "../../utils/sanitize.js";
import { CHAIN_PARAM_DESC, resolveChain } from "../shared.js";
import type { KeplrPlugin } from "../types.js";
import { matchLstBalances } from "./well-known-lst.js";
import {
  probeWellKnownVaults,
  type VaultQueryClient,
} from "./well-known-vaults.js";

/** Error patterns indicating the chain lacks a native staking module
 *  (e.g. ICS consumer chains like Neutron). */
const STAKING_NOT_SUPPORTED_PATTERNS = [
  "unknown query path",
  "unknown service cosmos.staking",
  "not implemented",
  "unimplemented",
  "unknown service cosmos.distribution",
];

const isStakingNotSupportedError = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return STAKING_NOT_SUPPORTED_PATTERNS.some((p) => lower.includes(p));
};

/**
 * Helper to handle errors in query tools.
 * Returns setup guide for setup-required errors, classifies others.
 */
function handleQueryError(
  error: unknown,
  attemptedAction: string,
): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  if (isSetupRequiredError(errorObj.message)) {
    const setupResponse = createSetupRequiredResponse({ attemptedAction });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(setupResponse, null, 2),
        },
      ],
    };
  }

  const classified = classifyError(errorObj);
  const formatted = formatClassifiedError(classified);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ...formatted, tool: attemptedAction }, null, 2),
      },
    ],
    isError: true,
  };
}

const queryPlugin: KeplrPlugin = {
  name: "cosmos-query",
  register(server, store) {
    // --- Tools ---

    server.registerTool(
      "list-cosmos-chains",
      {
        description:
          "List all supported Cosmos chains with their chain IDs, names, and native denominations",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const chains = listChains();
        const summary = chains.map((c) => ({
          chainId: c.chainId,
          name: c.chainName,
          denom: getStakeDenom(c),
          bech32Prefix: getBech32Prefix(c),
        }));

        const suggestedActions: SuggestedAction[] = [
          {
            tool: "get-cosmos-address",
            reason: "Get your wallet address for a specific chain",
            params: { chain: chains[0]?.chainId || "osmosis-1" },
            priority: 1,
          },
          {
            tool: "get-balances",
            reason: "Check your token balances on a chain",
            params: { chain: chains[0]?.chainId || "osmosis-1" },
            priority: 2,
          },
          {
            tool: "list-validators",
            reason: "View validators for staking",
            params: { chain: chains[0]?.chainId || "osmosis-1" },
            priority: 3,
          },
        ];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: summary.length,
                  chains: summary,
                  suggestedActions,
                  tip: pickTip("list-cosmos-chains"),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "list-fee-tokens",
      {
        description:
          "List all accepted fee tokens for a chain with current balances. For chains like Osmosis, dynamically fetches 100+ supported fee tokens from the chain. Useful for knowing which tokens can be used to pay transaction fees.",
        inputSchema: {
          chain: z
            .string()
            .describe(
              "Chain ID or name (e.g., 'osmosis-1', 'noble-1', 'noble')",
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const balances = await c.getBalances(chain);

          // Get all fee tokens (static + dynamic for chains like Osmosis)
          const allFeeTokens = await getAllFeeTokens(chain);
          const isDynamic = hasDynamicFeeTokens(chain);

          // Build fee token info with balances
          const feeTokens = allFeeTokens.map((fc) => {
            const balance = balances.find(
              (b) => b.denom === fc.coinMinimalDenom,
            );
            const balanceAmount = balance ? BigInt(balance.amount) : BigInt(0);
            // Estimate if balance is sufficient for a typical transaction fee
            const estimatedFee = BigInt(
              Math.ceil(
                200000 *
                  (fc.gasPriceStep?.average ?? 0.1) *
                  getGasAdjustment(chain),
              ),
            );
            const sufficient = balanceAmount >= estimatedFee;

            return {
              denom: fc.coinMinimalDenom,
              symbol: fc.coinDenom,
              balance: balance?.amount ?? "0",
              displayBalance: balance?.displayAmount ?? "0",
              sufficient,
              gasPriceStep: fc.gasPriceStep,
            };
          });

          // Sort: tokens with balance first, then by denom
          feeTokens.sort((a, b) => {
            if (a.sufficient && !b.sufficient) return -1;
            if (!a.sufficient && b.sufficient) return 1;
            const aHasBalance = BigInt(a.balance) > 0;
            const bHasBalance = BigInt(b.balance) > 0;
            if (aHasBalance && !bHasBalance) return -1;
            if (!aHasBalance && bHasBalance) return 1;
            return a.denom.localeCompare(b.denom);
          });

          // Find recommended fee token (first one with sufficient balance)
          const recommended =
            feeTokens.find((ft) => ft.sufficient)?.denom ?? feeTokens[0]?.denom;

          // Count tokens with balance
          const tokensWithBalance = feeTokens.filter(
            (ft) => BigInt(ft.balance) > 0,
          ).length;

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [
            {
              tool: "send-tokens",
              reason: "Send tokens using the recommended fee token",
              params: { chain: chain.chainId, feeDenom: recommended },
              priority: 1,
            },
            {
              tool: "delegate",
              reason: "Stake tokens using the recommended fee token",
              params: { chain: chain.chainId, feeDenom: recommended },
              priority: 2,
            },
            {
              tool: "get-balances",
              reason: "Check all your token balances",
              params: { chain: chain.chainId },
              priority: 3,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chain: chain.chainId,
                    chainName: chain.chainName,
                    totalFeeTokens: feeTokens.length,
                    tokensWithBalance,
                    isDynamicFeeChain: isDynamic,
                    feeTokens: feeTokens.slice(0, 50), // Limit to first 50 for readability
                    hasMore: feeTokens.length > 50,
                    recommended,
                    note: isDynamic
                      ? `This chain supports ${feeTokens.length} fee tokens (dynamically fetched). Showing first 50. Use the feeDenom parameter to specify which token to use for fees.`
                      : feeTokens.length > 1
                        ? "This chain accepts multiple fee tokens. Use the feeDenom parameter in transaction tools to specify which token to use for fees."
                        : "This chain accepts only one fee token.",
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "list-fee-tokens");
        }
      },
    );

    server.registerTool(
      "get-cosmos-address",
      {
        description: "Get wallet address for a specific Cosmos chain",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4' or 'cosmos')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const address = await c.getAddress(chain);

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [
            {
              tool: "get-balances",
              reason: "Check your token balances on this chain",
              params: { chain: chain.chainId },
              priority: 1,
            },
            {
              tool: "send-tokens",
              reason: "Send tokens to another address",
              params: { chain: chain.chainId },
              priority: 2,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    address,
                    bech32Prefix: getBech32Prefix(chain),
                    suggestedActions,
                    tip: pickTip("get-cosmos-address"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-cosmos-address");
        }
      },
    );

    server.registerTool(
      "get-balances",
      {
        description:
          "Query all token balances for the wallet on a specific chain",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4' or 'osmosis')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const address = await c.getAddress(chain);
          const balances = await c.getBalances(chain);

          // Build suggested actions based on balances
          const suggestedActions: SuggestedAction[] = [];

          // Check if there are any balances
          const hasBalance = balances.some((b) => BigInt(b.amount) > BigInt(0));

          if (hasBalance) {
            // Suggest staking if on a PoS chain
            suggestedActions.push({
              tool: "get-staking-info",
              reason: "Check your staking positions and pending rewards",
              params: { chain: chain.chainId },
              priority: 1,
            });

            suggestedActions.push({
              tool: "delegate",
              reason: "Stake tokens to earn rewards (typical APR: 10-20%)",
              params: { chain: chain.chainId },
              priority: 2,
            });

            // Suggest swap if Osmosis is available
            if (
              chain.chainId === "osmosis-1" ||
              chain.chainId.includes("osmosis")
            ) {
              suggestedActions.push({
                tool: "osmosis-swap",
                reason: "Swap tokens on Osmosis DEX",
                priority: 3,
              });
            }

            suggestedActions.push({
              tool: "send-tokens",
              reason: "Send tokens to another address",
              params: { chain: chain.chainId },
              priority: 4,
            });
          } else {
            // No balance - suggest how to get tokens
            suggestedActions.push({
              tool: "get-cosmos-address",
              reason:
                "Get your address to receive tokens from an exchange or another wallet",
              params: { chain: chain.chainId },
              priority: 1,
            });
          }

          // Identify liquid staking tokens in balances
          const liquidStakingPositions = matchLstBalances(
            chain.chainId,
            balances,
          );

          // Surface LST exit actions in top-level suggestedActions
          for (const lp of liquidStakingPositions) {
            for (const a of lp.suggestedActions) {
              suggestedActions.push({
                ...a,
                priority: suggestedActions.length + 1,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    address,
                    chainId: chain.chainId,
                    balances,
                    liquidStakingPositions:
                      liquidStakingPositions.length > 0
                        ? liquidStakingPositions
                        : undefined,
                    suggestedActions,
                    tip: pickTip("get-balances"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-balances");
        }
      },
    );

    server.registerTool(
      "get-staking-info",
      {
        description:
          "Get current delegations and pending staking rewards for the wallet on a specific chain",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4', 'osmosis')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const address = await c.getAddress(chain);

          // Probe well-known vaults in parallel with native staking
          // (vault probe never throws — failures are silently skipped)
          let delegations: Awaited<ReturnType<typeof c.getDelegations>> = [];
          let rewards: Awaited<ReturnType<typeof c.getRewards>> = [];
          let stakingNotSupported = false;

          const [stakingResult, vaultPositions] = await Promise.all([
            Promise.all([c.getDelegations(chain), c.getRewards(chain)]).catch(
              (e) => {
                const msg = e instanceof Error ? e.message : String(e);
                if (isStakingNotSupportedError(msg)) {
                  stakingNotSupported = true;
                  return null;
                }
                throw e;
              },
            ),
            probeWellKnownVaults(c as VaultQueryClient, chain, address),
          ]);

          if (stakingResult) {
            [delegations, rewards] = stakingResult;
          }

          // --- not_supported path (with vault positions) ---
          if (stakingNotSupported) {
            const suggestedActions: SuggestedAction[] = [
              {
                tool: "get-balances",
                reason: "Check liquid balances on this chain",
                params: { chain: chain.chainId },
                priority: 1,
              },
            ];
            // Surface vault unbond actions directly
            for (const vp of vaultPositions) {
              for (const a of vp.suggestedActions) {
                suggestedActions.push({
                  ...a,
                  priority: suggestedActions.length + 1,
                });
              }
            }
            if (vaultPositions.length === 0) {
              suggestedActions.push({
                tool: "cosmwasm-list-contracts",
                reason:
                  "Discover contract-based staking vaults on this chain (requires a known code ID)",
                params: { chain: chain.chainId },
                priority: 2,
              });
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "not_supported",
                      chainId: chain.chainId,
                      reason: `Native staking is not available on ${chain.chainId}. This chain may be an ICS consumer chain without a staking module.`,
                      delegations: [],
                      rewards: [],
                      vaultPositions,
                      suggestedActions,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // --- success path ---
          const suggestedActions: SuggestedAction[] = [];

          // Check if there are claimable rewards
          const hasRewards =
            rewards &&
            rewards.length > 0 &&
            rewards.some((r) =>
              r.rewards?.some((coin) => BigInt(coin.amount.split(".")[0]) > 0),
            );

          if (hasRewards) {
            const validatorsWithRewards = rewards.filter((r) =>
              r.rewards?.some((coin) => BigInt(coin.amount.split(".")[0]) > 0),
            );

            if (validatorsWithRewards.length > 1) {
              suggestedActions.push({
                tool: "claim-all-rewards",
                reason: `Claim rewards from ${validatorsWithRewards.length} validators in one transaction`,
                params: { chain: chain.chainId },
                priority: 1,
              });
            } else if (validatorsWithRewards.length === 1) {
              suggestedActions.push({
                tool: "claim-rewards",
                reason: "You have pending staking rewards to claim",
                params: {
                  chain: chain.chainId,
                  validatorAddress: validatorsWithRewards[0].validatorAddress,
                },
                priority: 1,
              });
            }
          }

          const hasDelegations = delegations && delegations.length > 0;

          if (hasDelegations) {
            suggestedActions.push({
              tool: "redelegate",
              reason:
                "Move stake to a different validator without unbonding period",
              params: { chain: chain.chainId },
              priority: 2,
            });

            suggestedActions.push({
              tool: "undelegate",
              reason: "Unstake tokens (note: 21-day unbonding period applies)",
              params: { chain: chain.chainId },
              priority: 4,
            });

            suggestedActions.push({
              tool: "get-unbonding",
              reason: "Check tokens being unstaked and their completion times",
              params: { chain: chain.chainId },
              priority: 5,
            });
          }

          suggestedActions.push({
            tool: "get-balances",
            reason: "Check available balance for additional staking",
            params: { chain: chain.chainId },
            priority: 3,
          });

          if (!hasDelegations) {
            suggestedActions.push({
              tool: "list-validators",
              reason: "View validators to choose one for staking",
              params: { chain: chain.chainId },
              priority: 1,
            });

            suggestedActions.push({
              tool: "delegate",
              reason: "Start staking to earn rewards",
              params: { chain: chain.chainId },
              priority: 2,
            });
          }

          // Add vault unbond actions
          for (const vp of vaultPositions) {
            for (const a of vp.suggestedActions) {
              suggestedActions.push({
                ...a,
                priority: suggestedActions.length + 1,
              });
            }
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    address,
                    chainId: chain.chainId,
                    delegations,
                    rewards,
                    vaultPositions,
                    suggestedActions,
                    tip: pickTip("get-staking-info"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-staking-info");
        }
      },
    );

    server.registerTool(
      "get-transaction-status",
      {
        description:
          "Get the status of a transaction by its hash. Returns confirmation status, block height, and gas usage.",
        inputSchema: {
          txHash: z
            .string()
            .describe("Transaction hash to look up (e.g., 'ABC123...')"),
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4' or 'cosmos')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ txHash, chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const result = await c.getTransactionStatus(chain, txHash);

          // Build suggested actions based on status
          const suggestedActions: SuggestedAction[] = [];

          if (result.status === "confirmed") {
            suggestedActions.push({
              tool: "get-balances",
              reason: "Check your updated balance after the transaction",
              params: { chain: chain.chainId },
              priority: 1,
            });
          } else if (result.status === "failed") {
            suggestedActions.push({
              tool: "get-balances",
              reason: "Check your balance - the transaction failed",
              params: { chain: chain.chainId },
              priority: 1,
            });
          } else {
            // not_found - tx may be pending or invalid
            suggestedActions.push({
              tool: "get-transaction-status",
              reason:
                "Transaction not found. It may still be pending - try again in a few seconds.",
              params: { txHash, chain: chain.chainId },
              priority: 1,
            });
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    ...result,
                    // rawLog may contain arbitrary on-chain data
                    ...(result.rawLog && {
                      rawLog: sanitizeString(result.rawLog),
                    }),
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-transaction-status");
        }
      },
    );

    server.registerTool(
      "list-validators",
      {
        description:
          "List validators on a chain with their commission rates, voting power, and status. Useful for choosing a validator to delegate to.",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4', 'osmosis')"),
          status: z
            .enum(["active", "inactive", "jailed", "all"])
            .default("active")
            .describe(
              "Filter by status: 'active' (bonded), 'inactive' (unbonded/unbonding), 'jailed', or 'all'",
            ),
          limit: z
            .number()
            .min(1)
            .max(100)
            .default(20)
            .describe(
              "Maximum number of validators to return (1-100, default: 20)",
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, status, limit }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Map status to bond status
          type BondStatus =
            | "BOND_STATUS_BONDED"
            | "BOND_STATUS_UNBONDING"
            | "BOND_STATUS_UNBONDED"
            | "";
          const bondStatusMap: Record<string, BondStatus | undefined> = {
            active: "BOND_STATUS_BONDED",
            inactive: "BOND_STATUS_UNBONDED",
            jailed: "BOND_STATUS_BONDED", // Jailed validators are still bonded
            all: "",
          };

          const bondStatus = bondStatusMap[status];
          const validators = await c.getValidators(chain, bondStatus);

          // Filter jailed if specifically requested
          let filteredValidators = validators;
          if (status === "jailed") {
            filteredValidators = validators.filter((v) => v.jailed);
          } else if (status === "active") {
            filteredValidators = validators.filter((v) => !v.jailed);
          }

          // Sort by voting power (tokens) descending
          filteredValidators.sort(
            (a, b) => parseInt(b.tokens, 10) - parseInt(a.tokens, 10),
          );

          // Limit results
          const limitedValidators = filteredValidators.slice(0, limit);

          // Format commission rates
          const formattedValidators = limitedValidators.map((v, index) => ({
            rank: index + 1,
            operatorAddress: v.operatorAddress,
            moniker: v.moniker,
            commission: `${(parseFloat(v.commissionRate) * 100).toFixed(2)}%`,
            votingPower: v.displayTokens,
            status: v.status,
            jailed: v.jailed,
            website: v.website,
          }));

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [
            {
              tool: "delegate",
              reason: "Stake tokens to a validator to earn rewards",
              params: { chain: chain.chainId },
              priority: 1,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    status,
                    totalFound: filteredValidators.length,
                    showing: limitedValidators.length,
                    validators: formattedValidators,
                    suggestedActions,
                    tip: pickTip("list-validators"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "list-validators");
        }
      },
    );

    server.registerTool(
      "get-unbonding",
      {
        description:
          "Get unbonding delegations for the wallet. Shows tokens that are being unstaked with their completion times.",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4', 'osmosis')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const address = await c.getAddress(chain);
          const unbonding = await c.getUnbondingDelegations(chain);

          // Calculate total unbonding and find nearest completion
          let totalUnbonding = BigInt(0);
          let nearestCompletion: string | null = null;
          const now = new Date();

          for (const u of unbonding) {
            for (const e of u.entries) {
              totalUnbonding += BigInt(e.balance);
              const completionDate = new Date(e.completionTime);
              if (
                completionDate > now &&
                (!nearestCompletion ||
                  completionDate < new Date(nearestCompletion))
              ) {
                nearestCompletion = e.completionTime;
              }
            }
          }

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [];

          if (unbonding.length > 0) {
            // Get the first unbonding entry for cancel suggestion
            const firstEntry = unbonding[0]?.entries[0];
            if (firstEntry) {
              suggestedActions.push({
                tool: "cancel-unbonding",
                reason:
                  "Cancel unbonding to return tokens to staked state (no waiting period)",
                params: {
                  chain: chain.chainId,
                  validatorAddress: unbonding[0].validatorAddress,
                  creationHeight: firstEntry.creationHeight,
                },
                priority: 1,
              });
            }

            suggestedActions.push({
              tool: "get-staking-info",
              reason: "Check your active delegations and pending rewards",
              params: { chain: chain.chainId },
              priority: 2,
            });
          } else {
            suggestedActions.push({
              tool: "delegate",
              reason:
                "No unbonding delegations. Consider staking to earn rewards.",
              params: { chain: chain.chainId },
              priority: 1,
            });
          }

          const stakeDenom = getStakeDenom(chain);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    address,
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    unbondingDelegations: unbonding,
                    summary: {
                      totalEntries: unbonding.reduce(
                        (sum, u) => sum + u.entries.length,
                        0,
                      ),
                      totalValidators: unbonding.length,
                      totalAmount: totalUnbonding.toString(),
                      denom: stakeDenom,
                      nearestCompletion,
                    },
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-unbonding");
        }
      },
    );

    server.registerTool(
      "list-proposals",
      {
        description:
          "List governance proposals on a chain. Filter by status to see active voting proposals, passed, or rejected ones.",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4', 'osmosis')"),
          status: z
            .enum(["voting", "deposit", "passed", "rejected", "failed", "all"])
            .default("voting")
            .describe(
              "Filter by status: 'voting' (active), 'deposit', 'passed', 'rejected', 'failed', or 'all'",
            ),
          limit: z
            .number()
            .min(1)
            .max(50)
            .default(10)
            .describe(
              "Maximum number of proposals to return (1-50, default: 10)",
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, status, limit }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Map status to proposal status code
          const statusCodeMap: Record<string, number> = {
            all: 0,
            deposit: 1,
            voting: 2,
            passed: 3,
            rejected: 4,
            failed: 5,
          };

          const statusCode = statusCodeMap[status];
          const proposals = await c.getProposals(chain, statusCode);

          // Sort by proposal ID descending (newest first)
          proposals.sort(
            (a, b) => parseInt(b.proposalId, 10) - parseInt(a.proposalId, 10),
          );

          // Limit results
          const limitedProposals = proposals.slice(0, limit);

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [];

          const votingProposals = proposals.filter(
            (p) => p.status === "VOTING_PERIOD",
          );
          if (votingProposals.length > 0) {
            suggestedActions.push({
              tool: "vote-governance",
              reason: `${votingProposals.length} proposal(s) in voting period`,
              params: {
                chain: chain.chainId,
                proposalId: votingProposals[0].proposalId,
              },
              priority: 1,
            });
          }

          suggestedActions.push({
            tool: "get-proposal",
            reason: "View detailed information about a specific proposal",
            params: { chain: chain.chainId },
            priority: 2,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    status,
                    totalFound: proposals.length,
                    showing: limitedProposals.length,
                    proposals: limitedProposals.map((p) => ({
                      ...p,
                      title: sanitizeString(p.title),
                      description: sanitizeString(p.description),
                    })),
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "list-proposals");
        }
      },
    );

    server.registerTool(
      "get-proposal",
      {
        description:
          "Get detailed information about a specific governance proposal including current tally results.",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'cosmoshub-4', 'osmosis')"),
          proposalId: z
            .string()
            .describe("Proposal ID to look up (e.g., '123', '456')"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, proposalId }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const proposal = await c.getProposal(chain, proposalId);

          if (!proposal) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "not_found",
                      message: `Proposal #${proposalId} not found on ${chain.chainId}`,
                      suggestedActions: [
                        {
                          tool: "list-proposals",
                          reason: "View available proposals",
                          params: { chain: chain.chainId },
                          priority: 1,
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [];

          if (proposal.status === "VOTING_PERIOD") {
            suggestedActions.push({
              tool: "vote-governance",
              reason: "Cast your vote on this proposal",
              params: { chain: chain.chainId, proposalId },
              priority: 1,
            });
          }

          suggestedActions.push({
            tool: "list-proposals",
            reason: "View other proposals",
            params: { chain: chain.chainId },
            priority: 2,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    proposal: {
                      ...proposal,
                      title: sanitizeString(proposal.title),
                      description: sanitizeString(proposal.description),
                    },
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "get-proposal");
        }
      },
    );

    server.registerTool(
      "list-ibc-channels",
      {
        description:
          "List IBC transfer channels for a chain. Use 'counterpartyChain' parameter to find channels for a specific destination chain (recommended for IBC transfers). Without it, returns channels quickly without chain ID resolution.",
        inputSchema: {
          chain: z
            .string()
            .describe("Chain ID or name (e.g., 'osmosis-1', 'cosmoshub-4')"),
          counterpartyChain: z
            .string()
            .optional()
            .describe(
              "Filter by counterparty chain ID (e.g., 'cosmoshub-4' to find channels to Cosmos Hub)",
            ),
          state: z
            .enum(["OPEN", "CLOSED", "all"])
            .optional()
            .default("OPEN")
            .describe("Filter by channel state (default: OPEN)"),
          limit: z
            .number()
            .optional()
            .default(50)
            .describe(
              "Max number of channels to return (default: 50). Use with offset for pagination.",
            ),
          offset: z
            .number()
            .optional()
            .default(0)
            .describe("Number of channels to skip (default: 0)"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({
        chain: chainInput,
        counterpartyChain,
        state,
        limit,
        offset,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          // Enrich with chain IDs only when counterpartyChain filter is specified
          const ibcResult = await c.getIbcChannels(chain, {
            enrichChainIds: !!counterpartyChain,
          });
          let channels = ibcResult.channels;

          // Filter by state
          if (state && state !== "all") {
            channels = channels.filter((ch) => ch.state === state);
          }

          // Filter by counterparty chain
          let enrichmentWarning: string | undefined;
          if (counterpartyChain) {
            if (!ibcResult.enrichmentComplete) {
              enrichmentWarning =
                "Chain ID enrichment timed out. Cannot filter by counterpartyChain. Showing all channels instead.";
            } else {
              channels = channels.filter(
                (ch) =>
                  ch.counterpartyChainId?.toLowerCase() ===
                  counterpartyChain.toLowerCase(),
              );
            }
          }

          // Build suggested actions
          const suggestedActions: SuggestedAction[] = [];

          if (channels.length > 0) {
            // Only suggest IBC transfer when counterparty chain is known
            const firstKnownChannel = enrichmentWarning
              ? channels.find((ch) => ch.counterpartyChainId)
              : channels[0];

            if (firstKnownChannel) {
              suggestedActions.push({
                tool: "ibc-transfer",
                reason: `Transfer tokens via ${firstKnownChannel.channelId}${firstKnownChannel.counterpartyChainId ? ` to ${firstKnownChannel.counterpartyChainId}` : ""}`,
                params: {
                  chain: chain.chainId,
                  sourceChannel: firstKnownChannel.channelId,
                },
                priority: 1,
              });
            }

            // Suggest checking balances before transfer
            suggestedActions.push({
              tool: "get-balances",
              reason: "Check available tokens before transferring",
              params: { chain: chain.chainId },
              priority: 2,
            });
          }

          const totalFiltered = channels.length;
          const paged = channels.slice(offset, offset + limit);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    chainName: chain.chainName,
                    totalChannels: totalFiltered,
                    returnedChannels: paged.length,
                    hasMore: offset + limit < totalFiltered,
                    pagination: { offset, limit },
                    filter: {
                      state: state || "OPEN",
                      counterpartyChain: counterpartyChain || null,
                    },
                    ...(enrichmentWarning && { warning: enrichmentWarning }),
                    channels: paged,
                    suggestedActions,
                    tip: "Use the channelId (e.g., 'channel-0') as the sourceChannel parameter in ibc-transfer.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleQueryError(error, "list-ibc-channels");
        }
      },
    );

    // NOTE: get-portfolio has been moved to unified-portfolio plugin
    // which combines both Cosmos and EVM assets with USD prices.

    // --- Resources ---

    server.registerResource(
      "wallet-status",
      "wallet://status",
      { description: "Wallet configuration status and supported chains" },
      async (uri) => {
        const mnemonic = await getActiveMnemonic();
        const mnemonicConfigured = !!mnemonic;
        const chains = listChains().map((c) => ({
          chainId: c.chainId,
          name: c.chainName,
          denom: getStakeDenom(c),
        }));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  mnemonicConfigured,
                  supportedChains: chains.length,
                  chains,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerResource(
      "chain-portfolio",
      new ResourceTemplate("wallet://portfolio/{chainId}", {
        list: undefined,
        complete: {
          chainId: chainCompletionProvider,
        },
      }),
      { description: "Portfolio for a specific chain (balances + staking)" },
      async (uri, variables) => {
        const chainId = variables.chainId as string;
        const chain = resolveChain(chainId);
        const c = await store.getClientFor<CosmosClient>("cosmos");
        const address = await c.getAddress(chain);
        const [balances, delegations, rewards] = await Promise.all([
          c.getBalances(chain),
          c.getDelegations(chain),
          c.getRewards(chain),
        ]);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  chainId: chain.chainId,
                  chainName: chain.chainName,
                  address,
                  balances,
                  staking: { delegations, rewards },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // --- Prompts ---

    server.registerPrompt(
      "analyze-portfolio",
      {
        description:
          "Analyze cross-chain Cosmos portfolio holdings and provide recommendations",
        argsSchema: {
          chains: z
            .string()
            .optional()
            .describe("Comma-separated chain IDs (default: all)"),
        },
      },
      async ({ chains }) => {
        const allChains = listChains();
        const targetChainIds = chains
          ? chains.split(",").map((s) => s.trim())
          : allChains.map((c) => c.chainId);
        const chainList = targetChainIds.join(", ");
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  `Analyze my Cosmos ecosystem portfolio across these chains: ${chainList}.`,
                  "",
                  "For each chain:",
                  "1. Read the wallet://portfolio/{chainId} resource to get balances and staking info.",
                  "2. Summarize token holdings with approximate USD values if possible.",
                  "3. Show staking positions and pending rewards.",
                  "",
                  "Then provide:",
                  "- Total portfolio overview across all chains",
                  "- Staking yield analysis (are rewards being claimed regularly?)",
                  "- Diversification assessment",
                  "- Actionable recommendations (e.g., claim pending rewards, rebalance, explore new chains)",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "check-balances",
      {
        description: "Check token balances on a specific chain or all chains",
        argsSchema: {
          chain: z
            .string()
            .optional()
            .describe(
              "Chain name (e.g., 'cosmos', 'osmosis'). Leave empty for all chains",
            ),
        },
      },
      async ({ chain }) => {
        const instruction = chain
          ? `Check my token balances on ${chain} chain using the get-balances tool.`
          : "Check my token balances on all Cosmos chains. First list available chains, then check balances on each.";
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: instruction },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "check-staking",
      {
        description: "Check staking delegations and rewards",
        argsSchema: {
          chain: z
            .string()
            .optional()
            .describe(
              "Chain name (e.g., 'cosmos', 'osmosis'). Leave empty for all chains",
            ),
        },
      },
      async ({ chain }) => {
        const instruction = chain
          ? `Check my staking delegations and pending rewards on ${chain} chain using the get-staking-info tool. Show validators I'm delegating to and any claimable rewards.`
          : "Check my staking delegations and pending rewards on all Cosmos chains. Show which validators I'm delegating to and summarize claimable rewards.";
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: instruction },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "send",
      {
        description: "Send tokens to an address (guided)",
        argsSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          to: z.string().optional().describe("Recipient address"),
          amount: z.string().optional().describe("Amount to send"),
        },
      },
      async ({ chain, to, amount }) => {
        const parts = [`I want to send tokens on ${chain} chain.`];
        if (to) parts.push(`Recipient: ${to}`);
        if (amount) parts.push(`Amount: ${amount}`);
        parts.push(
          "",
          "Please help me:",
          "1. First check my balance on this chain",
          "2. Prepare the send-tokens transaction",
          "3. Show me a summary before I confirm",
        );
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "stake",
      {
        description: "Stake tokens to a validator (guided)",
        argsSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          amount: z.string().optional().describe("Amount to stake"),
        },
      },
      async ({ chain, amount }) => {
        const parts = [`I want to stake tokens on ${chain} chain.`];
        if (amount) parts.push(`Amount: ${amount}`);
        parts.push(
          "",
          "Please help me:",
          "1. Check my available balance",
          "2. Show me top validators with their commission rates",
          "3. Prepare the delegation transaction",
          "4. Show me a summary before I confirm",
        );
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "claim-rewards",
      {
        description: "Claim staking rewards",
        argsSchema: {
          chain: z
            .string()
            .optional()
            .describe("Chain name. Leave empty to check all chains"),
        },
      },
      async ({ chain }) => {
        const instruction = chain
          ? `Check my pending staking rewards on ${chain} and help me claim them.`
          : "Check my pending staking rewards on all chains and help me claim them. Show a summary of all claimable rewards first.";
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: instruction },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "wallet-overview",
      {
        description: "Get a quick overview of wallet status and addresses",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "Give me an overview of my wallet:",
                  "1. List my accounts (use list-accounts)",
                  "2. Show my addresses (Cosmos)",
                  "3. List supported chains",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "governance",
      {
        description: "Participate in governance voting (guided)",
        argsSchema: {
          chain: z.string().describe("Chain name (e.g., 'cosmos', 'osmosis')"),
          proposalId: z
            .string()
            .optional()
            .describe("Specific proposal ID to vote on"),
        },
      },
      async ({ chain, proposalId }) => {
        const parts = [
          `I want to participate in governance on ${chain} chain.`,
        ];
        if (proposalId) {
          parts.push(`Proposal ID: ${proposalId}`);
          parts.push(
            "",
            "Please help me:",
            "1. Get the proposal details (use get-proposal)",
            "2. Explain what this proposal is about",
            "3. Show me voting options and prepare the vote transaction",
            "4. Show me a summary before I confirm",
          );
        } else {
          parts.push(
            "",
            "Please help me:",
            "1. List active proposals (use list-proposals with status 'voting')",
            "2. Show me the proposals I can vote on",
            "3. Help me understand each proposal",
            "4. Guide me through voting when I choose one",
          );
        }
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "redelegate",
      {
        description: "Move stake from one validator to another (guided)",
        argsSchema: {
          chain: z.string().describe("Chain name (e.g., 'cosmos', 'osmosis')"),
          amount: z.string().optional().describe("Amount to redelegate"),
        },
      },
      async ({ chain, amount }) => {
        const parts = [
          `I want to redelegate (move my stake) on ${chain} chain.`,
        ];
        if (amount) parts.push(`Amount: ${amount}`);
        parts.push(
          "",
          "Please help me:",
          "1. Check my current delegations (use get-staking-info)",
          "2. Show me my current validators",
          "3. List top validators with their commission rates",
          "4. Help me choose a new validator",
          "5. Prepare the redelegate transaction",
          "",
          "Note: Redelegation moves stake immediately without the unbonding period.",
        );
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "ibc-transfer",
      {
        description: "Transfer tokens between chains via IBC (guided)",
        argsSchema: {
          sourceChain: z
            .string()
            .describe("Source chain name (e.g., 'osmosis', 'cosmos')"),
          destChain: z.string().optional().describe("Destination chain name"),
          token: z.string().optional().describe("Token to transfer"),
          amount: z.string().optional().describe("Amount to transfer"),
        },
      },
      async ({ sourceChain, destChain, token, amount }) => {
        const parts = [
          `I want to transfer tokens via IBC from ${sourceChain}.`,
        ];
        if (destChain) parts.push(`Destination: ${destChain}`);
        if (token) parts.push(`Token: ${token}`);
        if (amount) parts.push(`Amount: ${amount}`);
        parts.push(
          "",
          "Please help me:",
          "1. Check my balance on the source chain (use get-balances)",
          `2. Find the correct IBC channel using list-ibc-channels${destChain ? ` --counterpartyChain ${destChain}` : ""}`,
          "3. Prepare the IBC transfer transaction with the channel ID",
          "4. Show me a summary including estimated arrival time",
          "",
          "Note: IBC transfers typically take 30 seconds to a few minutes.",
          "Important: Use list-ibc-channels to find the correct channel ID (e.g., 'channel-0') for the destination chain.",
        );
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "security-check",
      {
        description: "Review wallet security settings and recommendations",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "Please perform a security check on my wallet setup:",
                  "",
                  "1. Check my account type and security settings",
                  "2. Review authentication settings (use auth-status)",
                  "3. Check if biometric authentication is available and enabled",
                  "4. Review session settings",
                  "5. Provide security recommendations based on my setup",
                  "",
                  "Suggest improvements if any security features are not enabled.",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "bridge",
      {
        description: "Bridge tokens between Cosmos chains",
        argsSchema: {
          from: z
            .string()
            .optional()
            .describe("Source chain (e.g., 'osmosis', 'cosmoshub')"),
          to: z.string().optional().describe("Destination ecosystem or chain"),
          token: z.string().optional().describe("Token to bridge"),
          amount: z.string().optional().describe("Amount to bridge"),
        },
      },
      async ({ from, to, token, amount }) => {
        const parts = ["I want to bridge tokens between ecosystems."];
        if (from) parts.push(`From: ${from}`);
        if (to) parts.push(`To: ${to}`);
        if (token) parts.push(`Token: ${token}`);
        if (amount) parts.push(`Amount: ${amount}`);
        parts.push(
          "",
          "Please help me:",
          "1. Identify the best bridging route",
          "2. Check my balances on the source chain",
          "3. Explain the bridging process and any fees",
          "4. Guide me through the required transactions",
          "",
          "Note: Cross-ecosystem bridges may take longer and involve multiple steps.",
        );
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );
  },
};

export default queryPlugin;

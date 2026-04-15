/**
 * Unified Portfolio Plugin
 *
 * Provides a single `get-portfolio` tool that aggregates assets across
 * both Cosmos and EVM ecosystems with optional USD price data.
 */

import pLimit from "p-limit";
import { z } from "zod";
import type { DenomMetadata } from "../chains/cosmos.js";
import {
  classifyError,
  createSetupRequiredResponse,
  formatClassifiedError,
  isSetupRequiredError,
  type SuggestedAction,
} from "../errors.js";
import { getPriceService, resolveCoingeckoId } from "../services/price.js";
import { pickTip } from "../tips.js";
import { getTokenDecimals } from "../types/currency.js";
import { formatDisplayAmount } from "../utils/balance-formatter.js";
import { matchLstBalances } from "./cosmos/well-known-lst.js";
import type { KeplrPlugin } from "./types.js";

/** Parse a display amount string to a number, returning 0 for NaN values.
 *  Prevents NaN propagation in financial accumulation paths. */
const safeAmount = (value: string): number => parseFloat(value) || 0;

/** Error patterns indicating the chain lacks a native staking module
 *  (e.g. ICS consumer chains that rely on provider-chain staking). */
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

/** Build denom/symbol → coinGeckoId map from existing chain configs.
 *  Uses the same listChains()/getEvmChains() that queryCosmos/queryEvm use. */
const buildChainGeckoIds = async (
  chainIds?: string[],
): Promise<Map<string, string>> => {
  const geckoIds = new Map<string, string>();

  // Cosmos: currencies[].coinGeckoId + stakeCurrency.coinGeckoId
  try {
    const { listChains } = await import("../chains/cosmos.js");
    for (const chain of listChains()) {
      if (
        chainIds &&
        !chainIds.some(
          (id) =>
            chain.chainId.toLowerCase() === id.toLowerCase() ||
            chain.chainName.toLowerCase() === id.toLowerCase(),
        )
      )
        continue;
      if (chain.stakeCurrency?.coinGeckoId) {
        geckoIds.set(
          chain.stakeCurrency.coinDenom,
          chain.stakeCurrency.coinGeckoId,
        );
      }
      for (const c of chain.currencies ?? []) {
        if (c.coinGeckoId) {
          geckoIds.set(c.coinDenom, c.coinGeckoId);
          if (c.coinMinimalDenom.startsWith("ibc/")) {
            geckoIds.set(c.coinMinimalDenom, c.coinGeckoId);
          }
        }
      }
    }
  } catch {
    /* cosmos module not available */
  }

  return geckoIds;
};

interface StakingDelegation {
  validatorAddress: string;
  displayAmount: string;
  displayDenom: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

interface StakingReward {
  validatorAddress: string;
  displayAmount: string;
  displayDenom: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

interface StakingResult {
  delegations: StakingDelegation[];
  rewards: StakingReward[];
  totalStakedValueUsd: number | null;
  totalRewardsValueUsd: number | null;
  /** Set when native staking module is unavailable (e.g. ICS consumer chains) */
  status?: "not_supported";
  /** Human-readable reason why staking is unavailable */
  reason?: string;
}

interface CosmosChainResult {
  chainId: string;
  chainName: string;
  address: string;
  balances: Array<{
    denom: string;
    amount: string;
    displayAmount: string;
    displayDenom: string;
    priceUsd: number | null;
    valueUsd: number | null;
  }>;
  staking: StakingResult | null;
  vaultPositions?: import("./cosmos/well-known-vaults.js").VaultPosition[];
  liquidStakingPositions?: import("./cosmos/well-known-lst.js").LstPosition[];
  chainValueUsd: number | null;
}

interface TotalEntry {
  symbol: string;
  totalAmount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  ecosystem: "cosmos";
}

const unifiedPortfolioPlugin: KeplrPlugin = {
  name: "unified-portfolio",

  register(server, store) {
    server.registerTool(
      "get-portfolio",
      {
        description:
          "Get a unified portfolio summary across all Cosmos chains with USD values. " +
          "Queries balances, staking info, and current market prices in a single call. " +
          "Perfect for answering 'How much are my total assets?'",
        inputSchema: {
          chains: z
            .array(z.string())
            .optional()
            .describe(
              "List of chain IDs/names to query (default: all). Example: ['osmosis-1', 'cosmoshub-4']",
            ),
          includeStaking: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              "Include staking info (delegations, rewards) for Cosmos chains",
            ),
          includePrices: z
            .boolean()
            .optional()
            .default(true)
            .describe("Include USD price data from CoinGecko"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chains: chainIds, includeStaking, includePrices }) => {
        try {
          // Query Cosmos chains
          const cosmosResult = await queryCosmos(
            store,
            chainIds,
            includeStaking,
          ).then(
            (value) => ({ status: "fulfilled" as const, value }),
            (reason: unknown) => ({ status: "rejected" as const, reason }),
          );

          const cosmosPortfolio: CosmosChainResult[] =
            cosmosResult.status === "fulfilled"
              ? cosmosResult.value.portfolio
              : [];
          const cosmosErrors: Array<{ chainId: string; error: string }> =
            cosmosResult.status === "fulfilled"
              ? cosmosResult.value.errors
              : [];

          // Capture ecosystem-level failures that aren't setup-required
          if (
            cosmosResult.status === "rejected" &&
            !isSetupRequiredError(
              cosmosResult.reason instanceof Error
                ? cosmosResult.reason.message
                : String(cosmosResult.reason),
            )
          ) {
            cosmosErrors.push({
              chainId: "cosmos",
              error:
                cosmosResult.reason instanceof Error
                  ? cosmosResult.reason.message
                  : String(cosmosResult.reason),
            });
          }

          // Check if Cosmos failed with setup-required
          const cosmosSetupRequired =
            cosmosResult.status === "rejected" &&
            isSetupRequiredError(
              cosmosResult.reason instanceof Error
                ? cosmosResult.reason.message
                : String(cosmosResult.reason),
            );

          if (cosmosSetupRequired) {
            const setupResponse = createSetupRequiredResponse({
              attemptedAction: "get-portfolio",
            });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(setupResponse, null, 2),
                },
              ],
            };
          }

          // Enrich with prices if requested
          let priceNote = "Prices not requested";
          let priceRateLimited = false;
          if (includePrices) {
            // Build denom→coinGeckoId map from existing chain configs
            const chainGeckoIds = await buildChainGeckoIds(chainIds);
            const priceResult = await enrichWithPrices(
              cosmosPortfolio,
              chainGeckoIds,
            );
            priceNote = priceResult.note;
            priceRateLimited = priceResult.rateLimited;
          }

          // Calculate totals by symbol (liquid balances only)
          const totals = calculateTotals(cosmosPortfolio);

          // Sort totals by valueUsd descending (priced tokens first)
          totals.sort((a, b) => {
            if (a.valueUsd != null && b.valueUsd != null)
              return b.valueUsd - a.valueUsd;
            if (a.valueUsd != null) return -1;
            if (b.valueUsd != null) return 1;
            return 0;
          });

          // Calculate total portfolio value with breakdown
          let totalValueUsd: number | null = null;
          let liquidValueUsd: number | null = null;
          let stakedValueUsd: number | null = null;
          let rewardsValueUsd: number | null = null;

          if (includePrices) {
            const liquidSum = totals.reduce(
              (acc, t) => (t.valueUsd != null ? acc + t.valueUsd : acc),
              0,
            );
            liquidValueUsd =
              liquidSum > 0 ? Math.round(liquidSum * 100) / 100 : null;

            let stakedSum = 0;
            let rewardsSum = 0;
            let vaultSum = 0;
            for (const chain of cosmosPortfolio) {
              if (chain.staking) {
                if (chain.staking.totalStakedValueUsd != null) {
                  stakedSum += chain.staking.totalStakedValueUsd;
                }
                if (chain.staking.totalRewardsValueUsd != null) {
                  rewardsSum += chain.staking.totalRewardsValueUsd;
                }
              }
              if (chain.vaultPositions) {
                for (const v of chain.vaultPositions) {
                  if (v.valueUsd != null) {
                    vaultSum += v.valueUsd;
                  }
                }
              }
            }
            stakedValueUsd =
              stakedSum > 0 ? Math.round(stakedSum * 100) / 100 : null;
            rewardsValueUsd =
              rewardsSum > 0 ? Math.round(rewardsSum * 100) / 100 : null;

            const grandTotal =
              (liquidValueUsd ?? 0) +
              (stakedValueUsd ?? 0) +
              (rewardsValueUsd ?? 0) +
              vaultSum;
            totalValueUsd =
              grandTotal > 0 ? Math.round(grandTotal * 100) / 100 : null;
          }

          // Check if portfolio is empty (no liquid balances and no staking)
          const isEmpty =
            cosmosPortfolio.every((c) =>
              c.balances.every((b) => parseFloat(b.displayAmount) === 0),
            ) && cosmosPortfolio.every((c) => !c.staking?.delegations?.length);

          // Build suggested actions
          const suggestedActions = buildSuggestedActions(
            cosmosPortfolio,
            isEmpty,
          );

          // Add rate limit recovery hints
          if (priceRateLimited) {
            suggestedActions.push({
              tool: "get-portfolio",
              reason:
                "Retry with includePrices: false to skip price lookup, or wait 1-2 minutes and try again",
              params: { includePrices: false },
              priority: 10,
            });
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...(isEmpty && {
                      status: "empty_portfolio",
                      message:
                        "Your portfolio is empty. Fund your wallet to get started.",
                    }),
                    summary: {
                      totalValueUsd,
                      ...(includePrices && {
                        liquidValueUsd,
                        stakedValueUsd,
                        rewardsValueUsd,
                      }),
                      cosmosChains: cosmosPortfolio.length,
                      chainsSuccessful: cosmosPortfolio.length,
                      chainsFailed: cosmosErrors.length,
                    },
                    totals: totals
                      .filter((t) => t.totalAmount > 0)
                      .map((t) => ({
                        ...t,
                        totalAmount: t.totalAmount.toFixed(6),
                        valueUsd:
                          t.valueUsd != null
                            ? Math.round(t.valueUsd * 100) / 100
                            : null,
                      })),
                    cosmos: cosmosPortfolio,
                    ...(cosmosErrors.length > 0 && { errors: cosmosErrors }),
                    priceNote,
                    suggestedActions,
                    tip: pickTip("get-portfolio"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handlePortfolioError(error, "get-portfolio");
        }
      },
    );
  },
};

// ── Cosmos Query ──────────────────────────────────────────────────────

const CHAIN_TIMEOUT_MS = 10_000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`RPC timeout after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const queryCosmos = async (
  store: Parameters<KeplrPlugin["register"]>[1],
  chainIds: string[] | undefined,
  includeStaking: boolean,
): Promise<{
  portfolio: CosmosChainResult[];
  errors: Array<{ chainId: string; error: string }>;
}> => {
  // Dynamic import to avoid hard dependency on cosmos chains module
  const { listChains, resolveChainDenom } = await import("../chains/cosmos.js");
  const { resolveIbcDenom } = await import("../utils/ibc-resolver.js");

  const { probeWellKnownVaults } = await import(
    "./cosmos/well-known-vaults.js"
  );

  const client = await store.getClientFor<{
    disconnect: () => void | Promise<void>;
    getAddress: (chain: unknown) => Promise<string>;
    getBalancesViaLcd: (chain: unknown) => Promise<
      Array<{
        denom: string;
        amount: string;
        displayAmount: string;
        displayDenom: string;
      }>
    >;
    getDelegationsViaLcd: (chain: unknown) => Promise<
      Array<{
        validatorAddress: string;
        amount: string;
        displayAmount: string;
        denom: string;
      }>
    >;
    getRewardsViaLcd: (chain: unknown) => Promise<
      Array<{
        validatorAddress: string;
        rewards: Array<{ denom: string; amount: string }>;
      }>
    >;
    queryContract: (
      chain: unknown,
      contractAddress: string,
      queryMsg: Record<string, unknown>,
    ) => Promise<{ data: unknown }>;
  }>("cosmos");

  const allChains = listChains();
  const chainsToQuery = chainIds
    ? allChains.filter((ch: { chainId: string; chainName: string }) =>
        chainIds.some(
          (id) =>
            ch.chainId.toLowerCase() === id.toLowerCase() ||
            ch.chainName.toLowerCase() === id.toLowerCase(),
        ),
      )
    : allChains;

  const portfolio: CosmosChainResult[] = [];
  const errors: Array<{ chainId: string; error: string }> = [];

  const limit = pLimit(10); // max 10 concurrent chain queries
  const results = await Promise.allSettled(
    chainsToQuery.map(
      (chain: {
        chainId: string;
        chainName: string;
        stakeCurrency?: {
          coinDenom: string;
          coinMinimalDenom: string;
          coinDecimals: number;
        };
        currencies?: Array<{
          coinDenom: string;
          coinMinimalDenom: string;
          coinDecimals: number;
          coinGeckoId?: string;
        }>;
        feeCurrencies?: Array<{
          coinDenom: string;
          coinMinimalDenom: string;
          coinDecimals: number;
          coinGeckoId?: string;
        }>;
      }) =>
        limit(() =>
          withTimeout(
            (async () => {
              const address = await client.getAddress(chain);
              const balances = await client.getBalancesViaLcd(chain);

              let staking: CosmosChainResult["staking"] = null;
              if (includeStaking) {
                try {
                  const [rawDelegations, rawRewards] = await Promise.all([
                    client.getDelegationsViaLcd(chain),
                    client.getRewardsViaLcd(chain),
                  ]);

                  const decimals = chain.stakeCurrency?.coinDecimals ?? 6;
                  const stakeDenom = chain.stakeCurrency?.coinDenom ?? "";

                  const delegations: StakingDelegation[] = rawDelegations.map(
                    (d) => ({
                      validatorAddress: d.validatorAddress,
                      displayAmount: d.displayAmount,
                      displayDenom: stakeDenom || d.denom,
                      priceUsd: null,
                      valueUsd: null,
                    }),
                  );

                  // Batch-resolve unregistered IBC reward denoms in parallel
                  // (same enrichment that balances get via enrichIbcDenoms)
                  const ibcRewardDenoms = new Set<string>();
                  for (const r of rawRewards) {
                    for (const coin of r.rewards) {
                      if (
                        coin.denom.startsWith("ibc/") &&
                        coin.denom !== chain.stakeCurrency?.coinMinimalDenom &&
                        !resolveChainDenom(
                          chain as Parameters<typeof resolveChainDenom>[0],
                          coin.denom,
                        )
                      ) {
                        ibcRewardDenoms.add(coin.denom);
                      }
                    }
                  }
                  const ibcResolutions = new Map<string, DenomMetadata>();
                  if (ibcRewardDenoms.size > 0) {
                    const denomList = [...ibcRewardDenoms];
                    // Sub-timeout prevents slow IBC lookups from exhausting
                    // the per-chain CHAIN_TIMEOUT_MS budget (see #58 review).
                    const IBC_REWARD_TIMEOUT_MS = 3_000;
                    const results = await Promise.race([
                      Promise.allSettled(
                        denomList.map((denom) =>
                          resolveIbcDenom(
                            chain as Parameters<typeof resolveIbcDenom>[0],
                            denom,
                          ),
                        ),
                      ),
                      new Promise<PromiseSettledResult<DenomMetadata | null>[]>(
                        (resolve) =>
                          setTimeout(
                            () =>
                              resolve(
                                denomList.map(() => ({
                                  status: "rejected" as const,
                                  reason: new Error(
                                    "IBC reward resolution timeout",
                                  ),
                                })),
                              ),
                            IBC_REWARD_TIMEOUT_MS,
                          ),
                      ),
                    ]);
                    for (let i = 0; i < denomList.length; i++) {
                      const result = results[i];
                      if (result.status === "fulfilled" && result.value) {
                        ibcResolutions.set(denomList[i], result.value);
                      }
                    }
                  }

                  // Flatten rewards per-validator into display-ready entries
                  // 4-tier resolution: native → chain config → IBC denom trace → heuristic
                  const rewards: StakingReward[] = [];
                  for (const r of rawRewards) {
                    for (const coin of r.rewards) {
                      if (parseFloat(coin.amount) > 0) {
                        // Truncate DecCoin fractional part for string-based formatting
                        const intAmount = coin.amount.includes(".")
                          ? coin.amount.split(".")[0]
                          : coin.amount;

                        const isNative =
                          coin.denom === chain.stakeCurrency?.coinMinimalDenom;
                        let tokenDecimals: number;
                        let displayDenom: string;

                        if (isNative) {
                          tokenDecimals = decimals;
                          displayDenom = stakeDenom || coin.denom;
                        } else {
                          const resolved = resolveChainDenom(
                            chain as Parameters<typeof resolveChainDenom>[0],
                            coin.denom,
                          );
                          if (resolved) {
                            tokenDecimals = resolved.decimals;
                            displayDenom = resolved.displayDenom;
                          } else {
                            const ibcMeta = ibcResolutions.get(coin.denom);
                            if (ibcMeta) {
                              tokenDecimals = ibcMeta.decimals;
                              displayDenom = ibcMeta.displayDenom;
                            } else {
                              tokenDecimals = getTokenDecimals(coin.denom);
                              displayDenom = coin.denom;
                            }
                          }
                        }

                        rewards.push({
                          validatorAddress: r.validatorAddress,
                          displayAmount: formatDisplayAmount(
                            intAmount,
                            tokenDecimals,
                          ),
                          displayDenom,
                          priceUsd: null,
                          valueUsd: null,
                        });
                      }
                    }
                  }

                  staking = {
                    delegations,
                    rewards,
                    totalStakedValueUsd: null,
                    totalRewardsValueUsd: null,
                  };
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  console.warn(
                    `[portfolio] staking query failed for ${chain.chainId}: ${msg}`,
                  );
                  if (isStakingNotSupportedError(msg)) {
                    staking = {
                      status: "not_supported",
                      reason: `Native staking is not available on ${chain.chainId}. This chain may be an ICS consumer chain without a staking module.`,
                      delegations: [],
                      rewards: [],
                      totalStakedValueUsd: null,
                      totalRewardsValueUsd: null,
                    };
                  }
                }
              }

              // Probe well-known vaults (never throws)
              const vaultPositions = await probeWellKnownVaults(
                client,
                chain,
                address,
              );

              // Identify liquid staking tokens in balances
              const liquidStakingPositions = matchLstBalances(
                chain.chainId,
                balances,
              );

              return {
                chainId: chain.chainId,
                chainName: chain.chainName,
                address,
                balances: balances.map((b) => ({
                  ...b,
                  priceUsd: null as number | null,
                  valueUsd: null as number | null,
                })),
                staking,
                vaultPositions:
                  vaultPositions.length > 0
                    ? vaultPositions.map((v) => {
                        const resolved = resolveChainDenom(
                          chain as Parameters<typeof resolveChainDenom>[0],
                          v.bondDenom,
                        );
                        const decimals =
                          resolved?.decimals ?? getTokenDecimals(v.bondDenom);
                        const displayDenom =
                          resolved?.displayDenom ?? v.bondDenom;
                        return {
                          ...v,
                          displayAmount: formatDisplayAmount(
                            v.bondedAmount,
                            decimals,
                          ),
                          displayDenom,
                        };
                      })
                    : undefined,
                liquidStakingPositions:
                  liquidStakingPositions.length > 0
                    ? liquidStakingPositions
                    : undefined,
                chainValueUsd: null as number | null,
              };
            })(),
            CHAIN_TIMEOUT_MS,
          ),
        ),
    ),
  );

  results.forEach((result, idx) => {
    const chain = chainsToQuery[idx];
    if (result.status === "fulfilled") {
      portfolio.push(result.value);
    } else {
      errors.push({
        chainId: (chain as { chainId: string }).chainId,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  });

  return { portfolio, errors };
};

// ── Price Enrichment ──────────────────────────────────────────────────

const enrichWithPrices = async (
  cosmosPortfolio: CosmosChainResult[],
  chainGeckoIds: Map<string, string>,
): Promise<{ note: string; rateLimited: boolean }> => {
  // Collect all unique symbols that need pricing
  const symbolsToResolve = new Set<string>();

  for (const chain of cosmosPortfolio) {
    for (const b of chain.balances) {
      symbolsToResolve.add(b.displayDenom);
    }
    if (chain.staking) {
      for (const d of chain.staking.delegations) {
        symbolsToResolve.add(d.displayDenom);
      }
      for (const r of chain.staking.rewards) {
        symbolsToResolve.add(r.displayDenom);
      }
    }
    if (chain.vaultPositions) {
      for (const v of chain.vaultPositions) {
        if (v.displayDenom) {
          symbolsToResolve.add(v.displayDenom);
        }
      }
    }
  }

  // Resolve symbols to CoinGecko IDs.
  // Primary: chain-provided coinGeckoId (from chain config/currencies).
  // Fallback: hardcoded DENOM_TO_COINGECKO map for tokens without chain config.
  const symbolToGeckoId = new Map<string, string>();
  for (const symbol of symbolsToResolve) {
    const geckoId = chainGeckoIds.get(symbol) ?? resolveCoingeckoId(symbol);
    if (geckoId) {
      symbolToGeckoId.set(symbol, geckoId);
    }
  }

  if (symbolToGeckoId.size === 0) {
    return {
      note: "No known tokens found for price lookup",
      rateLimited: false,
    };
  }

  // Fetch all prices in a single batch
  const priceService = getPriceService();
  const uniqueGeckoIds = [...new Set(symbolToGeckoId.values())];
  const prices = await priceService.getPrices(uniqueGeckoIds);

  if (prices.size === 0) {
    const rateLimited = priceService.isRateLimited();
    const note = rateLimited
      ? "Price data unavailable — CoinGecko API rate-limited after retries. Set COINGECKO_API_KEY env var for higher limits, or wait 1-2 minutes."
      : "Price data unavailable (CoinGecko API error)";
    return { note, rateLimited };
  }

  // Enrich Cosmos balances + staking
  for (const chain of cosmosPortfolio) {
    let chainValue = 0;
    let hasAnyPrice = false;

    for (const b of chain.balances) {
      const geckoId = symbolToGeckoId.get(b.displayDenom);
      const price = geckoId ? prices.get(geckoId) : undefined;
      if (price) {
        b.priceUsd = price.usd;
        b.valueUsd =
          Math.round(safeAmount(b.displayAmount) * price.usd * 100) / 100;
        chainValue += b.valueUsd;
        hasAnyPrice = true;
      }
    }

    if (chain.staking) {
      let stakedValue = 0;
      for (const d of chain.staking.delegations) {
        const geckoId = symbolToGeckoId.get(d.displayDenom);
        const price = geckoId ? prices.get(geckoId) : undefined;
        if (price) {
          d.priceUsd = price.usd;
          d.valueUsd =
            Math.round(safeAmount(d.displayAmount) * price.usd * 100) / 100;
          stakedValue += d.valueUsd;
          hasAnyPrice = true;
        }
      }
      chain.staking.totalStakedValueUsd =
        stakedValue > 0 ? Math.round(stakedValue * 100) / 100 : null;
      chainValue += stakedValue;

      let rewardsValue = 0;
      for (const r of chain.staking.rewards) {
        const geckoId = symbolToGeckoId.get(r.displayDenom);
        const price = geckoId ? prices.get(geckoId) : undefined;
        if (price) {
          r.priceUsd = price.usd;
          r.valueUsd =
            Math.round(safeAmount(r.displayAmount) * price.usd * 100) / 100;
          rewardsValue += r.valueUsd;
          hasAnyPrice = true;
        }
      }
      chain.staking.totalRewardsValueUsd =
        rewardsValue > 0 ? Math.round(rewardsValue * 100) / 100 : null;
      chainValue += rewardsValue;
    }

    if (chain.vaultPositions) {
      for (const v of chain.vaultPositions) {
        if (v.displayDenom && v.displayAmount) {
          const geckoId = symbolToGeckoId.get(v.displayDenom);
          const price = geckoId ? prices.get(geckoId) : undefined;
          if (price) {
            v.priceUsd = price.usd;
            v.valueUsd =
              Math.round(safeAmount(v.displayAmount) * price.usd * 100) / 100;
            chainValue += v.valueUsd;
            hasAnyPrice = true;
          }
        }
      }
    }

    chain.chainValueUsd = hasAnyPrice
      ? Math.round(chainValue * 100) / 100
      : null;
  }

  const cacheSec = Math.round(
    (process.env.COINGECKO_API_KEY ? 60_000 : 300_000) / 1000,
  );
  return {
    note: `Prices from CoinGecko (${cacheSec}s cache). ${prices.size} token(s) priced.`,
    rateLimited: false,
  };
};

// ── Totals Calculation ────────────────────────────────────────────────

const calculateTotals = (
  cosmosPortfolio: CosmosChainResult[],
): TotalEntry[] => {
  const totalsMap = new Map<
    string,
    {
      amount: number;
      priceUsd: number | null;
      valueUsd: number;
      ecosystem: "cosmos";
    }
  >();

  // Cosmos liquid balance totals
  for (const chain of cosmosPortfolio) {
    for (const b of chain.balances) {
      const existing = totalsMap.get(b.displayDenom) ?? {
        amount: 0,
        priceUsd: null,
        valueUsd: 0,
        ecosystem: "cosmos" as const,
      };
      existing.amount += safeAmount(b.displayAmount);
      if (b.priceUsd != null) existing.priceUsd = b.priceUsd;
      if (b.valueUsd != null) existing.valueUsd += b.valueUsd;
      totalsMap.set(b.displayDenom, existing);
    }
  }

  return Array.from(totalsMap.entries()).map(([symbol, data]) => ({
    symbol,
    totalAmount: data.amount,
    priceUsd: data.priceUsd,
    valueUsd:
      data.priceUsd != null ? Math.round(data.valueUsd * 100) / 100 : null,
    ecosystem: data.ecosystem,
  }));
};

// ── Suggested Actions ─────────────────────────────────────────────────

const buildSuggestedActions = (
  cosmosPortfolio: CosmosChainResult[],
  isEmpty: boolean,
): SuggestedAction[] => {
  const actions: SuggestedAction[] = [];

  // Empty portfolio: guide user to fund their wallet
  if (isEmpty) {
    actions.push({
      tool: "get-cosmos-address",
      reason: "Get your Cosmos address to receive tokens",
      priority: 1,
    });
    return actions;
  }

  // Find Cosmos chain with unstaked balance (exclude chains without native staking)
  const chainWithBalance = cosmosPortfolio.find(
    (p) =>
      p.balances.some(
        (b) =>
          parseFloat(b.displayAmount) > 0 && !p.staking?.delegations?.length,
      ) && p.staking?.status !== "not_supported",
  );
  if (chainWithBalance) {
    actions.push({
      tool: "delegate",
      reason: `Stake tokens on ${chainWithBalance.chainName} to earn rewards`,
      params: { chain: chainWithBalance.chainId },
      priority: 1,
    });
  }

  // Check for claimable rewards
  const chainWithRewards = cosmosPortfolio.find(
    (p) =>
      p.staking?.rewards &&
      p.staking.rewards.length > 0 &&
      p.staking.rewards.some((r) => parseFloat(r.displayAmount) > 0),
  );
  if (chainWithRewards) {
    actions.push({
      tool: "claim-all-rewards",
      reason: `Claim pending rewards on ${chainWithRewards.chainName}`,
      params: { chain: chainWithRewards.chainId },
      priority: 2,
    });
  }

  // Osmosis swap suggestion
  const osmosisChain = cosmosPortfolio.find(
    (p) =>
      p.chainId === "osmosis-1" &&
      p.balances.some((b) => parseFloat(b.displayAmount) > 0),
  );
  if (osmosisChain) {
    actions.push({
      tool: "osmosis-swap",
      reason: "Swap tokens on Osmosis DEX",
      params: { chain: "osmosis-1" },
      priority: 3,
    });
  }

  // Surface LST exit actions
  for (const chain of cosmosPortfolio) {
    if (!chain.liquidStakingPositions) continue;
    for (const lp of chain.liquidStakingPositions) {
      for (const a of lp.suggestedActions) {
        actions.push({ ...a, priority: actions.length + 1 });
      }
    }
  }

  return actions;
};

// ── Error Handling ────────────────────────────────────────────────────

const handlePortfolioError = (
  error: unknown,
  attemptedAction: string,
): { content: Array<{ type: "text"; text: string }>; isError?: true } => {
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
};

export default unifiedPortfolioPlugin;

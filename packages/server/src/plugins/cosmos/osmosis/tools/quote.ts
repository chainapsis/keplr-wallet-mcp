/**
 * Osmosis quote tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getChainConfig, type SuggestedAction } from "../../../../sdk.js";
import type { KeplrStore } from "../../../../store.js";
import { getOsmosisClient } from "../client.js";
import {
  AMOUNT_IN_SCHEMA,
  OSMOSIS_CHAIN_ID,
  SLIPPAGE_BPS_SCHEMA,
} from "../constants.js";
import { getSkipOsmosisAssets } from "../skip-assets.js";
import { handleError } from "./shared.js";

// Cosmos client interface for balance checking
interface CosmosClientLike {
  getBalances(chain: { chainId: string }): Promise<
    Array<{
      denom: string;
      amount: string;
    }>
  >;
  disconnect(): Promise<void>;
}

export function registerQuoteTool(server: McpServer, store: KeplrStore): void {
  server.registerTool(
    "osmosis-quote",
    {
      description:
        "Get a swap quote from Osmosis DEX via Skip Routes API. Returns the expected output amount, minimum output with slippage, price impact, and routing info. " +
        "Supports any Osmosis-listed token by symbol (OSMO, ATOM, USDC, milkTIA, NTRN, etc.), full IBC denom, or factory denom.",
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        tokenIn: z
          .string()
          .describe(
            "Input token symbol (e.g., OSMO, ATOM, milkTIA) or denom (e.g., uosmo, ibc/..., factory/...)",
          ),
        tokenOut: z
          .string()
          .describe("Output token symbol (e.g., USDC, NTRN, allBTC) or denom"),
        amountIn: AMOUNT_IN_SCHEMA,
        slippageBps: SLIPPAGE_BPS_SCHEMA,
      },
    },
    async ({ tokenIn, tokenOut, amountIn, slippageBps }) => {
      try {
        const client = getOsmosisClient();

        const quote = await client.getQuote({
          tokenIn,
          tokenOut,
          amountIn,
          slippageBps,
        });

        // Check user's balance for context-aware suggestions
        let userBalance: string | null = null;
        let hasInsufficientBalance = false;

        try {
          const osmosisChain = getChainConfig(OSMOSIS_CHAIN_ID);
          if (!osmosisChain) throw new Error("no chain config");
          const cosmosClient =
            await store.getClientFor<CosmosClientLike>("cosmos");
          const balances = await cosmosClient.getBalances(osmosisChain);
          const tokenBalance = balances.find(
            (b) => b.denom === quote.tokenIn.denom,
          );
          if (tokenBalance) {
            userBalance = tokenBalance.amount;
            hasInsufficientBalance =
              BigInt(tokenBalance.amount) < BigInt(quote.tokenIn.amount);
          } else {
            hasInsufficientBalance = true;
          }
        } catch {
          // Wallet not configured or balance check failed - continue without balance info
        }

        // Build context-aware suggested actions
        const suggestedActions: SuggestedAction[] = [];

        if (hasInsufficientBalance) {
          suggestedActions.push({
            tool: "get-balances",
            reason: `Check your current ${quote.tokenIn.symbol} balance on Osmosis`,
            params: { chain: "osmosis" },
            priority: 1,
          });
          suggestedActions.push({
            tool: "ibc-transfer",
            reason: `Transfer ${quote.tokenIn.symbol} to Osmosis from another chain`,
            priority: 2,
          });
          suggestedActions.push({
            tool: "osmosis-swap",
            reason: `Execute swap (⚠️ insufficient ${quote.tokenIn.symbol} balance)`,
            params: {
              tokenIn,
              tokenOut,
              amountIn,
              slippageBps,
            },
            priority: 3,
          });
        } else {
          suggestedActions.push({
            tool: "osmosis-swap",
            reason: `Execute this swap: ${amountIn} ${quote.tokenIn.symbol} → ${quote.tokenOut.displayAmount} ${quote.tokenOut.symbol}`,
            params: {
              tokenIn,
              tokenOut,
              amountIn,
              slippageBps,
            },
            priority: 1,
          });
          suggestedActions.push({
            tool: "get-balances",
            reason: "Check your Osmosis token balances",
            params: { chain: "osmosis" },
            priority: 2,
          });
        }

        // Build response
        const response: Record<string, unknown> = {
          quote: {
            input: `${quote.tokenIn.displayAmount} ${quote.tokenIn.symbol}`,
            output: `${quote.tokenOut.displayAmount} ${quote.tokenOut.symbol}`,
            minimumOutput: `${quote.amountOutMinDisplay} ${quote.tokenOut.symbol}`,
            priceImpact: quote.priceImpact,
            slippage: `${quote.slippageBps / 100}%`,
            ...(quote.usdAmountIn && { usdAmountIn: quote.usdAmountIn }),
            ...(quote.usdAmountOut && { usdAmountOut: quote.usdAmountOut }),
          },
          route: quote.route,
          chain: OSMOSIS_CHAIN_ID,
          tokens: {
            tokenIn: {
              symbol: quote.tokenIn.symbol,
              denom: quote.tokenIn.denom,
              decimals: quote.tokenIn.decimals,
            },
            tokenOut: {
              symbol: quote.tokenOut.symbol,
              denom: quote.tokenOut.denom,
              decimals: quote.tokenOut.decimals,
            },
          },
          rawAmounts: {
            amountIn: quote.tokenIn.amount,
            amountOut: quote.tokenOut.amount,
            amountOutMin: quote.amountOutMin,
          },
          suggestedActions,
        };

        if (userBalance !== null) {
          response.balanceContext = {
            currentBalance: userBalance,
            requiredAmount: quote.tokenIn.amount,
            sufficient: !hasInsufficientBalance,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return handleError(error, "osmosis-quote");
      }
    },
  );

  // Resource: list supported tokens (dynamic via Skip API)
  server.registerResource(
    "osmosis-tokens",
    "osmosis://tokens",
    {
      description:
        "List of tokens available on Osmosis DEX (dynamically fetched from Skip API)",
    },
    async (uri) => {
      try {
        const assets = await getSkipOsmosisAssets();
        const tokens = assets.map((a) => ({
          symbol: a.recommended_symbol ?? a.symbol,
          denom: a.denom,
          decimals: a.decimals,
        }));

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  chainId: OSMOSIS_CHAIN_ID,
                  tokenCount: tokens.length,
                  tokens,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  error: `Failed to fetch Osmosis token list: ${msg}`,
                  suggestedActions: [
                    {
                      tool: "osmosis-quote",
                      reason: "Try a specific token pair instead",
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
    },
  );

  // --- Prompts ---

  server.registerPrompt(
    "osmosis-swap",
    {
      description: "Swap tokens on Osmosis DEX (guided)",
      argsSchema: {
        from: z.string().optional().describe("Token to sell (symbol or denom)"),
        to: z.string().optional().describe("Token to buy (symbol or denom)"),
        amount: z.string().optional().describe("Amount to swap"),
      },
    },
    async ({ from, to, amount }) => {
      const parts = ["I want to swap tokens on Osmosis DEX."];
      if (from) parts.push(`Selling: ${from}`);
      if (to) parts.push(`Buying: ${to}`);
      if (amount) parts.push(`Amount: ${amount}`);
      parts.push(
        "",
        "Please help me:",
        "1. Get a quote using osmosis-quote",
        "2. Show me the expected output, price impact, and routing",
        "3. If I approve, prepare the swap transaction",
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
}

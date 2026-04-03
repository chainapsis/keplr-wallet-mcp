/**
 * Osmosis swap tool
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  elicitTxConfirmation,
  getChainConfig,
  pickTip,
  type SuggestedAction,
  type TransactionPreview,
} from "../../../../sdk.js";
import type { KeplrStore } from "../../../../store.js";
import { getTtlInfo } from "../../../../store.js";
import { getOsmosisClient } from "../client.js";
import {
  AMOUNT_IN_SCHEMA,
  OSMOSIS_CHAIN_ID,
  SLIPPAGE_BPS_SCHEMA,
} from "../constants.js";
import { handleError } from "./shared.js";

// CosmosClient interface for type safety
interface CosmosClientLike {
  getAddress(chain: unknown): Promise<string>;
  signAndBroadcastMsgs(
    chain: unknown,
    messages: Array<{ typeUrl: string; value: unknown }>,
  ): Promise<{
    transactionHash: string;
    code: number;
    gasUsed: string;
    gasWanted: string;
  }>;
  simulateFee?(
    chain: unknown,
    messages: Array<{ typeUrl: string; value: unknown }>,
  ): Promise<{ gasEstimate: string; feeAmount: string; feeDenom: string }>;
  disconnect(): Promise<void>;
}

export function registerSwapTool(server: McpServer, store: KeplrStore): void {
  server.registerTool(
    "osmosis-swap",
    {
      description:
        "Execute a token swap on Osmosis DEX via Skip Routes API. Returns a confirmation token that must be confirmed with the confirm-action tool. " +
        "Supports any Osmosis-listed token by symbol or denom, with automatic multi-hop routing.",
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        tokenIn: z
          .string()
          .describe("Input token symbol (e.g., OSMO, ATOM, milkTIA) or denom"),
        tokenOut: z
          .string()
          .describe("Output token symbol (e.g., USDC, NTRN, allBTC) or denom"),
        amountIn: AMOUNT_IN_SCHEMA,
        slippageBps: SLIPPAGE_BPS_SCHEMA,
      },
    },
    async ({ tokenIn, tokenOut, amountIn, slippageBps }, _extra) => {
      try {
        const osmosisChain = getChainConfig(OSMOSIS_CHAIN_ID);
        if (!osmosisChain) {
          throw new Error(`Chain config not found for ${OSMOSIS_CHAIN_ID}`);
        }

        // Get Cosmos client for sender address
        const cosmosClient =
          await store.getClientFor<CosmosClientLike>("cosmos");
        const senderAddress = await cosmosClient.getAddress(osmosisChain);

        // Get quote
        const client = getOsmosisClient();
        const quote = await client.getQuote({
          tokenIn,
          tokenOut,
          amountIn,
          slippageBps,
        });

        // Build swap messages via Skip msgs_direct
        const swapMsgs = await client.buildSwapMessages({
          tokenIn,
          tokenOut,
          amountIn,
          slippageBps,
          sender: senderAddress,
        });

        const summary = `Swap ${amountIn} ${quote.tokenIn.symbol} → ~${quote.tokenOut.displayAmount} ${quote.tokenOut.symbol} on Osmosis`;

        // Estimate fee via simulation, fall back to conservative default
        let estimatedFee: TransactionPreview["estimatedFee"];
        let feeEstimationMethod: TransactionPreview["feeEstimationMethod"];
        try {
          if (cosmosClient.simulateFee) {
            const sim = await cosmosClient.simulateFee(osmosisChain, swapMsgs);
            estimatedFee = {
              value: sim.feeAmount,
              denom: sim.feeDenom,
              formatted: `~${(Number(sim.feeAmount) / 1e6).toFixed(4)} OSMO`,
            };
            feeEstimationMethod = "simulated";
          } else {
            throw new Error("simulateFee not available");
          }
        } catch (feeErr) {
          const reason =
            feeErr instanceof Error ? feeErr.message : String(feeErr);
          console.warn(`[osmosis-swap] Fee simulation failed: ${reason}`);
          estimatedFee = {
            value: "25000",
            denom: "uosmo",
            formatted: "~0.025 OSMO",
          };
          feeEstimationMethod = "fallback";
        }

        // Build transaction preview for elicitation
        const warnings: TransactionPreview["warnings"] = [];

        if (feeEstimationMethod === "fallback") {
          warnings.push({
            level: "warning",
            code: "FEE_SIMULATION_FAILED",
            message:
              "Could not simulate exact fee. Using conservative estimate (~0.025 OSMO).",
          });
        }

        if (quote.priceImpactPercent > 1) {
          warnings.push({
            level: "warning",
            code: "HIGH_PRICE_IMPACT",
            message: `Price impact: ${quote.priceImpact}`,
          });
        }

        const preview: TransactionPreview = {
          summary,
          from: senderAddress,
          amount: {
            value: quote.tokenIn.amount,
            denom: quote.tokenIn.denom,
            formatted: `${quote.tokenIn.displayAmount} ${quote.tokenIn.symbol}`,
          },
          estimatedFee,
          feeEstimationMethod,
          warnings,
        };

        // Execute function for both elicitation and confirmation token flows
        const execute = async () => {
          const execClient =
            await store.getClientFor<CosmosClientLike>("cosmos");

          const result = await execClient.signAndBroadcastMsgs(
            osmosisChain,
            swapMsgs,
          );

          if (result.code !== 0) {
            throw new Error(`Transaction failed with code ${result.code}`);
          }

          return {
            transactionHash: result.transactionHash,
            code: result.code,
            gasUsed: result.gasUsed,
            gasWanted: result.gasWanted,
            swap: {
              tokenIn: quote.tokenIn.symbol,
              tokenOut: quote.tokenOut.symbol,
              amountIn: quote.tokenIn.displayAmount,
              expectedOutput: quote.tokenOut.displayAmount,
              minimumOutput: quote.amountOutMinDisplay,
            },
          };
        };

        // Try elicitation first
        const mcpServer = (server as unknown as { server: unknown }).server;
        const elicitResult = await elicitTxConfirmation(
          mcpServer as Parameters<typeof elicitTxConfirmation>[0],
          preview,
        );

        if (elicitResult !== null) {
          // Elicitation was supported
          if (!elicitResult.confirmed) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: "Transaction cancelled by user",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const result = await execute();

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "get-transaction-status",
              reason: "Check transaction confirmation status",
              params: {
                chain: OSMOSIS_CHAIN_ID,
                txHash: result.transactionHash,
              },
              priority: 1,
            },
            {
              tool: "get-balances",
              reason: "Check updated token balances",
              params: { chain: OSMOSIS_CHAIN_ID },
              priority: 2,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "success",
                    ...result,
                    suggestedActions,
                    tip: pickTip("osmosis-swap"),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Elicitation not supported - use confirmation token flow
        const confirmationToken = store.storePending(
          summary,
          OSMOSIS_CHAIN_ID,
          execute,
        );

        const ttlInfo = getTtlInfo();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "pending_confirmation",
                  summary,
                  from: senderAddress,
                  swap: {
                    tokenIn: {
                      symbol: quote.tokenIn.symbol,
                      denom: quote.tokenIn.denom,
                      amount: quote.tokenIn.displayAmount,
                    },
                    tokenOut: {
                      symbol: quote.tokenOut.symbol,
                      denom: quote.tokenOut.denom,
                      expectedAmount: quote.tokenOut.displayAmount,
                      minimumAmount: quote.amountOutMinDisplay,
                    },
                    priceImpact: quote.priceImpact,
                    slippage: `${slippageBps ? slippageBps / 100 : 0.5}%`,
                    route: quote.route,
                  },
                  chain: OSMOSIS_CHAIN_ID,
                  confirmationToken,
                  expiresIn: ttlInfo.expiresIn,
                  expiresAt: ttlInfo.expiresAt,
                  ttlWarning: ttlInfo.ttlWarning,
                  instruction:
                    "Call confirm-action with this token to execute the swap.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return handleError(error, "osmosis-swap");
      }
    },
  );
}

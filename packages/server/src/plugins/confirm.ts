import { z } from "zod";
import { loadAuthConfig } from "../auth/config.js";
import {
  classifyError,
  formatClassifiedError,
  parseCosmWasmMsgError,
  type SuggestedAction,
} from "../errors.js";
import {
  requestTxConfirmation,
  supportsFormElicitation,
} from "../mcp-features/elicitation.js";
import {
  createProgressReporter,
  TX_PROGRESS,
} from "../mcp-features/progress.js";
import { executePending } from "../pending-action.js";
import { formatTimeRemaining, store } from "../store.js";
import type { KeplrPlugin } from "./types.js";

/**
 * Build suggested actions for a confirmed transaction
 */
function buildConfirmSuggestedActions(
  chain: string | undefined,
  result: Record<string, unknown>,
): SuggestedAction[] {
  const txHash =
    (result.transactionHash as string) || (result.txHash as string);
  if (!chain || !txHash) return [];

  return [
    {
      tool: "get-transaction-status",
      reason: "Check transaction confirmation status",
      params: { chain, txHash },
      priority: 1,
    },
    {
      tool: "get-balances",
      reason: "Check updated token balances",
      params: { chain },
      priority: 2,
    },
    {
      tool: "get-staking-info",
      reason: "Check updated staking positions and rewards",
      params: { chain },
      priority: 3,
    },
  ];
}

const confirmPlugin: KeplrPlugin = {
  name: "confirm",
  register(server) {
    // List all pending transactions awaiting confirmation
    server.registerTool(
      "list-pending-actions",
      {
        description:
          "List all pending transactions awaiting confirmation. Shows token (truncated for security), summary, chain, and time remaining.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const { pending } = store.getState();

        if (pending.size === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message: "No pending transactions",
                    count: 0,
                    pending: [],
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const pendingList = Array.from(pending.entries()).map(
          ([token, entry]) => ({
            // Show only first 8 characters of token for security
            tokenPreview: `${token.slice(0, 8)}...`,
            summary: entry.summary,
            chain: entry.chain || "(non-chain action)",
            expiresIn: formatTimeRemaining(entry.expiresAt),
            expiresAt: entry.expiresAt,
          }),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `${pending.size} pending transaction(s)`,
                  count: pending.size,
                  pending: pendingList,
                  tip: "Use cancel-pending-action with the full token to cancel a transaction before it expires.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // Cancel a pending transaction
    server.registerTool(
      "cancel-pending-action",
      {
        description:
          "Cancel a pending transaction before it is confirmed. Requires the full confirmation token.",
        annotations: {
          idempotentHint: true,
        },
        inputSchema: {
          confirmationToken: z
            .string()
            .describe("The full confirmation token to cancel"),
        },
      },
      async ({ confirmationToken }) => {
        const { pending } = store.getState();
        const entry = pending.get(confirmationToken);

        if (!entry) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    message:
                      "Transaction not found. It may have already been confirmed, cancelled, or expired.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Remove from pending map
        const next = new Map(pending);
        next.delete(confirmationToken);
        store.setState({ pending: next });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Transaction cancelled successfully",
                  cancelledTransaction: {
                    summary: entry.summary,
                    chain: entry.chain || "(non-chain action)",
                  },
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
      "confirm-action",
      {
        description:
          "Confirm and execute a pending transaction using the confirmation token returned by a transaction tool.",
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
        inputSchema: {
          confirmationToken: z
            .string()
            .describe("The confirmation token returned by a transaction tool"),
          totpCode: z
            .string()
            .length(6)
            .regex(/^\d{6}$/)
            .optional()
            .describe(
              "6-digit TOTP code from authenticator app. Required only for TOTP-only auth when the client does not support elicitation.",
            ),
        },
      },
      async ({ confirmationToken, totpCode }, extra) => {
        // Get progress token from request metadata
        const progressToken = extra._meta?.progressToken;
        const reporter = progressToken
          ? createProgressReporter(server.server, progressToken)
          : null;

        // Get the pending entry to access chain information
        const { pending } = store.getState();
        const pendingEntry = pending.get(confirmationToken);
        const chain = pendingEntry?.chain;

        // Elicitation gate: show confirmation form when supported, skip otherwise
        if (
          pendingEntry?.elicitationSummary &&
          supportsFormElicitation(server.server)
        ) {
          const elicitResult = await requestTxConfirmation(
            server.server,
            pendingEntry.elicitationSummary,
          );

          if (!elicitResult || !elicitResult.confirmed) {
            // Remove cancelled action from pending map
            const next = new Map(pending);
            next.delete(confirmationToken);
            store.setState({ pending: next });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: "Transaction cancelled by user",
                      summary: pendingEntry.summary,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }

        try {
          // Report: preparing
          await reporter?.report(
            TX_PROGRESS.PREPARING.progress,
            100,
            TX_PROGRESS.PREPARING.message,
          );

          // Report: signing (wallet interaction) - this happens during execution
          await reporter?.report(
            TX_PROGRESS.SIGNING.progress,
            100,
            TX_PROGRESS.SIGNING.message,
          );

          // Execute the pending transaction with progress simulation
          // The actual signing and broadcasting happens inside executePending,
          // but we can't get callbacks from it. So we run progress updates
          // in parallel with the execution to give visual feedback.
          const progressPromise = (async () => {
            if (!reporter) return;
            // Wait a moment for signing to complete (typical user interaction)
            await new Promise((r) => setTimeout(r, 1500));
            await reporter.report(
              TX_PROGRESS.BROADCASTING.progress,
              100,
              TX_PROGRESS.BROADCASTING.message,
            );
            // Wait for broadcasting to node
            await new Promise((r) => setTimeout(r, 1000));
            await reporter.report(
              TX_PROGRESS.WAITING.progress,
              100,
              TX_PROGRESS.WAITING.message,
            );
          })();

          // Run execution and progress in parallel
          const [result] = await Promise.all([
            executePending(
              confirmationToken,
              totpCode ? { totpCode } : undefined,
            ),
            progressPromise,
          ]);

          // Report: complete
          await reporter?.complete(TX_PROGRESS.CONFIRMED.message);

          // Build response with suggested actions
          const resultObj = result as Record<string, unknown>;
          const suggestedActions = buildConfirmSuggestedActions(
            chain,
            resultObj,
          );

          const response: Record<string, unknown> = {
            ...resultObj,
          };

          if (suggestedActions.length > 0) {
            response.suggestedActions = suggestedActions;
          }

          // Warn if authentication is not enabled
          // Wrapped in try/catch: auth config read failure must not mask a successful tx result
          try {
            const authConfig = await loadAuthConfig();
            if (!authConfig.enabled) {
              response.securityWarning =
                "⚠️ Authentication is not enabled. Anyone with access to this MCP server can execute transactions without verification. Run auth-enable and auth-setup to protect your wallet.";
              const authAction: SuggestedAction = {
                tool: "auth-enable",
                reason: "Protect wallet with authentication",
                priority: 1,
              };
              if (Array.isArray(response.suggestedActions)) {
                response.suggestedActions.unshift(authAction);
              } else {
                response.suggestedActions = [authAction];
              }
            }
          } catch {
            // Auth config unreadable; skip warning rather than blocking tx response
          }

          return {
            content: [
              { type: "text", text: JSON.stringify(response, null, 2) },
            ],
          };
        } catch (error: unknown) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));

          // Check for CosmWasm message parsing errors first (prevents gas false positive)
          const cosmwasmParsed = parseCosmWasmMsgError(errorObj.message);
          if (cosmwasmParsed) {
            await reporter?.fail(errorObj.message);

            const cwSuggestedActions: SuggestedAction[] = [];
            if (
              cosmwasmParsed.availableVariants &&
              cosmwasmParsed.availableVariants.length > 0
            ) {
              cwSuggestedActions.push({
                tool: "cosmwasm-execute",
                reason: `Retry with a valid variant: ${cosmwasmParsed.availableVariants.join(", ")}`,
                priority: 1,
              });
            }
            cwSuggestedActions.push({
              tool: "cosmwasm-query",
              reason:
                "Query the contract config to understand how to use the available variants",
              priority: 2,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      isError: true,
                      category: "validation",
                      message: errorObj.message,
                      recoverable: false,
                      parsed: cosmwasmParsed,
                      suggestion:
                        "The contract does not accept this message format. See 'parsed' for valid options.",
                      suggestedActions: cwSuggestedActions,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Classify the error for better UX
          const classified = classifyError(errorObj);
          const formatted = formatClassifiedError(classified);

          // Report failure
          await reporter?.fail(classified.message);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formatted, null, 2),
              },
            ],
            isError: true,
          };
        }
      },
    );

    // List transaction history
    server.registerTool(
      "list-transaction-history",
      {
        description:
          "View past transaction history. Shows recent transactions with their status, chain, and results.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
        inputSchema: {
          chain: z
            .string()
            .optional()
            .describe("Filter by chain ID (e.g., 'osmosis-1', 'cosmoshub-4')"),
          limit: z
            .number()
            .optional()
            .default(20)
            .describe("Maximum number of transactions to return (default: 20)"),
        },
      },
      async ({ chain, limit }) => {
        const history = store
          .getState()
          .getTransactionHistory({ chain, limit });

        if (history.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message: chain
                      ? `No transactions found for chain: ${chain}`
                      : "No transaction history yet",
                    count: 0,
                    transactions: [],
                    tip: "Transactions are recorded when you confirm and execute them using confirm-action.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Format transactions for display
        const transactions = history.map((tx) => ({
          id: tx.id,
          summary: tx.summary,
          status: tx.status,
          chain: tx.chain || "(non-chain action)",
          txHash: tx.txHash || null,
          timestamp: new Date(tx.timestamp).toISOString(),
          timeAgo: formatTimeAgo(tx.timestamp),
          ...(tx.error && { error: tx.error }),
        }));

        const suggestedActions: SuggestedAction[] = [];

        // Suggest viewing recent successful transaction status
        const recentSuccess = history.find(
          (tx) => tx.status === "success" && tx.txHash,
        );
        if (recentSuccess) {
          suggestedActions.push({
            tool: "get-transaction-status",
            reason: "Check status of most recent transaction",
            params: {
              chain: recentSuccess.chain,
              txHash: recentSuccess.txHash,
            },
            priority: 1,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Found ${history.length} transaction(s)`,
                  count: history.length,
                  transactions,
                  ...(suggestedActions.length > 0 && { suggestedActions }),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  },
};

/**
 * Format timestamp as relative time (e.g., "2 minutes ago")
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export default confirmPlugin;

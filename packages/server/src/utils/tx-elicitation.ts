/**
 * Transaction Elicitation Helper
 *
 * Provides utilities for requesting transaction confirmation via MCP elicitation.
 * Falls back to the traditional confirmation token flow when elicitation is not supported.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { TransactionPreview } from "../errors.js";
import {
  requestTxConfirmation,
  supportsFormElicitation,
} from "../mcp-features/elicitation.js";

/**
 * Result of elicitation-based transaction confirmation
 */
export interface TxElicitationResult {
  /** User confirmed the transaction (always true; unconfirmed cases return null) */
  confirmed: true;
  /** Optional memo from user */
  memo?: string;
}

/**
 * Request transaction confirmation via elicitation.
 *
 * If the MCP client supports elicitation, this will show a confirmation form
 * to the user and return their response. If elicitation is not supported,
 * returns null to indicate the traditional confirmation token flow should be used.
 *
 * @param server - MCP Server instance (use McpServer.server to get this)
 * @param preview - Transaction preview to show the user
 * @returns Elicitation result, or null if elicitation is not supported
 */
export async function elicitTxConfirmation(
  server: Server,
  preview: TransactionPreview,
): Promise<TxElicitationResult | null> {
  if (!supportsFormElicitation(server)) {
    return null; // Use traditional confirmation token flow
  }

  const summary = formatPreviewForElicitation(preview);
  const result = await requestTxConfirmation(server, summary);

  if (!result) {
    return null; // Elicitation failed (client didn't show form), fall back to token flow
  }

  if (!result.confirmed) {
    // Fall back to token flow instead of returning cancelled.
    // The client may have auto-submitted with default value (confirmed: false)
    // without actual user interaction (e.g. non-interactive context, SDK timeout).
    return null;
  }

  return { confirmed: true, memo: result.memo };
}

/**
 * Format a transaction preview for display in the elicitation form.
 * Creates a human-readable summary with fee and warning information.
 */
export function formatPreviewForElicitation(
  preview: TransactionPreview,
): string {
  const parts: string[] = [];

  // Summary line
  if (preview.summary) {
    parts.push(preview.summary);
  }

  // Amount details
  if (preview.amount) {
    parts.push(`\nAmount: ${preview.amount.formatted}`);
  }

  // Fee information
  if (preview.estimatedFee) {
    let feeText = `Estimated Fee: ${preview.estimatedFee.formatted}`;
    if (preview.feeEstimationMethod === "fallback") {
      feeText += " (estimated)";
    }
    parts.push(feeText);
  }

  // Balance after
  if (preview.balanceAfter) {
    parts.push(`Balance After: ${preview.balanceAfter.formatted}`);
  }

  // Warnings
  if (preview.warnings?.length) {
    parts.push(
      `\n⚠️ Warnings:\n${preview.warnings.map((w) => `• ${w.message}`).join("\n")}`,
    );
  }

  // Fee warning
  if (preview.feeWarning) {
    parts.push(`\n⚠️ ${preview.feeWarning}`);
  }

  return parts.join("\n");
}

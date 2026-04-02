/**
 * MCP Elicitation
 *
 * Provides utilities for requesting structured user input from the MCP client.
 * Supports form mode for structured data and URL mode for sensitive operations.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Elicitation result actions
 */
export type ElicitAction = "accept" | "decline" | "cancel";

/**
 * Form elicitation result
 */
export interface ElicitFormResult<T = Record<string, unknown>> {
  action: ElicitAction;
  content?: T;
}

/**
 * URL elicitation result
 */
export interface ElicitUrlResult {
  action: ElicitAction;
}

/**
 * Check if client supports elicitation
 */
export function supportsElicitation(server: Server): boolean {
  const capabilities = server.getClientCapabilities();
  return !!capabilities?.elicitation;
}

/**
 * Check if client supports form mode elicitation
 */
export function supportsFormElicitation(server: Server): boolean {
  const capabilities = server.getClientCapabilities();
  if (!capabilities?.elicitation) return false;
  // Empty object means form only (backwards compat)
  const elicit = capabilities.elicitation as Record<string, unknown>;
  return Object.keys(elicit).length === 0 || !!elicit.form;
}

/**
 * Check if client supports URL mode elicitation
 */
export function supportsUrlElicitation(server: Server): boolean {
  const capabilities = server.getClientCapabilities();
  if (!capabilities?.elicitation) return false;
  const elicit = capabilities.elicitation as Record<string, unknown>;
  return !!elicit.url;
}

/**
 * Request form input from user using SDK types directly
 */
export async function elicitForm<T extends Record<string, unknown>>(
  server: Server,
  params: Omit<ElicitRequestFormParams, "_meta" | "task">,
): Promise<ElicitFormResult<T>> {
  if (!supportsFormElicitation(server)) {
    return { action: "decline" };
  }

  try {
    const result = await server.elicitInput(params);
    return {
      action: result.action as ElicitAction,
      content: result.content as T | undefined,
    };
  } catch (error) {
    console.error("[Elicitation] Form request failed:", error);
    return { action: "cancel" };
  }
}

/**
 * Request URL navigation from user (for sensitive operations)
 */
export async function elicitUrl(
  server: Server,
  params: Omit<ElicitRequestURLParams, "_meta" | "task">,
): Promise<ElicitUrlResult> {
  if (!supportsUrlElicitation(server)) {
    return { action: "decline" };
  }

  try {
    const result = await server.elicitInput(params);
    return { action: result.action as ElicitAction };
  } catch (error) {
    console.error("[Elicitation] URL request failed:", error);
    return { action: "cancel" };
  }
}

// ============================================================================
// Pre-built Form Schemas (SDK-compatible)
// ============================================================================

/**
 * Schema for swap parameters
 */
export const SWAP_PARAMS_SCHEMA = {
  type: "object" as const,
  properties: {
    slippage: {
      type: "number" as const,
      title: "Slippage Tolerance",
      description: "Maximum acceptable slippage percentage (0.1-5%)",
      minimum: 0.1,
      maximum: 5,
      default: 0.5,
    },
    deadline: {
      type: "integer" as const,
      title: "Transaction Deadline",
      description: "Transaction deadline in minutes",
      minimum: 1,
      maximum: 60,
      default: 20,
    },
  },
  required: ["slippage"] as string[],
};

/**
 * Schema for transaction confirmation
 */
export const TX_CONFIRM_SCHEMA = {
  type: "object" as const,
  properties: {
    confirmed: {
      type: "boolean" as const,
      title: "Confirm Transaction",
      description: "I understand and want to proceed with this transaction",
      default: false,
    },
    memo: {
      type: "string" as const,
      title: "Memo (optional)",
      description: "Optional memo to include with the transaction",
      maxLength: 256,
    },
  },
  required: ["confirmed"] as string[],
};

/**
 * Schema for gas settings
 */
export const GAS_SETTINGS_SCHEMA = {
  type: "object" as const,
  properties: {
    gasMultiplier: {
      type: "number" as const,
      title: "Gas Multiplier",
      description: "Multiply estimated gas by this factor (1.0-3.0)",
      minimum: 1.0,
      maximum: 3.0,
      default: 1.4,
    },
    gasPriority: {
      type: "string" as const,
      title: "Gas Priority",
      description: "Transaction priority level",
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
};

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Request swap parameters from user
 */
export async function requestSwapParams(server: Server): Promise<{
  slippage: number;
  deadline: number;
} | null> {
  const result = await elicitForm<{ slippage: number; deadline?: number }>(
    server,
    {
      mode: "form",
      message: "Configure swap parameters before proceeding:",
      requestedSchema: SWAP_PARAMS_SCHEMA,
    },
  );

  if (result.action !== "accept" || !result.content) {
    return null;
  }

  return {
    slippage: result.content.slippage,
    deadline: result.content.deadline ?? 20,
  };
}

/**
 * Request transaction confirmation from user
 */
export async function requestTxConfirmation(
  server: Server,
  summary: string,
): Promise<{ confirmed: boolean; memo?: string } | null> {
  const result = await elicitForm<{ confirmed: boolean; memo?: string }>(
    server,
    {
      mode: "form",
      message: `Please confirm: ${summary}`,
      requestedSchema: TX_CONFIRM_SCHEMA,
    },
  );

  if (result.action !== "accept" || !result.content) {
    return null;
  }

  return result.content;
}

// ============================================================================
// Simple Confirmation for High-Risk Operations
// ============================================================================

/**
 * Schema for simple yes/no confirmation
 */
export const SIMPLE_CONFIRM_SCHEMA = {
  type: "object" as const,
  properties: {
    confirmed: {
      type: "boolean" as const,
      title: "Confirm",
      description: "Check this box to confirm the action",
      default: false,
    },
  },
  required: ["confirmed"] as string[],
};

/**
 * Request a simple confirmation from the user for high-risk operations.
 * Returns null if elicitation is not supported, signaling that the caller
 * should fall back to the confirmation token flow.
 *
 * @param server - MCP server instance
 * @param options - Confirmation options
 * @returns true if confirmed, false if cancelled, or null if elicitation not supported
 */
export async function requestConfirmation(
  server: Server,
  options: {
    title: string;
    message: string;
    confirmLabel?: string;
  },
): Promise<boolean | null> {
  // If elicitation is not supported, return null to signal fallback to confirmation token
  if (!supportsFormElicitation(server)) {
    return null;
  }

  const result = await elicitForm<{ confirmed: boolean }>(server, {
    mode: "form",
    message: `${options.title}\n\n${options.message}`,
    requestedSchema: {
      type: "object" as const,
      properties: {
        confirmed: {
          type: "boolean" as const,
          title: options.confirmLabel ?? "I confirm this action",
          description: options.message,
          default: false,
        },
      },
      required: ["confirmed"] as string[],
    },
  });

  // User cancelled or declined
  if (result.action !== "accept") {
    return false;
  }

  // Check if they actually checked the confirmation box
  return result.content?.confirmed === true;
}

/**
 * Request a TOTP code from the user via elicitation.
 * Returns the 6-digit code string, or null if cancelled/unsupported.
 */
export async function requestTotpCode(server: Server): Promise<string | null> {
  const result = await elicitForm<{ totpCode: string }>(server, {
    mode: "form",
    message: "Enter the 6-digit code from your authenticator app.",
    requestedSchema: {
      type: "object" as const,
      properties: {
        totpCode: {
          type: "string" as const,
          title: "TOTP Code",
          description: "6-digit code from your authenticator app",
          minLength: 6,
          maxLength: 6,
        },
      },
      required: ["totpCode"] as string[],
    },
  });

  if (result.action !== "accept" || !result.content?.totpCode) {
    return null;
  }
  return result.content.totpCode;
}

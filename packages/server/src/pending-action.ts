/**
 * Pending Action Module
 *
 * Facade over the central store's pending-action logic.
 */

import { type PendingExecuteContext, store } from "./store.js";

export type { PendingAction, PendingExecuteContext } from "./store.js";

export function storePending(
  summary: string,
  chain: string,
  execute: (context?: PendingExecuteContext) => Promise<unknown>,
  preValidate?: (context?: PendingExecuteContext) => Promise<void>,
  elicitationSummary?: string,
): string {
  return store
    .getState()
    .storePending(summary, chain, execute, preValidate, elicitationSummary);
}

/**
 * Execute a pending action
 */
export async function executePending(
  token: string,
  context?: PendingExecuteContext,
): Promise<unknown> {
  return store.getState().executePending(token, context);
}

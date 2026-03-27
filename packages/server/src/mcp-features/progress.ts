/**
 * MCP Progress Notifications
 *
 * Provides utilities for reporting progress of long-running operations
 * to the MCP client.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Progress reporter for long-running operations
 */
export interface ProgressReporter {
  /** Report progress update */
  report(progress: number, total?: number, message?: string): Promise<void>;
  /** Mark operation as complete */
  complete(message?: string): Promise<void>;
  /** Mark operation as failed */
  fail(error: string): Promise<void>;
}

/**
 * Create a progress reporter for a given progress token
 */
export function createProgressReporter(
  server: Server,
  progressToken: string | number,
): ProgressReporter {
  let lastProgress = 0;

  return {
    async report(progress: number, total?: number, message?: string) {
      // Ensure progress always increases
      if (progress <= lastProgress && total === undefined) {
        progress = lastProgress + 1;
      }
      lastProgress = progress;

      try {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress,
            ...(total !== undefined && { total }),
            ...(message && { message }),
          },
        });
      } catch {
        // Ignore notification errors (client may not support progress)
      }
    },

    async complete(message?: string) {
      try {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: 100,
            total: 100,
            ...(message && { message }),
          },
        });
      } catch {
        // Ignore notification errors
      }
    },

    async fail(error: string) {
      try {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: lastProgress,
            message: `Error: ${error}`,
          },
        });
      } catch {
        // Ignore notification errors
      }
    },
  };
}

/**
 * Progress stages for transaction lifecycle
 */
export const TX_PROGRESS = {
  PREPARING: { progress: 10, message: "Preparing transaction..." },
  SIGNING: { progress: 30, message: "Requesting signature from wallet..." },
  BROADCASTING: { progress: 50, message: "Broadcasting transaction..." },
  WAITING: { progress: 70, message: "Waiting for confirmation..." },
  CONFIRMED: { progress: 100, message: "Transaction confirmed" },
} as const;

/**
 * Progress stages for multi-step operations
 */
export const MULTI_STEP_PROGRESS = {
  step: (current: number, total: number, message: string) => ({
    progress: Math.round((current / total) * 100),
    total: 100,
    message: `[${current}/${total}] ${message}`,
  }),
} as const;

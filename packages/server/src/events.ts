/**
 * Keplr MCP Server Event System
 *
 * Provides a typed event system for plugins and external packages
 * to subscribe to server lifecycle and transaction events.
 */

/**
 * All supported event types.
 */
export const KeplrEventTypes = {
  // Transaction events
  TRANSACTION_CONFIRMED: "transaction:confirmed",
  TRANSACTION_FAILED: "transaction:failed",

  // Account events
  ACCOUNT_SWITCHED: "account:switched",
  ACCOUNT_CREATED: "account:created",

  // Client events
  CLIENT_INITIALIZED: "client:initialized",
  CLIENT_DISCONNECTED: "client:disconnected",
} as const;

/**
 * Union type of all event type strings.
 */
export type KeplrEventType =
  (typeof KeplrEventTypes)[keyof typeof KeplrEventTypes];

/**
 * Base event interface for all Keplr events.
 */
export interface KeplrEvent<T extends KeplrEventType = KeplrEventType> {
  /** Event type identifier */
  type: T;
  /** Unix timestamp (ms) when event occurred */
  timestamp: number;
  /** Event-specific data payload */
  data: Record<string, unknown>;
}

/**
 * Event listener callback type.
 */
export type KeplrEventListener<T extends KeplrEvent = KeplrEvent> = (
  event: T,
) => void;

/**
 * Factory function to create a typed event.
 *
 * @param type - Event type
 * @param data - Event-specific data
 * @returns A fully formed KeplrEvent
 */
export function createEvent<T extends KeplrEventType>(
  type: T,
  data: Record<string, unknown>,
): KeplrEvent<T> {
  return {
    type,
    timestamp: Date.now(),
    data,
  };
}

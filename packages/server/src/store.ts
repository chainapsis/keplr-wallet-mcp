import { randomUUID } from "node:crypto";
import { createStore } from "zustand/vanilla";
import {
  getActiveAccount,
  getActiveAccountInfo,
  getActiveMnemonic,
  loadMnemonicForAccount,
  setActiveAccount,
} from "./accounts.js";
import type { EcosystemAdapter, EcosystemClient } from "./ecosystem.js";
import {
  createEvent,
  type KeplrEvent,
  type KeplrEventListener,
  type KeplrEventType,
  KeplrEventTypes,
} from "./events.js";
import {
  createKeyProvider,
  type KeyProvider,
  type MnemonicKeyProviderConfig,
} from "./keys/index.js";
import type { ProtocolPlugin } from "./plugins/protocol-types.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TTL_MS = process.env.KEPLR_TX_TTL_MINUTES
  ? Number.parseInt(process.env.KEPLR_TX_TTL_MINUTES, 10) * 60 * 1000
  : DEFAULT_TTL_MS;
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds

/**
 * Format remaining time until expiration in a human-readable format.
 * @param expiresAt - Epoch timestamp in milliseconds when the token expires
 * @returns Formatted string like "4m 30s" or "expired"
 */
export function formatTimeRemaining(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now());
  if (remaining === 0) {
    return "expired";
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Get TTL information for transaction responses.
 * @returns Object with expiresIn, expiresAt, and warning fields
 */
export function getTtlInfo(): {
  expiresIn: string;
  expiresAt: number;
  ttlWarning: string;
} {
  const expiresAt = Date.now() + TTL_MS;
  return {
    expiresIn: formatTimeRemaining(expiresAt),
    expiresAt,
    ttlWarning:
      "The confirmation token will expire. Request the transaction again if it expires.",
  };
}

export type MnemonicSource = "env" | "keychain" | null;

/** Optional context passed from confirm-action to the pending callback */
export interface PendingExecuteContext {
  totpCode?: string;
}

export interface PendingAction {
  /** Human-readable summary (e.g. "Send 1000000 uatom to cosmos1abc…") */
  summary: string;
  /** Chain ID (empty string for non-tx actions) */
  chain: string;
  /** Async function that actually executes when invoked */
  execute: (context?: PendingExecuteContext) => Promise<unknown>;
  /** Runs BEFORE token is consumed. Failure preserves the token for retry. */
  preValidate?: (context?: PendingExecuteContext) => Promise<void>;
  /** Epoch-ms when this entry expires */
  expiresAt: number;
  /** Pre-formatted summary for elicitation at confirm time.
   *  When present, confirm-action SHOULD show elicitation before executing (skipped when client does not support it). */
  elicitationSummary?: string;
}

/**
 * Recorded transaction in history
 */
export interface TransactionRecord {
  /** Unique ID for this record */
  id: string;
  /** Human-readable summary */
  summary: string;
  /** Chain ID */
  chain: string;
  /** Transaction hash (if available) */
  txHash?: string;
  /** Status of the transaction */
  status: "success" | "failed";
  /** Error message if failed */
  error?: string;
  /** Timestamp when the transaction was executed */
  timestamp: number;
  /** Transaction result data */
  result?: unknown;
}

/**
 * Single action item in a multi-action transaction
 */
export interface ActionItem {
  /** Action type (e.g., "send", "delegate", "claim-rewards") */
  type: string;
  /** Action parameters specific to the action type */
  params: Record<string, unknown>;
  /** Human-readable label for display */
  label?: string;
}

/**
 * Pending multi-action transaction that accumulates multiple actions
 * to be executed in a single transaction
 */
export interface PendingMultiAction {
  /** Unique identifier for this multi-action */
  id: string;
  /** Chain ID (e.g., "cosmoshub-4", "osmosis-1", "1") */
  chain: string;
  /** Ecosystem type */
  ecosystem: string;
  /** List of actions to execute */
  actions: ActionItem[];
  /** Epoch-ms when this entry was created */
  createdAt: number;
  /** Epoch-ms when this entry expires */
  expiresAt: number;
  /** Whether this multi-action has been previewed (locks mutations) */
  previewed: boolean;
}

interface KeplrState {
  adapters: Map<string, EcosystemAdapter>;
  protocols: Map<string, ProtocolPlugin>;
  clients: Map<string, EcosystemClient>;
  mnemonicSource: MnemonicSource;
  pending: Map<string, PendingAction>;
  /** Pending multi-action transactions by action ID */
  pendingMultiActions: Map<string, PendingMultiAction>;
  activeAccount: string | null;
  /** Transaction history (most recent first) */
  transactionHistory: TransactionRecord[];
  /** Event listeners by event type */
  eventListeners: Map<KeplrEventType, Set<KeplrEventListener>>;
  /** Global event listeners (receive all events) */
  globalEventListeners: Set<KeplrEventListener>;
}

interface KeplrActions {
  /** Return all registered adapters */
  getAdapters: () => Map<string, EcosystemAdapter>;
  /** Register an ecosystem adapter */
  registerAdapter: (adapter: EcosystemAdapter) => void;
  /** Return all registered protocols */
  getProtocols: () => Map<string, ProtocolPlugin>;
  /** Register a protocol plugin */
  registerProtocol: (protocol: ProtocolPlugin) => void;
  /**
   * Get KeyProvider for the active account.
   * Used by adapters that implement createClientWithProvider.
   */
  getKeyProvider: () => Promise<KeyProvider>;
  /** Lazy-initialize client for a given ecosystem: env → keychain → error */
  getClientFor: <T extends EcosystemClient>(type: string) => Promise<T>;
  /** Disconnect all cached clients and clear state */
  resetClients: () => Promise<void>;
  /** Store a pending transaction, return confirmation token */
  storePending: (
    summary: string,
    chain: string,
    execute: (context?: PendingExecuteContext) => Promise<unknown>,
    preValidate?: (context?: PendingExecuteContext) => Promise<void>,
    elicitationSummary?: string,
  ) => string;
  /** Execute and consume a pending transaction by token */
  executePending: (
    token: string,
    context?: PendingExecuteContext,
  ) => Promise<unknown>;
  /** Store a pending non-tx action (e.g. delete-mnemonic) */
  storePendingAction: (
    summary: string,
    execute: (context?: PendingExecuteContext) => Promise<unknown>,
    preValidate?: (context?: PendingExecuteContext) => Promise<void>,
  ) => string;
  /** Purge expired pending entries */
  cleanupPending: () => void;
  /** Start periodic cleanup timer (60s, unref'd) */
  startCleanupTimer: () => void;
  /** Switch to a different account */
  switchAccount: (name: string) => Promise<void>;
  /** Initialize the active account from config */
  initializeActiveAccount: () => Promise<void>;
  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on: (eventType: KeplrEventType, listener: KeplrEventListener) => () => void;
  /** Subscribe to all events. Returns unsubscribe function. */
  onAny: (listener: KeplrEventListener) => () => void;
  /** Unsubscribe from a specific event type. */
  off: (eventType: KeplrEventType, listener: KeplrEventListener) => void;
  /** Emit an event to all registered listeners. */
  emit: (event: KeplrEvent) => void;
  /** Record a completed transaction in history */
  recordTransaction: (record: Omit<TransactionRecord, "id">) => void;
  /** Get transaction history (most recent first) */
  getTransactionHistory: (options?: {
    chain?: string;
    limit?: number;
  }) => TransactionRecord[];
  /** Clear transaction history */
  clearTransactionHistory: () => void;

  // --- Multi-action methods ---
  /** Create a new multi-action transaction, returns action ID */
  createMultiAction: (chain: string, ecosystem: string) => string;
  /** Add an action to a multi-action transaction */
  addMultiAction: (actionId: string, action: ActionItem) => void;
  /** Remove an action from a multi-action transaction by index */
  removeMultiAction: (actionId: string, index: number) => void;
  /** Get a pending multi-action transaction by ID */
  getMultiAction: (actionId: string) => PendingMultiAction | undefined;
  /** Get all pending multi-action transactions */
  getAllMultiActions: () => PendingMultiAction[];
  /** Clear/cancel a multi-action transaction */
  clearMultiAction: (actionId: string) => void;
  /** Cleanup expired multi-action transactions */
  cleanupMultiActions: () => void;
  /** Mark a multi-action as previewed, locking it from further mutations */
  markPreviewed: (actionId: string) => void;
}

export type KeplrStore = KeplrState & KeplrActions;

export const store = createStore<KeplrStore>()((set, get) => ({
  // --- State ---
  adapters: new Map(),
  protocols: new Map(),
  clients: new Map(),
  mnemonicSource: null,
  pending: new Map(),
  pendingMultiActions: new Map(),
  activeAccount: null,
  transactionHistory: [],
  eventListeners: new Map(),
  globalEventListeners: new Set(),

  // --- Actions ---

  getAdapters: () => get().adapters,

  registerAdapter: (adapter) => {
    const { adapters } = get();
    const next = new Map(adapters);
    next.set(adapter.type, adapter);
    set({ adapters: next });
  },

  getProtocols: () => get().protocols,

  registerProtocol: (protocol) => {
    const { protocols } = get();
    const next = new Map(protocols);
    next.set(protocol.protocolId, protocol);
    set({ protocols: next });
  },

  getKeyProvider: async (): Promise<KeyProvider> => {
    const activeAccount = await getActiveAccount();
    const accountInfo = await getActiveAccountInfo();

    // 1. Check for environment mnemonic first
    const envMnemonic = process.env.KEPLR_MNEMONIC;
    if (envMnemonic) {
      const config: MnemonicKeyProviderConfig = {
        type: "mnemonic",
        mnemonic: envMnemonic,
      };
      return createKeyProvider(config);
    }

    if (!activeAccount || !accountInfo) {
      throw new Error(
        "No account is currently active. Use create-account or import-account tool.",
      );
    }

    // 2. Create KeyProvider based on account type
    switch (accountInfo.type) {
      case "mnemonic": {
        const mnemonic = await loadMnemonicForAccount(activeAccount);
        if (!mnemonic) {
          throw new Error(
            `Account "${activeAccount}" has no mnemonic stored in keychain.`,
          );
        }
        const config: MnemonicKeyProviderConfig = {
          type: "mnemonic",
          mnemonic,
        };
        return createKeyProvider(config);
      }

      // Future key provider types would be handled here
      case "smart-account":
        throw new Error(
          `Key provider type "${accountInfo.type}" is not yet implemented.`,
        );

      default:
        throw new Error(
          `Unknown account type: ${(accountInfo as { type: string }).type}`,
        );
    }
  },

  getClientFor: async <T extends EcosystemClient>(type: string): Promise<T> => {
    const { clients, adapters, activeAccount } = get();

    const cached = clients.get(type);
    if (cached) return cached as T;

    const adapter = adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for ecosystem "${type}".`);
    }

    // Try new KeyProvider approach first if adapter supports it
    if (adapter.createClientWithProvider) {
      try {
        const provider = await get().getKeyProvider();

        // Check if KeyProvider supports this ecosystem
        // (The adapter's createClientWithProvider will also check, but we can fail fast here)
        const supportedEcosystems = provider.getSupportedEcosystems();
        if (!supportedEcosystems.includes(type as "cosmos")) {
          throw new Error(
            `${provider.displayName} does not support "${type}" ecosystem. ` +
              `Supported ecosystems: ${supportedEcosystems.join(", ")}.`,
          );
        }

        const newClient = await adapter.createClientWithProvider(provider);
        const next = new Map(clients);
        next.set(type, newClient);
        const mnemonicSource: MnemonicSource =
          provider.type === "mnemonic"
            ? process.env.KEPLR_MNEMONIC
              ? "env"
              : "keychain"
            : null;
        set({
          clients: next,
          mnemonicSource,
        });
        // Emit client initialized event
        get().emit(
          createEvent(KeplrEventTypes.CLIENT_INITIALIZED, {
            ecosystem: type,
            source: provider.type,
            account: activeAccount,
          }),
        );
        return newClient as T;
      } catch (error) {
        // If KeyProvider approach fails, fall through to legacy methods
        // This provides backward compatibility during transition
        console.error(
          `[Store] createClientWithProvider failed, falling back to legacy method: ${error}`,
        );
      }
    }

    // Legacy approach: direct mnemonic handling

    // 1. Environment variable
    const envMnemonic = process.env.KEPLR_MNEMONIC;
    if (envMnemonic) {
      const newClient = adapter.createClient(envMnemonic);
      const next = new Map(clients);
      next.set(type, newClient);
      set({ clients: next, mnemonicSource: "env" });
      // Emit client initialized event
      get().emit(
        createEvent(KeplrEventTypes.CLIENT_INITIALIZED, {
          ecosystem: type,
          source: "env",
        }),
      );
      return newClient as T;
    }

    // Get active account info to determine account type
    const accountInfo = await getActiveAccountInfo();

    if (accountInfo?.type === "mnemonic") {
      // 2. Mnemonic-based account via OS Keychain
      const keychainMnemonic = await getActiveMnemonic();
      if (keychainMnemonic) {
        const newClient = adapter.createClient(keychainMnemonic);
        const next = new Map(clients);
        next.set(type, newClient);
        set({ clients: next, mnemonicSource: "keychain" });
        // Emit client initialized event
        get().emit(
          createEvent(KeplrEventTypes.CLIENT_INITIALIZED, {
            ecosystem: type,
            source: "keychain",
            account: activeAccount,
          }),
        );
        return newClient as T;
      }
    }

    // Build helpful error message
    const accountHint = activeAccount
      ? `The active account "${activeAccount}" has no mnemonic stored.`
      : "No account is currently active.";

    throw new Error(
      `No mnemonic configured. ${accountHint} Use the create-account or import-account tool, or set the KEPLR_MNEMONIC environment variable.`,
    );
  },

  resetClients: async () => {
    const { clients } = get();
    const ecosystems = Array.from(clients.keys());
    for (const client of clients.values()) {
      await client.disconnect();
    }
    set({ clients: new Map(), mnemonicSource: null });

    // Emit client disconnected event for each ecosystem
    for (const ecosystem of ecosystems) {
      get().emit(
        createEvent(KeplrEventTypes.CLIENT_DISCONNECTED, {
          ecosystem,
        }),
      );
    }
  },

  storePending: (summary, chain, execute, preValidate, elicitationSummary) => {
    get().cleanupPending();
    const token = randomUUID();
    const { pending } = get();
    const next = new Map(pending);
    next.set(token, {
      summary,
      chain,
      execute,
      preValidate,
      expiresAt: Date.now() + TTL_MS,
      elicitationSummary,
    });
    set({ pending: next });
    return token;
  },

  executePending: async (token, context) => {
    get().cleanupPending();
    const { pending } = get();
    const entry = pending.get(token);
    if (!entry) {
      throw new Error(
        "Invalid or expired confirmation token. The transaction may have already been executed or timed out.",
      );
    }

    // Pre-validation (e.g. authentication) runs before token consumption.
    // Failure here preserves the token so the user can retry.
    if (entry.preValidate) {
      await entry.preValidate(context);
    }

    // Single-use: delete before executing so a retry cannot re-submit.
    const next = new Map(pending);
    next.delete(token);
    set({ pending: next });

    try {
      const result = await entry.execute(context);
      // Emit success event
      get().emit(
        createEvent(KeplrEventTypes.TRANSACTION_CONFIRMED, {
          token,
          chain: entry.chain,
          summary: entry.summary,
          result,
        }),
      );

      // Record successful transaction in history
      const resultObj = result as Record<string, unknown> | undefined;
      get().recordTransaction({
        summary: entry.summary,
        chain: entry.chain,
        txHash:
          (resultObj?.transactionHash as string) ||
          (resultObj?.txHash as string),
        status: "success",
        timestamp: Date.now(),
        result,
      });

      return result;
    } catch (error) {
      // Emit failure event
      get().emit(
        createEvent(KeplrEventTypes.TRANSACTION_FAILED, {
          token,
          chain: entry.chain,
          summary: entry.summary,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      // Record failed transaction in history
      get().recordTransaction({
        summary: entry.summary,
        chain: entry.chain,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });

      throw error;
    }
  },

  storePendingAction: (summary, execute, preValidate) => {
    return get().storePending(summary, "", execute, preValidate);
  },

  cleanupPending: () => {
    const { pending, pendingMultiActions } = get();
    const now = Date.now();
    let changed = false;
    const nextPending = new Map(pending);
    for (const [token, entry] of nextPending) {
      if (entry.expiresAt <= now) {
        nextPending.delete(token);
        changed = true;
      }
    }
    const nextMultiActions = new Map(pendingMultiActions);
    for (const [id, entry] of nextMultiActions) {
      if (entry.expiresAt <= now) {
        nextMultiActions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      set({
        pending: nextPending,
        pendingMultiActions: nextMultiActions,
      });
    }
  },

  startCleanupTimer: () => {
    const timer = setInterval(() => {
      get().cleanupPending();
    }, CLEANUP_INTERVAL_MS);
    timer.unref();
  },

  switchAccount: async (name: string) => {
    const previousAccount = get().activeAccount;
    // setActiveAccount throws if account doesn't exist
    await setActiveAccount(name);
    // Reset clients to force re-initialization with new mnemonic/session
    await get().resetClients();
    set({ activeAccount: name });

    // Emit account switched event
    get().emit(
      createEvent(KeplrEventTypes.ACCOUNT_SWITCHED, {
        previousAccount,
        newAccount: name,
      }),
    );
  },

  initializeActiveAccount: async () => {
    const activeAccount = await getActiveAccount();
    set({ activeAccount });
  },

  on: (eventType, listener) => {
    const { eventListeners } = get();
    const next = new Map(eventListeners);
    const listeners = next.get(eventType) ?? new Set();
    const updatedListeners = new Set(listeners);
    updatedListeners.add(listener);
    next.set(eventType, updatedListeners);
    set({ eventListeners: next });

    // Return unsubscribe function
    return () => {
      get().off(eventType, listener);
    };
  },

  onAny: (listener) => {
    const { globalEventListeners } = get();
    const next = new Set(globalEventListeners);
    next.add(listener);
    set({ globalEventListeners: next });

    // Return unsubscribe function
    return () => {
      const current = get().globalEventListeners;
      const updated = new Set(current);
      updated.delete(listener);
      set({ globalEventListeners: updated });
    };
  },

  off: (eventType, listener) => {
    const { eventListeners } = get();
    const listeners = eventListeners.get(eventType);
    if (!listeners) return;
    const next = new Map(eventListeners);
    const updatedListeners = new Set(listeners);
    updatedListeners.delete(listener);
    if (updatedListeners.size === 0) {
      next.delete(eventType);
    } else {
      next.set(eventType, updatedListeners);
    }
    set({ eventListeners: next });
  },

  emit: (event) => {
    const { eventListeners, globalEventListeners } = get();

    // Notify type-specific listeners
    const listeners = eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(
            `[Store] Error in event listener for ${event.type}:`,
            error,
          );
        }
      }
    }

    // Notify global listeners
    for (const listener of globalEventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[Store] Error in global event listener:", error);
      }
    }
  },

  recordTransaction: (record) => {
    const { transactionHistory } = get();
    const newRecord: TransactionRecord = {
      id: randomUUID(),
      ...record,
    };
    // Keep most recent 100 transactions
    const updated = [newRecord, ...transactionHistory].slice(0, 100);
    set({ transactionHistory: updated });
  },

  getTransactionHistory: (options) => {
    const { transactionHistory } = get();
    let result = transactionHistory;

    // Filter by chain if specified
    if (options?.chain) {
      result = result.filter((tx) => tx.chain === options.chain);
    }

    // Limit results if specified
    if (options?.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  },

  clearTransactionHistory: () => {
    set({ transactionHistory: [] });
  },

  // --- Multi-action methods ---

  createMultiAction: (chain, ecosystem) => {
    get().cleanupMultiActions();
    const id = randomUUID();
    const { pendingMultiActions } = get();
    const next = new Map(pendingMultiActions);
    next.set(id, {
      id,
      chain,
      ecosystem,
      actions: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
      previewed: false,
    });
    set({ pendingMultiActions: next });
    return id;
  },

  addMultiAction: (actionId, action) => {
    const { pendingMultiActions } = get();
    const multiAction = pendingMultiActions.get(actionId);
    if (!multiAction) {
      throw new Error(
        `Multi-action "${actionId}" not found or expired. Create a new one with multi-action-create.`,
      );
    }
    if (multiAction.previewed) {
      throw new Error(
        "Session is locked after preview. Cancel and recreate, or execute as previewed.",
      );
    }
    const next = new Map(pendingMultiActions);
    next.set(actionId, {
      ...multiAction,
      actions: [...multiAction.actions, action],
    });
    set({ pendingMultiActions: next });
  },

  removeMultiAction: (actionId, index) => {
    const { pendingMultiActions } = get();
    const multiAction = pendingMultiActions.get(actionId);
    if (!multiAction) {
      throw new Error(`Multi-action "${actionId}" not found or expired.`);
    }
    if (multiAction.previewed) {
      throw new Error(
        "Session is locked after preview. Cancel and recreate, or execute as previewed.",
      );
    }
    if (index < 0 || index >= multiAction.actions.length) {
      throw new Error(
        `Invalid action index ${index}. Valid range: 0-${multiAction.actions.length - 1}`,
      );
    }
    const next = new Map(pendingMultiActions);
    const updatedActions = [...multiAction.actions];
    updatedActions.splice(index, 1);
    next.set(actionId, {
      ...multiAction,
      actions: updatedActions,
    });
    set({ pendingMultiActions: next });
  },

  getMultiAction: (actionId) => {
    get().cleanupMultiActions();
    return get().pendingMultiActions.get(actionId);
  },

  getAllMultiActions: () => {
    get().cleanupMultiActions();
    return Array.from(get().pendingMultiActions.values());
  },

  clearMultiAction: (actionId) => {
    const { pendingMultiActions } = get();
    const next = new Map(pendingMultiActions);
    next.delete(actionId);
    set({ pendingMultiActions: next });
  },

  cleanupMultiActions: () => {
    const { pendingMultiActions } = get();
    const now = Date.now();
    let changed = false;
    const next = new Map(pendingMultiActions);
    for (const [id, entry] of next) {
      if (entry.expiresAt <= now) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      set({ pendingMultiActions: next });
    }
  },

  markPreviewed: (actionId) => {
    const { pendingMultiActions } = get();
    const multiAction = pendingMultiActions.get(actionId);
    if (!multiAction) {
      throw new Error(`Multi-action "${actionId}" not found or expired.`);
    }
    const next = new Map(pendingMultiActions);
    next.set(actionId, { ...multiAction, previewed: true });
    set({ pendingMultiActions: next });
  },
}));

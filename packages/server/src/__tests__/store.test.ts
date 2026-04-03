import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock accounts module before importing store
vi.mock("../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue(null),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic import to ensure mocks are in place
const { store } = await import("../store.js");

describe("KeplrStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    store.setState({
      adapters: new Map(),
      clients: new Map(),
      mnemonicSource: null,
      pending: new Map(),
      activeAccount: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Pending Transactions", () => {
    it("should store a pending transaction and return token", () => {
      const execute = vi.fn().mockResolvedValue({ txHash: "abc123" });

      const token = store
        .getState()
        .storePending("Send 1 ATOM", "cosmoshub-4", execute);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });

    it("should execute pending transaction and remove it", async () => {
      const result = { txHash: "abc123" };
      const execute = vi.fn().mockResolvedValue(result);

      const token = store
        .getState()
        .storePending("Send 1 ATOM", "cosmoshub-4", execute);
      const executionResult = await store.getState().executePending(token);

      expect(executionResult).toEqual(result);
      expect(execute).toHaveBeenCalledOnce();

      // Token should be consumed
      await expect(store.getState().executePending(token)).rejects.toThrow(
        /Invalid or expired confirmation token/,
      );
    });

    it("should reject invalid token", async () => {
      await expect(
        store.getState().executePending("invalid-token"),
      ).rejects.toThrow(/Invalid or expired confirmation token/);
    });

    it("should store pending action (non-tx)", () => {
      const execute = vi.fn().mockResolvedValue(true);

      const token = store
        .getState()
        .storePendingAction("Delete account", execute);

      expect(token).toBeDefined();
      expect(store.getState().pending.size).toBe(1);
    });

    it("should cleanup expired pending transactions", () => {
      const execute = vi.fn().mockResolvedValue({});

      // Create a pending transaction
      const token = store.getState().storePending("Test", "chain", execute);

      // Manually expire it
      const pending = store.getState().pending;
      const entry = pending.get(token);
      if (entry) {
        const expired = new Map(pending);
        expired.set(token, { ...entry, expiresAt: Date.now() - 1000 });
        store.setState({ pending: expired });
      }

      // Trigger cleanup
      store.getState().cleanupPending();

      expect(store.getState().pending.size).toBe(0);
    });
  });

  describe("Client Management", () => {
    it("should throw when no adapter registered", async () => {
      await expect(store.getState().getClientFor("unknown")).rejects.toThrow(
        /No adapter registered for ecosystem "unknown"/,
      );
    });

    it("should reset clients and clear mnemonic source", async () => {
      const mockClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      store.setState({
        clients: new Map([["test", mockClient as never]]),
        mnemonicSource: "keychain",
      });

      await store.getState().resetClients();

      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(store.getState().clients.size).toBe(0);
      expect(store.getState().mnemonicSource).toBeNull();
    });
  });
});

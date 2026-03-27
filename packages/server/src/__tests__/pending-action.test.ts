import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock accounts module
vi.mock("../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue(null),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth manager so executePending doesn't fail on provider-less auth
const mockAuthManager = {
  isAuthRequired: vi.fn().mockResolvedValue(false),
  authenticate: vi.fn().mockResolvedValue({ success: true }),
};
vi.mock("../auth/manager.js", () => ({
  getAuthManager: vi.fn().mockReturnValue(mockAuthManager),
}));

// Import store first to ensure mocks are applied
const { store } = await import("../store.js");
const { storePending, executePending } = await import("../pending-action.js");

describe("Transaction Confirmation Flow", () => {
  beforeEach(() => {
    // Reset store state
    store.setState({
      pending: new Map(),
    });
    // Reset auth mock to default (no auth required)
    mockAuthManager.isAuthRequired.mockResolvedValue(false);
    mockAuthManager.authenticate.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("storePending", () => {
    it("should store transaction and return confirmation token", () => {
      const execute = vi.fn().mockResolvedValue({ txHash: "0xabc" });

      const token = storePending(
        "Send 100 uatom to cosmos1...",
        "cosmoshub-4",
        execute,
      );

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      // UUID format check
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should store the summary and chain correctly", () => {
      const execute = vi.fn();
      const summary = "Delegate 1000000 uosmo to osmovaloper1...";
      const chain = "osmosis-1";

      const token = storePending(summary, chain, execute);

      const pending = store.getState().pending;
      const entry = pending.get(token);

      expect(entry).toBeDefined();
      expect(entry?.summary).toBe(summary);
      expect(entry?.chain).toBe(chain);
    });

    it("should set expiration time (5 minutes TTL)", () => {
      const execute = vi.fn();
      const beforeStore = Date.now();

      const token = storePending("Test", "chain", execute);

      const afterStore = Date.now();
      const entry = store.getState().pending.get(token);

      expect(entry?.expiresAt).toBeDefined();
      // TTL is 5 minutes = 300000 ms
      const expectedMinExpiry = beforeStore + 5 * 60 * 1000;
      const expectedMaxExpiry = afterStore + 5 * 60 * 1000;

      expect(entry?.expiresAt).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(entry?.expiresAt).toBeLessThanOrEqual(expectedMaxExpiry);
    });
  });

  describe("executePending", () => {
    it("should execute the stored transaction", async () => {
      const result = { txHash: "0xdef456" };
      const execute = vi.fn().mockResolvedValue(result);

      const token = storePending("Send tokens", "chain", execute);
      const executionResult = await executePending(token);

      expect(execute).toHaveBeenCalledOnce();
      expect(executionResult).toEqual(result);
    });

    it("should consume the token (single-use)", async () => {
      const execute = vi.fn().mockResolvedValue({});

      const token = storePending("Send tokens", "chain", execute);

      await executePending(token);

      // Second execution should fail
      await expect(executePending(token)).rejects.toThrow(
        /Invalid or expired confirmation token/,
      );
      expect(execute).toHaveBeenCalledOnce(); // Still only once
    });

    it("should reject invalid tokens", async () => {
      await expect(executePending("not-a-real-token")).rejects.toThrow(
        /Invalid or expired confirmation token/,
      );
    });

    it("should reject expired tokens", async () => {
      const execute = vi.fn().mockResolvedValue({});

      const token = storePending("Test", "chain", execute);

      // Manually expire the token
      const pending = store.getState().pending;
      const entry = pending.get(token);
      if (entry) {
        const expired = new Map(pending);
        expired.set(token, { ...entry, expiresAt: Date.now() - 1 });
        store.setState({ pending: expired });
      }

      await expect(executePending(token)).rejects.toThrow(
        /Invalid or expired confirmation token/,
      );
    });

    it("should propagate errors from execute function", async () => {
      const error = new Error("Insufficient funds");
      const execute = vi.fn().mockRejectedValue(error);

      const token = storePending("Send tokens", "chain", execute);

      await expect(executePending(token)).rejects.toThrow("Insufficient funds");
    });

    it("should delete token before executing (prevents replay)", async () => {
      let tokenDeletedBeforeExecute = false;

      const execute = vi.fn().mockImplementation(() => {
        // Check if token still exists during execution
        const pending = store.getState().pending;
        // Token should already be deleted
        tokenDeletedBeforeExecute = pending.size === 0;
        return Promise.resolve({});
      });

      const token = storePending("Test", "chain", execute);
      await executePending(token);

      expect(tokenDeletedBeforeExecute).toBe(true);
    });
  });

  describe("Concurrent Access", () => {
    it("should handle multiple pending transactions", () => {
      const tokens: string[] = [];

      for (let i = 0; i < 5; i++) {
        const token = storePending(`Transaction ${i}`, `chain-${i}`, vi.fn());
        tokens.push(token);
      }

      expect(new Set(tokens).size).toBe(5); // All unique
      expect(store.getState().pending.size).toBe(5);
    });

    it("should execute transactions independently", async () => {
      const execute1 = vi.fn().mockResolvedValue({ id: 1 });
      const execute2 = vi.fn().mockResolvedValue({ id: 2 });

      const token1 = storePending("Tx 1", "chain", execute1);
      const token2 = storePending("Tx 2", "chain", execute2);

      const result2 = await executePending(token2);
      const result1 = await executePending(token1);

      expect(result1).toEqual({ id: 1 });
      expect(result2).toEqual({ id: 2 });
    });
  });

  describe("Authentication", () => {
    beforeEach(() => {
      mockAuthManager.isAuthRequired.mockResolvedValue(false);
      mockAuthManager.authenticate.mockResolvedValue({ success: true });
    });

    it("should skip auth when isAuthRequired is false", async () => {
      mockAuthManager.isAuthRequired.mockResolvedValue(false);
      const execute = vi.fn().mockResolvedValue({ txHash: "0x1" });
      const token = storePending("Send tokens", "cosmoshub-4", execute);

      await executePending(token);

      expect(mockAuthManager.authenticate).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
    });

    it("should execute without auth (auth handled at tool layer)", async () => {
      const execute = vi.fn().mockResolvedValue({ txHash: "0x3" });
      const token = storePending("Send tokens", "cosmoshub-4", execute);

      await executePending(token);

      expect(mockAuthManager.authenticate).not.toHaveBeenCalled();
      expect(execute).toHaveBeenCalledOnce();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty summary", () => {
      const token = storePending("", "chain", vi.fn());
      const entry = store.getState().pending.get(token);

      expect(entry?.summary).toBe("");
    });

    it("should handle empty chain (for non-tx actions)", () => {
      const token = storePending("Delete account", "", vi.fn());
      const entry = store.getState().pending.get(token);

      expect(entry?.chain).toBe("");
    });

    it("should handle execute returning undefined", async () => {
      const execute = vi.fn().mockResolvedValue(undefined);

      const token = storePending("Test", "chain", execute);
      const result = await executePending(token);

      expect(result).toBeUndefined();
    });
  });

  describe("action binding", () => {
    it("should store pending action via storePendingAction", () => {
      const execute = vi.fn().mockResolvedValue({});
      const token = store
        .getState()
        .storePendingAction("Delete account", execute);
      const entry = store.getState().pending.get(token);
      expect(entry?.summary).toBe("Delete account");
      expect(entry?.chain).toBe("");
    });
  });

  describe("auth failure and token consumption", () => {
    it("bug: auth failure inside execute consumes token — user cannot retry", async () => {
      // Simulates the non-elicitation flow: authenticate() is called inside
      // the execute callback. If auth fails, the token is already consumed.
      let callCount = 0;
      const token = store
        .getState()
        .storePendingAction("DELETE ACCOUNT", async (context) => {
          callCount++;
          // Simulate auth failure on first attempt
          if (callCount === 1) {
            throw new Error("Authentication required: invalid TOTP code");
          }
          return { deleted: true };
        });

      // 1st attempt: wrong TOTP → auth fails inside execute
      await expect(
        executePending(token, { totpCode: "000000" }),
      ).rejects.toThrow("Authentication required");

      // 2nd attempt: same token → already consumed, cannot retry
      // This demonstrates the bug: token is gone even though
      // the destructive action never ran.
      await expect(
        executePending(token, { totpCode: "123456" }),
      ).rejects.toThrow(/Invalid or expired/);

      expect(callCount).toBe(1);
    });

    it("desired: preValidate failure should preserve token for retry", async () => {
      let validateAttempt = 0;
      const token = storePending("DELETE ACCOUNT", "", async () => ({
        deleted: true,
      }));

      // Manually attach preValidate to simulate desired behavior
      const pending = store.getState().pending;
      const entry = pending.get(token);
      if (entry) {
        const updated = new Map(pending);
        updated.set(token, {
          ...entry,
          preValidate: async (context) => {
            validateAttempt++;
            if (validateAttempt === 1) {
              throw new Error("Authentication required: invalid TOTP code");
            }
          },
        });
        store.setState({ pending: updated });
      }

      // 1st attempt: preValidate fails → token should be preserved
      await expect(
        executePending(token, { totpCode: "000000" }),
      ).rejects.toThrow("Authentication required");

      // 2nd attempt: same token → should succeed
      const result = await executePending(token, { totpCode: "123456" });
      expect(result).toEqual({ deleted: true });
      expect(validateAttempt).toBe(2);
    });

    it("desired: preValidate success + execute failure still consumes token", async () => {
      const token = storePending("SEND", "cosmoshub-4", async () => {
        throw new Error("broadcast failed");
      });

      // Attach preValidate that always succeeds
      const pending = store.getState().pending;
      const entry = pending.get(token);
      if (entry) {
        const updated = new Map(pending);
        updated.set(token, {
          ...entry,
          preValidate: async () => {},
        });
        store.setState({ pending: updated });
      }

      await expect(executePending(token)).rejects.toThrow("broadcast failed");
      // Token consumed — no retry
      await expect(executePending(token)).rejects.toThrow(/Invalid or expired/);
    });
  });
});

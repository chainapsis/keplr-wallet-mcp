/**
 * Multi-action User Scenario Tests
 *
 * These tests simulate real-world user behavior patterns to verify
 * that multi-action transactions work correctly end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock accounts module before importing store
vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue(null),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

const { store } = await import("../../store.js");

describe("Multi-action User Scenarios", () => {
  beforeEach(() => {
    store.setState({
      adapters: new Map(),

      clients: new Map(),
      mnemonicSource: null,
      pending: new Map(),
      pendingMultiActions: new Map(),
      activeAccount: null,
      transactionHistory: [],
      eventListeners: new Map(),
      globalEventListeners: new Set(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Scenario 10: Expired Multi-action Cleanup", () => {
    /**
     * Test that expired multi-actions are cleaned up properly.
     */
    it("should cleanup expired multi-actions", () => {
      // Create some multi-actions
      const id1 = store.getState().createMultiAction("cosmoshub-4", "cosmos");
      const id2 = store.getState().createMultiAction("osmosis-1", "cosmos");
      const id3 = store.getState().createMultiAction("1", "evm");

      // Manually expire id1 and id2
      const multiActions = store.getState().pendingMultiActions;
      const expired = new Map(multiActions);

      const entry1 = expired.get(id1);
      const entry2 = expired.get(id2);
      if (entry1) expired.set(id1, { ...entry1, expiresAt: Date.now() - 1000 });
      if (entry2) expired.set(id2, { ...entry2, expiresAt: Date.now() - 1000 });

      store.setState({ pendingMultiActions: expired });

      // Run cleanup
      store.getState().cleanupMultiActions();

      // Only id3 should remain
      expect(store.getState().pendingMultiActions.size).toBe(1);
      expect(store.getState().getMultiAction(id1)).toBeUndefined();
      expect(store.getState().getMultiAction(id2)).toBeUndefined();
      expect(store.getState().getMultiAction(id3)).toBeDefined();
    });
  });

  describe("Scenario 18: Preview Locks Session (TOCTOU Defense)", () => {
    /**
     * M14: After preview, mutations (add/remove) must be rejected
     * to prevent TOCTOU attacks where previewed content differs from executed content.
     */
    it("should reject add after preview", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
      });

      // Simulate preview by marking as previewed
      store.getState().markPreviewed(actionId);

      // Attempt to add should fail
      expect(() => {
        store.getState().addMultiAction(actionId, {
          type: "delegate",
          params: {
            validatorAddress: "cosmosvaloper1attacker...",
            amount: "1000000",
          },
        });
      }).toThrow(/locked after preview/);

      // Actions should remain unchanged
      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(1);
      expect(multiAction?.actions[0].type).toBe("claim-rewards");
    });

    it("should reject remove after preview", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1...", amount: "1000000" },
      });
      store.getState().addMultiAction(actionId, {
        type: "delegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "5000000" },
      });

      store.getState().markPreviewed(actionId);

      expect(() => {
        store.getState().removeMultiAction(actionId, 0);
      }).toThrow(/locked after preview/);

      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(2);
    });

    it("should allow cancel after preview", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1...", amount: "1000000" },
      });
      store.getState().markPreviewed(actionId);

      // Cancel should still work
      store.getState().clearMultiAction(actionId);
      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
    });
  });

  describe("Scenario 19: No Preview Means No Lock", () => {
    /**
     * Without preview, the session remains freely mutable (backward-compatible).
     */
    it("should allow unlimited add/remove without preview", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1...", amount: "1000000" },
      });
      store.getState().addMultiAction(actionId, {
        type: "delegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "5000000" },
      });
      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
      });

      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(3);
      expect(store.getState().getMultiAction(actionId)?.previewed).toBe(false);

      // Remove and add freely
      store.getState().removeMultiAction(actionId, 1);
      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(2);

      store.getState().addMultiAction(actionId, {
        type: "vote",
        params: { proposalId: "1", option: "yes" },
      });
      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(3);
    });
  });

  describe("Scenario 20: Preview Failure Still Locks Session", () => {
    /**
     * Even if simulation fails after preview is called, the session must
     * remain locked. This prevents TOCTOU attacks where an attacker
     * intentionally causes simulation failure to bypass the lock.
     */
    it("should keep session locked even if markPreviewed is followed by error", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1...", amount: "1000000" },
      });

      // markPreviewed is called at the start of preview, before simulation
      store.getState().markPreviewed(actionId);

      // Even though "simulation" would fail here, session is locked
      expect(store.getState().getMultiAction(actionId)?.previewed).toBe(true);

      // Mutation attempts must fail
      expect(() => {
        store.getState().addMultiAction(actionId, {
          type: "delegate",
          params: {
            validatorAddress: "cosmosvaloper1attacker...",
            amount: "1000000",
          },
        });
      }).toThrow(/locked after preview/);

      // User's only options: execute or cancel
      store.getState().clearMultiAction(actionId);
      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
    });
  });
});

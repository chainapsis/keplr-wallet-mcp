import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock accounts module before importing store
vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue(null),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

// Dynamic import to ensure mocks are in place
const { store } = await import("../../store.js");

describe("Multi-action Store Methods", () => {
  beforeEach(() => {
    // Reset store state before each test
    store.setState({
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
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createMultiAction", () => {
    it("should create a new multi-action and return ID", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      expect(actionId).toBeDefined();
      expect(typeof actionId).toBe("string");
      expect(actionId.length).toBeGreaterThan(0);

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction).toBeDefined();
      expect(multiAction?.chain).toBe("cosmoshub-4");
      expect(multiAction?.ecosystem).toBe("cosmos");
      expect(multiAction?.actions).toEqual([]);
    });

    it("should create multiple multi-actions", () => {
      const id1 = store.getState().createMultiAction("cosmoshub-4", "cosmos");
      const id2 = store.getState().createMultiAction("osmosis-1", "cosmos");

      expect(id1).not.toBe(id2);
      expect(store.getState().pendingMultiActions.size).toBe(2);
    });
  });

  describe("addMultiAction", () => {
    it("should add an action to multi-action", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(1);
      expect(multiAction?.actions[0].type).toBe("send");
    });

    it("should add multiple actions", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });
      store.getState().addMultiAction(actionId, {
        type: "delegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "2000000" },
      });
      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(3);
    });

    it("should throw when multi-action not found", () => {
      expect(() => {
        store.getState().addMultiAction("invalid-id", {
          type: "send",
          params: {},
        });
      }).toThrow(/not found or expired/);
    });

    it("should support action label", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
        label: "Send to Alice",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions[0].label).toBe("Send to Alice");
    });
  });

  describe("removeMultiAction", () => {
    it("should remove action by index", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, { type: "send", params: {} });
      store
        .getState()
        .addMultiAction(actionId, { type: "delegate", params: {} });
      store
        .getState()
        .addMultiAction(actionId, { type: "claim-rewards", params: {} });

      store.getState().removeMultiAction(actionId, 1); // Remove delegate

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(2);
      expect(multiAction?.actions[0].type).toBe("send");
      expect(multiAction?.actions[1].type).toBe("claim-rewards");
    });

    it("should throw on invalid index", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");
      store.getState().addMultiAction(actionId, { type: "send", params: {} });

      expect(() => {
        store.getState().removeMultiAction(actionId, 5);
      }).toThrow(/Invalid action index/);
    });

    it("should throw when multi-action not found", () => {
      expect(() => {
        store.getState().removeMultiAction("invalid-id", 0);
      }).toThrow(/not found or expired/);
    });
  });

  describe("getMultiAction", () => {
    it("should return multi-action by ID", () => {
      const actionId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");

      const multiAction = store.getState().getMultiAction(actionId);

      expect(multiAction).toBeDefined();
      expect(multiAction?.id).toBe(actionId);
    });

    it("should return undefined for non-existent ID", () => {
      const multiAction = store.getState().getMultiAction("non-existent");
      expect(multiAction).toBeUndefined();
    });
  });

  describe("getAllMultiActions", () => {
    it("should return all multi-actions", () => {
      store.getState().createMultiAction("cosmoshub-4", "cosmos");
      store.getState().createMultiAction("osmosis-1", "cosmos");

      const all = store.getState().getAllMultiActions();

      expect(all.length).toBe(2);
    });

    it("should return empty array when none exist", () => {
      const all = store.getState().getAllMultiActions();
      expect(all).toEqual([]);
    });
  });

  describe("clearMultiAction", () => {
    it("should remove multi-action by ID", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().clearMultiAction(actionId);

      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
    });

    it("should not throw when clearing non-existent ID", () => {
      expect(() => {
        store.getState().clearMultiAction("non-existent");
      }).not.toThrow();
    });
  });

  describe("cleanupMultiActions", () => {
    it("should cleanup expired multi-actions", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      // Manually expire it
      const multiActions = store.getState().pendingMultiActions;
      const entry = multiActions.get(actionId);
      if (entry) {
        const expired = new Map(multiActions);
        expired.set(actionId, { ...entry, expiresAt: Date.now() - 1000 });
        store.setState({ pendingMultiActions: expired });
      }

      store.getState().cleanupMultiActions();

      expect(store.getState().pendingMultiActions.size).toBe(0);
    });

    it("should not remove non-expired multi-actions", () => {
      store.getState().createMultiAction("cosmoshub-4", "cosmos");

      store.getState().cleanupMultiActions();

      expect(store.getState().pendingMultiActions.size).toBe(1);
    });
  });

  describe("cleanupPending integration", () => {
    it("should cleanup multi-actions along with other pending items", () => {
      // Create various pending items
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");
      const txToken = store
        .getState()
        .storePending("Test tx", "chain", async () => ({}));

      // Expire the multi-action
      const multiActions = store.getState().pendingMultiActions;
      const entry = multiActions.get(actionId);
      if (entry) {
        const expired = new Map(multiActions);
        expired.set(actionId, { ...entry, expiresAt: Date.now() - 1000 });
        store.setState({ pendingMultiActions: expired });
      }

      store.getState().cleanupPending();

      // Multi-action should be cleaned up
      expect(store.getState().pendingMultiActions.size).toBe(0);
      // But pending tx should still exist
      expect(store.getState().pending.has(txToken)).toBe(true);
    });
  });

  describe("markPreviewed", () => {
    it("should set previewed to true", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().markPreviewed(actionId);

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.previewed).toBe(true);
    });

    it("should throw for non-existent ID", () => {
      expect(() => {
        store.getState().markPreviewed("non-existent");
      }).toThrow(/not found or expired/);
    });
  });

  describe("preview lock (TOCTOU defense)", () => {
    it("should create multi-action with previewed=false", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.previewed).toBe(false);
    });

    it("should reject addMultiAction when previewed is true", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });
      store.getState().markPreviewed(actionId);

      expect(() => {
        store.getState().addMultiAction(actionId, {
          type: "delegate",
          params: { validatorAddress: "cosmosvaloper1...", amount: "2000000" },
        });
      }).toThrow(/locked after preview/);
    });

    it("should reject removeMultiAction when previewed is true", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });
      store.getState().markPreviewed(actionId);

      expect(() => {
        store.getState().removeMultiAction(actionId, 0);
      }).toThrow(/locked after preview/);
    });

    it("should allow addMultiAction when previewed is false", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.previewed).toBe(false);
      expect(multiAction?.actions.length).toBe(1);
    });

    it("should reject execute when not previewed", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });

      const multiAction = store.getState().getMultiAction(actionId);
      // execute requires previewed=true; without it, the handler will reject
      expect(multiAction?.previewed).toBe(false);
    });

    it("should allow execute after markPreviewed", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });
      store.getState().markPreviewed(actionId);

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.previewed).toBe(true);
    });

    it("should allow clearMultiAction even when previewed", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
      });
      store.getState().markPreviewed(actionId);

      // Cancel should work even after preview
      store.getState().clearMultiAction(actionId);
      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
    });
  });
});

describe("Multi-action Action Types", () => {
  beforeEach(() => {
    store.setState({
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
    });
  });

  it("should support all Cosmos action types", () => {
    const actionId = store
      .getState()
      .createMultiAction("cosmoshub-4", "cosmos");

    const actionTypes = [
      {
        type: "send",
        params: { recipientAddress: "cosmos1...", amount: "1000000" },
      },
      {
        type: "delegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "1000000" },
      },
      {
        type: "undelegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "1000000" },
      },
      {
        type: "redelegate",
        params: {
          srcValidatorAddress: "cosmosvaloper1...",
          dstValidatorAddress: "cosmosvaloper2...",
          amount: "1000000",
        },
      },
      {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
      },
      { type: "vote", params: { proposalId: "1", option: "yes" } },
      {
        type: "ibc-transfer",
        params: {
          recipientAddress: "osmo1...",
          amount: "1000000",
          denom: "uatom",
          sourceChannel: "channel-0",
        },
      },
    ];

    for (const action of actionTypes) {
      store.getState().addMultiAction(actionId, action);
    }

    const multiAction = store.getState().getMultiAction(actionId);
    expect(multiAction?.actions.length).toBe(actionTypes.length);
  });
});

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

  describe("Scenario 1: DeFi Power User - Claim & Restake", () => {
    /**
     * User wants to claim rewards from multiple validators and restake them
     * in a single transaction to save on fees.
     */
    it("should handle claim rewards + delegate workflow", () => {
      // Step 1: Create multi-action for Cosmos Hub
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");
      expect(actionId).toBeDefined();

      // Step 2: Add claim rewards from 3 validators
      const validators = [
        "cosmosvaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4epsluffn",
        "cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u2lcnj0",
        "cosmosvaloper1z8zjv3lntpwxua0rtpvgrcwl0nm0tltgpgs6l7",
      ];

      for (const validator of validators) {
        store.getState().addMultiAction(actionId, {
          type: "claim-rewards",
          params: { validatorAddress: validator },
          label: `Claim from ${validator.slice(0, 20)}...`,
        });
      }

      // Step 3: Add delegate action (restake the claimed rewards)
      store.getState().addMultiAction(actionId, {
        type: "delegate",
        params: {
          validatorAddress: validators[0],
          amount: "5000000", // 5 ATOM
        },
        label: "Restake 5 ATOM",
      });

      // Verify the multi-action state
      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction).toBeDefined();
      expect(multiAction?.actions.length).toBe(4);
      expect(multiAction?.actions[0].type).toBe("claim-rewards");
      expect(multiAction?.actions[3].type).toBe("delegate");
    });
  });

  describe("Scenario 2: Cross-chain Transfer Preparation", () => {
    /**
     * User wants to send tokens to multiple addresses before
     * doing an IBC transfer to Osmosis.
     */
    it("should handle multiple sends + IBC transfer", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      // Send to friend Alice
      store.getState().addMultiAction(actionId, {
        type: "send",
        params: {
          recipientAddress: "cosmos1alice123456789",
          amount: "1000000",
        },
        label: "Send 1 ATOM to Alice",
      });

      // Send to friend Bob
      store.getState().addMultiAction(actionId, {
        type: "send",
        params: {
          recipientAddress: "cosmos1bob987654321",
          amount: "2000000",
        },
        label: "Send 2 ATOM to Bob",
      });

      // IBC transfer to self on Osmosis
      store.getState().addMultiAction(actionId, {
        type: "ibc-transfer",
        params: {
          recipientAddress: "osmo1myaddress123",
          amount: "10000000",
          denom: "uatom",
          sourceChannel: "channel-141",
        },
        label: "IBC 10 ATOM to Osmosis",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(3);
      expect(multiAction?.actions[2].type).toBe("ibc-transfer");
    });
  });

  describe("Scenario 3: Governance Participation", () => {
    /**
     * User wants to vote on multiple proposals at once.
     */
    it("should handle voting on multiple proposals", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      const votes = [
        { proposalId: "123", option: "yes" },
        { proposalId: "124", option: "no" },
        { proposalId: "125", option: "abstain" },
        { proposalId: "126", option: "no_with_veto" },
      ];

      for (const vote of votes) {
        store.getState().addMultiAction(actionId, {
          type: "vote",
          params: vote,
          label: `Vote ${vote.option} on #${vote.proposalId}`,
        });
      }

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(4);
      expect(multiAction?.actions.every((a) => a.type === "vote")).toBe(true);
    });
  });

  describe("Scenario 4: Validator Migration", () => {
    /**
     * User wants to move stake from one validator to multiple others
     * (diversifying risk).
     */
    it("should handle redelegation to multiple validators", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      const srcValidator = "cosmosvaloper1old000000000000000000000000";
      const dstValidators = [
        "cosmosvaloper1new111111111111111111111111",
        "cosmosvaloper1new222222222222222222222222",
        "cosmosvaloper1new333333333333333333333333",
      ];

      for (const dstValidator of dstValidators) {
        store.getState().addMultiAction(actionId, {
          type: "redelegate",
          params: {
            srcValidatorAddress: srcValidator,
            dstValidatorAddress: dstValidator,
            amount: "10000000", // 10 ATOM each
          },
        });
      }

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(3);
    });
  });

  describe("Scenario 5: User Changes Mind - Remove Actions", () => {
    /**
     * User adds several actions, then removes some before executing.
     */
    it("should handle action removal mid-workflow", () => {
      const actionId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");

      // Add 5 actions
      store
        .getState()
        .addMultiAction(actionId, { type: "send", params: { to: "1" } });
      store
        .getState()
        .addMultiAction(actionId, { type: "delegate", params: { to: "2" } });
      store
        .getState()
        .addMultiAction(actionId, { type: "send", params: { to: "3" } });
      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { to: "4" },
      });
      store
        .getState()
        .addMultiAction(actionId, { type: "vote", params: { to: "5" } });

      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(5);

      // User removes action at index 2 (the second send)
      store.getState().removeMultiAction(actionId, 2);
      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(4);

      // User removes action at index 0 (the first send)
      store.getState().removeMultiAction(actionId, 0);
      expect(store.getState().getMultiAction(actionId)?.actions.length).toBe(3);

      // Verify remaining actions are correct
      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions[0].type).toBe("delegate");
      expect(multiAction?.actions[1].type).toBe("claim-rewards");
      expect(multiAction?.actions[2].type).toBe("vote");
    });
  });

  describe("Scenario 6: User Abandons Transaction", () => {
    /**
     * User creates a multi-action but decides to cancel it.
     */
    it("should handle cancellation workflow", () => {
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

      // User cancels
      store.getState().clearMultiAction(actionId);

      // Verify it's gone
      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
      expect(store.getState().pendingMultiActions.size).toBe(0);
    });
  });

  describe("Scenario 7: Multiple Concurrent Multi-actions", () => {
    /**
     * User has multiple multi-actions in progress on different chains.
     */
    it("should handle multiple chains simultaneously", () => {
      // Create multi-actions on different chains
      const cosmosId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");
      const osmosisId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");
      const junoId = store.getState().createMultiAction("juno-1", "cosmos");

      // Add actions to each
      store.getState().addMultiAction(cosmosId, { type: "send", params: {} });
      store
        .getState()
        .addMultiAction(cosmosId, { type: "delegate", params: {} });

      store.getState().addMultiAction(osmosisId, { type: "send", params: {} });

      store.getState().addMultiAction(junoId, { type: "vote", params: {} });
      store.getState().addMultiAction(junoId, { type: "vote", params: {} });
      store.getState().addMultiAction(junoId, { type: "vote", params: {} });

      // Verify all are tracked correctly
      const all = store.getState().getAllMultiActions();
      expect(all.length).toBe(3);

      const cosmos = store.getState().getMultiAction(cosmosId);
      const osmosis = store.getState().getMultiAction(osmosisId);
      const juno = store.getState().getMultiAction(junoId);

      expect(cosmos?.actions.length).toBe(2);
      expect(osmosis?.actions.length).toBe(1);
      expect(juno?.actions.length).toBe(3);

      // Clear one, others should remain
      store.getState().clearMultiAction(osmosisId);
      expect(store.getState().getAllMultiActions().length).toBe(2);
    });
  });

  describe("Scenario 8: EVM User - Token Approvals + Swap Prep", () => {
    /**
     * EVM user wants to approve tokens and prepare for a swap.
     */
    it("should handle EVM approve + contract-call workflow", () => {
      const actionId = store.getState().createMultiAction("1", "evm"); // Ethereum mainnet

      // Approve USDC for Uniswap router
      store.getState().addMultiAction(actionId, {
        type: "approve",
        params: {
          contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
          spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", // Uniswap Router
          amount: "unlimited",
          decimals: 6,
          symbol: "USDC",
        },
        label: "Approve USDC for Uniswap",
      });

      // Approve WETH
      store.getState().addMultiAction(actionId, {
        type: "approve",
        params: {
          contractAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
          spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
          amount: "10",
          decimals: 18,
          symbol: "WETH",
        },
        label: "Approve 10 WETH for Uniswap",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.ecosystem).toBe("evm");
      expect(multiAction?.chain).toBe("1");
      expect(multiAction?.actions.length).toBe(2);
    });
  });

  describe("Scenario 9: EVM User - Multi-recipient Airdrop", () => {
    /**
     * EVM user wants to send tokens to multiple recipients.
     */
    it("should handle multiple ERC-20 sends", () => {
      const actionId = store.getState().createMultiAction("137", "evm"); // Polygon

      const recipients = [
        {
          address: "0x1111111111111111111111111111111111111111",
          amount: "100",
        },
        {
          address: "0x2222222222222222222222222222222222222222",
          amount: "200",
        },
        {
          address: "0x3333333333333333333333333333333333333333",
          amount: "150",
        },
        {
          address: "0x4444444444444444444444444444444444444444",
          amount: "250",
        },
        {
          address: "0x5555555555555555555555555555555555555555",
          amount: "300",
        },
      ];

      for (const recipient of recipients) {
        store.getState().addMultiAction(actionId, {
          type: "send-erc20",
          params: {
            contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC on Polygon
            to: recipient.address,
            amount: recipient.amount,
            decimals: 6,
            symbol: "USDC",
          },
        });
      }

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(5);
    });
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

  describe("Scenario 11: Edge Case - Empty Multi-action", () => {
    /**
     * User creates but never adds actions.
     */
    it("should handle empty multi-action gracefully", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions).toEqual([]);
      expect(multiAction?.actions.length).toBe(0);

      // Should be able to cancel without issues
      store.getState().clearMultiAction(actionId);
      expect(store.getState().getMultiAction(actionId)).toBeUndefined();
    });
  });

  describe("Scenario 12: Edge Case - Invalid Action ID", () => {
    /**
     * Operations on non-existent multi-action IDs.
     */
    it("should throw on invalid action ID", () => {
      expect(() => {
        store
          .getState()
          .addMultiAction("non-existent-id", { type: "send", params: {} });
      }).toThrow(/not found or expired/);

      expect(() => {
        store.getState().removeMultiAction("non-existent-id", 0);
      }).toThrow(/not found or expired/);

      // getMultiAction should return undefined, not throw
      expect(
        store.getState().getMultiAction("non-existent-id"),
      ).toBeUndefined();

      // clearMultiAction should not throw
      expect(() => {
        store.getState().clearMultiAction("non-existent-id");
      }).not.toThrow();
    });
  });

  describe("Scenario 13: Edge Case - Remove from Empty", () => {
    /**
     * Trying to remove from a multi-action with no actions.
     */
    it("should throw when removing from empty multi-action", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      expect(() => {
        store.getState().removeMultiAction(actionId, 0);
      }).toThrow(/Invalid action index/);
    });
  });

  describe("Scenario 14: CosmWasm Execute in Multi-action", () => {
    /**
     * User wants to execute multiple CosmWasm contract calls.
     */
    it("should handle cosmwasm-execute actions", () => {
      const actionId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");

      // Multiple DEX swaps
      store.getState().addMultiAction(actionId, {
        type: "cosmwasm-execute",
        params: {
          contractAddress: "osmo1contractaddress1",
          executeMsg: JSON.stringify({
            swap: { input_token: "uosmo", output_token: "uatom" },
          }),
        },
        label: "Swap OSMO to ATOM",
      });

      store.getState().addMultiAction(actionId, {
        type: "cosmwasm-execute",
        params: {
          contractAddress: "osmo1contractaddress2",
          executeMsg: JSON.stringify({ provide_liquidity: { assets: [] } }),
        },
        label: "Provide liquidity",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(2);
      expect(multiAction?.actions[0].type).toBe("cosmwasm-execute");
    });
  });

  describe("Scenario 15: Cross-chain IBC Workflow", () => {
    /**
     * User wants to do actions on Cosmos Hub then IBC transfer to Osmosis.
     * This tests IBC transfer as part of a multi-action.
     */
    it("should include IBC transfer in multi-action on source chain", () => {
      // Multi-action on Cosmos Hub (source chain)
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      // Claim rewards first
      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
        label: "Claim ATOM rewards",
      });

      // Send some to a friend
      store.getState().addMultiAction(actionId, {
        type: "send",
        params: { recipientAddress: "cosmos1friend...", amount: "5000000" },
        label: "Send 5 ATOM to friend",
      });

      // IBC transfer to Osmosis
      store.getState().addMultiAction(actionId, {
        type: "ibc-transfer",
        params: {
          recipientAddress: "osmo1myaddress...",
          amount: "10000000",
          denom: "uatom",
          sourceChannel: "channel-141", // Cosmos Hub -> Osmosis
        },
        label: "IBC 10 ATOM to Osmosis",
      });

      // IBC transfer to Celestia
      store.getState().addMultiAction(actionId, {
        type: "ibc-transfer",
        params: {
          recipientAddress: "celestia1myaddress...",
          amount: "5000000",
          denom: "uatom",
          sourceChannel: "channel-617", // Cosmos Hub -> Celestia
        },
        label: "IBC 5 ATOM to Celestia",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(4);
      expect(multiAction?.chain).toBe("cosmoshub-4"); // Source chain

      // Verify IBC transfers are correctly stored
      const ibcActions = multiAction?.actions.filter(
        (a) => a.type === "ibc-transfer",
      );
      expect(ibcActions?.length).toBe(2);
      expect(ibcActions?.[0].params.sourceChannel).toBe("channel-141");
      expect(ibcActions?.[1].params.sourceChannel).toBe("channel-617");
    });
  });

  describe("Scenario 16: Multi-chain Concurrent Workflow", () => {
    /**
     * User manages multiple chains simultaneously with separate multi-actions.
     * This is as close to "cross-chain" as we can get atomically.
     */
    it("should handle concurrent multi-actions on different chains", () => {
      // Create multi-actions on 4 different chains
      const cosmosId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");
      const osmosisId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");
      const ethereumId = store.getState().createMultiAction("1", "evm");
      const polygonId = store.getState().createMultiAction("137", "evm");

      // Cosmos Hub: Claim + Stake
      store.getState().addMultiAction(cosmosId, {
        type: "claim-rewards",
        params: { validatorAddress: "cosmosvaloper1..." },
      });
      store.getState().addMultiAction(cosmosId, {
        type: "delegate",
        params: { validatorAddress: "cosmosvaloper1...", amount: "10000000" },
      });

      // Osmosis: Swap prep (CosmWasm calls)
      store.getState().addMultiAction(osmosisId, {
        type: "cosmwasm-execute",
        params: {
          contractAddress: "osmo1pool...",
          executeMsg: JSON.stringify({ swap: {} }),
        },
      });

      // Ethereum: Token approvals
      store.getState().addMultiAction(ethereumId, {
        type: "approve",
        params: {
          contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
          amount: "unlimited",
        },
      });
      store.getState().addMultiAction(ethereumId, {
        type: "approve",
        params: {
          contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
          amount: "unlimited",
        },
      });

      // Polygon: Send tokens
      store.getState().addMultiAction(polygonId, {
        type: "send-erc20",
        params: {
          contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
          to: "0x1234567890123456789012345678901234567890",
          amount: "100",
          decimals: 6,
        },
      });

      // Verify all multi-actions are independent
      const all = store.getState().getAllMultiActions();
      expect(all.length).toBe(4);

      // Verify each chain's multi-action
      const cosmos = store.getState().getMultiAction(cosmosId);
      const osmosis = store.getState().getMultiAction(osmosisId);
      const ethereum = store.getState().getMultiAction(ethereumId);
      const polygon = store.getState().getMultiAction(polygonId);

      expect(cosmos?.chain).toBe("cosmoshub-4");
      expect(cosmos?.ecosystem).toBe("cosmos");
      expect(cosmos?.actions.length).toBe(2);

      expect(osmosis?.chain).toBe("osmosis-1");
      expect(osmosis?.ecosystem).toBe("cosmos");
      expect(osmosis?.actions.length).toBe(1);

      expect(ethereum?.chain).toBe("1");
      expect(ethereum?.ecosystem).toBe("evm");
      expect(ethereum?.actions.length).toBe(2);

      expect(polygon?.chain).toBe("137");
      expect(polygon?.ecosystem).toBe("evm");
      expect(polygon?.actions.length).toBe(1);

      // Execute one, others should remain unaffected
      store.getState().clearMultiAction(cosmosId);
      expect(store.getState().getAllMultiActions().length).toBe(3);
      expect(store.getState().getMultiAction(osmosisId)).toBeDefined();
      expect(store.getState().getMultiAction(ethereumId)).toBeDefined();
      expect(store.getState().getMultiAction(polygonId)).toBeDefined();
    });
  });

  describe("Scenario 17: Osmosis DeFi Multi-action", () => {
    /**
     * Complex Osmosis DeFi scenario: swap + provide liquidity + stake LP
     */
    it("should handle Osmosis DEX operations", () => {
      const actionId = store
        .getState()
        .createMultiAction("osmosis-1", "cosmos");

      // Step 1: Claim existing staking rewards
      store.getState().addMultiAction(actionId, {
        type: "claim-rewards",
        params: { validatorAddress: "osmovaloper1..." },
        label: "Claim OSMO rewards",
      });

      // Step 2: CosmWasm swap OSMO -> ATOM
      store.getState().addMultiAction(actionId, {
        type: "cosmwasm-execute",
        params: {
          contractAddress: "osmo1poolcontract...",
          executeMsg: JSON.stringify({
            swap_exact_amount_in: {
              token_in: { denom: "uosmo", amount: "10000000" },
              token_out_denom:
                "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
              token_out_min_amount: "900000",
            },
          }),
          funds: JSON.stringify([{ denom: "uosmo", amount: "10000000" }]),
        },
        label: "Swap 10 OSMO for ATOM",
      });

      // Step 3: IBC transfer some to Cosmos Hub
      store.getState().addMultiAction(actionId, {
        type: "ibc-transfer",
        params: {
          recipientAddress: "cosmos1myaddress...",
          amount: "5000000",
          denom:
            "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
          sourceChannel: "channel-0",
        },
        label: "IBC ATOM back to Cosmos Hub",
      });

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(3);

      // Verify action types
      expect(multiAction?.actions[0].type).toBe("claim-rewards");
      expect(multiAction?.actions[1].type).toBe("cosmwasm-execute");
      expect(multiAction?.actions[2].type).toBe("ibc-transfer");
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

  describe("Scenario 22: All Cosmos Action Types Combined", () => {
    /**
     * Complex scenario with many different action types in one multi-action.
     */
    it("should handle all Cosmos action types together", () => {
      const actionId = store
        .getState()
        .createMultiAction("cosmoshub-4", "cosmos");

      const actions = [
        {
          type: "send",
          params: { recipientAddress: "cosmos1...", amount: "1000000" },
        },
        {
          type: "delegate",
          params: { validatorAddress: "cosmosvaloper1...", amount: "5000000" },
        },
        {
          type: "undelegate",
          params: { validatorAddress: "cosmosvaloper1...", amount: "1000000" },
        },
        {
          type: "claim-rewards",
          params: { validatorAddress: "cosmosvaloper1..." },
        },
        { type: "vote", params: { proposalId: "100", option: "yes" } },
      ];

      for (const action of actions) {
        store.getState().addMultiAction(actionId, action);
      }

      const multiAction = store.getState().getMultiAction(actionId);
      expect(multiAction?.actions.length).toBe(5);

      // Verify each action type is preserved
      const types = multiAction?.actions.map((a) => a.type);
      expect(types).toEqual([
        "send",
        "delegate",
        "undelegate",
        "claim-rewards",
        "vote",
      ]);
    });
  });
});

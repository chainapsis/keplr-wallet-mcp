/**
 * Unit tests for CosmWasm tools.
 *
 * Tests cover:
 * - cosmwasm-query: Query contract state
 * - cosmwasm-contract-info: Get contract metadata
 * - cosmwasm-execute: Execute contract actions (pending confirmation)
 * - cosmwasm-instantiate: Instantiate new contracts (pending confirmation)
 * - Chain support validation
 * - Error handling and setup_required
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCosmosClient,
  createMockMcpServer,
  createMockStore,
  type MockCosmosClient,
  type MockMcpServer,
  type MockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

import {
  createChainsMock,
  mockCosmosChain,
  mockOsmosisChain,
} from "../helpers/chain-mocks.js";

vi.mock("../../chains/cosmos.js", () =>
  createChainsMock({
    "osmosis-1": mockOsmosisChain,
    "cosmoshub-4": mockCosmosChain,
  }),
);

// Mock pending-action module
vi.mock("../../pending-action.js", () => ({
  storePending: vi.fn().mockReturnValue("mock-confirmation-token-12345"),
}));

describe("CosmWasm Tools", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;
  let mockClient: MockCosmosClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockServer = createMockMcpServer();
    mockClient = createMockCosmosClient({
      getAddress: vi.fn().mockResolvedValue("osmo1testaddress..."),
    });
    mockStore = createMockStore({
      getClientFor: vi.fn().mockResolvedValue(mockClient),
    });

    // Register the cosmwasm plugin
    const { default: cosmwasmPlugin } = await import(
      "../../plugins/cosmos/cosmwasm.js"
    );
    cosmwasmPlugin.register(
      mockServer as unknown as Parameters<typeof cosmwasmPlugin.register>[0],
      mockStore as unknown as Parameters<typeof cosmwasmPlugin.register>[1],
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("cosmwasm-query", () => {
    it("should query contract state successfully", async () => {
      const tool = mockServer.getTool("cosmwasm-query");
      expect(tool).toBeDefined();

      mockClient.queryContract.mockResolvedValueOnce({
        data: { balance: "1000000", owner: "osmo1owner..." },
      });

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"balance":{"address":"osmo1user..."}}',
      });

      const response = parseToolResponse<{
        chainId: string;
        contractAddress: string;
        query: Record<string, unknown>;
        result: string;
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      expect(response.chainId).toBe("osmosis-1");
      expect(response.contractAddress).toBe("osmo1contract...");
      expect(response.query).toEqual({ balance: { address: "osmo1user..." } });
      // Result is wrapped with untrusted data markers for prompt injection protection
      expect(response.result).toContain(
        "[UNTRUSTED ON-CHAIN DATA from cosmwasm-contract]",
      );
      expect(response.result).toContain("balance");
      expect(response.result).toContain("1000000");
      expect(response.suggestedActions).toBeDefined();
      expect(response.suggestedActions.length).toBeGreaterThan(0);
    });

    it("should reject queries on non-CosmWasm chains", async () => {
      const tool = mockServer.getTool("cosmwasm-query");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        contractAddress: "cosmos1contract...",
        queryMsg: '{"balance":{}}',
      });

      const response = parseToolResponse<{
        error: string;
        message: string;
        supportedChains: string[];
      }>(result);

      expect(response.error).toBe("not_supported");
      expect(response.message).toContain("not available");
      expect(response.supportedChains).toContain("osmosis-1");
    });

    it("should return error for invalid JSON query", async () => {
      const tool = mockServer.getTool("cosmwasm-query");

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: "invalid json",
      });

      const response = parseToolResponse<{
        error: string;
        message: string;
      }>(result);

      expect(response.error).toBe("invalid_query");
      expect(response.message).toContain("valid JSON");
    });

    it("should include suggestedActions in response", async () => {
      const tool = mockServer.getTool("cosmwasm-query");

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"token_info":{}}',
      });

      const response = parseToolResponse<{
        suggestedActions: Array<{ tool: string; reason: string }>;
      }>(result);

      expect(response.suggestedActions).toBeDefined();
      const tools = response.suggestedActions.map((a) => a.tool);
      expect(tools).toContain("cosmwasm-contract-info");
      expect(tools).toContain("cosmwasm-execute");
    });
  });

  describe("cosmwasm-contract-info", () => {
    it("should return contract metadata", async () => {
      const tool = mockServer.getTool("cosmwasm-contract-info");
      expect(tool).toBeDefined();

      mockClient.getContractInfo.mockResolvedValueOnce({
        address: "osmo1contract...",
        codeId: "456",
        creator: "osmo1creator...",
        admin: "osmo1admin...",
        label: "My Token Contract",
      });

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
      });

      const response = parseToolResponse<{
        chainId: string;
        contract: {
          address: string;
          codeId: string;
          creator: string;
          admin: string;
          label: string;
        };
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      expect(response.chainId).toBe("osmosis-1");
      expect(response.contract.codeId).toBe("456");
      expect(response.contract.label).toBe("My Token Contract");
      expect(response.contract.admin).toBe("osmo1admin...");
      expect(response.suggestedActions).toBeDefined();
    });

    it("should reject on non-CosmWasm chains", async () => {
      const tool = mockServer.getTool("cosmwasm-contract-info");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        contractAddress: "cosmos1contract...",
      });

      const response = parseToolResponse<{
        error: string;
        supportedChains: string[];
      }>(result);

      expect(response.error).toBe("not_supported");
      expect(response.supportedChains).toContain("osmosis-1");
    });
  });

  describe("cosmwasm-execute", () => {
    it("should return pending confirmation for execute", async () => {
      const tool = mockServer.getTool("cosmwasm-execute");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        executeMsg:
          '{"transfer":{"recipient":"osmo1recipient...","amount":"1000000"}}',
      });

      const response = parseToolResponse<{
        status: string;
        confirmationToken: string;
        preview: {
          action: string;
          chain: string;
          contract: string;
          message: string;
        };
        warnings: string[];
      }>(result);

      expect(response.status).toBe("pending_confirmation");
      expect(response.confirmationToken).toBe("mock-confirmation-token-12345");
      expect(response.preview.action).toBe("Execute CosmWasm Contract");
      expect(response.preview.chain).toBe("osmosis-1");
      expect(response.preview.contract).toBe("osmo1contract...");
      expect(response.preview.message).toBe("transfer");
      expect(response.warnings).toBeDefined();
      expect(response.warnings.length).toBeGreaterThan(0);
    });

    it("should handle execute with funds", async () => {
      const tool = mockServer.getTool("cosmwasm-execute");

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        executeMsg: '{"deposit":{}}',
        funds: '[{"denom":"uosmo","amount":"1000000"}]',
      });

      const response = parseToolResponse<{
        status: string;
        preview: {
          funds: Array<{ denom: string; amount: string }>;
        };
      }>(result);

      expect(response.status).toBe("pending_confirmation");
      expect(response.preview.funds).toEqual([
        { denom: "uosmo", amount: "1000000" },
      ]);
    });

    it("should return error for invalid execute message", async () => {
      const tool = mockServer.getTool("cosmwasm-execute");

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        executeMsg: "not valid json",
      });

      const response = parseToolResponse<{
        error: string;
        message: string;
      }>(result);

      expect(response.error).toBe("invalid_message");
    });

    it("should return error for invalid funds JSON", async () => {
      const tool = mockServer.getTool("cosmwasm-execute");

      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        executeMsg: '{"transfer":{}}',
        funds: "not valid json",
      });

      const response = parseToolResponse<{
        error: string;
        message: string;
      }>(result);

      expect(response.error).toBe("invalid_funds");
    });

    it("should reject on non-CosmWasm chains", async () => {
      const tool = mockServer.getTool("cosmwasm-execute");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        contractAddress: "cosmos1contract...",
        executeMsg: '{"transfer":{}}',
      });

      const response = parseToolResponse<{
        error: string;
      }>(result);

      expect(response.error).toBe("not_supported");
    });
  });

  describe("cosmwasm-instantiate", () => {
    it("should return pending confirmation for instantiate", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "123",
        instantiateMsg: '{"name":"My Token","symbol":"MTK","decimals":6}',
        label: "My Token Contract v1",
      });

      const response = parseToolResponse<{
        status: string;
        confirmationToken: string;
        preview: {
          action: string;
          chain: string;
          codeId: string;
          label: string;
          admin: string;
        };
        warnings: string[];
      }>(result);

      expect(response.status).toBe("pending_confirmation");
      expect(response.confirmationToken).toBe("mock-confirmation-token-12345");
      expect(response.preview.action).toBe("Instantiate CosmWasm Contract");
      expect(response.preview.codeId).toBe("123");
      expect(response.preview.label).toBe("My Token Contract v1");
      expect(response.preview.admin).toContain("immutable");
      expect(response.warnings).toBeDefined();
    });

    it("should handle instantiate with admin", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "123",
        instantiateMsg: '{"name":"My Token"}',
        label: "My Token",
        admin: "osmo1admin...",
      });

      const response = parseToolResponse<{
        preview: {
          admin: string;
        };
        warnings: string[];
      }>(result);

      expect(response.preview.admin).toBe("osmo1admin...");
      // Should warn about admin being set
      const hasAdminWarning = response.warnings.some((w) =>
        w.toLowerCase().includes("admin"),
      );
      expect(hasAdminWarning).toBe(true);
    });

    it("should return error for invalid code ID", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "not-a-number",
        instantiateMsg: "{}",
        label: "Test",
      });

      const response = parseToolResponse<{
        error: string;
        message: string;
      }>(result);

      expect(response.error).toBe("invalid_code_id");
    });

    it("should return error for zero code ID", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "0",
        instantiateMsg: "{}",
        label: "Test",
      });

      const response = parseToolResponse<{
        error: string;
      }>(result);

      expect(response.error).toBe("invalid_code_id");
    });

    it("should return error for invalid instantiate message", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "123",
        instantiateMsg: "invalid json",
        label: "Test",
      });

      const response = parseToolResponse<{
        error: string;
      }>(result);

      expect(response.error).toBe("invalid_message");
    });

    it("should reject on non-CosmWasm chains", async () => {
      const tool = mockServer.getTool("cosmwasm-instantiate");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        codeId: "123",
        instantiateMsg: "{}",
        label: "Test",
      });

      const response = parseToolResponse<{
        error: string;
        supportedChains: string[];
      }>(result);

      expect(response.error).toBe("not_supported");
      expect(response.supportedChains).not.toContain("cosmoshub-4");
    });
  });

  describe("setup_required handling", () => {
    it("should return setup_required when no wallet configured", async () => {
      mockStore.getClientFor.mockRejectedValueOnce(
        new Error(
          "No mnemonic configured. Use create-account or import-account first.",
        ),
      );

      const tool = mockServer.getTool("cosmwasm-query");
      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"balance":{}}',
      });

      const response = parseToolResponse<{
        status: string;
        setupGuide: {
          options: Array<{ tool: string }>;
        };
      }>(result);

      expect(response.status).toBe("setup_required");
      expect(response.setupGuide).toBeDefined();
      expect(response.setupGuide.options.length).toBeGreaterThan(0);
    });

    it("should return error response for contract errors", async () => {
      mockClient.queryContract.mockRejectedValueOnce(
        new Error("Contract execution failed: insufficient funds"),
      );

      const tool = mockServer.getTool("cosmwasm-query");
      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"balance":{}}',
      });

      const response = parseToolResponse<{
        isError: boolean;
        message: string;
        suggestedActions: Array<{ tool: string }>;
      }>(result);

      expect(response.isError).toBe(true);
      expect(response.message).toContain("insufficient funds");
      expect(response.suggestedActions).toBeDefined();
    });

    it("should return structured error for CosmWasm unknown variant", async () => {
      mockClient.queryContract.mockRejectedValueOnce(
        new Error(
          "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`",
        ),
      );

      const tool = mockServer.getTool("cosmwasm-query");
      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"unstake":{}}',
      });

      const response = parseToolResponse<{
        isError: boolean;
        category: string;
        recoverable: boolean;
        parsed: {
          errorType: string;
          sentValue: string;
          availableVariants: string[];
        };
        suggestedActions: Array<{ tool: string; reason: string }>;
      }>(result);

      expect(response.isError).toBe(true);
      expect(response.category).toBe("validation");
      expect(response.recoverable).toBe(false);
      expect(response.parsed.errorType).toBe("unknown_variant");
      expect(response.parsed.sentValue).toBe("unstake");
      expect(response.parsed.availableVariants).toContain("proxy");
      expect(response.parsed.availableVariants).toContain("update_config");
      // Should suggest retrying with valid variants
      const execAction = response.suggestedActions.find(
        (a) => a.tool === "cosmwasm-execute",
      );
      expect(execAction).toBeDefined();
      expect(execAction!.reason).toContain("proxy");
    });

    it("should return structured error for CosmWasm missing field", async () => {
      mockClient.queryContract.mockRejectedValueOnce(
        new Error(
          "Error parsing into type cw20::msg::TransferMsg: missing field `recipient`",
        ),
      );

      const tool = mockServer.getTool("cosmwasm-query");
      const result = await tool!.handler({
        chain: "osmosis-1",
        contractAddress: "osmo1contract...",
        queryMsg: '{"transfer":{}}',
      });

      const response = parseToolResponse<{
        isError: boolean;
        parsed: { errorType: string; missingField: string };
      }>(result);

      expect(response.isError).toBe(true);
      expect(response.parsed.errorType).toBe("missing_field");
      expect(response.parsed.missingField).toBe("recipient");
    });
  });

  describe("cosmwasm-list-contracts", () => {
    it("should list contracts by code ID", async () => {
      const tool = mockServer.getTool("cosmwasm-list-contracts");
      expect(tool).toBeDefined();

      mockClient.listContractsByCodeId = vi.fn().mockResolvedValueOnce({
        contracts: [
          "osmo1contract1...",
          "osmo1contract2...",
          "osmo1contract3...",
        ],
        truncated: false,
      });

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "100",
      });

      const response = parseToolResponse<{
        chainId: string;
        codeId: string;
        totalContracts: number;
        contracts: string[];
        suggestedActions: Array<{
          tool: string;
          params: Record<string, string>;
        }>;
      }>(result);

      expect(response.chainId).toBe("osmosis-1");
      expect(response.codeId).toBe("100");
      expect(response.totalContracts).toBe(3);
      expect(response.contracts).toHaveLength(3);
      // Should suggest cosmwasm-contract-info for first 3 contracts
      expect(response.suggestedActions).toHaveLength(3);
      expect(response.suggestedActions[0].tool).toBe("cosmwasm-contract-info");
    });

    it("should reject on non-CosmWasm chains", async () => {
      const tool = mockServer.getTool("cosmwasm-list-contracts");

      const result = await tool!.handler({
        chain: "cosmoshub-4",
        codeId: "100",
      });

      const response = parseToolResponse<{ error: string }>(result);
      expect(response.error).toBe("not_supported");
    });

    it("should handle empty contract list", async () => {
      const tool = mockServer.getTool("cosmwasm-list-contracts");

      mockClient.listContractsByCodeId = vi
        .fn()
        .mockResolvedValueOnce({ contracts: [], truncated: false });

      const result = await tool!.handler({
        chain: "osmosis-1",
        codeId: "999",
      });

      const response = parseToolResponse<{
        totalContracts: number;
        contracts: string[];
      }>(result);

      expect(response.totalContracts).toBe(0);
      expect(response.contracts).toHaveLength(0);
    });
  });

});

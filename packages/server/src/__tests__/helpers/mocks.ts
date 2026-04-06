/**
 * Test mocks and helpers for MCP tool testing.
 *
 * This module provides mock factories for:
 * - CosmosClient: Mock blockchain client
 * - KeplrStore: Mock state management
 * - McpServer: Mock MCP server for capturing tool handlers
 */

import { vi } from "vitest";

/**
 * Mock balance entry returned by CosmosClient
 */
export interface MockBalance {
  denom: string;
  amount: string;
}

/**
 * Mock delegation entry returned by CosmosClient
 */
export interface MockDelegation {
  validatorAddress: string;
  balance: { denom: string; amount: string };
}

/**
 * Mock reward entry returned by CosmosClient
 */
export interface MockReward {
  validatorAddress: string;
  rewards: Array<{ denom: string; amount: string }>;
}

/**
 * Mock CosmosClient interface for testing.
 */
export interface MockCosmosClient {
  getAddress: ReturnType<typeof vi.fn>;
  getBalances: ReturnType<typeof vi.fn>;
  getDelegations: ReturnType<typeof vi.fn>;
  getRewards: ReturnType<typeof vi.fn>;
  getBalancesViaLcd: ReturnType<typeof vi.fn>;
  getDelegationsViaLcd: ReturnType<typeof vi.fn>;
  getRewardsViaLcd: ReturnType<typeof vi.fn>;
  sendTokens: ReturnType<typeof vi.fn>;
  delegate: ReturnType<typeof vi.fn>;
  undelegate: ReturnType<typeof vi.fn>;
  claimRewards: ReturnType<typeof vi.fn>;
  ibcTransfer: ReturnType<typeof vi.fn>;
  verifyIbcChannel: ReturnType<typeof vi.fn>;
  vote: ReturnType<typeof vi.fn>;
  simulateFee: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  // CosmWasm methods
  queryContract: ReturnType<typeof vi.fn>;
  getContractInfo: ReturnType<typeof vi.fn>;
  listContractsByCodeId: ReturnType<typeof vi.fn>;
  executeContract: ReturnType<typeof vi.fn>;
  instantiateContract: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock CosmosClient with default implementations.
 */
export function createMockCosmosClient(
  overrides: Partial<MockCosmosClient> = {},
): MockCosmosClient {
  return {
    getAddress: vi.fn().mockResolvedValue("cosmos1testaddress..."),
    getBalances: vi
      .fn()
      .mockResolvedValue([{ denom: "uatom", amount: "1000000" }]),
    getDelegations: vi.fn().mockResolvedValue([]),
    getRewards: vi.fn().mockResolvedValue([]),
    getBalancesViaLcd: vi
      .fn()
      .mockResolvedValue([{ denom: "uatom", amount: "1000000" }]),
    getDelegationsViaLcd: vi.fn().mockResolvedValue([]),
    getRewardsViaLcd: vi.fn().mockResolvedValue([]),
    sendTokens: vi.fn().mockResolvedValue({
      transactionHash: "ABC123TXHASH",
      code: 0,
      gasUsed: "100000",
      gasWanted: "200000",
    }),
    delegate: vi.fn().mockResolvedValue({
      transactionHash: "DEF456DELEGATEHASH",
      code: 0,
      gasUsed: "120000",
      gasWanted: "200000",
    }),
    undelegate: vi.fn().mockResolvedValue({
      transactionHash: "GHI789UNDELEGATEHASH",
      code: 0,
      gasUsed: "130000",
      gasWanted: "200000",
    }),
    claimRewards: vi.fn().mockResolvedValue({
      transactionHash: "JKL012CLAIMHASH",
      code: 0,
      gasUsed: "80000",
      gasWanted: "150000",
    }),
    ibcTransfer: vi.fn().mockResolvedValue({
      transactionHash: "MNO345IBCHASH",
      code: 0,
      gasUsed: "150000",
      gasWanted: "250000",
    }),
    verifyIbcChannel: vi
      .fn()
      .mockResolvedValue({ exists: true, state: "STATE_OPEN" }),
    vote: vi.fn().mockResolvedValue({
      transactionHash: "PQR678VOTEHASH",
      code: 0,
      gasUsed: "90000",
      gasWanted: "180000",
    }),
    simulateFee: vi.fn().mockResolvedValue({
      feeAmount: "5000",
      feeDenom: "uatom",
      gasEstimate: "200000",
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    // CosmWasm methods
    queryContract: vi.fn().mockResolvedValue({
      data: { balance: "1000000" },
    }),
    getContractInfo: vi.fn().mockResolvedValue({
      address: "osmo1contractaddr...",
      codeId: "123",
      creator: "osmo1creator...",
      admin: "osmo1admin...",
      label: "Test Contract",
    }),
    listContractsByCodeId: vi
      .fn()
      .mockResolvedValue({ contracts: [], truncated: false }),
    executeContract: vi.fn().mockResolvedValue({
      transactionHash: "STU901EXECUTEHASH",
      code: 0,
      gasUsed: "200000",
      gasWanted: "300000",
      events: [],
    }),
    instantiateContract: vi.fn().mockResolvedValue({
      transactionHash: "VWX234INSTANTIATEHASH",
      code: 0,
      gasUsed: "250000",
      gasWanted: "400000",
      events: [],
      contractAddress: "osmo1newcontract...",
    }),
    ...overrides,
  };
}

/**
 * Mock store interface for testing.
 */
export interface MockStore {
  getClientFor: ReturnType<typeof vi.fn>;
  storePending: ReturnType<typeof vi.fn>;
  executePending: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock store with default implementations.
 */
export function createMockStore(overrides: Partial<MockStore> = {}): MockStore {
  return {
    getClientFor: vi.fn(),
    storePending: vi.fn().mockReturnValue("mock-confirmation-token"),
    executePending: vi.fn().mockResolvedValue({ txHash: "0xmocktx..." }),
    ...overrides,
  };
}

/**
 * Tool handler function type.
 */
export type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

/**
 * Registered tool with schema and handler.
 */
export interface RegisteredTool {
  name: string;
  config: {
    description?: string;
    inputSchema?: Record<string, unknown>;
  };
  handler: ToolHandler;
}

/**
 * Mock inner Server for elicitation capabilities.
 * By default, elicitation is not supported (returns null capabilities).
 */
export interface MockInnerServer {
  getClientCapabilities: ReturnType<typeof vi.fn>;
  getClientVersion: ReturnType<typeof vi.fn>;
  elicitInput: ReturnType<typeof vi.fn>;
}

/**
 * Mock MCP server for capturing tool registrations.
 */
export interface MockMcpServer {
  registerTool: ReturnType<typeof vi.fn>;
  registerResource: ReturnType<typeof vi.fn>;
  registerPrompt: ReturnType<typeof vi.fn>;
  /** Get a registered tool by name */
  getTool: (name: string) => RegisteredTool | undefined;
  /** Map of all registered tools */
  tools: Map<string, RegisteredTool>;
  /** Inner server for elicitation (McpServer.server) */
  server: MockInnerServer;
}

/**
 * Create a mock MCP server that captures tool registrations.
 *
 * @param options.elicitationSupported - Whether to mock elicitation support (default: false)
 */
export function createMockMcpServer(options?: {
  elicitationSupported?: boolean;
  clientName?: string;
}): MockMcpServer {
  const tools = new Map<string, RegisteredTool>();
  const elicitationSupported = options?.elicitationSupported ?? false;

  const registerTool = vi.fn(
    (
      name: string,
      config: { description?: string; inputSchema?: Record<string, unknown> },
      handler: ToolHandler,
    ) => {
      tools.set(name, { name, config, handler });
    },
  );

  // Mock inner server for elicitation and client detection
  const server: MockInnerServer = {
    getClientCapabilities: vi.fn(() =>
      elicitationSupported ? { elicitation: {} } : null,
    ),
    getClientVersion: vi.fn(() =>
      options?.clientName
        ? { name: options.clientName, version: "1.0.0" }
        : undefined,
    ),
    elicitInput: vi.fn(),
  };

  return {
    registerTool,
    registerResource: vi.fn(),
    registerPrompt: vi.fn(),
    getTool: (name: string) => tools.get(name),
    tools,
    server,
  };
}

/**
 * Parse JSON response from tool handler.
 */
export function parseToolResponse<T = unknown>(result: {
  content: Array<{ type: "text"; text: string }>;
}): T {
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent) {
    throw new Error("No text content in tool response");
  }
  return JSON.parse(textContent.text) as T;
}

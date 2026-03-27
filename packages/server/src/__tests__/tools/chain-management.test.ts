/**
 * Unit tests for chain-management plugin.
 *
 * Tests cover:
 * - validateRpcUrl: HTTPS enforcement for non-local endpoints
 * - add-cosmos-chain: Blocks HTTP remote endpoints, allows local and HTTPS
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateRpcUrl } from "../../plugins/chain-management.js";
import {
  createMockMcpServer,
  createMockStore,
  type MockMcpServer,
  type MockStore,
} from "../helpers/mocks.js";

// Mock the chains/cosmos module
vi.mock("../../chains/cosmos.js", () => ({
  isBuiltinChain: vi.fn().mockReturnValue(false),
  addCustomChainToCache: vi.fn(),
  removeCustomChainFromCache: vi.fn(),
  convertStoredToChainInfo: vi
    .fn()
    .mockImplementation((config: unknown) => config),
}));

// Mock the chains/storage module
vi.mock("../../chains/storage.js", () => ({
  addCosmosChain: vi.fn().mockResolvedValue(undefined),
  removeCosmosChain: vi.fn().mockResolvedValue(true),
}));

describe("validateRpcUrl", () => {
  it("allows https:// URLs", () => {
    expect(() => validateRpcUrl("https://rpc.cosmos.network")).not.toThrow();
  });

  it("allows http://localhost with port", () => {
    expect(() => validateRpcUrl("http://localhost:26657")).not.toThrow();
  });

  it("allows http://127.0.0.1 with port", () => {
    expect(() => validateRpcUrl("http://127.0.0.1:26657")).not.toThrow();
  });

  it("allows http://[::1] (IPv6 loopback) with port", () => {
    expect(() => validateRpcUrl("http://[::1]:26657")).not.toThrow();
  });

  it("blocks http://example.com with error", () => {
    expect(() => validateRpcUrl("http://example.com:26657")).toThrow(
      "HTTP RPC is not allowed",
    );
  });

  it("blocks http://192.168.1.1 (private network) with error", () => {
    expect(() => validateRpcUrl("http://192.168.1.1:26657")).toThrow(
      "HTTP RPC is not allowed",
    );
  });
});

describe("add-cosmos-chain tool", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;

  const baseParams = {
    chainId: "testchain-1",
    chainName: "Test Chain",
    bech32Prefix: "test",
    denom: "TEST",
    minimalDenom: "utest",
    decimals: 6,
    gasPrice: "0.025utest",
    testConnection: false,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    mockStore = createMockStore();

    const { default: chainManagementPlugin } = await import(
      "../../plugins/chain-management.js"
    );
    chainManagementPlugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows adding a chain with https:// RPC and REST", async () => {
    const tool = mockServer.getTool("add-cosmos-chain");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      ...baseParams,
      rpc: "https://rpc.testchain.network",
      rest: "https://lcd.testchain.network",
    })) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).not.toBe(true);
  });

  it("allows adding a chain with http://localhost RPC", async () => {
    const tool = mockServer.getTool("add-cosmos-chain");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      ...baseParams,
      rpc: "http://localhost:26657",
      rest: "http://localhost:1317",
    })) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).not.toBe(true);
  });

  it("blocks adding a chain with http:// remote RPC", async () => {
    const tool = mockServer.getTool("add-cosmos-chain");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      ...baseParams,
      rpc: "http://rpc.testchain.network",
      rest: "https://lcd.testchain.network",
    })) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP RPC is not allowed");
  });

  it("blocks adding a chain with http:// remote REST", async () => {
    const tool = mockServer.getTool("add-cosmos-chain");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      ...baseParams,
      rpc: "https://rpc.testchain.network",
      rest: "http://lcd.testchain.network",
    })) as { content: { type: string; text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP RPC is not allowed");
  });
});

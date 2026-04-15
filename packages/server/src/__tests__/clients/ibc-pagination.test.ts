/**
 * IBC Channel Pagination Tests
 *
 * Verifies that getIbcChannels() correctly paginates through all pages
 * of channels and connections, matching real-world scenarios like Neutron
 * (7,500+ channels where transfer channels appear after page 14).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CosmosClient } from "../../clients/cosmos.js";

// --- Module mocks ---

vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic phrase here"),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../chains/cosmos.js", () => ({
  getBech32Prefix: vi.fn().mockReturnValue("neutron"),
  getGasPrice: vi.fn().mockReturnValue("0.025untrn"),
  getGasPriceForDenom: vi.fn().mockReturnValue("0.025untrn"),
  getStakeDecimals: vi.fn().mockReturnValue(6),
  getStakeDenom: vi.fn().mockReturnValue("NTRN"),
  getStakeMinimalDenom: vi.fn().mockReturnValue("untrn"),
}));

vi.mock("@cosmjs/stargate", () => ({
  SigningStargateClient: { connectWithSigner: vi.fn() },
  StargateClient: { connect: vi.fn() },
  GasPrice: {
    fromString: vi.fn().mockReturnValue({ amount: "0.025", denom: "untrn" }),
  },
  defaultRegistryTypes: [],
}));

vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: {
    fromMnemonic: vi.fn().mockResolvedValue({
      getAccounts: vi
        .fn()
        .mockResolvedValue([
          { address: "neutron1test", pubkey: new Uint8Array(33) },
        ]),
    }),
  },
  Registry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
}));

const mockLcdFetch = vi.fn();
const mockSafeParseJson = vi.fn();

vi.mock("../../utils/lcd-fetch.js", () => ({
  lcdFetch: (...args: unknown[]) => mockLcdFetch(...args),
  safeParseJson: (...args: unknown[]) => mockSafeParseJson(...args),
}));

// --- Helpers ---

const mockChain = {
  chainId: "neutron-1",
  chainName: "Neutron",
  rpc: "https://rpc.neutron.org",
} as never;

const makeChannel = (
  id: number,
  portId: string,
  connectionId: string,
  state = "STATE_OPEN",
) => ({
  state,
  ordering: "ORDER_UNORDERED",
  counterparty: { port_id: "transfer", channel_id: `channel-${id}` },
  connection_hops: [connectionId],
  version: "ics20-1",
  port_id: portId,
  channel_id: `channel-${id}`,
});

describe("IBC Channel Pagination", () => {
  let client: CosmosClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CosmosClient("test mnemonic phrase here");
  });

  it("should jump to transfer port via pagination key and collect channels", async () => {
    // With the transfer-port-key jump, the first request skips non-transfer channels
    const transferPage1 = Array.from({ length: 500 }, (_, i) =>
      makeChannel(i, "transfer", `connection-${i % 10}`),
    );
    const transferPage2 = Array.from({ length: 5 }, (_, i) =>
      makeChannel(500 + i, "transfer", `connection-${i}`),
    );

    let channelCallCount = 0;
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        channelCallCount++;
        return { ok: true };
      }
      return { ok: false, statusText: "Not Found" };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        if (channelCallCount === 1) {
          return {
            channels: transferPage1,
            pagination: { next_key: "page-key-2" },
          };
        }
        return {
          channels: transferPage2,
          pagination: { next_key: null },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);

    expect(result.channels).toHaveLength(505);
    expect(result.channels.every((ch) => ch.portId === "transfer")).toBe(true);
    expect(channelCallCount).toBe(2);
    expect(result.channels[0].counterpartyChainId).toBeUndefined();
    expect(result.enrichmentComplete).toBe(true);
  });

  it("should stop early when non-transfer channels appear after transfer ones", async () => {
    // Simulates the boundary page: transfer channels + wasm channels mixed
    const mixedPage = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeChannel(i, "transfer", `connection-${i}`),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeChannel(100 + i, "wasm.neutron1contract", `connection-${i}`),
      ),
    ];

    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) return { ok: true };
      return { ok: false, statusText: "Not Found" };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: mixedPage,
          pagination: { next_key: "should-not-follow" },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);

    expect(result.channels).toHaveLength(3);
    expect(result.channels.every((ch) => ch.portId === "transfer")).toBe(true);
  });

  it("should stop at MAX_PAGES (50) to prevent infinite loops", async () => {
    // Every page returns next_key — should stop at 50
    let channelCallCount = 0;
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        channelCallCount++;
        return { ok: true };
      }
      if (path.includes("/ibc/core/connection/v1/connections")) {
        return { ok: true };
      }
      return { ok: false, statusText: "Not Found" };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [makeChannel(channelCallCount, "transfer", "connection-0")],
          pagination: { next_key: `always-more-${channelCallCount}` },
        };
      }
      if (context === "/ibc/core/connection/v1/connections") {
        return { connections: [], pagination: { next_key: null } };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);

    expect(channelCallCount).toBe(50);
    expect(result.channels).toHaveLength(50);
  });

  it("should use transfer port key on first request and response key on subsequent", async () => {
    const capturedPaths: string[] = [];
    const TRANSFER_PORT_KEY = btoa("/ports/transfer/");

    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      capturedPaths.push(path);
      return { ok: true };
    });

    let channelPage = 0;
    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        channelPage++;
        if (channelPage === 1) {
          return {
            channels: [makeChannel(0, "transfer", "connection-0")],
            pagination: { next_key: "abc123==" },
          };
        }
        return {
          channels: [makeChannel(1, "transfer", "connection-0")],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    await client.getIbcChannels(mockChain);

    // First page: should use TRANSFER_PORT_KEY to jump to transfer channels
    expect(capturedPaths[0]).toContain("pagination.limit=500");
    expect(capturedPaths[0]).toContain(
      `pagination.key=${encodeURIComponent(TRANSFER_PORT_KEY)}`,
    );

    // Second page: should include the key from first response
    expect(capturedPaths[1]).toContain("pagination.key=abc123%3D%3D");
  });

  it("should throw on non-ok channel response", async () => {
    mockLcdFetch.mockResolvedValue({ ok: false, statusText: "Forbidden" });

    await expect(client.getIbcChannels(mockChain)).rejects.toThrow(
      "Failed to fetch IBC channels: Forbidden",
    );
  });

  it("should continue without chain IDs if bulk connections fetch fails", async () => {
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        return { ok: true };
      }
      // Bulk connections endpoint fails
      if (path.includes("/ibc/core/connection/v1/connections")) {
        return { ok: false, statusText: "Internal Server Error" };
      }
      return { ok: false };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [makeChannel(0, "transfer", "connection-0")],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain, {
      enrichChainIds: true,
    });

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].counterpartyChainId).toBeUndefined();
    expect(result.enrichmentComplete).toBe(false);
  });

  it("should use bulk endpoints to enrich chain IDs", async () => {
    mockLcdFetch.mockResolvedValue({ ok: true });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [
            makeChannel(0, "transfer", "connection-1"),
            makeChannel(1, "transfer", "connection-1"),
            makeChannel(2, "transfer", "connection-2"),
          ],
          pagination: { next_key: null },
        };
      }
      if (context === "/ibc/core/connection/v1/connections") {
        return {
          connections: [
            { id: "connection-0", client_id: "07-tendermint-99" },
            { id: "connection-1", client_id: "07-tendermint-0" },
            { id: "connection-2", client_id: "07-tendermint-0" },
          ],
          pagination: { next_key: null },
        };
      }
      if (context === "/ibc/core/client/v1/client_states") {
        return {
          client_states: [
            {
              client_id: "07-tendermint-0",
              client_state: { chain_id: "osmosis-1" },
            },
            {
              client_id: "07-tendermint-99",
              client_state: { chain_id: "stargaze-1" },
            },
          ],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain, {
      enrichChainIds: true,
    });

    expect(result.channels).toHaveLength(3);
    expect(result.channels[0].counterpartyChainId).toBe("osmosis-1");
    expect(result.channels[1].counterpartyChainId).toBe("osmosis-1");
    expect(result.channels[2].counterpartyChainId).toBe("osmosis-1");
    expect(result.enrichmentComplete).toBe(true);
  });

  it("should deduplicate client_id mappings across connections", async () => {
    mockLcdFetch.mockResolvedValue({ ok: true });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [
            makeChannel(0, "transfer", "connection-0"),
            makeChannel(1, "transfer", "connection-1"),
          ],
          pagination: { next_key: null },
        };
      }
      if (context === "/ibc/core/connection/v1/connections") {
        return {
          connections: [
            { id: "connection-0", client_id: "07-tendermint-0" },
            { id: "connection-1", client_id: "07-tendermint-0" },
          ],
          pagination: { next_key: null },
        };
      }
      if (context === "/ibc/core/client/v1/client_states") {
        return {
          client_states: [
            {
              client_id: "07-tendermint-0",
              client_state: { chain_id: "cosmoshub-4" },
            },
          ],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain, {
      enrichChainIds: true,
    });

    // Both connections share 07-tendermint-0 → cosmoshub-4
    expect(result.channels[0].counterpartyChainId).toBe("cosmoshub-4");
    expect(result.channels[1].counterpartyChainId).toBe("cosmoshub-4");
  });

  it("should skip connection/client fetches when enrichChainIds is false", async () => {
    const allPaths: string[] = [];
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      allPaths.push(path);
      return { ok: true };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [makeChannel(0, "transfer", "connection-0")],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    await client.getIbcChannels(mockChain); // default = no enrichment

    // Should only fetch channels, no bulk connections or client_states
    const connectionPaths = allPaths.filter((p) =>
      p.includes("/connection/v1/connections"),
    );
    const clientPaths = allPaths.filter((p) => p.includes("/client_states"));
    expect(connectionPaths).toHaveLength(0);
    expect(clientPaths).toHaveLength(0);
  });

  it("should handle empty channel list", async () => {
    mockLcdFetch.mockResolvedValue({ ok: true });
    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return { channels: [], pagination: { next_key: null } };
      }
      if (context === "/ibc/core/connection/v1/connections") {
        return { connections: [], pagination: { next_key: null } };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);
    expect(result.channels).toHaveLength(0);
  });

  it("should return partial channels when a mid-pagination request times out", async () => {
    let channelCallCount = 0;
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        channelCallCount++;
        if (channelCallCount === 2) {
          // Simulate AbortSignal.timeout triggering
          return Promise.reject(
            new DOMException("The operation was aborted", "AbortError"),
          );
        }
        return { ok: true };
      }
      return { ok: false, statusText: "Not Found" };
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: Array.from({ length: 3 }, (_, i) =>
            makeChannel(i, "transfer", `connection-${i}`),
          ),
          pagination: { next_key: "more-pages" },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);

    // Should return channels from first page only (second page timed out)
    expect(result.channels).toHaveLength(3);
    expect(channelCallCount).toBe(2);
  });

  it("should return channels without enrichment when bulk fetches throw", async () => {
    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        return { ok: true };
      }
      // Simulate timeout/network error for bulk endpoints
      return Promise.reject(new Error("Request timeout"));
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [makeChannel(0, "transfer", "connection-0")],
          pagination: { next_key: null },
        };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain, {
      enrichChainIds: true,
    });

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].counterpartyChainId).toBeUndefined();
    expect(result.enrichmentComplete).toBe(false);
  });

  it("should return channels without enrichment when enrichment exceeds overall timeout", async () => {
    vi.useFakeTimers();

    mockLcdFetch.mockImplementation((_chain: unknown, path: string) => {
      if (path.includes("/ibc/core/channel/v1/channels")) {
        return Promise.resolve({ ok: true });
      }
      // Bulk endpoints resolve ok but safeParseJson will hang
      return Promise.resolve({ ok: true });
    });

    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [makeChannel(0, "transfer", "connection-0")],
          pagination: { next_key: null },
        };
      }
      // Bulk endpoints never resolve — simulates very slow LCD
      return new Promise(() => {});
    });

    const promise = client.getIbcChannels(mockChain, {
      enrichChainIds: true,
    });

    // Advance past ENRICHMENT_TIMEOUT_MS (20s)
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await promise;

    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].counterpartyChainId).toBeUndefined();
    expect(result.enrichmentComplete).toBe(false);

    vi.useRealTimers();
  });

  it("should map state and ordering codes to human-readable strings", async () => {
    mockLcdFetch.mockResolvedValue({ ok: true });
    mockSafeParseJson.mockImplementation((_resp: unknown, context: string) => {
      if (context === "/ibc/core/channel/v1/channels") {
        return {
          channels: [
            makeChannel(0, "transfer", "connection-0", "STATE_OPEN"),
            makeChannel(1, "transfer", "connection-0", "STATE_CLOSED"),
          ],
          pagination: { next_key: null },
        };
      }
      if (context === "/ibc/core/connection/v1/connections") {
        return { connections: [], pagination: { next_key: null } };
      }
      return {};
    });

    const result = await client.getIbcChannels(mockChain);

    expect(result.channels[0].state).toBe("OPEN");
    expect(result.channels[0].ordering).toBe("UNORDERED");
    expect(result.channels[1].state).toBe("CLOSED");
  });
});

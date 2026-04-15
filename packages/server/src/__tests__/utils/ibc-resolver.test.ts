/**
 * IBC Resolver Unit Tests
 *
 * Tests the IBC channel → chain name resolution with caching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the chains module
vi.mock("../../chains/cosmos.js", () => ({
  findChainByName: vi.fn().mockImplementation((chainId: string) => {
    const chains: Record<string, { chainId: string; chainName: string }> = {
      "osmosis-1": { chainId: "osmosis-1", chainName: "Osmosis" },
      "cosmoshub-4": { chainId: "cosmoshub-4", chainName: "Cosmos Hub" },
      "stargaze-1": { chainId: "stargaze-1", chainName: "Stargaze" },
    };
    return chains[chainId] ?? null;
  }),
  getChainConfig: vi.fn(),
  resolveChainDenom: vi.fn(),
}));

import type { ChainInfo } from "@keplr-wallet/types";
import { getChainConfig, resolveChainDenom } from "../../chains/cosmos.js";
import type {
  BalanceResult,
  CosmosClient,
  IbcChannelResult,
} from "../../clients/cosmos.js";
// Import after mocking
import {
  clearIbcCache,
  enrichIbcDenoms,
  formatIbcTransferSummary,
  getIbcCacheStats,
  getIbcDestinationChainId,
  getIbcDestinationName,
  preloadIbcChannels,
  queryCounterpartyChainId,
  queryDenomTrace,
  resolveIbcDenom,
  resolveIbcDestination,
} from "../../utils/ibc-resolver.js";

/**
 * Helper to create a mock Response with `.text()` support.
 * `safeParseJson` reads the body via `response.text()` then `JSON.parse()`,
 * so mocks must provide `.text()` returning the stringified data.
 */
const mockJsonResponse = (
  data: unknown,
  opts: { ok?: boolean; status?: number; statusText?: string } = {},
) =>
  ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  }) as Response;

// Mock chain info
const mockCosmosChain: ChainInfo = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  rpc: "https://rpc.cosmos.network",
  rest: "https://lcd.cosmos.network",
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "cosmos",
    bech32PrefixAccPub: "cosmospub",
    bech32PrefixValAddr: "cosmosvaloper",
    bech32PrefixValPub: "cosmosvaloperpub",
    bech32PrefixConsAddr: "cosmosvalcons",
    bech32PrefixConsPub: "cosmosvalconspub",
  },
  currencies: [
    { coinDenom: "ATOM", coinMinimalDenom: "uatom", coinDecimals: 6 },
  ],
  feeCurrencies: [
    { coinDenom: "ATOM", coinMinimalDenom: "uatom", coinDecimals: 6 },
  ],
  stakeCurrency: {
    coinDenom: "ATOM",
    coinMinimalDenom: "uatom",
    coinDecimals: 6,
  },
};

// Mock IBC channels
const mockIbcChannels: IbcChannelResult[] = [
  {
    channelId: "channel-141",
    portId: "transfer",
    state: "OPEN",
    counterpartyChannelId: "channel-0",
    counterpartyPortId: "transfer",
    connectionId: "connection-141",
    ordering: "UNORDERED",
    counterpartyChainId: "osmosis-1",
  },
  {
    channelId: "channel-207",
    portId: "transfer",
    state: "OPEN",
    counterpartyChannelId: "channel-1",
    counterpartyPortId: "transfer",
    connectionId: "connection-207",
    ordering: "UNORDERED",
    counterpartyChainId: "stargaze-1",
  },
  {
    channelId: "channel-500",
    portId: "transfer",
    state: "OPEN",
    counterpartyChannelId: "channel-2",
    counterpartyPortId: "transfer",
    connectionId: "connection-500",
    ordering: "UNORDERED",
    // No counterparty chain ID - simulates unresolved channel
  },
];

// Mock CosmosClient
const createMockClient = (): CosmosClient =>
  ({
    getIbcChannels: vi.fn().mockResolvedValue({
      channels: mockIbcChannels,
      enrichmentComplete: true,
    }),
  }) as unknown as CosmosClient;

describe("IBC Resolver", () => {
  beforeEach(() => {
    clearIbcCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearIbcCache();
  });

  describe("getIbcDestinationName (sync)", () => {
    it("should return null when cache is empty", () => {
      const result = getIbcDestinationName("cosmoshub-4", "channel-141");
      expect(result).toBeNull();
    });

    it("should return cached chain name after preloading", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const result = getIbcDestinationName("cosmoshub-4", "channel-141");
      expect(result).toBe("Osmosis");
    });

    it("should return null for non-existent channel after preloading", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const result = getIbcDestinationName("cosmoshub-4", "channel-999");
      expect(result).toBeNull();
    });
  });

  describe("getIbcDestinationChainId (sync)", () => {
    it("should return null when cache is empty", () => {
      const result = getIbcDestinationChainId("cosmoshub-4", "channel-141");
      expect(result).toBeNull();
    });

    it("should return cached chain ID after preloading", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const result = getIbcDestinationChainId("cosmoshub-4", "channel-141");
      expect(result).toBe("osmosis-1");
    });
  });

  describe("preloadIbcChannels", () => {
    it("should preload all channels for a chain", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      expect(client.getIbcChannels).toHaveBeenCalledWith(mockCosmosChain, {
        enrichChainIds: true,
      });

      // Check cache stats
      const stats = getIbcCacheStats();
      expect(stats.size).toBe(2); // Only 2 have counterpartyChainId
    });

    it("should preload only specified channels", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain, ["channel-141"]);

      const stats = getIbcCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.entries[0].chainName).toBe("Osmosis");
    });

    it("should handle API errors gracefully", async () => {
      const client = {
        getIbcChannels: vi.fn().mockRejectedValue(new Error("Network error")),
      } as unknown as CosmosClient;

      // Should not throw
      await expect(
        preloadIbcChannels(client, mockCosmosChain),
      ).resolves.not.toThrow();
    });

    it("should skip channels without counterpartyChainId", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      // channel-500 has no counterpartyChainId
      const result = getIbcDestinationName("cosmoshub-4", "channel-500");
      expect(result).toBeNull();
    });
  });

  describe("resolveIbcDestination (async)", () => {
    it("should resolve and cache a single channel", async () => {
      const client = createMockClient();
      const result = await resolveIbcDestination(
        client,
        mockCosmosChain,
        "channel-141",
      );

      expect(result).toBe("Osmosis");
      // Should have called getIbcChannels once
      expect(client.getIbcChannels).toHaveBeenCalledTimes(1);
    });

    it("should return cached value on subsequent calls", async () => {
      const client = createMockClient();

      // First call
      const result1 = await resolveIbcDestination(
        client,
        mockCosmosChain,
        "channel-141",
      );
      expect(result1).toBe("Osmosis");

      // Second call should use cache
      const result2 = await resolveIbcDestination(
        client,
        mockCosmosChain,
        "channel-141",
      );
      expect(result2).toBe("Osmosis");

      // Should only have called API once
      expect(client.getIbcChannels).toHaveBeenCalledTimes(1);
    });

    it("should return null for unresolvable channels", async () => {
      const client = createMockClient();
      const result = await resolveIbcDestination(
        client,
        mockCosmosChain,
        "channel-500",
      );

      expect(result).toBeNull();
    });
  });

  describe("formatIbcTransferSummary", () => {
    it("should format with destination chain when cached", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const result = formatIbcTransferSummary(
        "10 ATOM",
        "channel-141",
        "cosmoshub-4",
      );
      expect(result).toBe("IBC transfer 10 ATOM to Osmosis (via channel-141)");
    });

    it("should fall back to raw channel when not cached", () => {
      const result = formatIbcTransferSummary(
        "10 ATOM",
        "channel-999",
        "cosmoshub-4",
      );
      expect(result).toBe("IBC transfer 10 ATOM via channel-999");
    });

    it("should handle different amounts and channels", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const result = formatIbcTransferSummary(
        "100.5 OSMO",
        "channel-207",
        "cosmoshub-4",
      );
      expect(result).toBe(
        "IBC transfer 100.5 OSMO to Stargaze (via channel-207)",
      );
    });
  });

  describe("Cache Expiration", () => {
    it("should expire cache entries after TTL", async () => {
      // Use fake timers
      vi.useFakeTimers();

      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      // Cache should be populated
      expect(getIbcDestinationName("cosmoshub-4", "channel-141")).toBe(
        "Osmosis",
      );

      // Advance time by 6 minutes (past 5 min TTL)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Cache should be expired
      expect(getIbcDestinationName("cosmoshub-4", "channel-141")).toBeNull();

      vi.useRealTimers();
    });
  });

  describe("getIbcCacheStats", () => {
    it("should return empty stats when cache is empty", () => {
      const stats = getIbcCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it("should return cache stats after preloading", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      const stats = getIbcCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.entries).toContainEqual(
        expect.objectContaining({
          key: "cosmoshub-4:channel-141",
          chainName: "Osmosis",
        }),
      );
    });
  });

  describe("clearIbcCache", () => {
    it("should clear all cache entries", async () => {
      const client = createMockClient();
      await preloadIbcChannels(client, mockCosmosChain);

      expect(getIbcCacheStats().size).toBe(2);

      clearIbcCache();

      expect(getIbcCacheStats().size).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle unknown chain IDs gracefully", async () => {
      // Mock client returning channel with unknown counterparty chain
      const unknownChainClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-100",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-0",
              counterpartyPortId: "transfer",
              connectionId: "connection-100",
              ordering: "UNORDERED",
              counterpartyChainId: "unknown-chain-xyz",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;

      await preloadIbcChannels(unknownChainClient, mockCosmosChain);

      // Should fall back to chain ID when name not found
      const result = getIbcDestinationName("cosmoshub-4", "channel-100");
      expect(result).toBe("unknown-chain-xyz");
    });

    it("should handle multiple chains independently", async () => {
      const client = createMockClient();
      const mockOsmosisChain = {
        ...mockCosmosChain,
        chainId: "osmosis-1",
        chainName: "Osmosis",
      };

      // Different channels on osmosis
      const osmosisClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-0",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-141",
              counterpartyPortId: "transfer",
              connectionId: "connection-0",
              ordering: "UNORDERED",
              counterpartyChainId: "cosmoshub-4",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;

      await preloadIbcChannels(client, mockCosmosChain);
      await preloadIbcChannels(osmosisClient, mockOsmosisChain);

      // Check both chains have independent cache entries
      expect(getIbcDestinationName("cosmoshub-4", "channel-141")).toBe(
        "Osmosis",
      );
      expect(getIbcDestinationName("osmosis-1", "channel-0")).toBe(
        "Cosmos Hub",
      );
    });
  });
});

// ── Tier 2: Dynamic IBC Denom Trace Resolution Tests ──────────────────

// Valid 64-char uppercase hex hashes for testing
const VALID_ATOM_HASH =
  "27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const VALID_HASH_A =
  "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2";
const VALID_HASH_B =
  "B1C2D3E4F5A6B7C8D9E0F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2";
const VALID_HASH_C =
  "C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2";
const VALID_HASH_D =
  "D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B3C4D5E6F7A8B9C0D1E2";
const VALID_HASH_E =
  "E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D0E1F2";

// Mock Osmosis chain for Tier 2 tests (source chain with IBC denoms)
const mockOsmosisSource: ChainInfo = {
  chainId: "osmosis-1",
  chainName: "Osmosis",
  rpc: "https://rpc.osmosis.zone",
  rest: "https://lcd.osmosis.zone",
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "osmo",
    bech32PrefixAccPub: "osmopub",
    bech32PrefixValAddr: "osmovaloper",
    bech32PrefixValPub: "osmovaloperpub",
    bech32PrefixConsAddr: "osmovalcons",
    bech32PrefixConsPub: "osmovalconspub",
  },
  currencies: [
    {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
      coinGeckoId: "osmosis",
    },
  ],
  feeCurrencies: [
    { coinDenom: "OSMO", coinMinimalDenom: "uosmo", coinDecimals: 6 },
  ],
  stakeCurrency: {
    coinDenom: "OSMO",
    coinMinimalDenom: "uosmo",
    coinDecimals: 6,
    coinGeckoId: "osmosis",
  },
};

describe("IBC Denom Trace Resolution (Tier 2)", () => {
  beforeEach(() => {
    clearIbcCache();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    clearIbcCache();
    vi.restoreAllMocks();
  });

  describe("queryDenomTrace", () => {
    it("should return denom trace for valid IBC hash", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "uatom",
          },
        }),
      );

      const result = await queryDenomTrace(
        "https://lcd.osmosis.zone",
        VALID_ATOM_HASH,
      );

      expect(result).toEqual({
        baseDenom: "uatom",
        path: "transfer/channel-0",
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://lcd.osmosis.zone/ibc/apps/transfer/v1/denom_traces/${VALID_ATOM_HASH}`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("should return null on REST failure (404)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const result = await queryDenomTrace(
        "https://lcd.osmosis.zone",
        VALID_HASH_A,
      );
      expect(result).toBeNull();
    });

    it("should return null on network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      const result = await queryDenomTrace(
        "https://lcd.osmosis.zone",
        VALID_HASH_B,
      );
      expect(result).toBeNull();
    });

    it("should return null for invalid IBC hash format", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await queryDenomTrace(
        "https://lcd.osmosis.zone",
        "INVALID_HASH",
      );
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should return null for malformed response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({ unexpected: "structure" }),
      );

      const result = await queryDenomTrace(
        "https://lcd.osmosis.zone",
        VALID_HASH_A,
      );
      expect(result).toBeNull();
    });
  });

  describe("queryCounterpartyChainId", () => {
    it("should resolve counterparty chain ID via 3-step REST query", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();

          if (url.includes("/channels/channel-0/ports/transfer")) {
            return Promise.resolve(
              mockJsonResponse({
                channel: { connection_hops: ["connection-0"] },
              }),
            );
          }
          if (url.includes("/connections/connection-0")) {
            return Promise.resolve(
              mockJsonResponse({
                connection: { client_id: "07-tendermint-0" },
              }),
            );
          }
          if (url.includes("/client_states/07-tendermint-0")) {
            return Promise.resolve(
              mockJsonResponse({ client_state: { chain_id: "cosmoshub-4" } }),
            );
          }
          return Promise.resolve({ ok: false } as Response);
        });

      const result = await queryCounterpartyChainId(
        "https://lcd.osmosis.zone",
        "channel-0",
      );
      expect(result).toBe("cosmoshub-4");
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("should return null when channel query fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const result = await queryCounterpartyChainId(
        "https://lcd.osmosis.zone",
        "channel-999",
      );
      expect(result).toBeNull();
    });

    it("should return null when connection query fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/channels/")) {
            return Promise.resolve(
              mockJsonResponse({
                channel: { connection_hops: ["connection-0"] },
              }),
            );
          }
          return Promise.resolve({ ok: false } as Response);
        },
      );

      const result = await queryCounterpartyChainId(
        "https://lcd.osmosis.zone",
        "channel-0",
      );
      expect(result).toBeNull();
    });

    it("should return null for invalid channel ID format", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const result = await queryCounterpartyChainId(
        "https://lcd.osmosis.zone",
        "invalid-channel",
      );
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("resolveIbcDenom", () => {
    // Helper: pre-populate IBC channel cache for osmosis → cosmoshub
    const preloadOsmosisChannels = async () => {
      const osmosisClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-0",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-141",
              counterpartyPortId: "transfer",
              connectionId: "connection-0",
              ordering: "UNORDERED",
              counterpartyChainId: "cosmoshub-4",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(osmosisClient, mockOsmosisSource);
    };

    // Helper: set up chain config + resolveChainDenom mocks for cosmoshub-4
    const setupCosmosHubMocks = () => {
      vi.mocked(getChainConfig).mockImplementation((chainId: string) => {
        if (chainId === "cosmoshub-4") {
          return {
            chainId: "cosmoshub-4",
            chainName: "Cosmos Hub",
            rpc: "https://rpc.cosmos.network",
            rest: "https://lcd.cosmos.network",
            bip44: { coinType: 118 },
            bech32Config: {
              bech32PrefixAccAddr: "cosmos",
              bech32PrefixAccPub: "cosmospub",
              bech32PrefixValAddr: "cosmosvaloper",
              bech32PrefixValPub: "cosmosvaloperpub",
              bech32PrefixConsAddr: "cosmosvalcons",
              bech32PrefixConsPub: "cosmosvalconspub",
            },
            currencies: [
              {
                coinDenom: "ATOM",
                coinMinimalDenom: "uatom",
                coinDecimals: 6,
                coinGeckoId: "cosmos",
              },
            ],
            feeCurrencies: [
              {
                coinDenom: "ATOM",
                coinMinimalDenom: "uatom",
                coinDecimals: 6,
              },
            ],
            stakeCurrency: {
              coinDenom: "ATOM",
              coinMinimalDenom: "uatom",
              coinDecimals: 6,
              coinGeckoId: "cosmos",
            },
          };
        }
        return undefined;
      });

      vi.mocked(resolveChainDenom).mockImplementation(
        (chain: ChainInfo, denom: string) => {
          if (
            (chain as { chainId: string }).chainId === "cosmoshub-4" &&
            denom === "uatom"
          ) {
            return {
              displayDenom: "ATOM",
              decimals: 6,
              coinGeckoId: "cosmos",
            };
          }
          return null;
        },
      );
    };

    it("should resolve single-hop IBC denom to DenomMetadata", async () => {
      await preloadOsmosisChannels();
      setupCosmosHubMocks();

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "uatom",
          },
        }),
      );

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_ATOM_HASH}`,
      );

      expect(result).toEqual({
        displayDenom: "ATOM",
        decimals: 6,
        coinGeckoId: "cosmos",
      });
    });

    it("should return null for multi-hop IBC denom", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0/transfer/channel-1",
            base_denom: "uatom",
          },
        }),
      );

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_HASH_A}`,
      );
      expect(result).toBeNull();
    });

    it("should return null for non-IBC denom", async () => {
      const result = await resolveIbcDenom(mockOsmosisSource, "uosmo");
      expect(result).toBeNull();
    });

    it("should use cache on subsequent calls", async () => {
      await preloadOsmosisChannels();
      setupCosmosHubMocks();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "uatom",
          },
        }),
      );

      const ibcDenom = `ibc/${VALID_ATOM_HASH}`;

      // First call
      await resolveIbcDenom(mockOsmosisSource, ibcDenom);

      // Second call should use cache
      const result = await resolveIbcDenom(mockOsmosisSource, ibcDenom);

      expect(result).toEqual({
        displayDenom: "ATOM",
        decimals: 6,
        coinGeckoId: "cosmos",
      });
      // Only one fetch call for the denom trace (first call)
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should return heuristic result when counterparty chain config is unknown", async () => {
      // Pre-populate channel cache with unknown chain
      const unknownClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-999",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-0",
              counterpartyPortId: "transfer",
              connectionId: "connection-999",
              ordering: "UNORDERED",
              counterpartyChainId: "unknown-chain-xyz",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(unknownClient, mockOsmosisSource);

      // getChainConfig returns undefined for unknown chain
      vi.mocked(getChainConfig).mockReturnValue(undefined);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-999",
            base_denom: "uxyz",
          },
        }),
      );

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_HASH_B}`,
      );
      // Heuristic fallback: uses getTokenDecimals("uxyz") → 6
      expect(result).toEqual({
        displayDenom: "uxyz",
        decimals: 6,
        coinGeckoId: undefined,
      });
    });

    it("should return heuristic result with correct decimals for 18-decimal tokens on unknown chain", async () => {
      const unknownClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-998",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-0",
              counterpartyPortId: "transfer",
              connectionId: "connection-998",
              ordering: "UNORDERED",
              counterpartyChainId: "injective-1",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(unknownClient, mockOsmosisSource);

      vi.mocked(getChainConfig).mockReturnValue(undefined);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-998",
            base_denom: "inj",
          },
        }),
      );

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_HASH_D}`,
      );
      // Heuristic fallback: getTokenDecimals("inj") → 18 (known 18-decimal)
      expect(result).toEqual({
        displayDenom: "inj",
        decimals: 18,
        coinGeckoId: undefined,
      });
    });

    it("should return heuristic result when base denom not found on counterparty chain", async () => {
      await preloadOsmosisChannels();

      vi.mocked(getChainConfig).mockReturnValue({
        chainId: "cosmoshub-4",
        chainName: "Cosmos Hub",
        rpc: "",
        rest: "",
        bip44: { coinType: 118 },
        bech32Config: {
          bech32PrefixAccAddr: "cosmos",
          bech32PrefixAccPub: "cosmospub",
          bech32PrefixValAddr: "cosmosvaloper",
          bech32PrefixValPub: "cosmosvaloperpub",
          bech32PrefixConsAddr: "cosmosvalcons",
          bech32PrefixConsPub: "cosmosvalconspub",
        },
        currencies: [],
        feeCurrencies: [],
        stakeCurrency: {
          coinDenom: "ATOM",
          coinMinimalDenom: "uatom",
          coinDecimals: 6,
        },
      });
      vi.mocked(resolveChainDenom).mockReturnValue(null);

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "staevmos",
          },
        }),
      );

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_HASH_C}`,
      );
      // Heuristic fallback: getTokenDecimals("staevmos") → st + aevmos → 18
      expect(result).toEqual({
        displayDenom: "staevmos",
        decimals: 18,
        coinGeckoId: undefined,
      });
    });

    it("should fall back to REST for counterparty chain ID when channel cache misses", async () => {
      // Don't pre-populate channel cache — force REST fallback
      setupCosmosHubMocks();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();

          // Denom trace query
          if (url.includes("/denom_traces/")) {
            return Promise.resolve(
              mockJsonResponse({
                denom_trace: {
                  path: "transfer/channel-0",
                  base_denom: "uatom",
                },
              }),
            );
          }
          // Channel query
          if (url.includes("/channels/channel-0/ports/transfer")) {
            return Promise.resolve(
              mockJsonResponse({
                channel: { connection_hops: ["connection-0"] },
              }),
            );
          }
          // Connection query
          if (url.includes("/connections/connection-0")) {
            return Promise.resolve(
              mockJsonResponse({
                connection: { client_id: "07-tendermint-0" },
              }),
            );
          }
          // Client state query
          if (url.includes("/client_states/07-tendermint-0")) {
            return Promise.resolve(
              mockJsonResponse({ client_state: { chain_id: "cosmoshub-4" } }),
            );
          }
          return Promise.resolve({ ok: false } as Response);
        });

      const result = await resolveIbcDenom(
        mockOsmosisSource,
        `ibc/${VALID_ATOM_HASH}`,
      );

      expect(result).toEqual({
        displayDenom: "ATOM",
        decimals: 6,
        coinGeckoId: "cosmos",
      });
      // 1 denom trace + 3 counterparty chain ID = 4 fetch calls
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("should return null when chain has no REST endpoint", async () => {
      const noRestChain: ChainInfo = {
        ...mockOsmosisSource,
        rest: "",
      };

      const result = await resolveIbcDenom(
        noRestChain,
        `ibc/${VALID_ATOM_HASH}`,
      );
      expect(result).toBeNull();
    });

    it("should expire denom trace cache entries after TTL", async () => {
      vi.useFakeTimers();

      setupCosmosHubMocks();

      // Comprehensive fetch mock for both denom trace and counterparty chain queries
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();

          if (url.includes("/denom_traces/")) {
            return Promise.resolve(
              mockJsonResponse({
                denom_trace: {
                  path: "transfer/channel-0",
                  base_denom: "uatom",
                },
              }),
            );
          }
          if (url.includes("/channels/channel-0/ports/transfer")) {
            return Promise.resolve(
              mockJsonResponse({
                channel: { connection_hops: ["connection-0"] },
              }),
            );
          }
          if (url.includes("/connections/connection-0")) {
            return Promise.resolve(
              mockJsonResponse({
                connection: { client_id: "07-tendermint-0" },
              }),
            );
          }
          if (url.includes("/client_states/07-tendermint-0")) {
            return Promise.resolve(
              mockJsonResponse({ client_state: { chain_id: "cosmoshub-4" } }),
            );
          }
          return Promise.resolve({ ok: false } as Response);
        });

      const ibcDenom = `ibc/${VALID_ATOM_HASH}`;

      // First call — populates both caches
      const result1 = await resolveIbcDenom(mockOsmosisSource, ibcDenom);
      expect(result1?.displayDenom).toBe("ATOM");
      expect(fetchSpy).toHaveBeenCalled();

      // Second call — cache hit, no fetch
      fetchSpy.mockClear();
      const result2 = await resolveIbcDenom(mockOsmosisSource, ibcDenom);
      expect(result2?.displayDenom).toBe("ATOM");
      expect(fetchSpy).not.toHaveBeenCalled();

      // Advance past 24h denom trace TTL
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      // Third call — cache expired, should re-fetch
      fetchSpy.mockClear();
      const result3 = await resolveIbcDenom(mockOsmosisSource, ibcDenom);
      expect(result3?.displayDenom).toBe("ATOM");
      expect(fetchSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("enrichIbcDenoms", () => {
    const setupMocksForEnrich = async () => {
      // Pre-populate channel cache
      const osmosisClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-0",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-141",
              counterpartyPortId: "transfer",
              connectionId: "connection-0",
              ordering: "UNORDERED",
              counterpartyChainId: "cosmoshub-4",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(osmosisClient, mockOsmosisSource);

      vi.mocked(getChainConfig).mockImplementation((chainId: string) => {
        if (chainId === "cosmoshub-4") {
          return {
            chainId: "cosmoshub-4",
            chainName: "Cosmos Hub",
            rpc: "",
            rest: "",
            bip44: { coinType: 118 },
            bech32Config: {
              bech32PrefixAccAddr: "cosmos",
              bech32PrefixAccPub: "cosmospub",
              bech32PrefixValAddr: "cosmosvaloper",
              bech32PrefixValPub: "cosmosvaloperpub",
              bech32PrefixConsAddr: "cosmosvalcons",
              bech32PrefixConsPub: "cosmosvalconspub",
            },
            currencies: [
              {
                coinDenom: "ATOM",
                coinMinimalDenom: "uatom",
                coinDecimals: 6,
                coinGeckoId: "cosmos",
              },
            ],
            feeCurrencies: [],
            stakeCurrency: {
              coinDenom: "ATOM",
              coinMinimalDenom: "uatom",
              coinDecimals: 6,
            },
          };
        }
        return undefined;
      });

      vi.mocked(resolveChainDenom).mockImplementation(
        (chain: ChainInfo, denom: string) => {
          if (
            (chain as { chainId: string }).chainId === "cosmoshub-4" &&
            denom === "uatom"
          ) {
            return {
              displayDenom: "ATOM",
              decimals: 6,
              coinGeckoId: "cosmos",
            };
          }
          return null;
        },
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "uatom",
          },
        }),
      );
    };

    it("should resolve IBC denoms in balance array", async () => {
      await setupMocksForEnrich();

      const ibcDenom = `ibc/${VALID_ATOM_HASH}`;
      const balances: BalanceResult[] = [
        {
          denom: "uosmo",
          amount: "5000000",
          displayAmount: "5.000000",
          displayDenom: "OSMO",
        },
        {
          denom: ibcDenom,
          amount: "10000000",
          displayAmount: "10.000000",
          displayDenom: ibcDenom,
        },
      ];

      const result = await enrichIbcDenoms(balances, mockOsmosisSource);

      expect(result[0]).toEqual(balances[0]); // OSMO unchanged
      expect(result[1].displayDenom).toBe("ATOM");
      expect(result[1].displayAmount).toBe("10.000000");
      expect(result[1].denom).toBe(ibcDenom); // raw denom preserved
    });

    it("should return unchanged if no IBC denoms", async () => {
      const balances: BalanceResult[] = [
        {
          denom: "uosmo",
          amount: "5000000",
          displayAmount: "5.000000",
          displayDenom: "OSMO",
        },
      ];

      const result = await enrichIbcDenoms(balances, mockOsmosisSource);
      expect(result).toEqual(balances);
    });

    it("should keep raw denom for unresolvable IBC tokens", async () => {
      // Don't set up mocks — fetch will fail
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const ibcDenom = `ibc/${VALID_HASH_D}`;
      const balances: BalanceResult[] = [
        {
          denom: ibcDenom,
          amount: "1000000",
          displayAmount: "1.000000",
          displayDenom: ibcDenom,
        },
      ];

      const result = await enrichIbcDenoms(balances, mockOsmosisSource);
      expect(result[0].displayDenom).toBe(ibcDenom); // unchanged
    });

    it("should recalculate displayAmount when resolved decimals differ", async () => {
      // Setup: channel cache + chain config with 18-decimal token
      const osmosisClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-208",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-0",
              counterpartyPortId: "transfer",
              connectionId: "connection-208",
              ordering: "UNORDERED",
              counterpartyChainId: "axelar-dojo-1",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(osmosisClient, mockOsmosisSource);

      vi.mocked(getChainConfig).mockImplementation((chainId: string) => {
        if (chainId === "axelar-dojo-1") {
          return {
            chainId: "axelar-dojo-1",
            chainName: "Axelar",
            rpc: "",
            rest: "",
            bip44: { coinType: 118 },
            bech32Config: {
              bech32PrefixAccAddr: "axelar",
              bech32PrefixAccPub: "axelarpub",
              bech32PrefixValAddr: "axelarvaloper",
              bech32PrefixValPub: "axelarvaloperpub",
              bech32PrefixConsAddr: "axelarvalcons",
              bech32PrefixConsPub: "axelarvalconspub",
            },
            currencies: [
              {
                coinDenom: "WETH",
                coinMinimalDenom: "weth-wei",
                coinDecimals: 18,
                coinGeckoId: "weth",
              },
            ],
            feeCurrencies: [],
            stakeCurrency: {
              coinDenom: "AXL",
              coinMinimalDenom: "uaxl",
              coinDecimals: 6,
            },
          };
        }
        return undefined;
      });

      vi.mocked(resolveChainDenom).mockImplementation(
        (chain: ChainInfo, denom: string) => {
          if (
            (chain as { chainId: string }).chainId === "axelar-dojo-1" &&
            denom === "weth-wei"
          ) {
            return {
              displayDenom: "WETH",
              decimals: 18,
              coinGeckoId: "weth",
            };
          }
          return null;
        },
      );

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-208",
            base_denom: "weth-wei",
          },
        }),
      );

      const ibcDenom = `ibc/${VALID_HASH_E}`;
      const balances: BalanceResult[] = [
        {
          denom: ibcDenom,
          amount: "1000000000000000000",
          displayAmount: "1000000000000.000000", // Wrong: formatted with 6 decimals
          displayDenom: ibcDenom,
        },
      ];

      const result = await enrichIbcDenoms(balances, mockOsmosisSource);
      expect(result[0].displayDenom).toBe("WETH");
      // 1000000000000000000 with 18 decimals = 1.000000000000000000
      expect(result[0].displayAmount).toBe("1.000000000000000000");
    });

    it("should handle rejected promise from resolveIbcDenom gracefully", async () => {
      // Pre-populate channel cache
      const osmosisClient = {
        getIbcChannels: vi.fn().mockResolvedValue({
          channels: [
            {
              channelId: "channel-0",
              portId: "transfer",
              state: "OPEN",
              counterpartyChannelId: "channel-141",
              counterpartyPortId: "transfer",
              connectionId: "connection-0",
              ordering: "UNORDERED",
              counterpartyChainId: "cosmoshub-4",
            },
          ],
          enrichmentComplete: true,
        }),
      } as unknown as CosmosClient;
      await preloadIbcChannels(osmosisClient, mockOsmosisSource);

      // getChainConfig throws unexpectedly
      vi.mocked(getChainConfig).mockImplementation(() => {
        throw new Error("Unexpected chain config error");
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockJsonResponse({
          denom_trace: {
            path: "transfer/channel-0",
            base_denom: "uatom",
          },
        }),
      );

      const ibcDenom = `ibc/${VALID_ATOM_HASH}`;
      const balances: BalanceResult[] = [
        {
          denom: ibcDenom,
          amount: "10000000",
          displayAmount: "10.000000",
          displayDenom: ibcDenom,
        },
      ];

      const result = await enrichIbcDenoms(balances, mockOsmosisSource);
      // Should not crash, and should keep original displayDenom
      expect(result[0].displayDenom).toBe(ibcDenom);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected rejection"),
        expect.any(Error),
      );
    });
  });
});

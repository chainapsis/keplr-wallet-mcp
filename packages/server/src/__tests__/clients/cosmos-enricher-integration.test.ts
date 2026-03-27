/**
 * CosmosClient.getBalances() → balanceEnricherRegistry integration test.
 *
 * Verifies that getBalances() passes results through the enricher registry,
 * so removing the registry call from cosmos.ts would break this test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceResult } from "../../clients/cosmos.js";

// --- Hoisted values (available inside vi.mock factories) ---

const mockFormatted = vi.hoisted((): BalanceResult[] => [
  {
    denom: "uosmo",
    amount: "5000000",
    displayAmount: "5",
    displayDenom: "OSMO",
  },
]);

// --- Module mocks (must be before CosmosClient import) ---

vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue("test mnemonic phrase here"),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../chains/cosmos.js", () => ({
  getBech32Prefix: vi.fn().mockReturnValue("osmosis"),
  getGasPrice: vi.fn().mockReturnValue("0.025uosmo"),
  getGasPriceForDenom: vi.fn().mockReturnValue("0.025uosmo"),
  getStakeDecimals: vi.fn().mockReturnValue(6),
  getStakeDenom: vi.fn().mockReturnValue("OSMO"),
  getStakeMinimalDenom: vi.fn().mockReturnValue("uosmo"),
}));

vi.mock("@cosmjs/stargate", () => ({
  SigningStargateClient: { connectWithSigner: vi.fn() },
  StargateClient: {
    connect: vi.fn().mockResolvedValue({
      getAllBalances: vi
        .fn()
        .mockResolvedValue([{ denom: "uosmo", amount: "5000000" }]),
    }),
  },
  GasPrice: {
    fromString: vi.fn().mockReturnValue({ amount: "0.025", denom: "uosmo" }),
  },
  defaultRegistryTypes: [],
}));

vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: {
    fromMnemonic: vi.fn().mockResolvedValue({
      getAccounts: vi
        .fn()
        .mockResolvedValue([
          { address: "osmo1test123", pubkey: new Uint8Array(33) },
        ]),
    }),
  },
  Registry: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../utils/balance-formatter.js", () => ({
  formatBalances: vi.fn().mockReturnValue(mockFormatted),
}));

vi.mock("../../utils/ibc-resolver.js", () => ({
  enrichIbcDenoms: vi.fn().mockResolvedValue(mockFormatted),
}));

vi.mock("../../rpc/resolver.js", () => ({
  getRpcResolver: vi.fn().mockReturnValue({
    resolveEndpoint: vi
      .fn()
      .mockReturnValue({ url: "https://rpc.osmosis.zone", headers: undefined }),
  }),
}));

// Import after mocks
import { CosmosClient } from "../../clients/cosmos.js";
import { balanceEnricherRegistry } from "../../utils/balance-enricher.js";

const mockChain = {
  chainId: "osmosis-1",
  chainName: "Osmosis",
  rpc: "https://rpc.osmosis.zone",
} as never;

describe("CosmosClient.getBalances → enricher registry integration", () => {
  beforeEach(() => {
    balanceEnricherRegistry.clear();
  });

  it("should pass balances through balanceEnricherRegistry.enrich()", async () => {
    const enrichSpy = vi.spyOn(balanceEnricherRegistry, "enrich");
    const client = new CosmosClient("test mnemonic");

    await client.getBalances(mockChain);

    expect(enrichSpy).toHaveBeenCalledWith(mockFormatted, "osmosis-1");
    enrichSpy.mockRestore();
  });

  it("should return enricher-transformed balances", async () => {
    balanceEnricherRegistry.register({
      id: "test-enricher",
      chainIds: ["osmosis-1"],
      enrich: async (balances) =>
        balances.map((b) => ({ ...b, displayDenom: "ENRICHED" })),
    });

    const client = new CosmosClient("test mnemonic");
    const result = await client.getBalances(mockChain);

    expect(result[0].displayDenom).toBe("ENRICHED");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { KEPLR_CHAIN_MAP } from "../../rpc/keplr-chains.js";
import {
  _resetResolver,
  getRpcResolver,
  RpcResolver,
} from "../../rpc/resolver.js";

afterEach(() => {
  _resetResolver();
});

describe("RpcResolver", () => {
  describe("resolveEndpoint (RPC)", () => {
    it("should use chain override when available (highest priority)", () => {
      const resolver = new RpcResolver({
        overrides: { "cosmoshub-4": "https://my-rpc.example.com" },
        apiKey: "some-key",
      });
      const endpoint = resolver.resolveEndpoint(
        "cosmoshub-4",
        "https://cosmos-rpc.polkachu.com",
      );
      expect(endpoint.url).toBe("https://my-rpc.example.com");
      expect(endpoint.headers).toBeUndefined();
    });

    it("should use Keplr infra when apiKey is set for supported chain", () => {
      const resolver = new RpcResolver({ apiKey: "my-api-key" });
      const endpoint = resolver.resolveEndpoint(
        "cosmoshub-4",
        "https://cosmos-rpc.polkachu.com",
      );
      expect(endpoint.url).toBe("https://api.keplr.app/rpc/cosmoshub");
      expect(endpoint.headers).toEqual({
        "X-API-Key": "my-api-key",
        "X-Client-Type": "keplr-mcp",
      });
    });

    it("should fall back to fallbackUrl for unsupported chain even with apiKey", () => {
      const resolver = new RpcResolver({ apiKey: "my-api-key" });
      const fallback = "https://some-rpc.polkachu.com";
      // some-unknown-chain is not in KEPLR_CHAIN_MAP
      const endpoint = resolver.resolveEndpoint("some-unknown-chain", fallback);
      expect(endpoint.url).toBe(fallback);
      expect(endpoint.headers).toBeUndefined();
    });

    it("should fall back to fallbackUrl when no API key", () => {
      const resolver = new RpcResolver({});
      const fallback = "https://cosmos-rpc.polkachu.com";
      const endpoint = resolver.resolveEndpoint("cosmoshub-4", fallback);
      expect(endpoint.url).toBe(fallback);
      expect(endpoint.headers).toBeUndefined();
    });

    it("should throw when fallbackUrl is empty", () => {
      const resolver = new RpcResolver({});
      expect(() => resolver.resolveEndpoint("unknown-chain", "")).toThrow(
        "No RPC endpoint available for chain unknown-chain",
      );
    });

    it("should return different RPCs for different chains", () => {
      const resolver = new RpcResolver({});
      const cosmoshub = resolver.resolveEndpoint(
        "cosmoshub-4",
        "https://cosmos-rpc.polkachu.com",
      );
      const osmosis = resolver.resolveEndpoint(
        "osmosis-1",
        "https://rpc.osmosis.zone",
      );
      expect(cosmoshub.url).toBe("https://cosmos-rpc.polkachu.com");
      expect(osmosis.url).toBe("https://rpc.osmosis.zone");
      expect(cosmoshub.url).not.toBe(osmosis.url);
    });
  });

  describe("resolveLcdEndpoint (LCD)", () => {
    it("should use Keplr infra LCD when apiKey is set for supported chain", () => {
      const resolver = new RpcResolver({ apiKey: "test-key" });
      const endpoint = resolver.resolveLcdEndpoint(
        "osmosis-1",
        "https://lcd.osmosis.zone",
      );
      expect(endpoint.url).toBe("https://api.keplr.app/rest/osmosis");
      expect(endpoint.headers).toEqual({
        "X-API-Key": "test-key",
        "X-Client-Type": "keplr-mcp",
      });
    });

    it("should fall back to provided fallback URL for unsupported chain", () => {
      const resolver = new RpcResolver({ apiKey: "test-key" });
      const fallback = "https://some-lcd.publicnode.com";
      const endpoint = resolver.resolveLcdEndpoint(
        "some-unknown-chain",
        fallback,
      );
      expect(endpoint.url).toBe(fallback);
      expect(endpoint.headers).toBeUndefined();
    });

    it("should fall back to provided URL when no apiKey", () => {
      const resolver = new RpcResolver({});
      const fallback = "https://cosmos-rest.publicnode.com";
      const endpoint = resolver.resolveLcdEndpoint("cosmoshub-4", fallback);
      expect(endpoint.url).toBe(fallback);
      expect(endpoint.headers).toBeUndefined();
    });

    it("should throw when fallbackUrl is empty", () => {
      const resolver = new RpcResolver({});
      expect(() => resolver.resolveLcdEndpoint("unknown-chain", "")).toThrow(
        "No LCD endpoint available for chain unknown-chain",
      );
    });

    it("should skip Keplr LCD for excluded chains and use fallback", () => {
      // core-1 was previously the only LCD-excluded chain but is no longer in KEPLR_CHAIN_MAP.
      // The mechanism remains for future use; unsupported chains naturally fall back.
      const resolver = new RpcResolver({ apiKey: "test-key" });
      const fallback = "https://some-lcd.publicnode.com";
      const endpoint = resolver.resolveLcdEndpoint(
        "some-unknown-chain",
        fallback,
      );
      expect(endpoint.url).toBe(fallback);
      expect(endpoint.headers).toBeUndefined();
    });
  });

  describe("override priority", () => {
    it("RPC override should beat Keplr infra", () => {
      const resolver = new RpcResolver({
        apiKey: "key",
        overrides: { "osmosis-1": "https://custom-rpc.example.com" },
      });
      const endpoint = resolver.resolveEndpoint(
        "osmosis-1",
        "https://rpc.osmosis.zone",
      );
      expect(endpoint.url).toBe("https://custom-rpc.example.com");
      expect(endpoint.headers).toBeUndefined();
    });
  });
});

describe("KEPLR_CHAIN_MAP", () => {
  it("should contain 19 supported chains", () => {
    expect(Object.keys(KEPLR_CHAIN_MAP)).toHaveLength(19);
  });

  it("should map all chain IDs to non-empty names", () => {
    for (const [chainId, name] of Object.entries(KEPLR_CHAIN_MAP)) {
      expect(chainId).toBeTruthy();
      expect(name).toBeTruthy();
      expect(typeof name).toBe("string");
    }
  });

  it("should include key chains", () => {
    expect(KEPLR_CHAIN_MAP["cosmoshub-4"]).toBe("cosmoshub");
    expect(KEPLR_CHAIN_MAP["osmosis-1"]).toBe("osmosis");
    expect(KEPLR_CHAIN_MAP.celestia).toBe("celestia");
    expect(KEPLR_CHAIN_MAP["injective-1"]).toBe("injective");
  });
});

describe("getRpcResolver singleton", () => {
  it("should return the same instance on subsequent calls", () => {
    const resolver1 = getRpcResolver({ apiKey: "test" });
    const resolver2 = getRpcResolver();
    expect(resolver1).toBe(resolver2);
  });

  it("should reinitialize when first init had no config but second has apiKey", () => {
    const resolver1 = getRpcResolver();
    const fallback = "https://cosmos-rpc.polkachu.com";
    const endpoint1 = resolver1.resolveEndpoint("cosmoshub-4", fallback);
    expect(endpoint1.headers).toBeUndefined();

    const resolver2 = getRpcResolver({ apiKey: "new-key" });
    const endpoint2 = resolver2.resolveEndpoint("cosmoshub-4", fallback);
    expect(endpoint2.headers).toEqual({
      "X-API-Key": "new-key",
      "X-Client-Type": "keplr-mcp",
    });
  });

  it("should reset via _resetResolver", () => {
    const resolver1 = getRpcResolver({ apiKey: "first" });
    _resetResolver();
    const resolver2 = getRpcResolver({ apiKey: "second" });
    expect(resolver1).not.toBe(resolver2);

    const endpoint = resolver2.resolveEndpoint(
      "cosmoshub-4",
      "https://cosmos-rpc.polkachu.com",
    );
    expect(endpoint.headers).toEqual({
      "X-API-Key": "second",
      "X-Client-Type": "keplr-mcp",
    });
  });
});

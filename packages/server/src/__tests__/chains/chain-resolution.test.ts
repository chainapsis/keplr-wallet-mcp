import { describe, expect, it } from "vitest";
import { findAllChainsByName, findChainByName } from "../../chains/cosmos.js";
import { resolveChain } from "../../plugins/shared.js";

describe("findChainByName", () => {
  it("resolves 'nym' to the nyx chain (chainName 'Nym')", () => {
    const chain = findChainByName("nym");
    expect(chain).toBeDefined();
    expect(chain!.chainId).toBe("nyx");
    expect(chain!.chainName).toBe("Nym");
  });

  it("resolves 'terra' to the first matching chain", () => {
    const chain = findChainByName("terra");
    expect(chain).toBeDefined();
  });
});

describe("findAllChainsByName", () => {
  it("returns both columbus-5 and phoenix-1 for 'terra'", () => {
    const matches = findAllChainsByName("terra");
    const chainIds = matches.map((c) => c.chainId);
    expect(chainIds).toContain("columbus-5");
    expect(chainIds).toContain("phoenix-1");
    expect(matches.length).toBe(2);
  });

  it("returns only nyx for 'nym'", () => {
    const matches = findAllChainsByName("nym");
    expect(matches).toHaveLength(1);
    expect(matches[0].chainId).toBe("nyx");
  });
});

describe("resolveChain", () => {
  it("returns exact match for chain ID 'phoenix-1'", () => {
    const chain = resolveChain("phoenix-1");
    expect(chain.chainId).toBe("phoenix-1");
  });

  it("returns the chain for single-match name 'nym'", () => {
    const chain = resolveChain("nym");
    expect(chain.chainId).toBe("nyx");
  });

  it("throws Ambiguous chain error for 'terra'", () => {
    expect(() => resolveChain("terra")).toThrow(/Ambiguous chain/);
    expect(() => resolveChain("terra")).toThrow(/columbus-5/);
    expect(() => resolveChain("terra")).toThrow(/phoenix-1/);
    expect(() => resolveChain("terra")).toThrow(/list-cosmos-chains/);
  });

  it("throws Unknown chain error for nonexistent chain", () => {
    expect(() => resolveChain("nonexistent")).toThrow(/Unknown chain/);
    expect(() => resolveChain("nonexistent")).toThrow(/list-cosmos-chains/);
  });
});

import { describe, expect, it } from "vitest";
import { pickTip } from "../tips.js";

describe("pickTip", () => {
  it("returns a string starting with 💡 for known tools", () => {
    const tip = pickTip("get-balances");
    expect(tip).toBeDefined();
    expect(tip).toMatch(/^💡 /);
  });

  it("returns undefined for unknown tools", () => {
    expect(pickTip("nonexistent-tool")).toBeUndefined();
    expect(pickTip("")).toBeUndefined();
  });

  it("returns a tip from the pool for each known tool", () => {
    const knownTools = [
      "get-cosmos-address",
      "get-balances",
      "get-staking-info",
      "get-portfolio",
      "list-validators",
      "send-tokens",
      "ibc-transfer",
      "delegate",
      "undelegate",
      "redelegate",
      "claim-rewards",
      "claim-all-rewards",
      "vote-governance",
      "cosmwasm-execute",
      "cosmwasm-query",
      "osmosis-swap",
    ];

    for (const tool of knownTools) {
      const tip = pickTip(tool);
      expect(tip, `tool: ${tool}`).toBeDefined();
      expect(tip, `tool: ${tool}`).toMatch(/^💡 .+/);
    }
  });

  it("returns consistent format — non-empty text after prefix", () => {
    const tip = pickTip("claim-rewards");
    expect(tip).toBeDefined();
    const text = tip!.replace(/^💡 /, "");
    expect(text.length).toBeGreaterThan(0);
  });
});

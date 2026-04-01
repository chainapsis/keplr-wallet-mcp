import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../../plugins/meta/registry-data.js";
import { ToolIndex } from "../../../plugins/meta/tool-index.js";

describe("TOOL_REGISTRY", () => {
  it("should have valid categories", () => {
    const validCategories = [
      "account-management",
      "authentication",
      "transaction-confirm",
      "cosmos-query",
      "cosmos-transaction",
      "cosmwasm",
      "cosmos-signing",
      "evm-query",
      "evm-transaction",
      "evm-signing",
      "defi-osmosis",
      "defi-uniswap",
      "keplr-rpc",
      "meta",
    ];
    for (const entry of TOOL_REGISTRY) {
      expect(
        validCategories,
        `Invalid category: ${entry.category} for tool: ${entry.name}`,
      ).toContain(entry.category);
    }
  });

  it("should have valid ecosystems", () => {
    for (const entry of TOOL_REGISTRY) {
      expect(
        ["cosmos", "evm", "common"],
        `Invalid ecosystem for tool: ${entry.name}`,
      ).toContain(entry.ecosystem);
    }
  });

  it("should have valid risk levels", () => {
    for (const entry of TOOL_REGISTRY) {
      expect(
        ["safe", "destructive", "mixed"],
        `Invalid risk for tool: ${entry.name}`,
      ).toContain(entry.risk);
    }
  });

  it("should have no duplicate names", () => {
    const names = TOOL_REGISTRY.map((e) => e.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `Duplicate tool names: ${dupes.join(", ")}`).toHaveLength(0);
  });

  it("should be searchable via ToolIndex", () => {
    const index = new ToolIndex(TOOL_REGISTRY);
    const sendResults = index.search({ query: "send" });
    expect(sendResults.length).toBeGreaterThanOrEqual(1);

    const stakeResults = index.search({ query: "delegate" });
    expect(stakeResults.length).toBeGreaterThanOrEqual(1);

    const swapResults = index.search({ query: "swap" });
    expect(swapResults.length).toBeGreaterThanOrEqual(1);
  });
});

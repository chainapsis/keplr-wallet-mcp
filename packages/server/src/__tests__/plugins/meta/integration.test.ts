import { describe, expect, it, vi } from "vitest";
import metaToolsPlugin from "../../../plugins/meta/index.js";
import { TOOL_REGISTRY } from "../../../plugins/meta/registry-data.js";
import { ToolIndex } from "../../../plugins/meta/tool-index.js";

describe("Meta-tools Integration", () => {
  it("should register both meta-tools", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as any;
    await metaToolsPlugin.register(mockServer, {} as any);
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("registry should cover all expected categories", () => {
    const index = new ToolIndex(TOOL_REGISTRY);
    const cats = index.getCategories().map((c) => c.name);
    expect(cats).toContain("cosmos-query");
    expect(cats).toContain("cosmos-transaction");
    expect(cats).toContain("account-management");
  });

  it("common queries should return relevant results", () => {
    const index = new ToolIndex(TOOL_REGISTRY);

    const sendResults = index.search({ query: "send" });
    expect(sendResults.some((r) => r.name === "send-tokens")).toBe(true);

    const stakeResults = index.search({ query: "delegate" });
    expect(stakeResults.some((r) => r.name === "delegate")).toBe(true);

    const swapResults = index.search({ query: "swap" });
    expect(swapResults.length).toBeGreaterThan(0);

    const balanceResults = index.search({ query: "balance" });
    expect(balanceResults.length).toBeGreaterThanOrEqual(2);
  });
});

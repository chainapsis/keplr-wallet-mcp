import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../../plugins/meta/registry-data.js";
import { ToolIndex } from "../../../plugins/meta/tool-index.js";

describe("Meta-tools Integration", () => {
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

import { describe, expect, it, vi } from "vitest";
import metaToolsPlugin from "../../../plugins/meta/index.js";

describe("metaToolsPlugin", () => {
  it("should have correct name", () => {
    expect(metaToolsPlugin.name).toBe("meta-tools");
  });

  it("should register search-tools and describe-tools", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as any;
    const mockStore = {} as any;

    await metaToolsPlugin.register(mockServer, mockStore);

    const toolNames = registerTool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames).toContain("search-tools");
    expect(toolNames).toContain("describe-tools");
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("should register search-tools before describe-tools", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as any;
    const mockStore = {} as any;

    await metaToolsPlugin.register(mockServer, mockStore);

    const toolNames = registerTool.mock.calls.map((c: any[]) => c[0]);
    expect(toolNames.indexOf("search-tools")).toBeLessThan(
      toolNames.indexOf("describe-tools"),
    );
  });
});

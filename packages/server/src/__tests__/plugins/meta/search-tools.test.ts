import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { registerSearchTools } from "../../../plugins/meta/search-tools.js";

describe("search-tools registration", () => {
  it("should register the search-tools tool", () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0][0]).toBe("search-tools");
    const schema = registerTool.mock.calls[0][1];
    expect(schema.annotations?.readOnlyHint).toBe(true);
  });

  it("should return matching tools for a query", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ query: "send cosmos" }, {} as any);

    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]).toHaveProperty("name");
    expect(parsed.results[0]).toHaveProperty("description");
    expect(parsed.results[0]).toHaveProperty("category");
  });

  it("should include categories summary when no query", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({}, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.categories).toBeDefined();
    expect(parsed.categories.length).toBeGreaterThan(0);
  });

  it("should filter by ecosystem", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ ecosystem: "evm" }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    // Should NOT include cosmos-only categories
    const cosmosOnlyCategories = [
      "cosmos-query",
      "cosmos-transaction",
      "cosmwasm",
      "cosmos-signing",
      "defi-osmosis",
    ];
    for (const tool of parsed.results) {
      expect(
        cosmosOnlyCategories,
        `EVM filter should not include cosmos-only tool: ${tool.name} (${tool.category})`,
      ).not.toContain(tool.category);
    }
  });

  it("should filter by category", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ category: "cosmos-query" }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results.length).toBeGreaterThan(0);
    for (const tool of parsed.results) {
      expect(tool.category).toBe("cosmos-query");
    }
  });

  it("should provide hint about describe-tools", async () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ query: "send" }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toContain("describe-tools");
  });

  it("should auto-discover tools from plugins not in registry-data", async () => {
    const registerTool = vi.fn();
    const mockServer = {
      registerTool,
      _registeredTools: {
        "custom-plugin-tool": {
          description: "A tool from an external plugin",
        },
      },
    } as unknown as McpServer;

    registerSearchTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ query: "custom plugin" }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(
      parsed.results.some((r: any) => r.name === "custom-plugin-tool"),
    ).toBe(true);
  });
});

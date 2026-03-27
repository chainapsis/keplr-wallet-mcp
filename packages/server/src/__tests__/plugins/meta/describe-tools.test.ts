import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { registerDescribeTools } from "../../../plugins/meta/describe-tools.js";

describe("describe-tools registration", () => {
  it("should register the describe-tools tool", () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerDescribeTools(mockServer);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0][0]).toBe("describe-tools");
    const schema = registerTool.mock.calls[0][1];
    expect(schema.annotations?.readOnlyHint).toBe(true);
  });

  it("should return full details for known tools", async () => {
    const registerTool = vi.fn();
    // Simulate _registeredTools with a known tool that has inputSchema and description
    const mockServer = {
      registerTool,
      _registeredTools: {
        "send-tokens": {
          description: "Send tokens to another address",
          inputSchema: {
            shape: {
              chainId: { _def: { typeName: "ZodString" } },
              amount: { _def: { typeName: "ZodString" } },
            },
          },
          annotations: { readOnlyHint: false, destructiveHint: true },
          enabled: true,
        },
      },
    } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ names: ["send-tokens"] }, {} as any);

    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("send-tokens");
    expect(parsed.tools[0].description).toBeDefined();
    expect(parsed.tools[0].category).toBe("cosmos-transaction");
    expect(parsed.tools[0].risk).toBe("destructive");
  });

  it("should report notFound for unknown tools", async () => {
    const registerTool = vi.fn();
    const mockServer = {
      registerTool,
      _registeredTools: {},
    } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler(
      { names: ["nonexistent-tool", "also-fake"] },
      {} as any,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.notFound).toContain("nonexistent-tool");
    expect(parsed.notFound).toContain("also-fake");
    expect(parsed.tools).toHaveLength(0);
  });

  it("should return mix of found and not-found tools", async () => {
    const registerTool = vi.fn();
    const mockServer = {
      registerTool,
      _registeredTools: {
        "get-balances": {
          description: "Query token balances",
          inputSchema: null,
          annotations: { readOnlyHint: true },
          enabled: true,
        },
      },
    } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler(
      { names: ["get-balances", "nonexistent"] },
      {} as any,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("get-balances");
    expect(parsed.notFound).toContain("nonexistent");
  });

  it("should include live schema info when available from server", async () => {
    const registerTool = vi.fn();
    const mockServer = {
      registerTool,
      _registeredTools: {
        "send-tokens": {
          description: "Send tokens to another address",
          inputSchema: {
            shape: {
              chainId: { _def: { typeName: "ZodString" } },
              amount: { _def: { typeName: "ZodString" } },
            },
          },
          annotations: { readOnlyHint: false, destructiveHint: true },
          enabled: true,
        },
      },
    } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ names: ["send-tokens"] }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tools[0].liveSchema).toBeDefined();
    expect(parsed.tools[0].liveSchema.annotations).toBeDefined();
  });

  it("should require names parameter", () => {
    const registerTool = vi.fn();
    const mockServer = { registerTool } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const config = registerTool.mock.calls[0][1];
    expect(config.inputSchema.names).toBeDefined();
  });

  it("should auto-discover tools from plugins not in registry-data", async () => {
    const registerTool = vi.fn();
    const mockServer = {
      registerTool,
      _registeredTools: {
        "custom-plugin-tool": {
          description: "A tool from an external plugin",
          inputSchema: {
            shape: { param1: {} },
          },
          annotations: { readOnlyHint: true },
          enabled: true,
        },
      },
    } as unknown as McpServer;

    registerDescribeTools(mockServer);

    const handler = registerTool.mock.calls[0][2];
    const result = await handler({ names: ["custom-plugin-tool"] }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("custom-plugin-tool");
    expect(parsed.tools[0].category).toBe("uncategorized");
    expect(parsed.tools[0].liveSchema).toBeDefined();
    expect(parsed.tools[0].liveSchema.parameters).toContain("param1");
    expect(parsed.notFound).toHaveLength(0);
  });
});

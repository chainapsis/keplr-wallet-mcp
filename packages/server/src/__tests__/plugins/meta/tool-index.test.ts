import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import {
  buildLiveIndex,
  type ToolEntry,
  ToolIndex,
} from "../../../plugins/meta/tool-index.js";

describe("ToolIndex", () => {
  const entries: ToolEntry[] = [
    {
      name: "send-tokens",
      description: "Send tokens to another address",
      category: "cosmos-transaction",
      ecosystem: "cosmos",
      risk: "destructive",
      keywords: ["send", "transfer", "cosmos", "token"],
    },
    {
      name: "get-balances",
      description: "Query token balances",
      category: "cosmos-query",
      ecosystem: "cosmos",
      risk: "safe",
      keywords: ["balance", "query", "cosmos", "token"],
    },
    {
      name: "delegate",
      description: "Stake native tokens to a validator",
      category: "cosmos-transaction",
      ecosystem: "cosmos",
      risk: "destructive",
      keywords: ["stake", "delegate", "cosmos", "validator"],
    },
  ];

  const index = new ToolIndex(entries);

  describe("search", () => {
    it("should find tools by keyword", () => {
      const results = index.search({ query: "send" });
      expect(results).toHaveLength(1);
      expect(results.map((r) => r.name)).toContain("send-tokens");
    });

    it("should filter by ecosystem", () => {
      const results = index.search({ query: "cosmos", ecosystem: "cosmos" });
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name)).toContain("send-tokens");
      expect(results.map((r) => r.name)).toContain("get-balances");
      expect(results.map((r) => r.name)).toContain("delegate");
    });

    it("should filter by category", () => {
      const results = index.search({ category: "cosmos-query" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("get-balances");
    });

    it("should return all tools when no filters", () => {
      const results = index.search({});
      expect(results).toHaveLength(3);
    });

    it("should match partial keywords case-insensitively", () => {
      const results = index.search({ query: "BALANCE" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("get-balances");
    });

    it("should match tool name directly", () => {
      const results = index.search({ query: "delegate" });
      expect(results).toHaveLength(1);
    });

    it("should match description words", () => {
      const results = index.search({ query: "validator" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("delegate");
    });

    it("should use OR logic for multi-word queries", () => {
      // "send" matches send-tokens, "balance" matches get-balances, "stake" matches delegate
      const results = index.search({ query: "send balance stake" });
      expect(results).toHaveLength(3);
    });

    it("should rank results by match count (most matches first)", () => {
      // "send cosmos" — send-tokens matches both terms, delegate matches only "cosmos"
      const results = index.search({ query: "send cosmos" });
      expect(results[0].name).toBe("send-tokens");
    });
  });

  describe("getCategories", () => {
    it("should list all categories with counts", () => {
      const cats = index.getCategories();
      expect(cats).toHaveLength(2);
      expect(cats.find((c) => c.name === "cosmos-transaction")?.count).toBe(2);
    });
  });

  describe("getByName", () => {
    it("should return entry by exact name", () => {
      const entry = index.getByName("send-tokens");
      expect(entry?.category).toBe("cosmos-transaction");
    });

    it("should return undefined for unknown name", () => {
      expect(index.getByName("nonexistent")).toBeUndefined();
    });
  });

  describe("buildLiveIndex", () => {
    const staticRegistry: ToolEntry[] = [
      {
        name: "send-tokens",
        description: "Send tokens to another address",
        category: "cosmos-transaction",
        ecosystem: "cosmos",
        risk: "destructive",
        keywords: ["send", "transfer", "cosmos", "token"],
      },
    ];

    it("should include tools from _registeredTools not in static registry", () => {
      const server = {
        _registeredTools: {
          "send-tokens": { description: "Send tokens" },
          "custom-plugin-tool": {
            description: "A tool from an external plugin",
          },
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, staticRegistry);
      const results = liveIndex.search({});
      expect(results.map((r) => r.name)).toContain("custom-plugin-tool");
      expect(results.map((r) => r.name)).toContain("send-tokens");
    });

    it("should auto-categorize discovered tools as uncategorized", () => {
      const server = {
        _registeredTools: {
          "my-new-tool": { description: "Brand new tool" },
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, staticRegistry);
      const entry = liveIndex.getByName("my-new-tool");
      expect(entry).toBeDefined();
      expect(entry!.category).toBe("uncategorized");
      expect(entry!.ecosystem).toBe("common");
      expect(entry!.risk).toBe("mixed");
    });

    it("should prefer static registry metadata over auto-discovery", () => {
      const server = {
        _registeredTools: {
          "send-tokens": { description: "Different description" },
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, staticRegistry);
      const entry = liveIndex.getByName("send-tokens");
      expect(entry!.description).toBe("Send tokens to another address");
      expect(entry!.category).toBe("cosmos-transaction");
    });

    it("should include meta-tools themselves in discovery", () => {
      const server = {
        _registeredTools: {
          "search-tools": { description: "Search" },
          "describe-tools": { description: "Describe" },
          "real-tool": { description: "A real tool" },
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, []);
      const results = liveIndex.search({});
      expect(results.map((r) => r.name)).toContain("search-tools");
      expect(results.map((r) => r.name)).toContain("describe-tools");
      expect(results.map((r) => r.name)).toContain("real-tool");
    });

    it("should handle missing _registeredTools gracefully", () => {
      const server = {} as unknown as McpServer;
      const liveIndex = buildLiveIndex(server, staticRegistry);
      const results = liveIndex.search({});
      // No tools registered → no results, even if static registry has entries
      expect(results).toHaveLength(0);
    });

    it("should exclude static entries not registered at runtime", () => {
      const extendedStaticRegistry: ToolEntry[] = [
        ...staticRegistry,
        {
          name: "osmosis-swap",
          description: "Execute Osmosis DEX swap",
          category: "defi-osmosis",
          ecosystem: "cosmos",
          risk: "destructive",
          keywords: ["osmosis", "swap"],
        },
      ];
      const server = {
        _registeredTools: {
          "send-tokens": { description: "Send tokens" },
          // osmosis-swap is NOT registered (protocol plugin not loaded)
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, extendedStaticRegistry);
      const results = liveIndex.search({});
      expect(results.map((r) => r.name)).toContain("send-tokens");
      expect(results.map((r) => r.name)).not.toContain("osmosis-swap");
    });

    it("should use tool name parts as keywords for discovered tools", () => {
      const server = {
        _registeredTools: {
          "my-fancy-tool": { description: "Does fancy things" },
        },
      } as unknown as McpServer;

      const liveIndex = buildLiveIndex(server, []);
      const results = liveIndex.search({ query: "fancy" });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("my-fancy-tool");
    });
  });
});

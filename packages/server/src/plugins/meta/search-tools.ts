import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_REGISTRY } from "./registry-data.js";
import { buildLiveIndex } from "./tool-index.js";

export const registerSearchTools = (server: McpServer): void => {
  server.registerTool(
    "search-tools",
    {
      description:
        "Search available Keplr tools by keyword, category, or ecosystem. Use this first to discover which tools can help with your task.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            "Keyword search (e.g., 'send cosmos', 'swap', 'balance', 'stake')",
          ),
        category: z
          .string()
          .optional()
          .describe(
            "Filter by category (use without query to list all tools in category)",
          ),
        ecosystem: z
          .enum(["cosmos", "all"])
          .optional()
          .default("all")
          .describe("Filter by blockchain ecosystem"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const toolIndex = buildLiveIndex(server, TOOL_REGISTRY);

      const results = toolIndex.search({
        query: input.query,
        category: input.category,
        ecosystem: input.ecosystem,
      });

      const categories = toolIndex.getCategories();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                results,
                total: results.length,
                categories,
                hint:
                  results.length > 0
                    ? "Use describe-tools with specific tool names to get full usage details."
                    : "No tools found. Try broader keywords or check categories.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};

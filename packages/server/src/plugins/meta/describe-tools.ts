import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TOOL_REGISTRY } from "./registry-data.js";
import { buildLiveIndex } from "./tool-index.js";

/**
 * Attempt to extract serializable schema info from a registered tool's inputSchema.
 * The inputSchema is a Zod schema object; we extract shape keys and annotations.
 */
function extractLiveSchema(registeredTool: {
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  enabled?: boolean;
}): Record<string, unknown> | null {
  if (!registeredTool) return null;

  const live: Record<string, unknown> = {};

  if (registeredTool.description) {
    live.description = registeredTool.description;
  }

  if (registeredTool.annotations) {
    live.annotations = registeredTool.annotations;
  }

  if (registeredTool.inputSchema) {
    const schema = registeredTool.inputSchema as {
      shape?: Record<string, unknown>;
    };
    if (schema.shape) {
      live.parameters = Object.keys(schema.shape);
    }
  }

  live.enabled = registeredTool.enabled ?? true;

  return Object.keys(live).length > 0 ? live : null;
}

export const registerDescribeTools = (server: McpServer): void => {
  server.registerTool(
    "describe-tools",
    {
      description:
        "Get full details (description, parameters, category, risk level) for specific tools by name. Use after search-tools to get usage information.",
      inputSchema: {
        names: z
          .array(z.string())
          .describe("Tool names to describe (from search-tools results)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const toolIndex = buildLiveIndex(server, TOOL_REGISTRY);
      const tools: Record<string, unknown>[] = [];
      const notFound: string[] = [];

      // Access the McpServer's internal _registeredTools for live schema info
      const registeredTools =
        (server as unknown as { _registeredTools: Record<string, unknown> })
          ._registeredTools ?? {};

      for (const name of input.names) {
        const registryEntry = toolIndex.getByName(name);

        if (registryEntry) {
          const toolInfo: Record<string, unknown> = {
            name: registryEntry.name,
            description: registryEntry.description,
            category: registryEntry.category,
            ecosystem: registryEntry.ecosystem,
            risk: registryEntry.risk,
            keywords: registryEntry.keywords,
          };

          // Try to get live schema from registered tools
          const liveTool = registeredTools[name] as
            | {
                description?: string;
                inputSchema?: unknown;
                annotations?: Record<string, unknown>;
                enabled?: boolean;
              }
            | undefined;
          if (liveTool) {
            const liveSchema = extractLiveSchema(liveTool);
            if (liveSchema) {
              toolInfo.liveSchema = liveSchema;
            }
          }

          tools.push(toolInfo);
        } else {
          notFound.push(name);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                tools,
                notFound,
                hint:
                  notFound.length > 0
                    ? "Some tools were not found. Use search-tools to discover available tool names."
                    : undefined,
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

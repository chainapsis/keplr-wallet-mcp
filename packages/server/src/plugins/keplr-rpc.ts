import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { z } from "zod";
import type { SuggestedAction } from "../errors.js";
import { classifyError, formatClassifiedError } from "../errors.js";
import type { KeplrPlugin } from "./types.js";

// ─── HTTP Client ─────────────────────────────────────────────────────
const KEPLR_API_BASE = "https://api.keplr.app";

class KeplrApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KeplrApiError";
  }
}

const keplrApiFetch = async <T>(options: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}): Promise<T> => {
  const url = new URL(`${KEPLR_API_BASE}${options.path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {};
  if (options.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;

    if (res.status === 402)
      throw new KeplrApiError(402, `Insufficient credits: ${msg}`);
    if (res.status === 403)
      throw new KeplrApiError(403, `Invalid API key or unauthorized: ${msg}`);
    if (res.status === 404)
      throw new KeplrApiError(404, `Resource not found: ${msg}`);
    if (res.status === 429)
      throw new KeplrApiError(429, `Rate limit exceeded: ${msg}`);
    if (res.status >= 500)
      throw new KeplrApiError(
        res.status,
        `Server error (${res.status}): ${msg}`,
      );
    throw new KeplrApiError(
      res.status,
      `Request failed (${res.status}): ${msg}`,
    );
  }

  return (await res.json()) as T;
};

// ─── Response sanitization ──────────────────────────────────────────
/**
 * Remove internal/sensitive fields from API responses before returning to the agent.
 * - apiKeyId: internal DB identifier
 * - metadata on credit history entries: contains stripeSessionId, stripeCustomerEmail, etc.
 */
const sanitizeResponse = <T extends Record<string, unknown>>(data: T): T => {
  const cleaned = { ...data };
  delete (cleaned as Record<string, unknown>).apiKeyId;
  if (cleaned.history && typeof cleaned.history === "object") {
    const history = { ...(cleaned.history as Record<string, unknown>) };
    delete history.apiKeyId;

    // Strip metadata from credit history entries (contains Stripe PII)
    if (Array.isArray(history.entries)) {
      history.entries = (history.entries as Record<string, unknown>[]).map(
        ({ metadata: _, ...entry }) => entry,
      );
    }

    (cleaned as Record<string, unknown>).history = history;
  }
  return cleaned;
};

// ─── Error response helpers ─────────────────────────────────────────
const createKeplrSetupResponse = (toolName?: string) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(
        {
          status: "setup_required",
          message:
            "A valid Keplr Infra API key is required. Create one from the dashboard.",
          setupGuide: {
            dashboardUrl: "https://api.keplr.app",
            steps: [
              "Visit the Keplr API dashboard at https://api.keplr.app",
              "Create an API key",
              "Set it as KEPLR_RPC_API_KEY environment variable, or run `keplr_api_configure_key`",
            ],
          },
          attemptedAction: toolName,
        },
        null,
        2,
      ),
    },
  ],
});

const makeErrorResponse = (error: unknown, toolName?: string) => {
  // 403 → setup guide (not an error response)
  if (error instanceof KeplrApiError && error.status === 403) {
    return createKeplrSetupResponse(toolName);
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const classified = classifyError(err);
  const formatted = formatClassifiedError(classified);

  // Add payment link suggestion for 402 errors
  const extra: { suggestedActions?: SuggestedAction[] } = {};
  if (error instanceof KeplrApiError && error.status === 402) {
    extra.suggestedActions = [
      {
        tool: "keplr_api_get_payment_link",
        reason: "Add credits to your account",
        priority: 1,
      },
    ];
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ...formatted, ...extra }, null, 2),
      },
    ],
    isError: true as const,
  };
};

// ─── Client detection ───────────────────────────────────────────────
type McpClientType = "claude-code" | "claude-desktop" | "unknown";

const detectClientType = (server: Server): McpClientType => {
  const name = server.getClientVersion()?.name;
  switch (name) {
    case "claude-code":
      return "claude-code";
    case "claude-ai":
      return "claude-desktop";
    default:
      return "unknown";
  }
};

const findServerKey = (
  servers: Record<string, Record<string, unknown>>,
): string | null => {
  for (const [key, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== "object") continue;
    if (
      Array.isArray(entry.args) &&
      entry.args.some(
        (a: unknown) => typeof a === "string" && a.includes("keplr-wallet-mcp"),
      )
    )
      return key;
    if (
      typeof entry.command === "string" &&
      entry.command.includes("keplr-wallet-mcp")
    )
      return key;
  }
  return null;
};

// ─── Plugin ──────────────────────────────────────────────────────────
const keplrRpcPlugin: KeplrPlugin = {
  name: "keplr-rpc",

  register(server, _store) {
    // ── keplr_api_configure_key ────────────────────────────────────────
    server.registerTool(
      "keplr_api_configure_key",
      {
        description:
          "Configure a Keplr Infra API key. Validates the key, then saves it to the MCP configuration file " +
          "based on the detected client. Restart required after configuration.",
        inputSchema: {
          apiKey: z
            .string()
            .describe("Keplr Infra API key (starts with 'keplr_')"),
          scope: z
            .enum(["user", "project"])
            .optional()
            .describe(
              "Where to store the key (Claude Code only): 'user' for ~/.claude.json (all projects), " +
                "'project' for .mcp.json (this project only). Ignored for other clients.",
            ),
        },
      },
      async ({ apiKey, scope }) => {
        try {
          // Step 1: Detect client type (local-only, no network)
          const clientType = detectClientType(server.server);

          if (clientType === "unknown") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "unsupported_client",
                      message:
                        "This MCP client is not supported for automatic configuration. " +
                        "Set the KEPLR_RPC_API_KEY environment variable manually in your MCP client configuration.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Step 2: Validate the API key
          const validation = await keplrApiFetch<{ valid?: boolean }>({
            method: "POST",
            path: "/v1/keys/validate",
            body: { apiKey },
          });

          if (!validation.valid) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "invalid_key",
                      message:
                        "The provided API key is not valid. Get a key from https://api.keplr.app",
                      suggestedActions: [
                        {
                          tool: "keplr_api_list_chains",
                          reason: "Browse available chains (no key required)",
                          priority: 1,
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "keplr_api_get_usage_summary",
              reason: "Check your credit balance and usage",
              priority: 1,
            },
            {
              tool: "keplr_api_list_chains",
              reason: "See which chains are available",
              priority: 2,
            },
          ];

          const { homedir } = await import("node:os");
          const { readFileSync, writeFileSync, mkdirSync } = await import(
            "node:fs"
          );
          const { join, dirname } = await import("node:path");

          if (clientType === "claude-code") {
            // Claude Code — write to ~/.claude.json or .mcp.json based on scope
            const resolvedScope = scope ?? "user";
            const configPath =
              resolvedScope === "user"
                ? join(homedir(), ".claude.json")
                : join(process.cwd(), ".mcp.json");

            let config: Record<string, unknown> = {};
            let raw: string | undefined;
            try {
              raw = readFileSync(configPath, "utf-8");
            } catch {
              // File doesn't exist — start fresh
            }
            if (raw !== undefined) {
              try {
                config = JSON.parse(raw);
              } catch {
                throw new Error(
                  `Cannot parse ${configPath} — please fix the JSON syntax before configuring the API key.`,
                );
              }
            }

            if (!config.mcpServers || typeof config.mcpServers !== "object") {
              config.mcpServers = {};
            }
            const servers = config.mcpServers as Record<
              string,
              Record<string, unknown>
            >;
            if (!servers.keplr || typeof servers.keplr !== "object") {
              servers.keplr = {
                command: "npx",
                args: ["@keplr-wallet/keplr-wallet-mcp"],
              };
            }
            if (!servers.keplr.env || typeof servers.keplr.env !== "object") {
              servers.keplr.env = {};
            }
            (servers.keplr.env as Record<string, string>).KEPLR_RPC_API_KEY =
              apiKey;

            writeFileSync(
              configPath,
              `${JSON.stringify(config, null, 2)}\n`,
              "utf-8",
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "configured",
                      message: `API key saved to ${resolvedScope === "user" ? "~/.claude.json (user scope)" : ".mcp.json (project scope)"}.`,
                      configPath,
                      scope: resolvedScope,
                      restartRequired: true,
                      restartGuide:
                        "The API key will take effect after restarting the MCP server. " +
                        "Please exit Claude Code (/exit) and start a new session. " +
                        "Note: /mcp reconnect reuses the existing process and will NOT pick up the new environment variable.",
                      suggestedActions,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Claude Desktop — write to platform-specific config
          const home = homedir();
          const desktopConfigPath = (() => {
            switch (process.platform) {
              case "darwin":
                return join(
                  home,
                  "Library",
                  "Application Support",
                  "Claude",
                  "claude_desktop_config.json",
                );
              case "win32":
                return join(
                  process.env.APPDATA ?? join(home, "AppData", "Roaming"),
                  "Claude",
                  "claude_desktop_config.json",
                );
              case "linux":
                return join(
                  home,
                  ".config",
                  "Claude",
                  "claude_desktop_config.json",
                );
              default:
                throw new Error(`Unsupported platform: ${process.platform}`);
            }
          })();

          let config: Record<string, unknown> = {};
          let raw: string | undefined;
          try {
            raw = readFileSync(desktopConfigPath, "utf-8");
          } catch {
            // File doesn't exist — start fresh
          }
          if (raw !== undefined) {
            try {
              config = JSON.parse(raw);
            } catch {
              throw new Error(
                `Cannot parse ${desktopConfigPath} — please fix the JSON syntax before configuring the API key.`,
              );
            }
          }

          if (!config.mcpServers || typeof config.mcpServers !== "object") {
            config.mcpServers = {};
          }
          const servers = config.mcpServers as Record<
            string,
            Record<string, unknown>
          >;

          // Find existing keplr-wallet-mcp entry or create one
          let serverKey = findServerKey(servers);
          if (serverKey === null) {
            serverKey =
              !servers.keplr || typeof servers.keplr !== "object"
                ? "keplr"
                : "keplr-wallet-mcp";
          }
          if (!servers[serverKey] || typeof servers[serverKey] !== "object") {
            servers[serverKey] = {
              command: "npx",
              args: ["@keplr-wallet/keplr-wallet-mcp"],
            };
          }
          if (
            !servers[serverKey].env ||
            typeof servers[serverKey].env !== "object"
          ) {
            servers[serverKey].env = {};
          }
          (servers[serverKey].env as Record<string, string>).KEPLR_RPC_API_KEY =
            apiKey;

          mkdirSync(dirname(desktopConfigPath), { recursive: true });
          writeFileSync(
            desktopConfigPath,
            `${JSON.stringify(config, null, 2)}\n`,
            "utf-8",
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "configured",
                    message: "API key saved to Claude Desktop config.",
                    configPath: desktopConfigPath,
                    restartRequired: true,
                    restartGuide:
                      "Quit and reopen Claude Desktop to apply the new API key.",
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_configure_key");
        }
      },
    );

    // ── keplr_api_validate_key ──────────────────────────────────────────
    server.registerTool(
      "keplr_api_validate_key",
      {
        description: "Validate an existing Keplr Infra API key",
        inputSchema: {
          apiKey: z.string().describe("API key to validate"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ apiKey }) => {
        try {
          const data = await keplrApiFetch<Record<string, unknown>>({
            method: "POST",
            path: "/v1/keys/validate",
            body: { apiKey },
          });

          const valid = (data as { valid?: boolean }).valid;
          const suggestedActions: SuggestedAction[] = valid
            ? [
                {
                  tool: "keplr_api_get_usage_summary",
                  reason: "Check credits and usage",
                  priority: 1,
                },
                {
                  tool: "keplr_api_list_chains",
                  reason: "See available chains",
                  priority: 2,
                },
              ]
            : [
                {
                  tool: "keplr_api_list_chains",
                  reason: "Browse available chains (no key required)",
                  priority: 1,
                },
              ];

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...data, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_validate_key");
        }
      },
    );

    // ── keplr_api_get_payment_link ──────────────────────────────────────
    server.registerTool(
      "keplr_api_get_payment_link",
      {
        description: "Get a Stripe payment link to add credits",
        inputSchema: {
          apiKey: z.string().describe("API key"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ apiKey }) => {
        try {
          const data = await keplrApiFetch<Record<string, unknown>>({
            method: "GET",
            path: "/v1/credits/payment-link",
            query: { apiKey },
          });

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "keplr_api_get_credit_history",
              reason: "Verify exact credit top-up amount after payment",
              priority: 1,
            },
            {
              tool: "keplr_api_get_usage_summary",
              reason: "Check current balance and usage overview",
              priority: 2,
            },
          ];

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...data, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_get_payment_link");
        }
      },
    );

    // ── keplr_api_get_usage_summary ─────────────────────────────────────
    server.registerTool(
      "keplr_api_get_usage_summary",
      {
        description:
          "Get usage summary (balance, requests, credits, per-chain breakdown)",
        inputSchema: {
          apiKey: z.string().describe("API key"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ apiKey }) => {
        try {
          const raw = await keplrApiFetch<Record<string, unknown>>({
            method: "GET",
            path: `/v1/usage/${apiKey}/summary`,
            query: { clientType: "keplr-mcp" },
          });
          const data = sanitizeResponse(raw);

          const balance = (data as { balance?: number }).balance ?? 0;
          const lowBalance = balance > 0 && balance < 100_000;

          const suggestedActions: SuggestedAction[] = [];
          if (lowBalance) {
            suggestedActions.push({
              tool: "keplr_api_get_payment_link",
              reason: "Low balance — add credits",
              priority: 1,
            });
          }
          suggestedActions.push({
            tool: "keplr_api_get_usage_history",
            reason: "View detailed usage over time",
            priority: 2,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...data, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_get_usage_summary");
        }
      },
    );

    // ── keplr_api_get_usage_history ─────────────────────────────────────
    server.registerTool(
      "keplr_api_get_usage_history",
      {
        description:
          "Get usage history with optional date/chain/endpoint filters",
        inputSchema: {
          apiKey: z.string().describe("API key"),
          startDate: z.string().optional().describe("Start date (ISO format)"),
          endDate: z.string().optional().describe("End date (ISO format)"),
          chain: z.string().optional().describe("Filter by chain ID"),
          endpointType: z
            .string()
            .optional()
            .describe("Filter by endpoint type"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ apiKey, startDate, endDate, chain, endpointType }) => {
        try {
          const query: Record<string, string> = { clientType: "keplr-mcp" };
          if (startDate) query.startDate = startDate;
          if (endDate) query.endDate = endDate;
          if (chain) query.chain = chain;
          if (endpointType) query.endpointType = endpointType;

          const raw = await keplrApiFetch<Record<string, unknown>>({
            method: "GET",
            path: `/v1/usage/${apiKey}/history`,
            query: Object.keys(query).length > 0 ? query : undefined,
          });
          const data = sanitizeResponse(raw);

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "keplr_api_get_usage_summary",
              reason: "View aggregated usage summary",
              priority: 1,
            },
          ];

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...data, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_get_usage_history");
        }
      },
    );

    // ── keplr_api_get_credit_history ───────────────────────────────────
    server.registerTool(
      "keplr_api_get_credit_history",
      {
        description:
          "Get Keplr Infra credit transaction history (top-ups, adjustments). " +
          "Use this after payment to verify the exact credit amount added instead of comparing usage summaries.",
        inputSchema: {
          apiKey: z.string().describe("API key"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ apiKey }) => {
        try {
          const raw = await keplrApiFetch<Record<string, unknown>>({
            method: "GET",
            path: `/v1/credits/${apiKey}/history`,
          });
          const data = sanitizeResponse(raw);

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "keplr_api_get_usage_summary",
              reason: "View current balance and usage overview",
              priority: 1,
            },
          ];

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ...data, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_get_credit_history");
        }
      },
    );

    // ── keplr_api_list_chains ───────────────────────────────────────────
    server.registerTool(
      "keplr_api_list_chains",
      {
        description:
          "List all chains available on Keplr Infra (no auth required)",
        annotations: { readOnlyHint: true },
      },
      async () => {
        try {
          const data = await keplrApiFetch<Record<string, unknown>>({
            method: "GET",
            path: "/chainlist",
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          return makeErrorResponse(error, "keplr_api_list_chains");
        }
      },
    );
  },
};

export default keplrRpcPlugin;

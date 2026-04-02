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
/** Remove internal identifiers (e.g. apiKeyId) from API responses before returning to the agent. */
const stripInternalIds = <T extends Record<string, unknown>>(data: T): T => {
  const cleaned = { ...data };
  delete (cleaned as Record<string, unknown>).apiKeyId;
  if (cleaned.history && typeof cleaned.history === "object") {
    const history = { ...(cleaned.history as Record<string, unknown>) };
    delete history.apiKeyId;
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
              "Set it as KEPLR_RPC_API_KEY environment variable",
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

// ─── Plugin ──────────────────────────────────────────────────────────
const keplrRpcPlugin: KeplrPlugin = {
  name: "keplr-rpc",

  register(server, store) {
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
          const data = stripInternalIds(raw);

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
          const data = stripInternalIds(raw);

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
          const data = stripInternalIds(raw);

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockMcpServer, MockStore } from "../helpers/mocks.js";
import {
  createMockMcpServer,
  createMockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

// Dynamic import to avoid hoisting issues
let keplrRpcPlugin: typeof import("../../plugins/keplr-rpc.js").default;

beforeEach(async () => {
  keplrRpcPlugin = (await import("../../plugins/keplr-rpc.js")).default;
});

// ─── Fetch mock helpers ──────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ─── Shared setup ────────────────────────────────────────────────────
let server: MockMcpServer;
let store: MockStore;

beforeEach(async () => {
  server = createMockMcpServer();
  store = createMockStore({
    storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
  } as never);
  mockFetch.mockReset();
  await keplrRpcPlugin.register(server as never, store as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Registration ────────────────────────────────────────────────────
describe("keplr-rpc plugin registration", () => {
  it("should register all 5 tools", () => {
    const expected = [
      "keplr_api_validate_key",
      "keplr_api_get_payment_link",
      "keplr_api_get_usage_summary",
      "keplr_api_get_usage_history",
      "keplr_api_list_chains",
    ];
    for (const name of expected) {
      expect(
        server.getTool(name),
        `tool "${name}" not registered`,
      ).toBeDefined();
    }
  });
});

// ─── keplr_api_validate_key ─────────────────────────────────────────────────
describe("keplr_api_validate_key", () => {
  it("should validate key and return suggestedActions", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));
    const tool = server.getTool("keplr_api_validate_key")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("valid", true);
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "keplr_api_get_usage_summary",
          priority: 1,
        }),
        expect.objectContaining({ tool: "keplr_api_list_chains", priority: 2 }),
      ]),
    );
  });

  it("should return limited suggestedActions for invalid key", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ valid: false }));
    const tool = server.getTool("keplr_api_validate_key")!;
    const result = await tool.handler({ apiKey: "keplr_invalid" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("valid", false);
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "keplr_api_list_chains", priority: 1 }),
      ]),
    );
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "keplr_api_get_usage_summary" }),
      ]),
    );
  });
});

// ─── keplr_api_get_payment_link ─────────────────────────────────────────────
describe("keplr_api_get_payment_link", () => {
  it("should return payment link with suggestedActions", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({ url: "https://buy.stripe.com/test" }),
    );
    const tool = server.getTool("keplr_api_get_payment_link")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("url");
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "keplr_api_get_usage_summary",
          priority: 1,
        }),
      ]),
    );
  });
});

// ─── keplr_api_get_usage_summary ────────────────────────────────────────────
describe("keplr_api_get_usage_summary", () => {
  it("should return usage summary with suggestedActions", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        balance: 2000000,
        usage: {
          last7Days: { totalRequests: 500, totalCredits: 500 },
          byChain: [
            { chain: "cosmoshub-4", totalRequests: 300, totalCredits: 300 },
            { chain: "osmosis-1", totalRequests: 200, totalCredits: 200 },
          ],
        },
      }),
    );
    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("balance", 2000000);
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "keplr_api_get_usage_history",
          priority: 2,
        }),
      ]),
    );
  });

  it("should suggest payment link when balance is low", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        balance: 50000,
        usage: {
          last7Days: { totalRequests: 500, totalCredits: 500 },
          byChain: [],
        },
      }),
    );
    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "keplr_api_get_payment_link",
          priority: 1,
        }),
      ]),
    );
  });
});

// ─── keplr_api_get_usage_history ────────────────────────────────────────────
describe("keplr_api_get_usage_history", () => {
  it("should return usage history with suggestedActions", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        history: {
          apiKeyId: 8,
          startDate: "2025-01-01",
          endDate: "2025-01-07",
          data: [
            { date: "2025-01-01", requests: 100, credits: 10 },
            { date: "2025-01-02", requests: 200, credits: 20 },
          ],
        },
      }),
    );
    const tool = server.getTool("keplr_api_get_usage_history")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    const history = (parsed as { history: { data: unknown[] } }).history;
    expect(history).not.toHaveProperty("apiKeyId");
    expect(history).toHaveProperty("data");
    expect(Array.isArray(history.data)).toBe(true);
    expect(
      (parsed as { suggestedActions: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "keplr_api_get_usage_summary",
          priority: 1,
        }),
      ]),
    );
  });
});

// ─── keplr_api_list_chains ──────────────────────────────────────────────────
describe("keplr_api_list_chains", () => {
  it("should return chain list without suggestedActions", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        chains: [
          {
            chain: "cosmoshub",
            name: "Cosmos Hub",
            endpoints: {
              rpc: "https://api.keplr.app/rpc/cosmoshub",
              rest: "https://api.keplr.app/rest/cosmoshub",
            },
          },
          {
            chain: "osmosis",
            name: "Osmosis",
            endpoints: {
              rpc: "https://api.keplr.app/rpc/osmosis",
              rest: "https://api.keplr.app/rest/osmosis",
            },
          },
        ],
        total: 2,
      }),
    );
    const tool = server.getTool("keplr_api_list_chains")!;
    const result = await tool.handler({});
    const parsed = parseToolResponse(result);
    const chains = (parsed as { chains: Record<string, unknown>[] }).chains;
    expect(chains).toHaveLength(2);
    expect(chains[0]).toHaveProperty("chain");
    expect(chains[0]).toHaveProperty("name");
    expect(chains[0]).toHaveProperty("endpoints");
    expect(parsed).toHaveProperty("total", 2);
    expect(parsed).not.toHaveProperty("suggestedActions");
  });
});

// ─── HTTP Error Mapping ──────────────────────────────────────────────
describe("HTTP error mapping", () => {
  it("should map 402 to credit error with payment link suggestion", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(402, { error: "Insufficient credits" }),
    );
    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    expect(result).toHaveProperty("isError", true);
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("message");
    expect(
      (parsed as { suggestedActions?: unknown[] }).suggestedActions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "keplr_api_get_payment_link" }),
      ]),
    );
  });

  it("should map 403 to setup_required guide", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(403, { error: "Invalid API key" }),
    );
    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "bad-key" });
    expect(result).not.toHaveProperty("isError");
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "setup_required");
    expect(parsed).toHaveProperty("setupGuide");
    expect(
      (parsed as { setupGuide: { dashboardUrl: string } }).setupGuide
        .dashboardUrl,
    ).toBe("https://api.keplr.app");
  });

  it("should map 429 to rate limit error", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(429, { error: "Rate limit exceeded" }),
    );
    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    expect(result).toHaveProperty("isError", true);
    const parsed = parseToolResponse(result);
    expect((parsed as { message: string }).message).toMatch(/rate.?limit|429/i);
  });

  it("should map 5xx to server error", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, { error: "Internal Server Error" }),
    );
    const tool = server.getTool("keplr_api_list_chains")!;
    const result = await tool.handler({});
    expect(result).toHaveProperty("isError", true);
    const parsed = parseToolResponse(result);
    expect((parsed as { message: string }).message).toMatch(
      /server|500|error/i,
    );
  });
});

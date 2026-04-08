import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockMcpServer, MockStore } from "../helpers/mocks.js";
import {
  createMockMcpServer,
  createMockStore,
  parseToolResponse,
} from "../helpers/mocks.js";

// Passthrough wrappers — by default these call the real implementations.
// Individual describe blocks can override via mockImplementation/mockReturnValue;
// vi.restoreAllMocks() in afterEach restores the passthrough.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

const mockGetRpcResolver = vi.fn();
vi.mock("../../rpc/resolver.js", () => ({
  getRpcResolver: (...args: unknown[]) => mockGetRpcResolver(...args),
}));

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
  server = createMockMcpServer({ clientName: "claude-code" });
  store = createMockStore({
    storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
  } as never);
  mockFetch.mockReset();
  // Default: no API key configured in resolver
  mockGetRpcResolver.mockReturnValue({ apiKey: undefined, hasApiKey: false });
  await keplrRpcPlugin.register(server as never, store as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Registration ────────────────────────────────────────────────────
describe("keplr-rpc plugin registration", () => {
  it("should register all 7 tools", () => {
    const expected = [
      "keplr_api_configure_key",
      "keplr_api_validate_key",
      "keplr_api_get_payment_link",
      "keplr_api_get_usage_summary",
      "keplr_api_get_usage_history",
      "keplr_api_get_credit_history",
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

// ─── keplr_api_configure_key ────────────────────────────────────────────────
describe("keplr_api_configure_key", () => {
  it("should reject invalid API key without writing config", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ valid: false }));
    const tool = server.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({
      apiKey: "keplr_invalid",
      scope: "user",
    });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "invalid_key");
  });

  it("should configure valid key for project scope and write .mcp.json", async () => {
    const { join } = await import("node:path");
    const { unlinkSync } = await import("node:fs");
    const configPath = join(process.cwd(), ".mcp.json");

    // Mock validation success
    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));

    const tool = server.getTool("keplr_api_configure_key")!;
    try {
      const result = await tool.handler({
        apiKey: "keplr_valid123",
        scope: "project",
      });
      const parsed = parseToolResponse(result);
      expect(parsed).toHaveProperty("status", "configured");
      expect(parsed).toHaveProperty("scope", "project");
      expect(parsed).toHaveProperty("restartRequired", true);
      expect((parsed as { configPath: string }).configPath).toBe(configPath);
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

      // Verify the file was actually written with correct content
      const { readFileSync } = await import("node:fs");
      const written = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(written.mcpServers.keplr.env.KEPLR_RPC_API_KEY).toBe(
        "keplr_valid123",
      );
    } finally {
      try {
        unlinkSync(configPath);
      } catch {}
    }
  });
});

// ─── keplr_api_configure_key: multi-client ─────────────────────────────────
describe("keplr_api_configure_key multi-client", () => {
  const mockReadFileSync = vi.mocked(readFileSync);
  const mockWriteFileSync = vi.mocked(writeFileSync);
  const mockMkdirSync = vi.mocked(mkdirSync);
  const mockHomedir = vi.mocked(homedir);

  const desktopConfigPath = (() => {
    const home = "/mock-home";
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
      default:
        return join(home, ".config", "Claude", "claude_desktop_config.json");
    }
  })();

  beforeEach(() => {
    mockHomedir.mockReturnValue("/mock-home");
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    mockWriteFileSync.mockImplementation(() => undefined);
    mockMkdirSync.mockReturnValue(undefined as unknown as string);
  });

  it("should use default scope 'user' when scope is not provided (Claude Code)", async () => {
    const configPath = join("/mock-home", ".claude.json");

    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));
    const tool = server.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({ apiKey: "keplr_defaultscope" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "configured");
    expect(parsed).toHaveProperty("scope", "user");
    expect((parsed as { configPath: string }).configPath).toBe(configPath);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      configPath,
      expect.any(String),
      "utf-8",
    );
  });

  it("should write to Desktop config for Claude Desktop client", async () => {
    const desktopServer = createMockMcpServer({ clientName: "claude-ai" });
    const desktopStore = createMockStore({
      storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
    } as never);
    await keplrRpcPlugin.register(
      desktopServer as never,
      desktopStore as never,
    );

    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));
    const tool = desktopServer.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({ apiKey: "keplr_desktop123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "configured");
    expect(parsed).toHaveProperty("configPath", desktopConfigPath);
    expect(parsed).not.toHaveProperty("scope");
    expect((parsed as { restartGuide: string }).restartGuide).toMatch(
      /Claude Desktop/,
    );

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      desktopConfigPath,
      expect.any(String),
      "utf-8",
    );
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written.mcpServers.keplr.env.KEPLR_RPC_API_KEY).toBe(
      "keplr_desktop123",
    );
  });

  it("should ignore scope parameter for Claude Desktop", async () => {
    const desktopServer = createMockMcpServer({ clientName: "claude-ai" });
    const desktopStore = createMockStore({
      storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
    } as never);
    await keplrRpcPlugin.register(
      desktopServer as never,
      desktopStore as never,
    );

    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));
    const tool = desktopServer.getTool("keplr_api_configure_key")!;
    // Pass scope: "project" — should be ignored for Desktop
    const result = await tool.handler({
      apiKey: "keplr_desktop_scope",
      scope: "project",
    });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "configured");
    expect((parsed as { configPath: string }).configPath).toBe(
      desktopConfigPath,
    );
  });

  it("should use alternative key when 'keplr' key exists for another server (Desktop)", async () => {
    const desktopServer = createMockMcpServer({ clientName: "claude-ai" });
    const desktopStore = createMockStore({
      storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
    } as never);
    await keplrRpcPlugin.register(
      desktopServer as never,
      desktopStore as never,
    );

    // Pre-seed: readFileSync returns existing config with a "keplr" key for another server
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        mcpServers: {
          keplr: { command: "some-other-server", args: [] },
        },
      }),
    );

    mockFetch.mockResolvedValueOnce(okJson({ valid: true }));
    const tool = desktopServer.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({ apiKey: "keplr_conflict123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "configured");

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    // Original "keplr" key should be preserved
    expect(written.mcpServers.keplr.command).toBe("some-other-server");
    // New entry should use alternative key
    expect(written.mcpServers["keplr-wallet-mcp"].env.KEPLR_RPC_API_KEY).toBe(
      "keplr_conflict123",
    );
  });

  it("should return unsupported_client for unknown client", async () => {
    const unknownServer = createMockMcpServer({ clientName: "cursor-vscode" });
    const unknownStore = createMockStore({
      storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
    } as never);
    await keplrRpcPlugin.register(
      unknownServer as never,
      unknownStore as never,
    );

    const tool = unknownServer.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({ apiKey: "keplr_unknown123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "unsupported_client");
    expect(parsed).not.toHaveProperty("configPath");
    expect(parsed).not.toHaveProperty("manualSetup");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should return unsupported_client when no client info is available", async () => {
    const noClientServer = createMockMcpServer();
    const noClientStore = createMockStore({
      storePendingAction: vi.fn().mockReturnValue("mock-confirmation-token"),
    } as never);
    await keplrRpcPlugin.register(
      noClientServer as never,
      noClientStore as never,
    );

    const tool = noClientServer.getTool("keplr_api_configure_key")!;
    const result = await tool.handler({ apiKey: "keplr_noclient123" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "unsupported_client");
    expect(mockFetch).not.toHaveBeenCalled();
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
          tool: "keplr_api_get_credit_history",
          priority: 1,
        }),
        expect.objectContaining({
          tool: "keplr_api_get_usage_summary",
          priority: 2,
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

// ─── keplr_api_get_credit_history ───────────────────────────────────────────
describe("keplr_api_get_credit_history", () => {
  it("should return credit history with sensitive fields stripped", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        history: {
          apiKeyId: 1,
          entries: [
            {
              id: "2",
              type: "topup",
              amount: 10000000,
              balanceAfter: 10999500,
              description: "Stripe payment: 10.00 USD",
              metadata: {
                source: "stripe",
                stripeSessionId: "cs_live_xxx",
                stripeCustomerEmail: "user@example.com",
                stripePaymentIntent: "pi_xxx",
                amountCents: 1000,
                currency: "usd",
              },
              createdAt: "2025-03-05T14:30:00.000Z",
            },
          ],
        },
      }),
    );
    const tool = server.getTool("keplr_api_get_credit_history")!;
    const result = await tool.handler({ apiKey: "keplr_abc123" });
    const parsed = parseToolResponse(result);
    const history = (
      parsed as { history: { entries: Record<string, unknown>[] } }
    ).history;
    expect(history).not.toHaveProperty("apiKeyId");
    expect(history.entries).toHaveLength(1);
    // Verify metadata is stripped from entries
    expect(history.entries[0]).not.toHaveProperty("metadata");
    expect(history.entries[0]).toHaveProperty("amount", 10000000);
    expect(history.entries[0]).toHaveProperty("description");
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

// ─── API key auto-resolution ───────────────────────────────────────
describe("API key auto-resolution", () => {
  it("should auto-detect API key from resolver when not provided", async () => {
    mockGetRpcResolver.mockReturnValue({
      apiKey: "keplr_from_env",
      hasApiKey: true,
    });
    mockFetch.mockResolvedValueOnce(
      okJson({ balance: 1000000, usage: { last7Days: {}, byChain: [] } }),
    );

    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({});
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("balance", 1000000);

    // Verify the resolved key was used in the fetch URL
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain("keplr_from_env");
  });

  it("should prefer explicit API key over configured key", async () => {
    mockGetRpcResolver.mockReturnValue({
      apiKey: "keplr_from_env",
      hasApiKey: true,
    });
    mockFetch.mockResolvedValueOnce(
      okJson({ balance: 500000, usage: { last7Days: {}, byChain: [] } }),
    );

    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({ apiKey: "keplr_explicit" });
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("balance", 500000);

    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain("keplr_explicit");
    expect(fetchUrl).not.toContain("keplr_from_env");
  });

  it("should return setup guide when no API key is available", async () => {
    mockGetRpcResolver.mockReturnValue({ apiKey: undefined, hasApiKey: false });

    const tool = server.getTool("keplr_api_get_usage_summary")!;
    const result = await tool.handler({});
    const parsed = parseToolResponse(result);
    expect(parsed).toHaveProperty("status", "setup_required");
    expect(parsed).toHaveProperty("setupGuide");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeplrStore } from "../../store.js";
import { store } from "../../store.js";

// Mock the auth manager
vi.mock("../../auth/manager.js", () => ({
  getAuthManager: () => ({
    isAuthRequired: vi.fn().mockResolvedValue(false),
  }),
}));

// Mock auth config for security warning tests
const mockLoadAuthConfig = vi.fn();
vi.mock("../../auth/config.js", () => ({
  loadAuthConfig: (...args: unknown[]) => mockLoadAuthConfig(...args),
}));

// Mock executePending to avoid real transaction execution
const mockExecutePending = vi.fn();
vi.mock("../../pending-action.js", () => ({
  executePending: (...args: unknown[]) => mockExecutePending(...args),
}));

// Mock elicitation module
const mockSupportsFormElicitation = vi.fn();
const mockRequestTxConfirmation = vi.fn();
vi.mock("../../mcp-features/elicitation.js", () => ({
  supportsFormElicitation: (...args: unknown[]) =>
    mockSupportsFormElicitation(...args),
  requestTxConfirmation: (...args: unknown[]) =>
    mockRequestTxConfirmation(...args),
}));

// Mock progress reporter
vi.mock("../../mcp-features/progress.js", () => ({
  createProgressReporter: () => null,
  TX_PROGRESS: {
    PREPARING: { progress: 10, message: "Preparing..." },
    SIGNING: { progress: 30, message: "Signing..." },
    BROADCASTING: { progress: 60, message: "Broadcasting..." },
    WAITING: { progress: 80, message: "Waiting..." },
    CONFIRMED: { message: "Confirmed" },
  },
}));

/**
 * Helper: register confirm plugin and extract the handler for a given tool name.
 */
const getToolHandler = async (toolName: string) => {
  const { default: confirmPlugin } = await import("../../plugins/confirm.js");
  const tools = new Map<string, { handler: (...args: unknown[]) => unknown }>();
  const mockServer = {
    registerTool: (name: string, _schema: unknown, handler: unknown) => {
      tools.set(name, { handler: handler as (...args: unknown[]) => unknown });
    },
    server: {},
  } as unknown as McpServer;

  confirmPlugin.register(mockServer, store as unknown as KeplrStore);
  const tool = tools.get(toolName);
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler;
};

describe("Confirm Tools", () => {
  beforeEach(() => {
    // Clear pending transactions before each test
    store.setState({ pending: new Map() });
    vi.clearAllMocks();
  });

  describe("list-pending-actions", () => {
    it("should return empty list when no pending transactions", () => {
      const { pending } = store.getState();
      expect(pending.size).toBe(0);
    });

    it("should list pending transactions with truncated tokens", () => {
      const { storePending } = store.getState();

      // Store a pending transaction
      const token = storePending(
        "Send 1 ATOM to cosmos1abc...",
        "cosmoshub-4",
        async () => ({
          success: true,
        }),
      );

      // Check that it's in the store
      const entry = store.getState().pending.get(token);
      expect(entry).toBeDefined();
      expect(entry?.summary).toBe("Send 1 ATOM to cosmos1abc...");
      expect(entry?.chain).toBe("cosmoshub-4");
      expect(entry?.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("cancel-pending-action", () => {
    it("should remove a pending transaction from the store", async () => {
      const { storePending } = store.getState();

      // Store a pending transaction
      const token = storePending("Send 1 ATOM", "cosmoshub-4", async () => ({
        success: true,
      }));

      // Verify it exists
      expect(store.getState().pending.has(token)).toBe(true);

      // Cancel via actual tool handler
      const cancelHandler = await getToolHandler("cancel-pending-action");
      await cancelHandler({ confirmationToken: token });

      // Verify it's gone
      expect(store.getState().pending.has(token)).toBe(false);
    });

    it("should not throw when cancelling non-existent transaction", async () => {
      const cancelHandler = await getToolHandler("cancel-pending-action");
      // Should not throw for non-existent token
      await expect(
        cancelHandler({ confirmationToken: "fake-token-12345" }),
      ).resolves.not.toThrow();
    });
  });

  describe("security warning when auth disabled", () => {
    it("should include securityWarning in response when auth is disabled", async () => {
      mockLoadAuthConfig.mockResolvedValue({ enabled: false });
      mockExecutePending.mockResolvedValue({
        transactionHash: "AABB1234",
        code: 0,
      });

      // Store a pending transaction so the handler can find it
      const { storePending: sp } = store.getState();
      const token = sp("Send 1 ATOM", "cosmoshub-4", async () => ({}));

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token, authMethod: "auto" },
        { _meta: {} },
      )) as { content: { type: string; text: string }[] };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.securityWarning).toContain("Authentication is not enabled");
      expect(parsed.suggestedActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tool: "auth-enable" }),
        ]),
      );
    });

    it("should not include securityWarning when auth is enabled", async () => {
      mockLoadAuthConfig.mockResolvedValue({ enabled: true });
      mockExecutePending.mockResolvedValue({
        transactionHash: "AABB1234",
        code: 0,
      });

      const { storePending: sp } = store.getState();
      const token = sp("Send 1 ATOM", "cosmoshub-4", async () => ({}));

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token, authMethod: "auto" },
        { _meta: {} },
      )) as { content: { type: string; text: string }[] };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.securityWarning).toBeUndefined();
    });

    it("should still return tx result when loadAuthConfig throws", async () => {
      mockLoadAuthConfig.mockRejectedValue(new SyntaxError("Malformed JSON"));
      mockExecutePending.mockResolvedValue({
        transactionHash: "AABB1234",
        code: 0,
      });

      const { storePending: sp } = store.getState();
      const token = sp("Send 1 ATOM", "cosmoshub-4", async () => ({}));

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token, authMethod: "auto" },
        { _meta: {} },
      )) as { content: { type: string; text: string }[]; isError?: boolean };

      // Should NOT be an error response — tx succeeded
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.transactionHash).toBe("AABB1234");
    });
  });

  describe("elicitation gate", () => {
    beforeEach(() => {
      mockLoadAuthConfig.mockResolvedValue({ enabled: true });
      mockExecutePending.mockResolvedValue({
        transactionHash: "TX123",
        code: 0,
      });
      mockSupportsFormElicitation.mockReturnValue(false);
      mockRequestTxConfirmation.mockReset();
    });

    it("A3: should execute without error when elicitation is not supported", async () => {
      // Store a pending tx with elicitationSummary
      const { storePending: sp } = store.getState();
      const token = sp(
        "Send 1 ATOM",
        "cosmoshub-4",
        async () => ({}),
        undefined,
        "Send 1 ATOM to cosmos1abc...",
      );

      // Client does NOT support elicitation
      mockSupportsFormElicitation.mockReturnValue(false);

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token },
        { _meta: {} },
      )) as { content: { type: string; text: string }[]; isError?: boolean };

      // Should NOT be an error — gate is skipped
      expect(result.isError).toBeUndefined();
      expect(mockExecutePending).toHaveBeenCalledWith(token, undefined);
      expect(mockRequestTxConfirmation).not.toHaveBeenCalled();
    });

    it("A1: should execute when elicitation is supported and user approves", async () => {
      const { storePending: sp } = store.getState();
      const token = sp(
        "Send 1 ATOM",
        "cosmoshub-4",
        async () => ({}),
        undefined,
        "Send 1 ATOM to cosmos1abc...",
      );

      mockSupportsFormElicitation.mockReturnValue(true);
      mockRequestTxConfirmation.mockResolvedValue({ confirmed: true });

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token },
        { _meta: {} },
      )) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).toBeUndefined();
      expect(mockExecutePending).toHaveBeenCalledWith(token, undefined);
      expect(mockRequestTxConfirmation).toHaveBeenCalled();
    });

    it("A2: should return cancelled when elicitation is supported and user rejects", async () => {
      const { storePending: sp } = store.getState();
      const token = sp(
        "Send 1 ATOM",
        "cosmoshub-4",
        async () => ({}),
        undefined,
        "Send 1 ATOM to cosmos1abc...",
      );

      mockSupportsFormElicitation.mockReturnValue(true);
      mockRequestTxConfirmation.mockResolvedValue({ confirmed: false });

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token },
        { _meta: {} },
      )) as { content: { type: string; text: string }[]; isError?: boolean };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe("cancelled");
      expect(mockExecutePending).not.toHaveBeenCalled();
      // Pending token should be cleaned up on explicit cancellation
      expect(store.getState().pending.has(token)).toBe(false);
    });
  });

  describe("CosmWasm error handling in confirm-action", () => {
    it("should return structured CosmWasm error instead of gas misclassification", async () => {
      const cosmwasmError =
        "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`: query wasm contract failed: unknown request with gas used: '163969'";
      mockExecutePending.mockRejectedValue(new Error(cosmwasmError));

      const { storePending: sp } = store.getState();
      const token = sp(
        "Execute CosmWasm contract (unstake) on neutron-1",
        "neutron-1",
        async () => ({}),
      );

      const handler = await getToolHandler("confirm-action");
      const result = (await handler(
        { confirmationToken: token, authMethod: "auto" },
        { _meta: {} },
      )) as { content: { type: string; text: string }[]; isError?: boolean };

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.category).toBe("validation");
      expect(parsed.recoverable).toBe(false);
      expect(parsed.parsed).toBeDefined();
      expect(parsed.parsed.errorType).toBe("unknown_variant");
      expect(parsed.parsed.sentValue).toBe("unstake");
      expect(parsed.parsed.availableVariants).toContain("proxy");
      // Must NOT contain "Gas estimation failed"
      expect(parsed.suggestion).not.toContain("Gas estimation failed");
      expect(parsed.suggestedActions).toBeDefined();
      const execAction = parsed.suggestedActions.find(
        (a: { tool: string }) => a.tool === "cosmwasm-execute",
      );
      expect(execAction).toBeDefined();
    });
  });

  describe("pending transaction expiration", () => {
    it("should have correct TTL info", () => {
      const { storePending } = store.getState();
      const token = storePending("Test tx", "cosmoshub-4", async () => ({}));

      const entry = store.getState().pending.get(token);
      expect(entry).toBeDefined();

      // TTL should be ~5 minutes in the future
      const fiveMinutes = 5 * 60 * 1000;
      const now = Date.now();
      expect(entry!.expiresAt).toBeGreaterThan(now);
      expect(entry!.expiresAt).toBeLessThanOrEqual(now + fiveMinutes + 100); // small buffer
    });
  });
});

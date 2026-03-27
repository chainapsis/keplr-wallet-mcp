import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeplrStore } from "../../store.js";
import { store } from "../../store.js";

// --- Mocks ---

const mockAccountExists = vi.fn();
const mockGetAccountKeyProviderType = vi.fn();
const mockListAccounts = vi.fn();
const mockLoadMnemonicForAccount = vi.fn();

vi.mock("../../accounts.js", () => ({
  accountExists: (...args: unknown[]) => mockAccountExists(...args),
  addAccount: vi.fn(),
  checkVaultIntegrity: vi.fn(),
  deleteMnemonicForAccount: vi.fn(),
  getAccountKeyProviderType: (...args: unknown[]) =>
    mockGetAccountKeyProviderType(...args),
  listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  loadMnemonicForAccount: (...args: unknown[]) =>
    mockLoadMnemonicForAccount(...args),
  removeAccount: vi.fn(),
  renameAccount: vi.fn(),
  saveMnemonicForAccount: vi.fn(),
}));

const mockAuthenticate = vi.fn();
const mockIsAuthRequired = vi.fn().mockResolvedValue(false);
vi.mock("../../auth/manager.js", () => ({
  getAuthManager: () => ({
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
    isAuthRequired: (...args: unknown[]) => mockIsAuthRequired(...args),
    getTotpProvider: () => undefined,
  }),
}));

const mockRequestConfirmation = vi.fn();
vi.mock("../../mcp-features/elicitation.js", () => ({
  requestConfirmation: (...args: unknown[]) => mockRequestConfirmation(...args),
  elicitForm: vi.fn(),
  supportsFormElicitation: vi.fn().mockReturnValue(false),
}));

vi.mock("../../preferences.js", () => ({
  isFirstTimeUser: vi.fn().mockResolvedValue(false),
  loadPreferences: vi.fn().mockResolvedValue({}),
  markOnboardingCompleted: vi.fn(),
}));

vi.mock("../../store.js", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../store.js");
  // Patch storePendingAction onto the store instance
  const storeInstance = actual.store;
  const origGetState = storeInstance.getState.bind(storeInstance);
  const patchedGetState = () => {
    const state = origGetState();
    if (!state.storePendingAction) {
      (state as unknown as Record<string, unknown>).storePendingAction = (
        summary: string,
        execute: () => Promise<unknown>,
      ) => state.storePending(summary, "", execute);
    }
    return state;
  };
  (storeInstance as unknown as Record<string, unknown>).getState =
    patchedGetState;
  // Also add storePendingAction directly on store for direct access
  (storeInstance as unknown as Record<string, unknown>).storePendingAction = (
    summary: string,
    execute: () => Promise<unknown>,
  ) => storeInstance.getState().storePending(summary, "", execute);
  return {
    ...actual,
    store: storeInstance,
    getTtlInfo: () => ({
      expiresIn: "5 minutes",
      expiresAt: Date.now() + 5 * 60 * 1000,
      ttlWarning: "Token expires in 5 minutes",
    }),
  };
});

// --- Helper ---

type ToolHandler = (
  params: Record<string, unknown>,
  extra?: unknown,
) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

const getToolHandler = async (toolName: string): Promise<ToolHandler> => {
  const { default: accountsPlugin } = await import("../../plugins/accounts.js");
  const tools = new Map<string, { handler: ToolHandler }>();
  const mockServer = {
    registerTool: (name: string, _schema: unknown, handler: unknown) => {
      tools.set(name, { handler: handler as ToolHandler });
    },
    registerPrompt: vi.fn(),
    server: {},
  } as unknown as McpServer;

  accountsPlugin.register(mockServer, store as unknown as KeplrStore);
  const tool = tools.get(toolName);
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler;
};

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// --- Tests ---

describe("export-mnemonic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.setState({ pending: new Map() });
  });

  it("should export mnemonic for active account", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockLoadMnemonicForAccount.mockResolvedValue(TEST_MNEMONIC);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.mnemonic).toBe(TEST_MNEMONIC);
    expect(parsed.accountName).toBe("main");
    expect(parsed.wordCount).toBe(12);
    expect(parsed.securityWarnings).toHaveLength(4);
    expect(result.isError).toBeFalsy();
  });

  it("should export mnemonic for a named account", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: {
        main: { type: "mnemonic" },
        trading: { type: "mnemonic" },
      },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockLoadMnemonicForAccount.mockResolvedValue(TEST_MNEMONIC);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({ name: "trading" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.accountName).toBe("trading");
  });

  it("should return setup_required when no active account", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: null,
      accounts: {},
    });

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("setup_required");
  });

  it("should return error for non-existent account", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(false);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({ name: "nonexistent" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("does not exist");
    expect(result.isError).toBe(true);
  });

  it("should return error for non-mnemonic account (passkey)", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "pk-wallet",
      accounts: { "pk-wallet": { type: "passkey" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("passkey");

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({ name: "pk-wallet" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("passkey");
    expect(parsed.suggestedActions).toBeDefined();
    expect(result.isError).toBe(true);
  });

  it("should return error when vault decryption fails", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockLoadMnemonicForAccount.mockResolvedValue(null);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Failed to decrypt");
    expect(parsed.suggestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "check-vault-health" }),
      ]),
    );
    expect(result.isError).toBe(true);
  });

  it("should return cancelled when confirmation is declined", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(false);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("cancelled");
  });

  it("should fall back to pending_confirmation when elicitation is not supported", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(null);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("pending_confirmation");
    expect(parsed.confirmationToken).toBeDefined();
    expect(parsed.expiresIn).toBeDefined();
  });

  it("should return error when auth fails", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({
      success: false,
      error: "Session expired",
    });

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Authentication required");
    expect(parsed.suggestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "auth-available-methods" }),
      ]),
    );
    expect(result.isError).toBe(true);
  });

  it("should export mnemonic after successful auth", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true, sessionToken: "tok" });
    mockLoadMnemonicForAccount.mockResolvedValue(TEST_MNEMONIC);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.mnemonic).toBe(TEST_MNEMONIC);
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "export_mnemonic" }),
    );
  });

  it("should pass totpCode to authenticate when provided", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({ success: true });
    mockLoadMnemonicForAccount.mockResolvedValue(TEST_MNEMONIC);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({ totpCode: "123456" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "export_mnemonic",
        totpCode: "123456",
      }),
    );
  });

  it("should require re-auth after session expiry", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: { main: { type: "mnemonic" } },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(true);
    mockAuthenticate.mockResolvedValue({
      success: false,
      error: "Session expired. Please re-authenticate.",
      requiresInput: true,
    });

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({});

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Authentication required");
    expect(result.isError).toBe(true);
  });

  it("should bind confirmation token to the requested account name", async () => {
    mockListAccounts.mockResolvedValue({
      activeAccount: "main",
      accounts: {
        main: { type: "mnemonic" },
        savings: { type: "mnemonic" },
      },
    });
    mockAccountExists.mockResolvedValue(true);
    mockGetAccountKeyProviderType.mockResolvedValue("mnemonic");
    mockRequestConfirmation.mockResolvedValue(null);

    const handler = await getToolHandler("export-mnemonic");
    const result = await handler({ name: "savings" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("pending_confirmation");
    expect(parsed.summary).toContain("savings");
  });
});

/**
 * Handler-level tests for multi-action tools.
 *
 * Unlike multi-action.test.ts (store-level), these tests invoke
 * actual tool handlers through a mock MCP server to verify:
 * - TOCTOU defense at handler level (execute requires preview)
 * - isError flag on all error-state responses
 * - HIGH_RISK warnings in multi-action-add
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMcpServer,
  type MockMcpServer,
  parseToolResponse,
} from "../helpers/mocks.js";

// Mock accounts module before importing store
vi.mock("../../accounts.js", () => ({
  getActiveAccount: vi.fn().mockResolvedValue(null),
  getActiveAccountInfo: vi.fn().mockResolvedValue(null),
  getActiveMnemonic: vi.fn().mockResolvedValue(null),
  setActiveAccount: vi.fn().mockResolvedValue(undefined),
}));

const { store } = await import("../../store.js");
const { default: multiActionPlugin } = await import(
  "../../plugins/cosmos/multi-action.js"
);

interface MultiActionResponse {
  status: string;
  actionId?: string;
  message?: string;
  warnings?: Array<{ level: string; message: string }>;
  suggestedActions?: Array<{
    tool: string;
    reason: string;
    params?: Record<string, unknown>;
    priority: number;
  }>;
}

let mockServer: MockMcpServer;

const resetStore = () => {
  store.setState({
    adapters: new Map(),
    protocols: new Map(),
    clients: new Map(),
    mnemonicSource: null,
    pending: new Map(),
    pendingMultiActions: new Map(),
    activeAccount: null,
    transactionHistory: [],
    eventListeners: new Map(),
    globalEventListeners: new Set(),
  });
};

beforeEach(() => {
  resetStore();
  mockServer = createMockMcpServer();
  multiActionPlugin.register(mockServer as any, store.getState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TOCTOU defense at handler level", () => {
  it("should reject execute when preview has not been called", async () => {
    // Create and add action via store (setup)
    const actionId = store
      .getState()
      .createMultiAction("cosmoshub-4", "cosmos");
    store.getState().addMultiAction(actionId, {
      type: "send",
      params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
    });

    // Call execute handler without preview
    const executeTool = mockServer.getTool("multi-action-execute");
    const result = await executeTool!.handler({ actionId });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("error");
    expect(parsed.message).toContain("Preview is required before execution");
  });

  it("should reject add when session is locked after preview", async () => {
    const actionId = store
      .getState()
      .createMultiAction("cosmoshub-4", "cosmos");
    store.getState().addMultiAction(actionId, {
      type: "send",
      params: { recipientAddress: "cosmos1abc...", amount: "1000000" },
    });
    store.getState().markPreviewed(actionId);

    const addTool = mockServer.getTool("multi-action-add");
    const result = await addTool!.handler({
      actionId,
      type: "delegate",
      params: { validatorAddress: "cosmosvaloper1...", amount: "2000000" },
    });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("error");
    expect(parsed.message).toContain("locked after preview");
  });
});

describe("isError flag on error-state responses", () => {
  it("should set isError on multi-action-add not-found", async () => {
    const addTool = mockServer.getTool("multi-action-add");
    const result = await addTool!.handler({
      actionId: "non-existent",
      type: "send",
      params: { recipientAddress: "cosmos1...", amount: "1000000" },
    });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("error");
  });

  it("should set isError on multi-action-preview not-found", async () => {
    const previewTool = mockServer.getTool("multi-action-preview");
    const result = await previewTool!.handler({ actionId: "non-existent" });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("error");
  });

  it("should set isError on multi-action-preview empty-actions", async () => {
    const actionId = store
      .getState()
      .createMultiAction("cosmoshub-4", "cosmos");

    const previewTool = mockServer.getTool("multi-action-preview");
    const result = await previewTool!.handler({ actionId });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("empty");
  });

  it("should set isError on multi-action-execute not-found", async () => {
    const executeTool = mockServer.getTool("multi-action-execute");
    const result = await executeTool!.handler({ actionId: "non-existent" });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("error");
  });

  it("should set isError on multi-action-execute empty-actions", async () => {
    const actionId = store
      .getState()
      .createMultiAction("cosmoshub-4", "cosmos");
    store.getState().markPreviewed(actionId);

    const executeTool = mockServer.getTool("multi-action-execute");
    const result = await executeTool!.handler({ actionId });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("empty");
  });

  it("should set isError on multi-action-cancel not-found", async () => {
    const cancelTool = mockServer.getTool("multi-action-cancel");
    const result = await cancelTool!.handler({ actionId: "non-existent" });

    expect(result.isError).toBe(true);
    const parsed = parseToolResponse<MultiActionResponse>(result);
    expect(parsed.status).toBe("not_found");
  });
});

/**
 * Unit tests for cosmos-sign-arbitrary tool.
 *
 * Tests cover:
 * - Happy path: sign message with default chain
 * - No active account → setup error with suggestedActions
 * - Provider doesn't support ADR-36 → error
 * - Chain prefix resolution (osmosis-1 → osmo, injective-1 → inj)
 * - User rejection → status: "rejected"
 * - Unknown chain falls through to default "cosmos" prefix
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMcpServer,
  createMockStore,
  type MockMcpServer,
  type MockStore,
  parseToolResponse,
} from "../../helpers/mocks.js";

describe("cosmos-sign-arbitrary", () => {
  let mockServer: MockMcpServer;
  let mockStore: MockStore;
  let mockKeyProvider: {
    capabilities: { signTypes: string[] };
    displayName: string;
    getAddress: ReturnType<typeof vi.fn>;
    sign: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockServer = createMockMcpServer();

    mockKeyProvider = {
      capabilities: { signTypes: ["amino", "direct", "adr36"] },
      displayName: "Mnemonic Wallet",
      getAddress: vi.fn().mockResolvedValue("cosmos1abc123def456"),
      sign: vi.fn().mockResolvedValue({
        signature: new Uint8Array([1, 2, 3, 4]),
        publicKey: new Uint8Array([5, 6, 7, 8]),
      }),
    };

    mockStore = createMockStore();
    (mockStore as Record<string, unknown>).getKeyProvider = vi
      .fn()
      .mockResolvedValue(mockKeyProvider);

    const { default: signingPlugin } = await import(
      "../../../plugins/cosmos/signing.js"
    );
    signingPlugin.register(mockServer as any, mockStore as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should sign a message with default chain and return signature + pubkey + signDoc", async () => {
    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    expect(tool).toBeDefined();

    const result = await tool!.handler({ message: "Hello, Cosmos!" });
    const parsed = parseToolResponse<{
      status: string;
      signer: string;
      message: string;
      signature: {
        pub_key: { type: string; value: string };
        signature: string;
      };
      signDoc: {
        chain_id: string;
        account_number: string;
        sequence: string;
        fee: { gas: string; amount: unknown[] };
        msgs: Array<{
          type: string;
          value: { signer: string; data: string };
        }>;
        memo: string;
      };
      suggestedActions: Array<{
        tool: string;
        reason: string;
        priority: number;
      }>;
    }>(result);

    expect(parsed.status).toBe("success");
    expect(parsed.signer).toBe("cosmos1abc123def456");
    expect(parsed.message).toBe("Hello, Cosmos!");

    // Verify signature is base64-encoded
    expect(parsed.signature.signature).toBe(
      Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64"),
    );
    expect(parsed.signature.pub_key.type).toBe("tendermint/PubKeySecp256k1");
    expect(parsed.signature.pub_key.value).toBe(
      Buffer.from(new Uint8Array([5, 6, 7, 8])).toString("base64"),
    );

    // Verify signDoc is ADR-36 format
    expect(parsed.signDoc.chain_id).toBe("");
    expect(parsed.signDoc.account_number).toBe("0");
    expect(parsed.signDoc.sequence).toBe("0");
    expect(parsed.signDoc.fee.gas).toBe("0");
    expect(parsed.signDoc.fee.amount).toEqual([]);
    expect(parsed.signDoc.msgs).toHaveLength(1);
    expect(parsed.signDoc.msgs[0].type).toBe("sign/MsgSignData");
    expect(parsed.signDoc.msgs[0].value.signer).toBe("cosmos1abc123def456");
    expect(parsed.signDoc.memo).toBe("");

    // Verify suggestedActions
    expect(parsed.suggestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "cosmos-verify-signature",
          priority: 1,
        }),
      ]),
    );

    // Verify isError is not set on success
    expect(result.isError).toBeUndefined();

    // Verify provider was called with correct params (default chain = cosmoshub-4 → cosmos prefix)
    expect(mockKeyProvider.getAddress).toHaveBeenCalledWith({
      ecosystem: "cosmos",
      bech32Prefix: "cosmos",
    });
    expect(mockKeyProvider.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystem: "cosmos",
        signType: "adr36",
        signerAddress: "cosmos1abc123def456",
      }),
    );
  });

  it("should return setup error when no active account", async () => {
    (mockStore as Record<string, unknown>).getKeyProvider = vi
      .fn()
      .mockRejectedValue(new Error("No active account"));

    // Re-register with the updated store
    mockServer = createMockMcpServer();
    const { default: signingPlugin } = await import(
      "../../../plugins/cosmos/signing.js"
    );
    signingPlugin.register(mockServer as any, mockStore as any);

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({ message: "test" });
    const parsed = parseToolResponse<{
      status: string;
      message: string;
      suggestedActions: Array<{
        tool: string;
        reason: string;
        priority: number;
      }>;
    }>(result);

    expect(parsed.status).toBe("error");
    expect(parsed.message).toContain("No active account");
    expect(result.isError).toBe(true);

    // Verify suggestedActions include create-account and import-account
    expect(parsed.suggestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "create-account", priority: 1 }),
        expect.objectContaining({ tool: "import-account", priority: 2 }),
      ]),
    );
  });

  it("should return error when provider does not support ADR-36", async () => {
    mockKeyProvider.capabilities.signTypes = ["amino", "direct"];

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({ message: "test" });
    const parsed = parseToolResponse<{
      status: string;
      message: string;
    }>(result);

    expect(parsed.status).toBe("error");
    expect(parsed.message).toContain("does not support ADR-36");
    expect(parsed.message).toContain("Mnemonic Wallet");
    expect(result.isError).toBe(true);
  });

  it("should resolve osmosis-1 to osmo prefix", async () => {
    mockKeyProvider.getAddress.mockResolvedValue("osmo1xyz789");

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({
      message: "Hello Osmosis",
      chain: "osmosis-1",
    });
    const parsed = parseToolResponse<{ status: string; signer: string }>(
      result,
    );

    expect(parsed.status).toBe("success");
    expect(parsed.signer).toBe("osmo1xyz789");
    expect(mockKeyProvider.getAddress).toHaveBeenCalledWith({
      ecosystem: "cosmos",
      bech32Prefix: "osmo",
    });
  });

  it("should resolve injective-1 to inj prefix", async () => {
    mockKeyProvider.getAddress.mockResolvedValue("inj1abc123");

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({
      message: "Hello Injective",
      chain: "injective-1",
    });
    const parsed = parseToolResponse<{ status: string; signer: string }>(
      result,
    );

    expect(parsed.status).toBe("success");
    expect(parsed.signer).toBe("inj1abc123");
    expect(mockKeyProvider.getAddress).toHaveBeenCalledWith({
      ecosystem: "cosmos",
      bech32Prefix: "inj",
    });
  });

  it("should return status rejected when user denies signing", async () => {
    mockKeyProvider.sign.mockRejectedValue(
      new Error("Request rejected by user"),
    );

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({ message: "test" });
    const parsed = parseToolResponse<{
      status: string;
      message: string;
    }>(result);

    expect(parsed.status).toBe("rejected");
    expect(parsed.message).toContain("rejected by the user");
    // Rejection is not an isError response
    expect(result.isError).toBeUndefined();
  });

  it("should also detect 'denied' as user rejection", async () => {
    mockKeyProvider.sign.mockRejectedValue(
      new Error("User denied the request"),
    );

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({ message: "test" });
    const parsed = parseToolResponse<{ status: string }>(result);

    expect(parsed.status).toBe("rejected");
  });

  it("should also detect 'cancelled' as user rejection", async () => {
    mockKeyProvider.sign.mockRejectedValue(new Error("Operation cancelled"));

    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({ message: "test" });
    const parsed = parseToolResponse<{ status: string }>(result);

    expect(parsed.status).toBe("rejected");
  });

  it("should fall back to cosmos prefix for unknown chain", async () => {
    const tool = mockServer.getTool("cosmos-sign-arbitrary");
    const result = await tool!.handler({
      message: "test",
      chain: "unknown-chain-99",
    });
    const parsed = parseToolResponse<{ status: string }>(result);

    expect(parsed.status).toBe("success");
    expect(mockKeyProvider.getAddress).toHaveBeenCalledWith({
      ecosystem: "cosmos",
      bech32Prefix: "cosmos",
    });
  });
});

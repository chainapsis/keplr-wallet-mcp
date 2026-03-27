import { describe, expect, it } from "vitest";
import { CosmosAdapter } from "../../adapters/cosmos.js";
import { MnemonicKeyProvider } from "../../keys/providers/mnemonic.js";

// Valid test mnemonic from BIP39 test vectors (DO NOT use for real funds)
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("CosmosAdapter.createClientWithProvider", () => {
  const adapter = new CosmosAdapter();

  describe("with MnemonicKeyProvider", () => {
    it("should create client successfully", async () => {
      const provider = new MnemonicKeyProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      const client = await adapter.createClientWithProvider(provider);

      expect(client).toBeDefined();
      expect(typeof client.disconnect).toBe("function");
    });
  });

  describe("ecosystem compatibility check", () => {
    it("should succeed for provider that supports cosmos", async () => {
      const provider = new MnemonicKeyProvider({
        type: "mnemonic",
        mnemonic: TEST_MNEMONIC,
      });

      // Verify the provider claims to support cosmos
      expect(provider.getSupportedEcosystems()).toContain("cosmos");

      // Should succeed
      const client = await adapter.createClientWithProvider(provider);
      expect(client).toBeDefined();
    });
  });
});

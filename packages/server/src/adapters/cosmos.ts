import { CosmosClient } from "../clients/cosmos.js";
import type { EcosystemAdapter, EcosystemClient } from "../ecosystem.js";
import { adapterBridgeRegistry } from "../keys/adapter-bridge.js";
import { MnemonicKeyProvider } from "../keys/providers/mnemonic.js";
import type { KeyProvider } from "../keys/types.js";
import cosmosCosmwasmPlugin from "../plugins/cosmos/cosmwasm.js";
import cosmosMultiActionPlugin from "../plugins/cosmos/multi-action.js";
import cosmosQueryPlugin from "../plugins/cosmos/query.js";
import cosmosSigningPlugin from "../plugins/cosmos/signing.js";
import cosmosTransactionPlugin from "../plugins/cosmos/transaction.js";
import { resolveChain } from "../plugins/shared.js";

export class CosmosAdapter implements EcosystemAdapter {
  readonly type = "cosmos";
  readonly displayName = "Cosmos";

  /**
   * Create a client using a KeyProvider.
   *
   * This method uses a two-phase approach:
   * 1. First, try the AdapterBridgeRegistry for plug-and-play extensibility
   * 2. Fall back to instanceof checks for backward compatibility
   *
   * New KeyProvider types should register bridges in the adapterBridgeRegistry.
   * This eliminates the need to modify adapter code when adding new providers.
   */
  async createClientWithProvider(
    provider: KeyProvider,
  ): Promise<EcosystemClient> {
    // 1. Compatibility check - KeyProvider declares what it supports
    if (!provider.getSupportedEcosystems().includes("cosmos")) {
      throw new Error(
        `${provider.displayName} does not support Cosmos ecosystem`,
      );
    }

    // 2. Try the bridge registry first (plug-and-play approach)
    if (adapterBridgeRegistry.hasBridge(provider.type, this.type)) {
      try {
        return await adapterBridgeRegistry.createClient(provider, this);
      } catch (error) {
        // Log but fall through to instanceof fallback
        console.error(
          `[CosmosAdapter] Bridge failed for ${provider.type}, trying fallback:`,
          error,
        );
      }
    }

    // 3. Fallback: instanceof checks for backward compatibility
    if (provider instanceof MnemonicKeyProvider) {
      return this.createClient(provider.getMnemonic());
    }

    // 4. No bridge and no instanceof match - throw helpful error
    throw new Error(
      `Cosmos adapter does not yet support ${provider.type} provider. ` +
        `Register a bridge with adapterBridgeRegistry.register() to add support.`,
    );
  }

  createClient(mnemonic: string): CosmosClient {
    return new CosmosClient(mnemonic);
  }

  async getDisplayAddress(client: EcosystemClient): Promise<string> {
    if (client instanceof CosmosClient) {
      const chain = resolveChain("cosmoshub-4");
      return client.getAddress(chain);
    }
    throw new Error("Unknown client type");
  }

  getPlugins() {
    return [
      cosmosQueryPlugin,
      cosmosTransactionPlugin,
      cosmosSigningPlugin,
      cosmosCosmwasmPlugin,
      cosmosMultiActionPlugin,
    ];
  }
}

import type { KeyProvider } from "./keys/types.js";
import type { KeplrPlugin } from "./plugins/types.js";

export interface EcosystemClient {
  disconnect(): void | Promise<void>;
}

export interface EcosystemAdapter {
  readonly type: string;
  readonly displayName: string;
  /** SDK version this adapter was built against (for compatibility checking) */
  readonly sdkVersion?: string;

  /**
   * Create a client from a mnemonic.
   * @deprecated Use createClientWithProvider for new implementations.
   */
  createClient(mnemonic: string): EcosystemClient;

  /**
   * Create a client using a KeyProvider.
   * This is the preferred method for new implementations.
   * Optional for backward compatibility - if not implemented,
   * the legacy createClient will be used.
   *
   * The implementation should:
   * 1. Check if provider.getSupportedEcosystems() includes this adapter's type
   * 2. Use instanceof checks to delegate to appropriate client creation
   *
   * @param provider - KeyProvider instance for signing operations
   * @returns EcosystemClient for chain interactions
   */
  createClientWithProvider?(provider: KeyProvider): Promise<EcosystemClient>;

  /** Display address for generate-mnemonic output (optional) */
  getDisplayAddress?(client: EcosystemClient): string | Promise<string>;

  /** Get all addresses across supported chains (optional) */
  getAllAddresses?(client: EcosystemClient): Promise<Record<string, string>>;

  /** Plugins provided by this ecosystem */
  getPlugins(): KeplrPlugin[];

  /**
   * Optional initialization method called after adapter registration.
   * Used for loading custom chains or other async setup.
   */
  initialize?(): Promise<void>;
}

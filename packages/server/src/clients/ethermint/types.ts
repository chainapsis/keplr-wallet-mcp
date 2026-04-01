/**
 * Constants for ethermint-compatible chain support.
 *
 * Ethermint chains (Injective, Dymension) use custom account and pubkey types
 * that CosmJS's default parsers don't handle.
 */

/** Account typeUrls that wrap BaseAccount in EthAccount proto structure */
export const ETHERMINT_ACCOUNT_TYPE_URLS = [
  "/injective.types.v1beta1.EthAccount",
  "/ethermint.types.v1.EthAccount",
] as const;

export type EthermintAccountTypeUrl =
  (typeof ETHERMINT_ACCOUNT_TYPE_URLS)[number];

/**
 * Chain-specific ethsecp256k1 pubkey typeUrl overrides.
 * Key: chainId prefix, Value: pubkey typeUrl
 */
export const ETHERMINT_PUBKEY_TYPE_MAP: Record<string, string> = {
  injective: "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
  interwoven: "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
};

/** Default ethermint pubkey typeUrl for chains without a specific override */
export const DEFAULT_ETHERMINT_PUBKEY_TYPE_URL =
  "/ethermint.crypto.v1.ethsecp256k1.PubKey";

/**
 * ChainId prefixes known to use custom EthAccount types (verified via API).
 * Other eth-address-gen chains (ZetaChain, XPLA, Initia) use standard BaseAccount.
 */
export const ETHERMINT_SIGNING_CHAIN_PREFIXES = [
  "injective",
  "dymension",
  "xrplevm",
] as const;

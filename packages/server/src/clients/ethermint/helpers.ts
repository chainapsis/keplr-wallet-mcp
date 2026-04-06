import type { ChainInfo } from "@keplr-wallet/types";
import {
  DEFAULT_ETHERMINT_PUBKEY_TYPE_URL,
  ETHERMINT_PUBKEY_TYPE_MAP,
} from "./types.js";

/**
 * Whether a chain uses ethermint-style address derivation (keccak256).
 * Based on the "eth-address-gen" feature flag in ChainInfo.
 */
export const isEthermintLike = (chain: ChainInfo): boolean =>
  chain.features?.includes("eth-address-gen") ?? false;

/**
 * Whether a chain needs ethsecp256k1 signing infrastructure
 * (accountParser, LCD broadcast, fallback gas estimation).
 * Based on the "eth-key-sign" feature flag, matching the Keplr extension.
 */
export const needsEthermintSigning = (chain: ChainInfo): boolean =>
  chain.features?.includes("eth-key-sign") ?? false;

/**
 * Get the ethsecp256k1 pubkey typeUrl for a chain.
 * Resolution order: chainId prefix overrides → feature flag overrides → default.
 */
export const getEthermintPubkeyTypeUrl = (chain: ChainInfo): string => {
  for (const [prefix, typeUrl] of Object.entries(ETHERMINT_PUBKEY_TYPE_MAP)) {
    if (chain.chainId.startsWith(prefix)) return typeUrl;
  }
  if (chain.features?.includes("eth-secp256k1-cosmos")) {
    return "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";
  }
  if (chain.features?.includes("eth-secp256k1-initia")) {
    return "/initia.crypto.v1beta1.ethsecp256k1.PubKey";
  }
  return DEFAULT_ETHERMINT_PUBKEY_TYPE_URL;
};

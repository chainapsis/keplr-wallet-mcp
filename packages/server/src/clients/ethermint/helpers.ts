import type { ChainInfo } from "@keplr-wallet/types";
import {
  DEFAULT_ETHERMINT_PUBKEY_TYPE_URL,
  ETHERMINT_PUBKEY_TYPE_MAP,
  ETHERMINT_SIGNING_CHAIN_PREFIXES,
} from "./types.js";

/**
 * Whether a chain uses ethermint-style address derivation (keccak256).
 * Based on the "eth-address-gen" feature flag in ChainInfo.
 */
export const isEthermintLike = (chain: ChainInfo): boolean =>
  chain.features?.includes("eth-address-gen") ?? false;

/**
 * Whether a chain needs custom ethermint signing (accountParser + wallet).
 * Only chains with custom EthAccount types need this (Injective, Dymension, XRPL EVM).
 * Chains like ZetaChain/XPLA/Initia use standard BaseAccount despite having eth-address-gen.
 */
export const needsEthermintSigning = (chain: ChainInfo): boolean => {
  if (!isEthermintLike(chain)) return false;
  return ETHERMINT_SIGNING_CHAIN_PREFIXES.some((prefix) =>
    chain.chainId.startsWith(prefix),
  );
};

/**
 * Get the ethsecp256k1 pubkey typeUrl for a chain.
 * Injective uses its own variant; others use the standard ethermint type.
 */
export const getEthermintPubkeyTypeUrl = (chain: ChainInfo): string => {
  for (const [prefix, typeUrl] of Object.entries(ETHERMINT_PUBKEY_TYPE_MAP)) {
    if (chain.chainId.startsWith(prefix)) return typeUrl;
  }
  return DEFAULT_ETHERMINT_PUBKEY_TYPE_URL;
};

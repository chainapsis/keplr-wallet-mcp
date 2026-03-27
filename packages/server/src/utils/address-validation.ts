import { fromBech32 } from "@cosmjs/encoding";
import type { ChainInfo } from "@keplr-wallet/types";

/**
 * Validate that a bech32 address prefix matches the expected chain prefix.
 * Throws if the prefix does not match.
 */
export const validateAddressForChain = (
  address: string,
  chain: ChainInfo,
): void => {
  const { prefix } = fromBech32(address);
  const expected = chain.bech32Config?.bech32PrefixAccAddr;
  if (expected && prefix !== expected) {
    throw new Error(
      `Address prefix "${prefix}" does not match chain "${chain.chainId}" (expected "${expected}")`,
    );
  }
};

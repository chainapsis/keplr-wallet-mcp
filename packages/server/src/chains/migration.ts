/**
 * Chain Configuration Helpers
 *
 * Utilities for creating Keplr-compatible chain configurations.
 */

import { Bech32Address } from "@keplr-wallet/cosmos";
import type { Bech32Config, Currency, FeeCurrency } from "@keplr-wallet/types";
import { parseGasPriceStep } from "../types/currency.js";

/**
 * Create a Bech32Config from a prefix.
 *
 * Uses `Bech32Address.defaultBech32Config()` from @keplr-wallet/cosmos
 * for battle-tested Bech32 configuration generation.
 *
 * @param prefix - The base bech32 prefix (e.g., "cosmos", "osmo")
 * @returns Full Bech32Config with all address type prefixes
 */
export function createBech32Config(prefix: string): Bech32Config {
  return Bech32Address.defaultBech32Config(prefix);
}

/**
 * Create a Currency object.
 *
 * @param denom - Display denomination (e.g., "ATOM")
 * @param minimalDenom - Minimal denomination (e.g., "uatom")
 * @param decimals - Number of decimal places
 * @param coinGeckoId - Optional CoinGecko ID
 * @returns Currency object
 */
export function createCurrency(
  denom: string,
  minimalDenom: string,
  decimals: number,
  coinGeckoId?: string,
): Currency {
  return {
    coinDenom: denom,
    coinMinimalDenom: minimalDenom,
    coinDecimals: decimals,
    coinGeckoId,
  };
}

/**
 * Create a FeeCurrency from a Currency and gas price string.
 *
 * @param currency - Base currency
 * @param gasPriceStr - Gas price string (e.g., "0.025uatom")
 * @returns FeeCurrency with gas price step
 */
export function createFeeCurrencyFromGasPrice(
  currency: Currency,
  gasPriceStr: string,
): FeeCurrency {
  const gasPriceStep = parseGasPriceStep(gasPriceStr);

  return {
    ...currency,
    gasPriceStep,
  };
}

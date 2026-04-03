/**
 * Osmosis client for swap operations via Skip Routes API
 */

import { OSMOSIS_CHAIN_ID } from "./constants.js";
import {
  getSkipMsgsDirect,
  getSkipRoute,
  skipMsgToEncodeObject,
} from "./skip-api.js";
import { resolveOsmosisDenom } from "./skip-assets.js";

export interface QuoteParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
}

export interface QuoteResult {
  chainId: string;
  tokenIn: {
    denom: string;
    symbol: string;
    decimals: number;
    amount: string;
    displayAmount: string;
  };
  tokenOut: {
    denom: string;
    symbol: string;
    decimals: number;
    amount: string;
    displayAmount: string;
  };
  amountOutMin: string;
  amountOutMinDisplay: string;
  priceImpact: string;
  priceImpactPercent: number;
  route: string[];
  slippageBps: number;
  estimatedDurationSeconds?: number;
  usdAmountIn?: string;
  usdAmountOut?: string;
}

export interface SwapParams extends QuoteParams {
  sender: string;
}

/**
 * Convert human-readable amount to minimal denom string without floating-point loss.
 * e.g. toMinimalDenom("1.5", 18) → "1500000000000000000"
 */
export const toMinimalDenom = (amount: string, decimals: number): string => {
  if (!amount || !/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(
      `Invalid amount '${amount}': must be a non-negative decimal number (e.g., '10', '0.5')`,
    );
  }
  if (decimals < 0) {
    throw new Error(`Invalid decimals '${decimals}': must be non-negative`);
  }
  const [whole = "0", frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded).toString();
};

/**
 * Convert minimal denom string to human-readable display amount without floating-point loss.
 * e.g. toDisplayAmount("1500000000000000000", 18) → "1.5"
 */
export const toDisplayAmount = (
  minimalAmount: string,
  decimals: number,
): string => {
  if (!minimalAmount || !/^\d+$/.test(minimalAmount)) {
    throw new Error(
      `Invalid minimal amount '${minimalAmount}': must be a non-negative integer string`,
    );
  }
  if (decimals < 0) {
    throw new Error(`Invalid decimals '${decimals}': must be non-negative`);
  }
  if (decimals === 0) return minimalAmount;
  const padded = minimalAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};

export class OsmosisClient {
  /**
   * Get a swap quote via Skip Routes API
   */
  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const { tokenIn, tokenOut, amountIn, slippageBps = 50 } = params;

    const tokenInResolved = await resolveOsmosisDenom(tokenIn);
    const tokenOutResolved = await resolveOsmosisDenom(tokenOut);

    const amountInMinimal = toMinimalDenom(amountIn, tokenInResolved.decimals);

    const routeResponse = await getSkipRoute({
      source_asset_denom: tokenInResolved.denom,
      source_asset_chain_id: OSMOSIS_CHAIN_ID,
      dest_asset_denom: tokenOutResolved.denom,
      dest_asset_chain_id: OSMOSIS_CHAIN_ID,
      amount_in: amountInMinimal,
    });

    // Apply slippage: slippageBps / 100 → percent string for min calculation
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const amountOutBigInt = BigInt(routeResponse.amount_out);
    const amountOutMin = (amountOutBigInt * slippageMultiplier) / BigInt(10000);

    if (amountOutMin <= 0n) {
      throw new Error(
        `Invalid swap: minimum output is ${amountOutMin}. ` +
          `Slippage too high or output amount too small.`,
      );
    }

    const amountOutDisplay = toDisplayAmount(
      routeResponse.amount_out,
      tokenOutResolved.decimals,
    );
    const amountOutMinDisplay = toDisplayAmount(
      amountOutMin.toString(),
      tokenOutResolved.decimals,
    );

    // Build route description from operations
    const route = [tokenInResolved.symbol];
    for (const op of routeResponse.operations) {
      if (op.swap?.swap_in?.swap_venue) {
        route.push(op.swap.swap_in.swap_venue.name);
      }
    }
    route.push(tokenOutResolved.symbol);

    return {
      chainId: OSMOSIS_CHAIN_ID,
      tokenIn: {
        denom: tokenInResolved.denom,
        symbol: tokenInResolved.symbol,
        decimals: tokenInResolved.decimals,
        amount: amountInMinimal,
        displayAmount: amountIn,
      },
      tokenOut: {
        denom: tokenOutResolved.denom,
        symbol: tokenOutResolved.symbol,
        decimals: tokenOutResolved.decimals,
        amount: routeResponse.amount_out,
        displayAmount: amountOutDisplay,
      },
      amountOutMin: amountOutMin.toString(),
      amountOutMinDisplay,
      priceImpact: (() => {
        if (!routeResponse.swap_price_impact_percent) return "unknown";
        const parsed = Number.parseFloat(
          routeResponse.swap_price_impact_percent,
        );
        return Number.isNaN(parsed)
          ? "unknown"
          : `${routeResponse.swap_price_impact_percent}%`;
      })(),
      priceImpactPercent: (() => {
        if (!routeResponse.swap_price_impact_percent) return 0;
        const parsed = Number.parseFloat(
          routeResponse.swap_price_impact_percent,
        );
        return Number.isNaN(parsed) ? 0 : parsed;
      })(),
      route,
      slippageBps,
      estimatedDurationSeconds: routeResponse.estimated_route_duration_seconds,
      usdAmountIn: routeResponse.usd_amount_in,
      usdAmountOut: routeResponse.usd_amount_out,
    };
  }

  /**
   * Build swap messages via Skip msgs_direct API
   */
  async buildSwapMessages(
    params: SwapParams & { slippagePercent?: string },
  ): Promise<Array<{ typeUrl: string; value: unknown }>> {
    const { tokenIn, tokenOut, amountIn, sender, slippageBps = 50 } = params;

    const tokenInResolved = await resolveOsmosisDenom(tokenIn);
    const tokenOutResolved = await resolveOsmosisDenom(tokenOut);

    const amountInMinimal = toMinimalDenom(amountIn, tokenInResolved.decimals);

    // Convert bps to percent string: 50 bps → "0.5"
    const slippagePercent =
      params.slippagePercent ?? (slippageBps / 100).toString();

    const response = await getSkipMsgsDirect({
      source_asset_denom: tokenInResolved.denom,
      source_asset_chain_id: OSMOSIS_CHAIN_ID,
      dest_asset_denom: tokenOutResolved.denom,
      dest_asset_chain_id: OSMOSIS_CHAIN_ID,
      amount_in: amountInMinimal,
      chain_ids_to_addresses: { [OSMOSIS_CHAIN_ID]: sender },
      slippage_tolerance_percent: slippagePercent,
    });

    return response.msgs.map((m) => skipMsgToEncodeObject(m.multi_chain_msg));
  }
}

// Singleton instance
let client: OsmosisClient | null = null;

export const getOsmosisClient = (): OsmosisClient => {
  if (!client) {
    client = new OsmosisClient();
  }
  return client;
};

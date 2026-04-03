/**
 * Smoke tests for Skip API real responses.
 * These tests call the actual Skip API and validate response structures.
 */

import { describe, expect, it } from "vitest";
import {
  getSkipMsgsDirect,
  getSkipRoute,
  skipMsgToEncodeObject,
} from "../../../../plugins/cosmos/osmosis/skip-api.js";
import { resolveOsmosisDenom } from "../../../../plugins/cosmos/osmosis/skip-assets.js";

const OSMOSIS = "osmosis-1";

// Valid bech32 address for Osmosis (derived from a known test mnemonic, no funds)
const TEST_ADDRESS = "osmo1cyyzpxplxdzkeea7kwsydadg87357qnahakaks";

// Helper to resolve a pair
const resolvePair = async (tokenIn: string, tokenOut: string) => {
  const inResolved = await resolveOsmosisDenom(tokenIn);
  const outResolved = await resolveOsmosisDenom(tokenOut);
  return { inResolved, outResolved };
};

describe("Skip API smoke tests", { timeout: 30000 }, () => {
  describe("route responses", () => {
    it("OSMO → ATOM (basic)", async () => {
      const { inResolved, outResolved } = await resolvePair("OSMO", "ATOM");

      const route = await getSkipRoute({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "10000000", // 10 OSMO
      });

      expect(route.amount_in).toBe("10000000");
      expect(route.amount_out).toBeDefined();
      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
      expect(route.does_swap).toBe(true);
      expect(route.chain_ids).toContain(OSMOSIS);
    });

    it("OSMO → USDC (basic)", async () => {
      const { inResolved, outResolved } = await resolvePair("OSMO", "USDC");

      const route = await getSkipRoute({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "10000000",
      });

      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
      expect(route.operations.length).toBeGreaterThanOrEqual(1);
    });

    it("milkTIA → USDC (factory token)", async () => {
      const resolved = await resolveOsmosisDenom("milkTIA");
      expect(resolved.denom).toContain("factory/");

      const outResolved = await resolveOsmosisDenom("USDC");
      const route = await getSkipRoute({
        source_asset_denom: resolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "1000000", // 1 milkTIA
      });

      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
    });

    it("NTRN → OSMO (IBC token)", async () => {
      const { inResolved, outResolved } = await resolvePair("NTRN", "OSMO");

      const route = await getSkipRoute({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "1000000",
      });

      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
    });

    it("allBTC → USDC (alloyed factory)", async () => {
      const { inResolved, outResolved } = await resolvePair("allBTC", "USDC");
      expect(inResolved.denom).toContain("factory/");

      const route = await getSkipRoute({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "100000", // 0.001 BTC (8 decimals)
      });

      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
    });
  });

  describe("msgs_direct responses", () => {
    it("OSMO → ATOM msgs_direct", async () => {
      const { inResolved, outResolved } = await resolvePair("OSMO", "ATOM");

      const response = await getSkipMsgsDirect({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "10000000",
        chain_ids_to_addresses: { [OSMOSIS]: TEST_ADDRESS },
        slippage_tolerance_percent: "0.5",
      });

      expect(response.msgs.length).toBeGreaterThanOrEqual(1);

      for (const m of response.msgs) {
        const { multi_chain_msg: msg } = m;
        expect(msg.chain_id).toBe(OSMOSIS);
        expect(msg.msg_type_url).toBeTruthy();

        // Validate JSON is parseable and msg_type_url matches if @type present
        const parsed = JSON.parse(msg.msg);
        if (parsed["@type"]) {
          expect(parsed["@type"]).toBe(msg.msg_type_url);
        }
      }
    });
  });

  describe("skipMsgToEncodeObject with real data", () => {
    it("should convert real msgs_direct response", async () => {
      const { inResolved, outResolved } = await resolvePair("OSMO", "ATOM");

      const response = await getSkipMsgsDirect({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "10000000",
        chain_ids_to_addresses: { [OSMOSIS]: TEST_ADDRESS },
        slippage_tolerance_percent: "0.5",
      });

      for (const m of response.msgs) {
        const encodeObject = skipMsgToEncodeObject(m.multi_chain_msg);

        expect(encodeObject.typeUrl).toBe(m.multi_chain_msg.msg_type_url);
        expect(encodeObject.value).toBeDefined();
        expect(encodeObject.value).not.toHaveProperty("@type");
        expect(encodeObject.typeUrl).toMatch(/^\//);
      }
    });
  });

  describe("multi-hop routing", () => {
    it("should return route for indirect pairs", async () => {
      // stATOM → USDC likely requires multi-hop
      const { inResolved, outResolved } = await resolvePair("stATOM", "USDC");

      const route = await getSkipRoute({
        source_asset_denom: inResolved.denom,
        source_asset_chain_id: OSMOSIS,
        dest_asset_denom: outResolved.denom,
        dest_asset_chain_id: OSMOSIS,
        amount_in: "1000000",
      });

      expect(route.operations.length).toBeGreaterThanOrEqual(1);
      expect(BigInt(route.amount_out)).toBeGreaterThan(0n);
    });
  });
});

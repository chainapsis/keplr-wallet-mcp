import { describe, expect, it } from "vitest";
import {
  getOsmosisRest,
  OSMOSIS_CHAIN_ID,
  SLIPPAGE_BPS_SCHEMA,
} from "../constants.js";

describe("Constants", () => {
  it("should have correct Osmosis chain ID", () => {
    expect(OSMOSIS_CHAIN_ID).toBe("osmosis-1");
  });

  it("should resolve REST endpoint via resolver", () => {
    const rest = getOsmosisRest();
    expect(rest.url).toMatch(/https?:\/\//);
  });
});

describe("SLIPPAGE_BPS_SCHEMA", () => {
  it("should accept valid values", () => {
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(50).success).toBe(true);
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(1).success).toBe(true);
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(500).success).toBe(true);
  });

  it("should reject invalid values", () => {
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(0).success).toBe(false);
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(501).success).toBe(false);
    expect(SLIPPAGE_BPS_SCHEMA.safeParse(-1).success).toBe(false);
  });

  it("should default to 50 when undefined", () => {
    const result = SLIPPAGE_BPS_SCHEMA.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(50);
  });
});

import { describe, expect, it } from "vitest";
import { getTokenDecimals } from "../../types/currency.js";

describe("getTokenDecimals", () => {
  describe("known 18-decimal denoms", () => {
    it.each([
      "inj",
      "adydx",
      "aevmos",
      "wei",
    ])("should return 18 for %s", (denom) => {
      expect(getTokenDecimals(denom)).toBe(18);
    });

    it("should be case-insensitive for known denoms", () => {
      expect(getTokenDecimals("INJ")).toBe(18);
      expect(getTokenDecimals("ADYDX")).toBe(18);
    });
  });

  describe("atto prefix convention (a-prefix = 18 decimals)", () => {
    it.each([
      "adym",
      "aarch",
      "aseda",
      "axpla",
      "azeta",
      "axrp",
      "au",
      "ausdy",
      "acanto",
    ])("should return 18 for a-prefixed denom %s", (denom) => {
      expect(getTokenDecimals(denom)).toBe(18);
    });

    it("should exclude compound denoms with '-' (e.g. Axelar bridged assets)", () => {
      expect(getTokenDecimals("arbitrum-uusdt")).toBe(6);
      expect(getTokenDecimals("avalanche-uusdc")).toBe(6);
      expect(getTokenDecimals("aave-wei")).toBe(6);
    });

    it("should exclude factory denoms with '/'", () => {
      expect(getTokenDecimals("factory/inj123/ausd")).toBe(6);
    });

    it("should not match single char 'a'", () => {
      expect(getTokenDecimals("a")).toBe(6);
    });
  });

  describe("stToken prefix stripping (st + host denom)", () => {
    it("should resolve 18-decimal stTokens via host denom", () => {
      expect(getTokenDecimals("staISLM")).toBe(18); // st + aISLM
      expect(getTokenDecimals("stadym")).toBe(18); // st + adym
      expect(getTokenDecimals("staevmos")).toBe(18); // st + aevmos
      expect(getTokenDecimals("stadydx")).toBe(18); // st + adydx
      expect(getTokenDecimals("stinj")).toBe(18); // st + inj
    });

    it("should resolve 6-decimal stTokens via host denom", () => {
      expect(getTokenDecimals("stuatom")).toBe(6); // st + uatom
      expect(getTokenDecimals("stuosmo")).toBe(6); // st + uosmo
      expect(getTokenDecimals("stutia")).toBe(6); // st + utia
      expect(getTokenDecimals("stujuno")).toBe(6); // st + ujuno
      expect(getTokenDecimals("stuluna")).toBe(6); // st + uluna
      expect(getTokenDecimals("stusaga")).toBe(6); // st + usaga
      expect(getTokenDecimals("stustars")).toBe(6); // st + ustars
      expect(getTokenDecimals("stuband")).toBe(6); // st + uband
      expect(getTokenDecimals("stuumee")).toBe(6); // st + uumee
      expect(getTokenDecimals("stusomm")).toBe(6); // st + usomm
      expect(getTokenDecimals("stucmdx")).toBe(6); // st + ucmdx
    });

    it("should preserve original case when stripping st prefix", () => {
      // staISLM → aISLM (case preserved) → lowercase aislm → a-prefix → 18
      expect(getTokenDecimals("staISLM")).toBe(18);
    });

    it("should strip st prefix at most once (recursion depth guard)", () => {
      // ststuatom → strip st once → stuatom → depth limit reached → default 6
      expect(getTokenDecimals("ststuatom")).toBe(6);
      // stststaISLM → strip st once → ststaISLM → depth limit → default 6
      expect(getTokenDecimals("stststaISLM")).toBe(6);
    });
  });

  describe("Osmosis LP share tokens", () => {
    it("should return 18 for gamm/pool/ denoms", () => {
      expect(getTokenDecimals("gamm/pool/1")).toBe(18);
      expect(getTokenDecimals("gamm/pool/123")).toBe(18);
    });

    it("should return 18 for cl/pool/ denoms", () => {
      expect(getTokenDecimals("cl/pool/1")).toBe(18);
      expect(getTokenDecimals("cl/pool/456")).toBe(18);
    });

    it("should be case-insensitive for LP denoms", () => {
      expect(getTokenDecimals("GAMM/POOL/1")).toBe(18);
      expect(getTokenDecimals("CL/POOL/1")).toBe(18);
    });
  });

  describe("default fallback", () => {
    it("should return 6 for unknown denoms", () => {
      expect(getTokenDecimals("uatom")).toBe(6);
      expect(getTokenDecimals("uosmo")).toBe(6);
      expect(getTokenDecimals("utia")).toBe(6);
    });

    it("should respect custom default", () => {
      expect(getTokenDecimals("unknown", 8)).toBe(8);
    });
  });
});

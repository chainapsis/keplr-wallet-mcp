import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceResult } from "../../clients/cosmos.js";
import {
  type BalanceEnricher,
  BalanceEnricherRegistry,
} from "../../utils/balance-enricher.js";

const makeBalance = (
  denom: string,
  amount: string,
  displayDenom?: string,
): BalanceResult => ({
  denom,
  amount,
  displayAmount: amount,
  displayDenom: displayDenom ?? denom,
});

describe("BalanceEnricherRegistry", () => {
  let registry: BalanceEnricherRegistry;

  beforeEach(() => {
    registry = new BalanceEnricherRegistry();
  });

  describe("register / unregister", () => {
    it("should register an enricher", () => {
      const enricher: BalanceEnricher = {
        id: "test",
        chainIds: ["osmosis-1"],
        enrich: async (b) => b,
      };
      registry.register(enricher);
      expect(registry.getEnrichers()).toHaveLength(1);
      expect(registry.getEnrichers()[0].id).toBe("test");
    });

    it("should throw on duplicate id", () => {
      const enricher: BalanceEnricher = {
        id: "dup",
        chainIds: [],
        enrich: async (b) => b,
      };
      registry.register(enricher);
      expect(() => registry.register(enricher)).toThrow(
        'Balance enricher "dup" is already registered.',
      );
    });

    it("should unregister by id", () => {
      registry.register({
        id: "to-remove",
        chainIds: [],
        enrich: async (b) => b,
      });
      expect(registry.unregister("to-remove")).toBe(true);
      expect(registry.getEnrichers()).toHaveLength(0);
    });

    it("should return false when unregistering non-existent id", () => {
      expect(registry.unregister("nope")).toBe(false);
    });

    it("should clear all enrichers", () => {
      registry.register({ id: "a", chainIds: [], enrich: async (b) => b });
      registry.register({ id: "b", chainIds: [], enrich: async (b) => b });
      registry.clear();
      expect(registry.getEnrichers()).toHaveLength(0);
    });
  });

  describe("enrich", () => {
    it("should pass through when no enrichers are registered", async () => {
      const balances = [makeBalance("uosmo", "1000000", "OSMO")];
      const result = await registry.enrich(balances, "osmosis-1");
      expect(result).toEqual(balances);
    });

    it("should apply enricher to matching chain", async () => {
      registry.register({
        id: "osmo-enricher",
        chainIds: ["osmosis-1"],
        enrich: async (balances) =>
          balances.map((b) =>
            b.displayDenom === b.denom
              ? { ...b, displayDenom: "RESOLVED", displayAmount: "1.0" }
              : b,
          ),
      });

      const balances = [
        makeBalance("uosmo", "1000000", "OSMO"),
        makeBalance("factory/osmo1.../allBTC", "100000000"),
      ];
      const result = await registry.enrich(balances, "osmosis-1");

      expect(result[0].displayDenom).toBe("OSMO");
      expect(result[1].displayDenom).toBe("RESOLVED");
      expect(result[1].displayAmount).toBe("1.0");
    });

    it("should skip enricher for non-matching chain", async () => {
      let called = false;
      registry.register({
        id: "osmo-only",
        chainIds: ["osmosis-1"],
        enrich: async (b) => {
          called = true;
          return b;
        },
      });

      const balances = [makeBalance("uatom", "1000000", "ATOM")];
      await registry.enrich(balances, "cosmoshub-4");
      expect(called).toBe(false);
    });

    it("should apply enricher with empty chainIds to all chains", async () => {
      let called = false;
      registry.register({
        id: "global",
        chainIds: [],
        enrich: async (b) => {
          called = true;
          return b;
        },
      });

      await registry.enrich([], "any-chain-id");
      expect(called).toBe(true);
    });

    it("should apply enrichers sequentially in registration order", async () => {
      const order: string[] = [];

      registry.register({
        id: "first",
        chainIds: [],
        enrich: async (b) => {
          order.push("first");
          return b.map((bal) => ({
            ...bal,
            displayDenom: `${bal.displayDenom}-1`,
          }));
        },
      });

      registry.register({
        id: "second",
        chainIds: [],
        enrich: async (b) => {
          order.push("second");
          return b.map((bal) => ({
            ...bal,
            displayDenom: `${bal.displayDenom}-2`,
          }));
        },
      });

      const result = await registry.enrich(
        [makeBalance("uosmo", "1000", "OSMO")],
        "osmosis-1",
      );

      expect(order).toEqual(["first", "second"]);
      expect(result[0].displayDenom).toBe("OSMO-1-2");
    });

    it("should gracefully handle enricher errors", async () => {
      registry.register({
        id: "failing",
        chainIds: [],
        enrich: async () => {
          throw new Error("API down");
        },
      });

      registry.register({
        id: "working",
        chainIds: [],
        enrich: async (b) =>
          b.map((bal) => ({ ...bal, displayDenom: "ENRICHED" })),
      });

      const balances = [makeBalance("uosmo", "1000", "OSMO")];
      const result = await registry.enrich(balances, "osmosis-1");

      // Failing enricher is skipped, working enricher still runs
      expect(result[0].displayDenom).toBe("ENRICHED");
    });

    it("should log warning when enricher fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registry.register({
        id: "broken-enricher",
        chainIds: ["osmosis-1"],
        enrich: async () => {
          throw new Error("Skip API rate limited");
        },
      });

      const balances = [makeBalance("uosmo", "1000", "OSMO")];
      await registry.enrich(balances, "osmosis-1");

      expect(warnSpy).toHaveBeenCalledWith(
        '[balance-enricher] Enricher "broken-enricher" failed for chain "osmosis-1":',
        "Skip API rate limited",
      );

      warnSpy.mockRestore();
    });
  });

  describe("integration: enricher pipeline", () => {
    it("should invoke enricher and return transformed result", async () => {
      const enrichFn = vi.fn(async (balances: BalanceResult[]) =>
        balances.map((b) => ({
          ...b,
          displayDenom:
            b.displayDenom === b.denom ? "ENRICHED" : b.displayDenom,
        })),
      );

      registry.register({
        id: "pipeline-test",
        chainIds: ["osmosis-1"],
        enrich: enrichFn,
      });

      const balances = [makeBalance("factory/osmo1.../allBTC", "100000000")];
      const result = await registry.enrich(balances, "osmosis-1");

      expect(enrichFn).toHaveBeenCalledWith(balances, "osmosis-1");
      expect(result[0].displayDenom).toBe("ENRICHED");
    });

    it("should not invoke enricher when removed", async () => {
      const enrichFn = vi.fn(async (b: BalanceResult[]) => b);

      registry.register({
        id: "removable",
        chainIds: ["osmosis-1"],
        enrich: enrichFn,
      });
      registry.unregister("removable");

      const balances = [makeBalance("uosmo", "1000")];
      await registry.enrich(balances, "osmosis-1");

      expect(enrichFn).not.toHaveBeenCalled();
    });
  });
});

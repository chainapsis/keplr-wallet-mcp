import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRouteCache,
  getSkipMsgsDirect,
  getSkipRoute,
  skipFetch,
  skipMsgToEncodeObject,
} from "../../../../plugins/cosmos/osmosis/skip-api.js";
import { skipThrottle } from "../../../../plugins/cosmos/osmosis/skip-throttle.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  skipThrottle._reset();
  _resetRouteCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skipFetch", () => {
  it("should throw descriptive error on HTTP 4xx/5xx", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ message: "invalid denom" }),
    });

    await expect(skipFetch("/v2/fungible/route", {})).rejects.toThrow(
      "Skip API error (400): invalid denom",
    );
  });

  it("should fallback to statusText when error body has no message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });

    await expect(skipFetch("/v2/fungible/route", {})).rejects.toThrow(
      "Skip API error (500): Internal Server Error",
    );
  });

  it("should throw 'Skip API unreachable' on network failure", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(skipFetch("/v2/fungible/route")).rejects.toThrow(
      "Skip API unreachable",
    );
  });

  it("should send GET when no body provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: "ok" }),
    });

    await skipFetch("/v2/fungible/assets?chain_id=osmosis-1");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v2/fungible/assets?chain_id=osmosis-1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should send POST with JSON body when body provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ amount_out: "100" }),
    });

    await skipFetch("/v2/fungible/route", { amount_in: "1000" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v2/fungible/route"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ amount_in: "1000" }),
      }),
    );
  });
});

describe("getSkipRoute", () => {
  it("should construct request and map response", async () => {
    const mockResponse = {
      amount_in: "10000000",
      amount_out: "900000",
      operations: [
        {
          swap: {
            swap_in: {
              swap_venue: { name: "osmosis-poolmanager" },
              swap_operations: [],
            },
          },
        },
      ],
      chain_ids: ["osmosis-1"],
      swap_price_impact_percent: "0.12",
      does_swap: true,
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getSkipRoute({
      source_asset_denom: "uosmo",
      source_asset_chain_id: "osmosis-1",
      dest_asset_denom:
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      dest_asset_chain_id: "osmosis-1",
      amount_in: "10000000",
    });

    expect(result.amount_in).toBe("10000000");
    expect(result.amount_out).toBe("900000");
    expect(result.operations).toHaveLength(1);
    expect(result.swap_price_impact_percent).toBe("0.12");

    // Verify POST body
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.source_asset_denom).toBe("uosmo");
    expect(callBody.amount_in).toBe("10000000");
  });

  it("should throw when response is missing amount_out", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        amount_in: "10000000",
        amount_out: "",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      }),
    });

    await expect(
      getSkipRoute({
        source_asset_denom: "uosmo",
        source_asset_chain_id: "osmosis-1",
        dest_asset_denom: "uatom",
        dest_asset_chain_id: "osmosis-1",
        amount_in: "10000000",
      }),
    ).rejects.toThrow("missing amount_out or operations");
  });

  it("should throw when response is missing operations", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        amount_in: "10000000",
        amount_out: "900000",
        chain_ids: ["osmosis-1"],
        does_swap: true,
      }),
    });

    await expect(
      getSkipRoute({
        source_asset_denom: "uosmo",
        source_asset_chain_id: "osmosis-1",
        dest_asset_denom: "uatom",
        dest_asset_chain_id: "osmosis-1",
        amount_in: "10000000",
      }),
    ).rejects.toThrow("missing amount_out or operations");
  });
});

describe("getSkipMsgsDirect", () => {
  it("should construct request and map response", async () => {
    const mockResponse = {
      msgs: [
        {
          multi_chain_msg: {
            chain_id: "osmosis-1",
            msg: '{"@type":"/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn","sender":"osmo1...","routes":[]}',
            msg_type_url: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
          },
        },
      ],
      route: {
        amount_in: "10000000",
        amount_out: "900000",
        operations: [],
        chain_ids: ["osmosis-1"],
        does_swap: true,
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getSkipMsgsDirect({
      source_asset_denom: "uosmo",
      source_asset_chain_id: "osmosis-1",
      dest_asset_denom:
        "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
      dest_asset_chain_id: "osmosis-1",
      amount_in: "10000000",
      chain_ids_to_addresses: { "osmosis-1": "osmo1abc" },
      slippage_tolerance_percent: "0.5",
    });

    expect(result.msgs).toHaveLength(1);
    expect(result.msgs[0].multi_chain_msg.chain_id).toBe("osmosis-1");
    expect(result.route.amount_out).toBe("900000");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.slippage_tolerance_percent).toBe("0.5");
    expect(callBody.chain_ids_to_addresses["osmosis-1"]).toBe("osmo1abc");
  });

  it("should throw when message is missing multi_chain_msg fields", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        msgs: [{ multi_chain_msg: { chain_id: "osmosis-1" } }],
        route: { amount_in: "10000000", amount_out: "900000" },
      }),
    });

    await expect(
      getSkipMsgsDirect({
        source_asset_denom: "uosmo",
        source_asset_chain_id: "osmosis-1",
        dest_asset_denom: "uatom",
        dest_asset_chain_id: "osmosis-1",
        amount_in: "10000000",
        chain_ids_to_addresses: { "osmosis-1": "osmo1abc" },
        slippage_tolerance_percent: "0.5",
      }),
    ).rejects.toThrow("malformed message at index 0");
  });

  it("should throw when response is missing msgs array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        msgs: "not-an-array",
        route: { amount_in: "10000000", amount_out: "900000" },
      }),
    });

    await expect(
      getSkipMsgsDirect({
        source_asset_denom: "uosmo",
        source_asset_chain_id: "osmosis-1",
        dest_asset_denom: "uatom",
        dest_asset_chain_id: "osmosis-1",
        amount_in: "10000000",
        chain_ids_to_addresses: { "osmosis-1": "osmo1abc" },
        slippage_tolerance_percent: "0.5",
      }),
    ).rejects.toThrow("missing msgs array");
  });
});

describe("skipMsgToEncodeObject", () => {
  it("should parse JSON, remove @type, and map to { typeUrl, value }", () => {
    const result = skipMsgToEncodeObject({
      msg: JSON.stringify({
        "@type": "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
        sender: "osmo1abc",
        routes: [{ pool_id: "1", token_out_denom: "uatom" }],
        token_in: { denom: "uosmo", amount: "10000000" },
        token_out_min_amount: "900000",
      }),
      msg_type_url: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    });

    expect(result.typeUrl).toBe(
      "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    );
    expect(result.value).not.toHaveProperty("@type");
    const value = result.value as Record<string, unknown>;
    expect(value.sender).toBe("osmo1abc");
    expect(value.routes).toEqual([{ pool_id: "1", token_out_denom: "uatom" }]);
  });

  it("should throw on invalid JSON with contextual message", () => {
    expect(() =>
      skipMsgToEncodeObject({
        msg: "not-json",
        msg_type_url: "/some.Type",
      }),
    ).toThrow(/Failed to parse Skip API message \(type: \/some\.Type\)/);
  });

  it("should handle MsgSwapExactAmountIn (single-hop)", () => {
    const result = skipMsgToEncodeObject({
      msg: JSON.stringify({
        "@type": "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
        sender: "osmo1sender",
        routes: [{ pool_id: "678", token_out_denom: "ibc/498A..." }],
        token_in: { denom: "uosmo", amount: "5000000" },
        token_out_min_amount: "4500",
      }),
      msg_type_url: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    });

    expect(result.typeUrl).toBe(
      "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn",
    );
    const val = result.value as Record<string, unknown>;
    expect(val.sender).toBe("osmo1sender");
    expect(val.token_in).toEqual({ denom: "uosmo", amount: "5000000" });
  });

  it("should handle MsgExecuteContract (CosmWasm pool)", () => {
    const result = skipMsgToEncodeObject({
      msg: JSON.stringify({
        "@type": "/cosmwasm.wasm.v1.MsgExecuteContract",
        sender: "osmo1sender",
        contract: "osmo1contract",
        msg: "eyJ0ZXN0IjogdHJ1ZX0=",
        funds: [{ denom: "uosmo", amount: "1000000" }],
      }),
      msg_type_url: "/cosmwasm.wasm.v1.MsgExecuteContract",
    });

    expect(result.typeUrl).toBe("/cosmwasm.wasm.v1.MsgExecuteContract");
    const val = result.value as Record<string, unknown>;
    expect(val.contract).toBe("osmo1contract");
    expect(val).not.toHaveProperty("@type");
    // base64 "eyJ0ZXN0IjogdHJ1ZX0=" decodes to '{"test": true}'
    expect(val.msg).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(val.msg as Uint8Array)).toBe(
      '{"test": true}',
    );
  });

  it("should throw on invalid base64 in MsgExecuteContract msg", () => {
    expect(() =>
      skipMsgToEncodeObject({
        msg: JSON.stringify({
          "@type": "/cosmwasm.wasm.v1.MsgExecuteContract",
          sender: "osmo1sender",
          contract: "osmo1contract",
          msg: "!!!not-valid-base64!!!",
          funds: [],
        }),
        msg_type_url: "/cosmwasm.wasm.v1.MsgExecuteContract",
      }),
    ).toThrow(/Failed to decode base64 msg in MsgExecuteContract/);
  });

  it("should throw on unexpected msg field type in MsgExecuteContract", () => {
    expect(() =>
      skipMsgToEncodeObject({
        msg: JSON.stringify({
          "@type": "/cosmwasm.wasm.v1.MsgExecuteContract",
          sender: "osmo1sender",
          contract: "osmo1contract",
          msg: 12345,
          funds: [],
        }),
        msg_type_url: "/cosmwasm.wasm.v1.MsgExecuteContract",
      }),
    ).toThrow(/Unexpected msg field type 'number'/);
  });

  it("should handle MsgExecuteContract with object msg", () => {
    const result = skipMsgToEncodeObject({
      msg: JSON.stringify({
        "@type": "/cosmwasm.wasm.v1.MsgExecuteContract",
        sender: "osmo1sender",
        contract: "osmo1contract",
        msg: { swap: { input_token: "Token1" } },
        funds: [],
      }),
      msg_type_url: "/cosmwasm.wasm.v1.MsgExecuteContract",
    });

    const val = result.value as Record<string, unknown>;
    expect(val.msg).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(new TextDecoder().decode(val.msg as Uint8Array))).toEqual(
      {
        swap: { input_token: "Token1" },
      },
    );
  });
});

describe("skipFetch 429 retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should retry on 429 and succeed on subsequent attempt", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: "ok" }),
      });

    const promise = skipFetch("/v2/fungible/route", {});
    // Advance past cooldown (60s) + minInterval (500ms) for acquire()
    await vi.advanceTimersByTimeAsync(61_000);
    const result = await promise;

    expect(result).toEqual({ data: "ok" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should throw after all retries exhausted on 429", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers(),
    });

    const promise = skipFetch("/v2/fungible/route", {});
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow("rate limited");
    // Advance past all cooldowns: 3 retries × 60s each
    await vi.advanceTimersByTimeAsync(200_000);
    await assertion;

    // 1 initial + 3 retries = 4 total
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("getSkipRoute cache", () => {
  const routeRequest = {
    source_asset_denom: "uosmo",
    source_asset_chain_id: "osmosis-1",
    dest_asset_denom: "uatom",
    dest_asset_chain_id: "osmosis-1",
    amount_in: "10000000",
  };

  const mockRouteResponse = {
    amount_in: "10000000",
    amount_out: "900000",
    operations: [
      {
        swap: {
          swap_in: {
            swap_venue: { name: "osmosis-poolmanager" },
            swap_operations: [],
          },
        },
      },
    ],
    chain_ids: ["osmosis-1"],
    does_swap: true,
  };

  it("should return cached result on same parameters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockRouteResponse,
    });

    await getSkipRoute(routeRequest);
    await getSkipRoute(routeRequest);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should not cache for different parameters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockRouteResponse,
    });

    await getSkipRoute(routeRequest);
    await getSkipRoute({ ...routeRequest, amount_in: "20000000" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should deduplicate concurrent requests for the same route", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockRouteResponse,
    });

    const [r1, r2] = await Promise.all([
      getSkipRoute(routeRequest),
      getSkipRoute(routeRequest),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  it("should not deduplicate concurrent requests for different routes", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockRouteResponse,
    });

    await Promise.all([
      getSkipRoute(routeRequest),
      getSkipRoute({ ...routeRequest, amount_in: "20000000" }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should clear pending on fetch error and allow retry", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockRouteResponse,
      });

    await expect(getSkipRoute(routeRequest)).rejects.toThrow();
    const result = await getSkipRoute(routeRequest);
    expect(result.amount_out).toBe("900000");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should re-fetch after 30s TTL expires", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockRouteResponse,
      });

      await getSkipRoute(routeRequest);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30_001);

      await getSkipRoute(routeRequest);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

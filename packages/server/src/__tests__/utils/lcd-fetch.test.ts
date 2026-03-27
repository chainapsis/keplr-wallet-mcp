import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LcdParseError, safeParseJson } from "../../utils/lcd-fetch.js";

const mockResponse = (body: string, status = 200) =>
  ({
    text: async () => body,
    status,
  }) as unknown as Response;

vi.mock("../../rpc/resolver.js", () => ({
  getRpcResolver: () => ({
    resolveLcdEndpoint: () => ({
      url: "https://endpoints.keplr.app/lcd/cosmoshub",
    }),
  }),
}));

vi.mock("../../utils/rpc-throttle.js", () => {
  const acquire = vi
    .fn<(host: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const markRateLimited = vi.fn();
  return {
    rpcThrottle: { acquire, markRateLimited },
  };
});

describe("safeParseJson", () => {
  it("should parse valid JSON object", async () => {
    const response = mockResponse('{"key": "value"}');
    const result = await safeParseJson<{ key: string }>(response, "/test");
    expect(result).toEqual({ key: "value" });
  });

  it("should parse valid JSON array", async () => {
    const response = mockResponse("[1, 2, 3]");
    const result = await safeParseJson<number[]>(response, "/test");
    expect(result).toEqual([1, 2, 3]);
  });

  it("should throw LcdParseError for non-JSON response", async () => {
    const response = mockResponse("<html>Error</html>", 502);
    await expect(
      safeParseJson(response, "/cosmos/bank/balances"),
    ).rejects.toThrow(LcdParseError);
  });

  it("should include path, status, and bodySnippet in error", async () => {
    const response = mockResponse("Bad Gateway", 502);
    try {
      await safeParseJson(response, "/cosmos/bank/balances");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LcdParseError);
      const lcdError = error as LcdParseError;
      expect(lcdError.path).toBe("/cosmos/bank/balances");
      expect(lcdError.status).toBe(502);
      expect(lcdError.bodySnippet).toBe("Bad Gateway");
    }
  });

  it("should truncate bodySnippet to 200 chars", async () => {
    const longBody = "x".repeat(500);
    const response = mockResponse(longBody);
    try {
      await safeParseJson(response, "/test");
      expect.unreachable("should have thrown");
    } catch (error) {
      const lcdError = error as LcdParseError;
      expect(lcdError.bodySnippet).toHaveLength(200);
    }
  });

  it("should set cause to the original SyntaxError", async () => {
    const response = mockResponse("not json");
    try {
      await safeParseJson(response, "/test");
      expect.unreachable("should have thrown");
    } catch (error) {
      const lcdError = error as LcdParseError;
      expect(lcdError.cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("LcdParseError", () => {
  it("should have correct name", () => {
    const error = new LcdParseError("/test", 500, "error body");
    expect(error.name).toBe("LcdParseError");
  });

  it("should include path and status in message", () => {
    const error = new LcdParseError("/cosmos/bank", 502, "Bad Gateway");
    expect(error.message).toContain("/cosmos/bank");
    expect(error.message).toContain("502");
    expect(error.message).toContain("Bad Gateway");
  });

  it("should be instanceof Error", () => {
    const error = new LcdParseError("/test", 500, "err");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("lcdFetch", () => {
  const chain = {
    chainId: "cosmoshub-4",
    rest: "https://lcd.cosmos.network",
  } as import("@keplr-wallet/types").ChainInfo;

  // biome-ignore lint: test helper type
  let fetchSpy: any;
  let throttle: {
    acquire: ReturnType<typeof vi.fn>;
    markRateLimited: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    const mod = await import("../../utils/rpc-throttle.js");
    throttle = mod.rpcThrottle as unknown as typeof throttle;
    vi.clearAllMocks();
    throttle.acquire.mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("should return response on success without retry", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"ok":true}', { status: 200 }),
    );

    const { lcdFetch } = await import("../../utils/lcd-fetch.js");
    const res = await lcdFetch(chain, "/test");

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(throttle.markRateLimited).not.toHaveBeenCalled();
  });

  it("should retry once on 429 and return retry response", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const { lcdFetch } = await import("../../utils/lcd-fetch.js");
    const res = await lcdFetch(chain, "/test");

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(throttle.markRateLimited).toHaveBeenCalledTimes(1);
    // acquire: 1 initial + 1 before retry
    expect(throttle.acquire).toHaveBeenCalledTimes(2);
  });

  it("should return 429 if retry also fails with 429", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("still limited", { status: 429 }));

    const { lcdFetch } = await import("../../utils/lcd-fetch.js");
    const res = await lcdFetch(chain, "/test");

    expect(res.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // markRateLimited called for both 429s
    expect(throttle.markRateLimited).toHaveBeenCalledTimes(2);
  });

  it("should not retry on non-429 errors", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { lcdFetch } = await import("../../utils/lcd-fetch.js");
    const res = await lcdFetch(chain, "/test");

    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(throttle.markRateLimited).not.toHaveBeenCalled();
  });

  it("should return original 429 response if retry fetch throws", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    const { lcdFetch } = await import("../../utils/lcd-fetch.js");
    const res = await lcdFetch(chain, "/test");

    expect(res.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(throttle.markRateLimited).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createExternalPluginContext,
  resolveExternalPlugin,
  wrapExternalPlugin,
} from "../../config/plugin-adapter.js";
import type { KeplrMcpPlugin } from "../../config/types.js";

describe("wrapExternalPlugin", () => {
  it("should call setup before registerTools during register", async () => {
    const calls: string[] = [];
    const external: KeplrMcpPlugin = {
      name: "ordered-plugin",
      setup: async () => {
        calls.push("setup");
      },
      registerTools: async () => {
        calls.push("registerTools");
      },
    };

    const internal = wrapExternalPlugin(external);
    const mockServer = {} as never;
    const mockStore = {} as never;
    await internal.register(mockServer, mockStore);

    expect(calls).toEqual(["setup", "registerTools"]);
  });
});

describe("resolveExternalPlugin", () => {
  it("should return KeplrMcpPlugin as-is if it has a name field", () => {
    const plugin: KeplrMcpPlugin = { name: "direct-plugin" };
    const result = resolveExternalPlugin(plugin);
    expect(result).toBe(plugin);
  });
});

describe("createExternalPluginContext", () => {
  it("should support get/set shared data", () => {
    const store = new Map<string, unknown>();
    const ctx = createExternalPluginContext("my-plugin", store);

    ctx.set("my-plugin.data", { value: 42 });
    const result = ctx.get<{ value: number }>("my-plugin.data");
    expect(result?.value).toBe(42);
  });
});

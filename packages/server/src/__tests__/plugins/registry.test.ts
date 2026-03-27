import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPluginContext,
  type KeplrPlugin,
  PluginRegistry,
} from "../../plugins/types.js";
import type { KeplrStore } from "../../store.js";

// Mock McpServer
const mockServer = {
  registerTool: vi.fn(),
  registerPrompt: vi.fn(),
} as unknown as McpServer;

// Mock Store
const createMockStore = () =>
  ({
    getClientFor: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
    emit: vi.fn(),
  }) as unknown as KeplrStore;

describe("PluginRegistry", () => {
  let registry: PluginRegistry;
  let mockStore: KeplrStore;

  beforeEach(() => {
    registry = new PluginRegistry();
    mockStore = createMockStore();
  });

  describe("add", () => {
    it("should add a plugin", () => {
      const plugin: KeplrPlugin = {
        name: "test-plugin",
        register: vi.fn(),
      };

      registry.add(plugin);

      expect(registry.has("test-plugin")).toBe(true);
      expect(registry.get("test-plugin")).toBe(plugin);
    });

    it("should throw on duplicate plugin", () => {
      const plugin: KeplrPlugin = {
        name: "test-plugin",
        register: vi.fn(),
      };

      registry.add(plugin);

      expect(() => registry.add(plugin)).toThrow(/already registered/);
    });
  });

  describe("getPluginNames", () => {
    it("should return all plugin names", () => {
      registry.add({ name: "plugin-a", register: vi.fn() });
      registry.add({ name: "plugin-b", register: vi.fn() });

      const names = registry.getPluginNames();

      expect(names).toContain("plugin-a");
      expect(names).toContain("plugin-b");
    });
  });

  describe("registerAll", () => {
    it("should register plugins in order", async () => {
      const order: string[] = [];

      registry.add({
        name: "plugin-a",
        register: vi.fn().mockImplementation(() => order.push("a")),
      });
      registry.add({
        name: "plugin-b",
        register: vi.fn().mockImplementation(() => order.push("b")),
      });

      await registry.registerAll(mockServer, mockStore);

      expect(order).toEqual(["a", "b"]);
    });

    it("should respect dependencies", async () => {
      const order: string[] = [];

      registry.add({
        name: "plugin-a",
        dependencies: ["plugin-b"], // a depends on b
        register: vi.fn().mockImplementation(() => order.push("a")),
      });
      registry.add({
        name: "plugin-b",
        register: vi.fn().mockImplementation(() => order.push("b")),
      });

      await registry.registerAll(mockServer, mockStore);

      // b should be registered before a
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
    });

    it("should handle complex dependency chains", async () => {
      const order: string[] = [];

      // c depends on b, b depends on a
      registry.add({
        name: "plugin-c",
        dependencies: ["plugin-b"],
        register: vi.fn().mockImplementation(() => order.push("c")),
      });
      registry.add({
        name: "plugin-b",
        dependencies: ["plugin-a"],
        register: vi.fn().mockImplementation(() => order.push("b")),
      });
      registry.add({
        name: "plugin-a",
        register: vi.fn().mockImplementation(() => order.push("a")),
      });

      await registry.registerAll(mockServer, mockStore);

      // a, then b, then c
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    });

    it("should detect circular dependencies", async () => {
      registry.add({
        name: "plugin-a",
        dependencies: ["plugin-b"],
        register: vi.fn(),
      });
      registry.add({
        name: "plugin-b",
        dependencies: ["plugin-a"],
        register: vi.fn(),
      });

      await expect(registry.registerAll(mockServer, mockStore)).rejects.toThrow(
        /Circular plugin dependency/,
      );
    });

    it("should throw on missing dependency", async () => {
      registry.add({
        name: "plugin-a",
        dependencies: ["plugin-missing"],
        register: vi.fn(),
      });

      await expect(registry.registerAll(mockServer, mockStore)).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("lifecycle hooks", () => {
    it("should call onAccountChanged for all plugins", async () => {
      const onAccountChanged1 = vi.fn();
      const onAccountChanged2 = vi.fn();

      registry.add({
        name: "plugin-a",
        register: vi.fn(),
        onAccountChanged: onAccountChanged1,
      });
      registry.add({
        name: "plugin-b",
        register: vi.fn(),
        onAccountChanged: onAccountChanged2,
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.notifyAccountChanged("new-account", "old-account");

      expect(onAccountChanged1).toHaveBeenCalledWith(
        "new-account",
        "old-account",
      );
      expect(onAccountChanged2).toHaveBeenCalledWith(
        "new-account",
        "old-account",
      );
    });

    it("should call onClientInitialized for all plugins", async () => {
      const onClientInit = vi.fn();

      registry.add({
        name: "plugin-a",
        register: vi.fn(),
        onClientInitialized: onClientInit,
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.notifyClientInitialized("cosmos", "keychain");

      expect(onClientInit).toHaveBeenCalledWith("cosmos", "keychain");
    });

    it("should call onClientDisconnected for all plugins", async () => {
      const onDisconnect = vi.fn();

      registry.add({
        name: "plugin-a",
        register: vi.fn(),
        onClientDisconnected: onDisconnect,
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.notifyClientDisconnected("evm");

      expect(onDisconnect).toHaveBeenCalledWith("evm");
    });

    it("should handle errors in lifecycle hooks without stopping others", async () => {
      const onAccountChanged1 = vi.fn().mockRejectedValue(new Error("test"));
      const onAccountChanged2 = vi.fn();

      registry.add({
        name: "plugin-a",
        register: vi.fn(),
        onAccountChanged: onAccountChanged1,
      });
      registry.add({
        name: "plugin-b",
        register: vi.fn(),
        onAccountChanged: onAccountChanged2,
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.notifyAccountChanged("new", null);

      // Both should be called even though first threw
      expect(onAccountChanged1).toHaveBeenCalled();
      expect(onAccountChanged2).toHaveBeenCalled();
    });
  });

  describe("unloadAll", () => {
    it("should call onUnload in reverse order", async () => {
      const order: string[] = [];

      registry.add({
        name: "plugin-a",
        register: vi.fn(),
        onUnload: vi.fn().mockImplementation(() => order.push("a")),
      });
      registry.add({
        name: "plugin-b",
        register: vi.fn(),
        onUnload: vi.fn().mockImplementation(() => order.push("b")),
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.unloadAll();

      // Should be called in reverse order
      expect(order).toEqual(["b", "a"]);
    });

    it("should clear plugins after unload", async () => {
      registry.add({
        name: "plugin-a",
        register: vi.fn(),
      });

      await registry.registerAll(mockServer, mockStore);
      await registry.unloadAll();

      expect(registry.getPluginNames()).toHaveLength(0);
    });
  });
});

describe("createPluginContext", () => {
  it("should create a valid context", () => {
    const mockStore = createMockStore();
    const context = createPluginContext(mockServer, mockStore, "test-plugin", {
      foo: "bar",
    });

    expect(context.server).toBe(mockServer);
    expect(context.getConfig()).toEqual({ foo: "bar" });
    expect(context.logger).toBeDefined();
  });

  it("should proxy getClient to store", async () => {
    const mockStore = createMockStore();
    const context = createPluginContext(mockServer, mockStore, "test");

    await context.getClient("cosmos");

    expect(mockStore.getClientFor).toHaveBeenCalledWith("cosmos");
  });

  it("should provide working logger", () => {
    const mockStore = createMockStore();
    const context = createPluginContext(mockServer, mockStore, "my-plugin");

    // Should not throw
    context.logger.debug("debug message");
    context.logger.info("info message");
    context.logger.warn("warn message");
    context.logger.error("error message");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type KeyProviderPlugin,
  KeyProviderRegistry,
  keyProviderRegistry,
} from "../../keys/registry.js";
import type { KeyProvider, KeyProviderCapabilities } from "../../keys/types.js";
import { KeyProviderError } from "../../keys/types.js";

// Mock KeyProvider for testing
// Using "mnemonic" type to satisfy the KeyProviderType constraint
class MockKeyProvider implements Omit<KeyProvider, "type"> {
  readonly type = "mock";
  readonly displayName = "Mock Provider";
  readonly capabilities: KeyProviderCapabilities = {
    curves: ["secp256k1"],
    signTypes: ["direct"],
    canExportKey: false,
    requiresUserInteraction: false,
    supportsDerivation: false,
  };

  constructor(public config: { type: string; value?: string }) {}

  async getAddress() {
    return "mock-address";
  }
  async getPublicKey() {
    return undefined;
  }
  async sign() {
    return { signature: new Uint8Array() };
  }
  async isReady() {
    return true;
  }
  async disconnect() {}
  getSupportedEcosystems() {
    return ["cosmos" as const];
  }
}

describe("KeyProviderRegistry", () => {
  let testRegistry: KeyProviderRegistry;

  beforeEach(() => {
    testRegistry = new KeyProviderRegistry();
  });

  describe("register", () => {
    it("should register a new provider type", () => {
      const plugin: KeyProviderPlugin<"mock", { type: "mock"; value: string }> =
        {
          type: "mock",
          displayName: "Mock Provider",
          create: async (config) =>
            new MockKeyProvider(config) as unknown as KeyProvider,
        };

      testRegistry.register(plugin);

      expect(testRegistry.isRegistered("mock")).toBe(true);
      expect(testRegistry.getRegisteredTypes()).toContain("mock");
    });

    it("should throw when registering duplicate type", () => {
      const plugin: KeyProviderPlugin = {
        type: "mock",
        displayName: "Mock Provider",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      };

      testRegistry.register(plugin);

      expect(() => testRegistry.register(plugin)).toThrow(/already registered/);
    });
  });

  describe("unregister", () => {
    it("should unregister a provider type", () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      expect(testRegistry.unregister("mock")).toBe(true);
      expect(testRegistry.isRegistered("mock")).toBe(false);
    });

    it("should return false for unregistered type", () => {
      expect(testRegistry.unregister("unknown")).toBe(false);
    });
  });

  describe("getRegisteredTypes", () => {
    it("should return all registered types", () => {
      testRegistry.register({
        type: "type1",
        displayName: "Type 1",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "1",
          }) as unknown as KeyProvider,
      });
      testRegistry.register({
        type: "type2",
        displayName: "Type 2",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "2",
          }) as unknown as KeyProvider,
      });

      const types = testRegistry.getRegisteredTypes();
      expect(types).toHaveLength(2);
      expect(types).toContain("type1");
      expect(types).toContain("type2");
    });
  });

  describe("getAvailableTypes", () => {
    it("should filter by isAvailable", async () => {
      testRegistry.register({
        type: "available",
        displayName: "Available",
        isAvailable: () => true,
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "1",
          }) as unknown as KeyProvider,
      });
      testRegistry.register({
        type: "unavailable",
        displayName: "Unavailable",
        isAvailable: () => false,
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "2",
          }) as unknown as KeyProvider,
      });
      testRegistry.register({
        type: "default",
        displayName: "Default",
        // No isAvailable means always available
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "3",
          }) as unknown as KeyProvider,
      });

      const available = await testRegistry.getAvailableTypes();
      expect(available).toContain("available");
      expect(available).toContain("default");
      expect(available).not.toContain("unavailable");
    });
  });

  describe("createProvider", () => {
    it("should create provider with valid config", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        configSchema: z.object({
          type: z.literal("mock"),
          value: z.string(),
        }),
        create: async (config) =>
          new MockKeyProvider(
            config as { type: "mock"; value: string },
          ) as unknown as KeyProvider,
      });

      const provider = await testRegistry.createProvider({
        type: "mock",
        value: "test-value",
      });

      expect(provider).toBeInstanceOf(MockKeyProvider);
      expect((provider as unknown as MockKeyProvider).config.value).toBe(
        "test-value",
      );
    });

    it("should throw for unknown type", async () => {
      await expect(
        testRegistry.createProvider({ type: "unknown" }),
      ).rejects.toThrow(KeyProviderError);
    });

    it("should validate config with schema", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        configSchema: z.object({
          type: z.literal("mock"),
          value: z.string().min(5), // Must be at least 5 chars
        }),
        create: async (config) =>
          new MockKeyProvider(
            config as { type: "mock"; value: string },
          ) as unknown as KeyProvider,
      });

      await expect(
        testRegistry.createProvider({ type: "mock", value: "abc" }),
      ).rejects.toThrow(/Invalid configuration/);
    });

    it("should run custom validation", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        validate: (config) => {
          if ((config as { value?: string }).value === "forbidden") {
            throw new Error("Value cannot be forbidden");
          }
          return true;
        },
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      await expect(
        testRegistry.createProvider({ type: "mock", value: "forbidden" }),
      ).rejects.toThrow(/Value cannot be forbidden/);
    });

    it("should check availability before creating", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        isAvailable: () => false,
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      await expect(
        testRegistry.createProvider({ type: "mock" }),
      ).rejects.toThrow(/not available/);
    });
  });

  describe("validateConfig", () => {
    it("should validate config without creating provider", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        configSchema: z.object({
          type: z.literal("mock"),
          value: z.string(),
        }),
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      const result = await testRegistry.validateConfig({
        type: "mock",
        value: "test",
      });
      expect(result).toBe(true);
    });

    it("should throw for invalid config", async () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider",
        configSchema: z.object({
          type: z.literal("mock"),
          value: z.string(),
        }),
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      await expect(
        testRegistry.validateConfig({ type: "mock" }), // missing value
      ).rejects.toThrow(KeyProviderError);
    });
  });

  describe("getDisplayName", () => {
    it("should return display name for registered type", () => {
      testRegistry.register({
        type: "mock",
        displayName: "Mock Provider Display Name",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "test",
          }) as unknown as KeyProvider,
      });

      expect(testRegistry.getDisplayName("mock")).toBe(
        "Mock Provider Display Name",
      );
    });

    it("should return undefined for unknown type", () => {
      expect(testRegistry.getDisplayName("unknown")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should remove all registered plugins", () => {
      testRegistry.register({
        type: "type1",
        displayName: "Type 1",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "1",
          }) as unknown as KeyProvider,
      });
      testRegistry.register({
        type: "type2",
        displayName: "Type 2",
        create: async () =>
          new MockKeyProvider({
            type: "mock",
            value: "2",
          }) as unknown as KeyProvider,
      });

      testRegistry.clear();

      expect(testRegistry.getRegisteredTypes()).toHaveLength(0);
    });
  });

  describe("global registry", () => {
    it("should have built-in providers registered", () => {
      // The global registry should have built-in providers
      expect(keyProviderRegistry.isRegistered("mnemonic")).toBe(true);
    });
  });
});

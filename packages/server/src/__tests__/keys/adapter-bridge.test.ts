import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EcosystemAdapter, EcosystemClient } from "../../ecosystem.js";
import {
  AdapterBridgeRegistry,
  type AdapterKeyProviderBridge,
  adapterBridgeRegistry,
} from "../../keys/adapter-bridge.js";
import type { KeyProvider, KeyProviderCapabilities } from "../../keys/types.js";

// Mock KeyProvider
const createMockProvider = (
  type: string,
  ecosystems: string[] = ["cosmos", "evm"],
) =>
  ({
    type,
    displayName: `${type} Provider`,
    capabilities: {} as KeyProviderCapabilities,
    getAddress: vi.fn(),
    getPublicKey: vi.fn(),
    sign: vi.fn(),
    isReady: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
    getSupportedEcosystems: vi.fn().mockReturnValue(ecosystems),
  }) as unknown as KeyProvider;

// Mock EcosystemAdapter
const createMockAdapter = (type: string) =>
  ({
    type,
    displayName: `${type} Adapter`,
    createClient: vi.fn().mockReturnValue({ disconnect: vi.fn() }),
    getDisplayAddress: vi.fn(),
    getPlugins: vi.fn().mockReturnValue([]),
  }) as unknown as EcosystemAdapter;

// Mock EcosystemClient
const mockClient = {
  disconnect: vi.fn(),
} as unknown as EcosystemClient;

describe("AdapterBridgeRegistry", () => {
  let registry: AdapterBridgeRegistry;

  beforeEach(() => {
    registry = new AdapterBridgeRegistry();
  });

  describe("register", () => {
    it("should register a bridge", () => {
      const bridge: AdapterKeyProviderBridge = {
        providerType: "test",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      };

      registry.register(bridge);

      expect(registry.hasBridge("test", "cosmos")).toBe(true);
    });

    it("should allow multiple bridges for different ecosystems", () => {
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });
      registry.register({
        providerType: "test",
        ecosystem: "evm",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      expect(registry.hasBridge("test", "cosmos")).toBe(true);
      expect(registry.hasBridge("test", "evm")).toBe(true);
    });

    it("should sort bridges by priority", () => {
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        priority: 1,
        createClient: vi.fn().mockResolvedValue(mockClient),
      });
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        priority: 10, // Higher priority
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      const bridges = registry.getBridges();
      expect(bridges[0].priority).toBe(10);
      expect(bridges[1].priority).toBe(1);
    });
  });

  describe("unregister", () => {
    it("should unregister bridges by provider type", () => {
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      const removed = registry.unregister("test");

      expect(removed).toBe(1);
      expect(registry.hasBridge("test", "cosmos")).toBe(false);
    });

    it("should unregister only specific ecosystem", () => {
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });
      registry.register({
        providerType: "test",
        ecosystem: "evm",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      registry.unregister("test", "cosmos");

      expect(registry.hasBridge("test", "cosmos")).toBe(false);
      expect(registry.hasBridge("test", "evm")).toBe(true);
    });
  });

  describe("findBridge", () => {
    it("should find a matching bridge", () => {
      const bridge: AdapterKeyProviderBridge = {
        providerType: "mnemonic",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      };
      registry.register(bridge);

      const provider = createMockProvider("mnemonic");
      const found = registry.findBridge(provider, "cosmos");

      expect(found).toBe(bridge);
    });

    it("should return undefined if no match", () => {
      const provider = createMockProvider("unknown");
      const found = registry.findBridge(provider, "cosmos");

      expect(found).toBeUndefined();
    });

    it("should use canHandle for custom matching", () => {
      const canHandle = vi.fn().mockReturnValue(false);
      registry.register({
        providerType: "test",
        ecosystem: "cosmos",
        canHandle,
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      const provider = createMockProvider("test");
      const found = registry.findBridge(provider, "cosmos");

      expect(canHandle).toHaveBeenCalledWith(provider);
      expect(found).toBeUndefined();
    });
  });

  describe("createClient", () => {
    it("should create client using bridge", async () => {
      const createClient = vi.fn().mockResolvedValue(mockClient);
      registry.register({
        providerType: "mnemonic",
        ecosystem: "cosmos",
        createClient,
      });

      const provider = createMockProvider("mnemonic");
      const adapter = createMockAdapter("cosmos");
      const client = await registry.createClient(provider, adapter);

      expect(createClient).toHaveBeenCalledWith(provider, adapter);
      expect(client).toBe(mockClient);
    });

    it("should throw if no bridge found", async () => {
      const provider = createMockProvider("unknown");
      const adapter = createMockAdapter("cosmos");

      await expect(registry.createClient(provider, adapter)).rejects.toThrow(
        /No adapter bridge registered/,
      );
    });
  });

  describe("hasBridge", () => {
    it("should return true for registered bridges", () => {
      registry.register({
        providerType: "test",
        ecosystem: "evm",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      expect(registry.hasBridge("test", "evm")).toBe(true);
      expect(registry.hasBridge("test", "cosmos")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all bridges", () => {
      registry.register({
        providerType: "a",
        ecosystem: "cosmos",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });
      registry.register({
        providerType: "b",
        ecosystem: "evm",
        createClient: vi.fn().mockResolvedValue(mockClient),
      });

      registry.clear();

      expect(registry.getBridges()).toHaveLength(0);
    });
  });
});

describe("global adapterBridgeRegistry", () => {
  it("should have built-in bridges registered", () => {
    // Built-in bridges are registered on module load (Cosmos only)
    expect(adapterBridgeRegistry.hasBridge("mnemonic", "cosmos")).toBe(true);
  });
});

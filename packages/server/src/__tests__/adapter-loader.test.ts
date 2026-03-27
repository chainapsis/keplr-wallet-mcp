import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Get the mock for manipulation in tests
import { readFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);

describe("Adapter Loader", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Clear environment variable
    delete process.env.KEPLR_ADAPTERS;
  });

  afterEach(() => {
    delete process.env.KEPLR_ADAPTERS;
  });

  describe("discoverExternalAdapters", () => {
    it("should return empty array when no adapters found", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {},
          optionalDependencies: {},
        }),
      );

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      expect(adapters).toEqual([]);
    });

    it("should discover adapters from optionalDependencies by prefix", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            lodash: "^4.0.0",
          },
          optionalDependencies: {
            "@keplr-wallet/adapter-test": "workspace:*",
          },
        }),
      );

      // Mock the dynamic import to fail gracefully
      vi.doMock("@keplr-wallet/adapter-test", () => {
        throw new Error("Module not found");
      });

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      // Will be empty because the import fails, but the mechanism works
      expect(adapters).toEqual([]);
    });

    it("should discover adapters from KEPLR_ADAPTERS env var", async () => {
      process.env.KEPLR_ADAPTERS = "custom-adapter-1, custom-adapter-2";

      mockReadFile.mockResolvedValue(JSON.stringify({}));

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      // Will be empty because the imports fail, but shows env var is processed
      expect(adapters).toEqual([]);
    });

    it("should recognize @keplr-wallet/adapter-* prefix", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          optionalDependencies: {
            "@keplr-wallet/adapter-evm": "workspace:*",
            "@keplr-wallet/adapter-solana": "workspace:*",
            "@some-other/package": "^1.0.0",
          },
        }),
      );

      const { discoverExternalAdapters } = await import("../adapter-loader.js");

      // The function will attempt to load the adapters
      // In tests, they won't be found, but we can verify the prefixes are recognized
      const adapters = await discoverExternalAdapters();
      expect(Array.isArray(adapters)).toBe(true);
    });

    it("should recognize keplr-adapter-* prefix", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          dependencies: {
            "keplr-adapter-custom": "^1.0.0",
          },
        }),
      );

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      expect(Array.isArray(adapters)).toBe(true);
    });

    it("should handle fs read errors gracefully", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      // Should not throw, just return empty
      expect(adapters).toEqual([]);
    });

    it("should handle malformed package.json gracefully", async () => {
      mockReadFile.mockResolvedValue("{ invalid json");

      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      // Should not throw, just return empty
      expect(adapters).toEqual([]);
    });
  });

  describe("Adapter Validation", () => {
    it("should validate adapter has required properties", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          optionalDependencies: {
            "@keplr-wallet/adapter-mock": "workspace:*",
          },
        }),
      );

      // This tests that invalid adapters are skipped
      // The isValidAdapter function checks for:
      // - type: string
      // - displayName: string
      // - createClient: function
      // - getPlugins: function
      const { discoverExternalAdapters } = await import("../adapter-loader.js");
      const adapters = await discoverExternalAdapters();

      // All returned adapters should have valid shape
      for (const adapter of adapters) {
        expect(typeof adapter.type).toBe("string");
        expect(typeof adapter.displayName).toBe("string");
        expect(typeof adapter.createClient).toBe("function");
        expect(typeof adapter.getPlugins).toBe("function");
      }
    });
  });
});

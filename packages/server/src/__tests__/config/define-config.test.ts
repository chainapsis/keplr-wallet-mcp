import { describe, expect, it } from "vitest";
import { defineConfig } from "../../config/define-config.js";
import type { KeplrMcpConfig } from "../../config/types.js";

describe("defineConfig", () => {
  it("should return config unchanged (identity function)", () => {
    const config: KeplrMcpConfig = {
      plugins: [],
      toolsets: { default: ["cosmos-query"] },
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("should accept minimal config with no fields", () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it("should accept config with rpc options", () => {
    const config = defineConfig({
      rpc: {
        apiKey: "test-key",
        overrides: { "cosmoshub-4": "https://custom-rpc.example.com" },
      },
    });
    expect(config.rpc?.apiKey).toBe("test-key");
    expect(config.rpc?.overrides?.["cosmoshub-4"]).toBe(
      "https://custom-rpc.example.com",
    );
  });
});

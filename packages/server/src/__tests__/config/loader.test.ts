import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config/loader.js";

/** Env vars that mergeEnvVars reads — isolate tests from host environment */
const MANAGED_ENV_KEYS = [
  "KEPLR_RPC_API_KEY",
  "SKIP_API_KEY",
  "SKIP_API_URL",
] as const;

describe("loadConfig", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keplr-config-test-"));
    for (const key of MANAGED_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const key of MANAGED_ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("should return empty config when no config file exists", async () => {
    const config = await loadConfig("/nonexistent/path");
    expect(config).toEqual({});
  });

  it("should load JSON config file", async () => {
    const configPath = path.join(tmpDir, "keplr-mcp.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ rpc: { apiKey: "test-key" } }),
    );
    const config = await loadConfig(tmpDir);
    expect(config.rpc?.apiKey).toBe("test-key");
  });

  it("should load JS config file", async () => {
    const configPath = path.join(tmpDir, "keplr-mcp.config.js");
    fs.writeFileSync(
      configPath,
      `export default { toolsets: { default: ["cosmos-query"] } }`,
    );
    const config = await loadConfig(tmpDir);
    expect(config.toolsets?.default).toContain("cosmos-query");
  });

  it("should prefer .js over .json when both exist", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "keplr-mcp.config.json"),
      JSON.stringify({ rpc: { apiKey: "json-key" } }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "keplr-mcp.config.js"),
      `export default { rpc: { apiKey: "js-key" } }`,
    );
    // Without .ts available, .js wins over .json
    const config = await loadConfig(tmpDir);
    expect(config.rpc?.apiKey).toBe("js-key");
  });

  describe("mergeEnvVars — SKIP_API_KEY / SKIP_API_URL", () => {
    it("should merge SKIP_API_KEY from env var when not in config", async () => {
      process.env.SKIP_API_KEY = "sk-from-env";
      const config = await loadConfig("/nonexistent/path");
      expect(config.skip?.apiKey).toBe("sk-from-env");
    });

    it("should merge SKIP_API_URL from env var when not in config", async () => {
      process.env.SKIP_API_URL = "https://custom.skip.build";
      const config = await loadConfig("/nonexistent/path");
      expect(config.skip?.apiUrl).toBe("https://custom.skip.build");
    });

    it("should prefer config file skip.apiKey over env var", async () => {
      process.env.SKIP_API_KEY = "sk-from-env";
      const configPath = path.join(tmpDir, "keplr-mcp.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ skip: { apiKey: "sk-from-config" } }),
      );
      const config = await loadConfig(tmpDir);
      expect(config.skip?.apiKey).toBe("sk-from-config");
    });
  });
});

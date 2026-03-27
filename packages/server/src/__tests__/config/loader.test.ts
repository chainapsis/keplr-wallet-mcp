import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../config/loader.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keplr-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
});

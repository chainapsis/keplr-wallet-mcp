import * as fs from "node:fs";
import * as path from "node:path";
import type { KeplrMcpConfig } from "./types.js";

const CONFIG_FILENAMES = [
  "keplr-mcp.config.ts",
  "keplr-mcp.config.js",
  "keplr-mcp.config.mjs",
  "keplr-mcp.config.json",
] as const;

/**
 * Load keplr-mcp config from the given directory.
 * Tries files in order: .ts → .js → .mjs → .json
 * Returns empty config if no file found.
 */
export const loadConfig = async (
  cwd: string = process.cwd(),
): Promise<KeplrMcpConfig> => {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = path.join(cwd, filename);
    if (!fs.existsSync(filepath)) continue;

    if (filename.endsWith(".json")) {
      const raw = fs.readFileSync(filepath, "utf-8");
      try {
        return mergeEnvVars(JSON.parse(raw) as KeplrMcpConfig);
      } catch (e) {
        throw new Error(
          `Failed to parse config file ${filepath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Dynamic import for .ts/.js/.mjs
    // Note: .ts files require the server to be running under tsx or ts-node.
    // In production (compiled), only .js/.mjs/.json are used.
    const mod = await import(filepath);
    const config: KeplrMcpConfig = mod.default ?? mod;
    return mergeEnvVars(config);
  }

  return mergeEnvVars({});
};

/**
 * Merge environment variables into the loaded config.
 * Config file values take precedence over env vars.
 *
 * KEPLR_RPC_API_KEY → config.rpc.apiKey
 * SKIP_API_KEY      → config.skip.apiKey
 * SKIP_API_URL      → config.skip.apiUrl
 */
const mergeEnvVars = (config: KeplrMcpConfig): KeplrMcpConfig => {
  let merged = config;

  const envRpcApiKey = process.env.KEPLR_RPC_API_KEY;
  if (envRpcApiKey && !merged.rpc?.apiKey) {
    merged = { ...merged, rpc: { ...merged.rpc, apiKey: envRpcApiKey } };
  }

  const envSkipApiKey = process.env.SKIP_API_KEY;
  if (envSkipApiKey && !merged.skip?.apiKey) {
    merged = { ...merged, skip: { ...merged.skip, apiKey: envSkipApiKey } };
  }

  const envSkipApiUrl = process.env.SKIP_API_URL;
  if (envSkipApiUrl && !merged.skip?.apiUrl) {
    merged = { ...merged, skip: { ...merged.skip, apiUrl: envSkipApiUrl } };
  }

  return merged;
};

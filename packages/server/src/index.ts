#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  checkVaultIntegrity,
  importFromEnvMnemonic,
  migrateFromLegacy,
  migrateToVault,
} from "./accounts.js";
import { loadConfig } from "./config/loader.js";
import { resolveExternalPlugin } from "./config/plugin-adapter.js";
import type { KeplrMcpPlugin } from "./config/types.js";
import { registerAll } from "./plugins/index.js";
import { registerKeplrGuidePrompt } from "./prompts/keplr-guide.js";
import { getRpcResolver } from "./rpc/resolver.js";
import { store } from "./store.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const server = new McpServer(
  {
    name: "keplr-wallet-mcp",
    version,
  },
  {
    capabilities: {
      logging: {},
      completions: {},
    },
    instructions:
      "When first connecting or if the user's wallet setup status is unknown, " +
      "call the `onboarding-status` tool to check setup progress and guide the user through any remaining steps.\n\n" +
      "IMPORTANT: Do NOT guess Cosmos chain IDs — they are often non-obvious " +
      "(e.g., 'nyx' for Nym, 'phoenix-1' for Terra, 'columbus-5' for Terra Classic). " +
      "Always call list-cosmos-chains to verify the correct chain ID before using any chain-dependent tool.",
  },
);

async function main() {
  // Load keplr-mcp.config.ts if present
  const config = await loadConfig();

  // Initialize RPC/LCD endpoint resolver (before any client usage)
  const apiKey = process.env.KEPLR_RPC_API_KEY ?? config.rpc?.apiKey;
  getRpcResolver({
    apiKey,
    overrides: config.rpc?.overrides,
  });
  console.error(
    `[keplr] RPC mode: ${apiKey ? "Keplr infrastructure (API key configured)" : "public endpoints (no KEPLR_RPC_API_KEY)"}`,
  );

  // Resolve external plugins from config
  const externalPlugins: KeplrMcpPlugin[] = [];
  for (const entry of config.plugins ?? []) {
    if (typeof entry === "string") {
      // Dynamic import of npm package (e.g., "my-keplr-plugin")
      const mod = await import(entry);
      const factory = mod.default ?? mod;
      const resolved = typeof factory === "function" ? factory() : factory;
      const plugins = Array.isArray(resolved) ? resolved : [resolved];
      externalPlugins.push(...plugins);
    } else {
      const resolved = resolveExternalPlugin(entry);
      const plugins = Array.isArray(resolved) ? resolved : [resolved];
      externalPlugins.push(...plugins);
    }
  }

  // Import account from KEPLR_MNEMONIC env var if set
  const envImported = await importFromEnvMnemonic();

  // Migrate legacy storage if needed (skip when running with env mnemonic only,
  // since migration requires keytar which may not be available in CI environments)
  if (!envImported) {
    await migrateFromLegacy();

    try {
      await migrateToVault();
    } catch (err) {
      console.error(
        "[keplr] Vault migration encountered an error (continuing with startup):",
        (err as Error).message,
      );
    }
  }

  // Vault integrity check with auto-repair
  try {
    const integrity = await checkVaultIntegrity({ repair: true });
    if (integrity.orphaned.length > 0) {
      console.error(
        `[keplr] WARNING: accounts missing vault files: ${integrity.orphaned.join(", ")}`,
      );
    }
    if (integrity.keyMissing.length > 0) {
      console.error(
        `[keplr] WARNING: accounts with inaccessible vault keys: ${integrity.keyMissing.join(", ")}`,
      );
    }
    if (integrity.dangling.length > 0) {
      console.error(
        `[keplr] INFO: orphan vault files without account entries: ${integrity.dangling.join(", ")}`,
      );
    }
    if (integrity.corrupt.length > 0) {
      console.error(
        `[keplr] WARNING: accounts with corrupt vault files: ${integrity.corrupt.join(", ")}`,
      );
    }
    if (integrity.repaired.length > 0) {
      console.error(
        `[keplr] Repaired ${integrity.repaired.length} vault(s): ${integrity.repaired.join(", ")}`,
      );
    }
    if (integrity.keychainError.length > 0) {
      console.error(
        `[keplr] WARNING: keychain access failed for: ${integrity.keychainError.join(", ")} (keychain may be locked)`,
      );
    }
    if (integrity.unrecoverable.length > 0) {
      console.error(
        `[keplr] WARNING: ${integrity.unrecoverable.length} account(s) unrecoverable (re-import required): ${integrity.unrecoverable.join(", ")}`,
      );
    }
  } catch (err) {
    console.error(
      "[keplr] Vault integrity check failed (continuing):",
      (err as Error).message,
    );
  }

  await registerAll(
    server,
    store.getState(),
    externalPlugins,
    config.toolsets?.default,
  );
  registerKeplrGuidePrompt(server);
  store.getState().startCleanupTimer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

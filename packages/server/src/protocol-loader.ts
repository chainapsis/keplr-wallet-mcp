import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProtocolPlugin,
  type ProtocolPlugin,
} from "./plugins/protocol-types.js";
import { checkVersionCompatibility } from "./version.js";

const PROTOCOL_PREFIXES = ["@keplr-wallet/protocol-", "keplr-protocol-"];

export async function discoverProtocolPlugins(): Promise<ProtocolPlugin[]> {
  const packageNames = new Set<string>();

  // 1. Scan server's package.json for convention-matching dependencies
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(thisDir, "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const dep of Object.keys(allDeps)) {
      if (PROTOCOL_PREFIXES.some((p) => dep.startsWith(p))) {
        packageNames.add(dep);
      }
    }
  } catch {
    /* scan failure is non-fatal */
  }

  // 2. Explicit list via environment variable
  const env = process.env.KEPLR_PROTOCOLS;
  if (env) {
    for (const name of env.split(",")) {
      const trimmed = name.trim();
      if (trimmed) packageNames.add(trimmed);
    }
  }

  // 3. Dynamic import + validation
  const protocols: ProtocolPlugin[] = [];
  for (const name of packageNames) {
    try {
      const mod = await import(name);
      const factory = mod.default;
      if (typeof factory !== "function") {
        console.error(
          `[keplr] "${name}" does not export a default function. Skipping.`,
        );
        continue;
      }
      const plugin = factory();
      if (!isProtocolPlugin(plugin)) {
        console.error(
          `[keplr] "${name}" returned invalid ProtocolPlugin shape. Skipping.`,
        );
        continue;
      }

      // Check SDK version compatibility
      const versionCheck = checkVersionCompatibility(
        plugin.sdkVersion,
        plugin.protocolId,
      );
      if (!versionCheck.compatible) {
        console.error(`[keplr] ${versionCheck.warning}. Skipping.`);
        continue;
      }
      if (versionCheck.warning) {
        console.error(`[keplr] Warning: ${versionCheck.warning}`);
      }

      protocols.push(plugin);
      console.error(`[keplr] Loaded protocol: ${plugin.protocolId}`);
    } catch (err) {
      console.error(
        `[keplr] Failed to load protocol "${name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return protocols;
}

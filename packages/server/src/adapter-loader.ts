import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EcosystemAdapter } from "./ecosystem.js";
import { checkVersionCompatibility } from "./version.js";

const ADAPTER_PREFIXES = ["@keplr-wallet/adapter-", "keplr-adapter-"];

export async function discoverExternalAdapters(): Promise<EcosystemAdapter[]> {
  const packageNames = new Set<string>();

  // 1. Scan server's package.json for convention-matching dependencies
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(thisDir, "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const dep of Object.keys(allDeps)) {
      if (ADAPTER_PREFIXES.some((p) => dep.startsWith(p))) {
        packageNames.add(dep);
      }
    }
  } catch {
    /* scan failure is non-fatal */
  }

  // 2. Explicit list via environment variable
  const env = process.env.KEPLR_ADAPTERS;
  if (env) {
    for (const name of env.split(",")) {
      const trimmed = name.trim();
      if (trimmed) packageNames.add(trimmed);
    }
  }

  // 3. Dynamic import + duck-type validation
  const adapters: EcosystemAdapter[] = [];
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
      const adapter = factory();
      if (!isValidAdapter(adapter)) {
        console.error(
          `[keplr] "${name}" returned invalid adapter shape. Skipping.`,
        );
        continue;
      }

      // Check SDK version compatibility
      const versionCheck = checkVersionCompatibility(
        adapter.sdkVersion,
        adapter.displayName,
      );
      if (!versionCheck.compatible) {
        console.error(`[keplr] ${versionCheck.warning}. Skipping.`);
        continue;
      }
      if (versionCheck.warning) {
        console.error(`[keplr] Warning: ${versionCheck.warning}`);
      }

      adapters.push(adapter);
      console.error(`[keplr] Loaded external adapter: ${adapter.displayName}`);
    } catch (err) {
      console.error(
        `[keplr] Failed to load "${name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return adapters;
}

function isValidAdapter(obj: unknown): obj is EcosystemAdapter {
  if (typeof obj !== "object" || obj === null) return false;
  const a = obj as Record<string, unknown>;
  return (
    typeof a.type === "string" &&
    typeof a.displayName === "string" &&
    typeof a.createClient === "function" &&
    typeof a.getPlugins === "function"
  );
}

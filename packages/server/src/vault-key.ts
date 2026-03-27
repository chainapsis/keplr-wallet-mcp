import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolveBiometricBinary } from "./native/resolve.js";

const execFileAsync = promisify(execFile);

/**
 * Thrown when the user explicitly cancels a biometric (Touch ID) prompt.
 * Callers should treat this as a hard stop — never fall back to less-secure storage.
 */
export class BiometricCancelledError extends Error {
  constructor() {
    super("Biometric authentication was cancelled by user");
    this.name = "BiometricCancelledError";
  }
}

/** Check stderr from the native binary for auth rejection.
 *  `error:cancelled`    = user tapped Cancel (LAContext).
 *  `error:fallback`     = user tapped "Use Password" on biometrics-only prompt.
 *  `error:failed`       = wrong Touch ID / Mac password (LAContext auth failed).
 *  `failed:-128`        = user cancelled OS Keychain password prompt (errSecUserCanceled).
 *                         Occurs with --skip-auth when binary cdhash doesn't match ACL. */
const isBiometricCancelled = (err: unknown): boolean => {
  const stderr = (err as { stderr?: string })?.stderr;
  if (typeof stderr !== "string") return false;
  return (
    stderr.includes("error:cancelled") ||
    stderr.includes("error:fallback") ||
    stderr.includes("error:failed") ||
    stderr.includes("failed:-128")
  );
};

/**
 * Extract the numeric exit code from a child_process error.
 * `util.promisify(execFile)` puts the exit code in `err.code` as a number.
 * (Note: `err.code` can also be a string error code like "ERR_..." for spawn
 * failures, so we only return it when it's a number.)
 */
const getExitCode = (err: unknown): number | null => {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "number" ? code : null;
};

// Lazy-load keytar to allow running without native binding (e.g. CI with KEPLR_MNEMONIC).
let _keytar: typeof import("keytar") | undefined;
async function getKeytar(): Promise<typeof import("keytar")> {
  if (!_keytar) {
    _keytar = (await import("keytar"))
      .default as unknown as typeof import("keytar");
  }
  return _keytar;
}

const BIOMETRIC_AUTH = resolveBiometricBinary();

// Service name used by keytar (legacy, used for migration and Linux).
const LEGACY_SERVICE = "keplr-mcp-server";

function nativeAvailable(): boolean {
  // Guard: vitest setup sets this env var to prevent tests from accidentally
  // accessing the real system keychain via the native BiometricAuth binary.
  // Tests that need to exercise the native code path mock child_process instead.
  if (process.env.__KEPLR_TEST_NO_NATIVE_KEYCHAIN) return false;
  return BIOMETRIC_AUTH !== null && existsSync(BIOMETRIC_AUTH);
}

/**
 * Vault operations always skip native biometric prompts.
 * Authentication is handled by the app's auth system (AuthManager),
 * not by the native keychain binary. The vault-level Touch ID is a
 * legacy defense-in-depth layer that will be fully removed when
 * pubkeys are stored as files instead of in the keychain.
 */
function shouldSkipNativeAuth(): boolean {
  return true;
}

async function nativeLoad(account: string): Promise<Buffer | null> {
  const args = ["vault-retrieve", account, "Keplr MCP: unlock wallet"];
  if (shouldSkipNativeAuth()) args.push("--skip-auth");
  try {
    const { stdout } = await execFileAsync(BIOMETRIC_AUTH!, args);
    const b64 = stdout.trim();
    if (!b64) return null;
    return Buffer.from(b64, "base64");
  } catch (err) {
    if (isBiometricCancelled(err)) throw new BiometricCancelledError();
    // Exit code 1 = not found, 2 = biometric unavailable — both are non-fatal.
    const exitCode = getExitCode(err);
    if (exitCode === 1 || exitCode === 2) return null;
    throw err;
  }
}

async function nativeDelete(account: string): Promise<void> {
  const args = ["vault-delete", account];
  if (shouldSkipNativeAuth()) args.push("--skip-auth");
  try {
    await execFileAsync(BIOMETRIC_AUTH!, args);
  } catch (err) {
    if (isBiometricCancelled(err)) throw new BiometricCancelledError();
    const exitCode = getExitCode(err);
    // Exit code 1 = not found — safe to ignore
    if (exitCode === 1) return;
    // Exit code 2 = biometric unavailable — can't delete native key but not a user action
    if (exitCode === 2) return;
    // Any other error (OS Keychain denial, unknown) — propagate
    throw err;
  }
}

/**
 * Store a vault key via keytar (OS credential store, no biometric prompt).
 * Write-verify: immediately re-reads the stored key to detect silent write failures.
 */
export async function storeVaultKey(
  account: string,
  key: Buffer,
): Promise<void> {
  const kt = await getKeytar();
  const b64 = key.toString("base64");
  await kt.setPassword(LEGACY_SERVICE, account, b64);
  const readBack = await kt.getPassword(LEGACY_SERVICE, account);
  if (readBack !== b64) {
    throw new Error("Keytar store write-verify failed");
  }
}

/**
 * Load a vault key from keytar (primary) with native migration fallback.
 * Keytar is checked first — no biometric prompt if the key is already there.
 * If keytar is empty and the native binary is available, attempts a one-time
 * migration from native keychain → keytar.
 */
export async function loadVaultKey(account: string): Promise<Buffer | null> {
  return loadVaultKeyFromKeychain(account);
}

/**
 * Keytar-first loader with native migration fallback.
 */
async function loadVaultKeyFromKeychain(
  account: string,
): Promise<Buffer | null> {
  const kt = await getKeytar();
  const b64 = await kt.getPassword(LEGACY_SERVICE, account);
  if (b64) return Buffer.from(b64, "base64");

  // Migration: native keychain → keytar (one-time)
  if (nativeAvailable()) {
    let nativeKey: Buffer | null = null;
    try {
      nativeKey = await nativeLoad(account);
      if (nativeKey) {
        await kt.setPassword(
          LEGACY_SERVICE,
          account,
          nativeKey.toString("base64"),
        );
      }
    } catch (err) {
      // User explicitly cancelled — propagate so callers can distinguish from "not found"
      if (err instanceof BiometricCancelledError) throw err;
      // Other migration failures (binary crash, keytar write failure, etc.)
      // — return whatever we managed to load so the caller isn't blocked
    }
    if (nativeKey) return nativeKey;
  }

  return null;
}

/**
 * Check if a vault key exists in keytar (no Touch ID required).
 * Used for integrity checks where Touch ID prompts must be avoided.
 */
export async function checkVaultKeyInKeytar(account: string): Promise<boolean> {
  const b64 = await (await getKeytar()).getPassword(LEGACY_SERVICE, account);
  return b64 !== null;
}

/**
 * Check if a vault key exists in the native macOS keychain without Touch ID.
 * Uses `vault-check` which queries keychain attributes only (no data access).
 *
 * Returns:
 * - "accessible": key found in native keychain
 * - "missing": key not found (errSecItemNotFound)
 * - "error": keychain error (e.g. locked, inaccessible)
 */
export async function checkVaultKeyInNative(
  account: string,
): Promise<"accessible" | "missing" | "error"> {
  if (!nativeAvailable()) return "missing";
  try {
    await execFileAsync(BIOMETRIC_AUTH!, ["vault-check", account]);
    return "accessible";
  } catch (err) {
    const exitCode = getExitCode(err);
    if (exitCode === 1) return "missing";
    return "error";
  }
}

/**
 * Check if native macOS keychain (Touch ID) is available.
 */
export const isNativeKeychainAvailable = nativeAvailable;

/**
 * Delete a vault key from the OS Keychain.
 * Cleans up both native and legacy keytar entries.
 */
export async function deleteVaultKey(account: string): Promise<void> {
  if (nativeAvailable()) {
    await nativeDelete(account);
  }
  // Always clean up legacy keytar entry too (idempotent).
  await (await getKeytar())
    .deletePassword(LEGACY_SERVICE, account)
    .catch(() => {});
}

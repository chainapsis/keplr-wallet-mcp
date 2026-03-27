import { randomBytes } from "node:crypto";
import { EnglishMnemonic } from "@cosmjs/crypto";
import { readJsonConfig, writeJsonConfig } from "./config-storage.js";
import type { KeyProviderType } from "./keys/types.js";
import {
  backupVaultFile,
  decryptMnemonic,
  deleteVaultFile,
  encryptMnemonic,
  listVaultFiles,
  readVaultFile,
  renameVaultFile,
  restoreVaultFromBackup,
  writeVaultFile,
} from "./vault.js";
import {
  checkVaultKeyInKeytar,
  checkVaultKeyInNative,
  deleteVaultKey,
  loadVaultKey,
  storeVaultKey,
} from "./vault-key.js";

// Lazy-load keytar to allow running without native binding (e.g. CI with KEPLR_MNEMONIC).
let _keytar: typeof import("keytar") | undefined;
async function getKeytar(): Promise<typeof import("keytar")> {
  if (!_keytar) {
    _keytar = (await import("keytar"))
      .default as unknown as typeof import("keytar");
  }
  return _keytar;
}

const ENV_MNEMONIC_ACCOUNT_NAME = "env";
const SERVICE_NAME = "keplr-mcp-server";
const LEGACY_ACCOUNT_NAME = "mnemonic";
const ACCOUNTS_CONFIG_FILE = "accounts.json";
/**
 * Current accounts config version.
 * - v1: Legacy format (no type field)
 * - v2: Added account types (mnemonic)
 * - v3: Uses KeyProviderType for extensibility (passkey, smart-account)
 */
const CURRENT_CONFIG_VERSION = 3;

/**
 * Account type
 * @deprecated Use KeyProviderType from keys/types.ts for new code
 */
export type AccountType = "mnemonic";

/**
 * Account info stored in config (v3)
 *
 * v3 extends v2 by:
 * - Using KeyProviderType instead of AccountType for future extensibility
 * - Adding optional fields for new key types (passkey, smart-account)
 */
export interface AccountInfo {
  /** Key provider type. For backward compatibility, also accepts v2 AccountType. */
  type: KeyProviderType;
  createdAt: string;
  description?: string;

  // Passkey-specific fields (future)
  /** For Passkey accounts: WebAuthn credential ID */
  passkeyCredentialId?: string;
  /** For Passkey accounts: public key from registration */
  passkeyPublicKey?: string;

  // Smart Account-specific fields (future)
  /** For Smart Account: the deployed account address */
  smartAccountAddress?: string;
  /** For Smart Account: factory contract address */
  smartAccountFactoryAddress?: string;
  /** For Passkey/Smart Account: chain ID where the account was created */
  passkeyChainId?: number;
}

/**
 * Configuration structure for accounts stored in ~/.keplr-mcp/accounts.json
 *
 * Version history:
 * - v1: Legacy format (no type field)
 * - v2: Added account types
 * - v3: Uses KeyProviderType for extensibility (passkey, smart-account)
 */
export interface AccountsConfig {
  version: 1 | 2 | 3;
  activeAccount: string | null;
  accounts: Record<string, AccountInfo>;
}

/**
 * Legacy v1 account info (no type field)
 */
interface LegacyAccountInfo {
  createdAt: string;
  description?: string;
}

/**
 * Legacy v2 account info (uses AccountType instead of KeyProviderType)
 */
interface LegacyV2AccountInfo {
  type: "mnemonic";
  createdAt: string;
  description?: string;
  ecosystem?: "evm" | "cosmos";
  address?: string;
}

/**
 * Get the legacy keychain account key.
 * Format: "account:{name}"
 */
function getKeychainKey(name: string): string {
  return `account:${name}`;
}

/**
 * Get the keychain key for storing the vault encryption key.
 * Format: "vault-key:{name}"
 */
function getVaultKeyChainKey(name: string): string {
  return `vault-key:${name}`;
}

/**
 * Save a mnemonic for a specific account.
 * Stores the mnemonic in an AES-256-GCM encrypted vault file.
 * The vault encryption key is stored in the OS Keychain.
 */
export async function saveMnemonicForAccount(
  name: string,
  mnemonic: string,
): Promise<void> {
  const vaultKey = randomBytes(32);
  try {
    const vault = encryptMnemonic(mnemonic, vaultKey);
    await writeVaultFile(name, vault);
    // If storeVaultKey fails, the .enc file is preserved (fail-closed).
    // An orphan .enc without its key is harmless and avoids data loss.
    await storeVaultKey(getVaultKeyChainKey(name), vaultKey);
    // Best-effort backup (non-fatal — backupVaultFile catches internally,
    // .catch() is defense-in-depth)
    await backupVaultFile(name).catch(() => {});
  } finally {
    vaultKey.fill(0);
  }
}

/**
 * Load the mnemonic for a specific account.
 * Reads from AES-256-GCM encrypted vault file.
 * For "env" accounts, reads directly from KEPLR_MNEMONIC environment variable.
 */
export async function loadMnemonicForAccount(
  name: string,
): Promise<string | null> {
  // "env" account reads directly from the environment variable
  if (name === ENV_MNEMONIC_ACCOUNT_NAME) {
    const envMnemonic = process.env.KEPLR_MNEMONIC?.trim();
    if (!envMnemonic) {
      console.error(
        '[keplr] KEPLR_MNEMONIC env var is no longer set but "env" account mnemonic was requested',
      );
      return null;
    }
    return envMnemonic;
  }

  const vault = await readVaultFile(name);
  if (!vault) {
    return null;
  }
  const vaultKey = await loadVaultKey(getVaultKeyChainKey(name));
  if (!vaultKey) {
    console.error(
      `[keplr] Vault key not found or access denied for account "${name}". ` +
        `The vault file exists but cannot be decrypted.`,
    );
    return null;
  }
  try {
    return decryptMnemonic(vault, vaultKey);
  } finally {
    vaultKey.fill(0);
  }
}

/**
 * Delete the mnemonic for a specific account.
 * Deletes the vault file and vault key from keychain.
 */
export async function deleteMnemonicForAccount(name: string): Promise<boolean> {
  // Delete vault key first — if this throws (user cancel), vault file is preserved
  await deleteVaultKey(getVaultKeyChainKey(name));
  const vaultDeleted = await deleteVaultFile(name);
  // Also clean up legacy keytar entry if present
  await (await getKeytar()).deletePassword(SERVICE_NAME, getKeychainKey(name));
  return vaultDeleted;
}

/**
 * Raw config as stored on disk (may be any version)
 */
interface RawAccountsConfig {
  version: 1 | 2 | 3;
  activeAccount: string | null;
  accounts: Record<string, unknown>;
}

/**
 * Load the accounts configuration from disk.
 * Migrates v1/v2 config to v3 if needed.
 */
export async function loadAccountsConfig(): Promise<AccountsConfig> {
  const config = await readJsonConfig<RawAccountsConfig>(ACCOUNTS_CONFIG_FILE);
  if (config) {
    // Migrate older versions
    if (config.version === 1) {
      const v2Config = migrateConfigV1ToV2(
        config as unknown as {
          version: 1;
          activeAccount: string | null;
          accounts: Record<string, LegacyAccountInfo>;
        },
      );
      return migrateConfigV2ToV3(v2Config);
    }
    if (config.version === 2) {
      return migrateConfigV2ToV3(
        config as unknown as {
          version: 2;
          activeAccount: string | null;
          accounts: Record<string, LegacyV2AccountInfo>;
        },
      );
    }
    return config as AccountsConfig;
  }
  // Return default empty config
  return {
    version: CURRENT_CONFIG_VERSION as 3,
    activeAccount: null,
    accounts: {},
  };
}

/**
 * Migrate v1 config to v2 by adding type field to all accounts.
 */
function migrateConfigV1ToV2(config: {
  version: 1;
  activeAccount: string | null;
  accounts: Record<string, LegacyAccountInfo>;
}): {
  version: 2;
  activeAccount: string | null;
  accounts: Record<string, LegacyV2AccountInfo>;
} {
  const migratedAccounts: Record<string, LegacyV2AccountInfo> = {};

  for (const [name, info] of Object.entries(config.accounts)) {
    migratedAccounts[name] = {
      type: "mnemonic", // All v1 accounts are mnemonic-based
      createdAt: info.createdAt,
      description: info.description,
    };
  }

  return {
    version: 2,
    activeAccount: config.activeAccount,
    accounts: migratedAccounts,
  };
}

/**
 * Migrate v2 config to v3.
 * v2 and v3 have the same structure for mnemonic types,
 * but v3 allows additional KeyProviderType values.
 */
function migrateConfigV2ToV3(config: {
  version: 2;
  activeAccount: string | null;
  accounts: Record<string, LegacyV2AccountInfo>;
}): AccountsConfig {
  const migratedAccounts: Record<string, AccountInfo> = {};

  for (const [name, info] of Object.entries(config.accounts)) {
    migratedAccounts[name] = {
      type: info.type as KeyProviderType,
      createdAt: info.createdAt,
      description: info.description,
      ...(info.ecosystem === "cosmos" && { ecosystem: info.ecosystem }),
      ...(info.address && { address: info.address }),
    };
  }

  return {
    version: 3,
    activeAccount: config.activeAccount,
    accounts: migratedAccounts,
  };
}

/**
 * Save the accounts configuration to disk.
 */
export async function saveAccountsConfig(
  config: AccountsConfig,
): Promise<void> {
  // Ensure version is current when saving
  config.version = CURRENT_CONFIG_VERSION as 3;
  await writeJsonConfig(ACCOUNTS_CONFIG_FILE, config);
}

/**
 * Get the currently active account name.
 */
export async function getActiveAccount(): Promise<string | null> {
  const config = await loadAccountsConfig();
  return config.activeAccount;
}

/**
 * Get the currently active account info.
 */
export async function getActiveAccountInfo(): Promise<AccountInfo | null> {
  const config = await loadAccountsConfig();
  if (!config.activeAccount) {
    return null;
  }
  return config.accounts[config.activeAccount] || null;
}

/**
 * Set the active account.
 * @throws Error if the account doesn't exist
 */
export async function setActiveAccount(name: string): Promise<void> {
  const config = await loadAccountsConfig();
  if (!config.accounts[name]) {
    throw new Error(`Account "${name}" does not exist.`);
  }
  config.activeAccount = name;
  await saveAccountsConfig(config);
}

/**
 * Add a new mnemonic-based account to the configuration.
 * Does not save the mnemonic - call saveMnemonicForAccount separately.
 */
export async function addAccount(
  name: string,
  description?: string,
): Promise<void> {
  const config = await loadAccountsConfig();
  if (config.accounts[name]) {
    throw new Error(`Account "${name}" already exists.`);
  }
  config.accounts[name] = {
    type: "mnemonic",
    createdAt: new Date().toISOString(),
    description,
  };
  // If this is the first account, make it active
  if (config.activeAccount === null) {
    config.activeAccount = name;
  }
  await saveAccountsConfig(config);
}

/**
 * Remove an account from the configuration.
 * Does not delete the mnemonic - call appropriate cleanup separately.
 */
export async function removeAccount(name: string): Promise<boolean> {
  const config = await loadAccountsConfig();
  if (!config.accounts[name]) {
    return false;
  }
  delete config.accounts[name];
  // If this was the active account, clear it or set to another
  if (config.activeAccount === name) {
    const remaining = Object.keys(config.accounts);
    config.activeAccount = remaining.length > 0 ? remaining[0] : null;
  }
  await saveAccountsConfig(config);
  return true;
}

/**
 * Rename an account.
 */
export async function renameAccount(
  oldName: string,
  newName: string,
): Promise<void> {
  const config = await loadAccountsConfig();
  if (!config.accounts[oldName]) {
    throw new Error(`Account "${oldName}" does not exist.`);
  }
  if (config.accounts[newName]) {
    throw new Error(`Account "${newName}" already exists.`);
  }

  const accountInfo = config.accounts[oldName];

  if (accountInfo.type === "mnemonic") {
    // New vault-based storage
    const vaultKey = await loadVaultKey(getVaultKeyChainKey(oldName));
    if (vaultKey) {
      try {
        // Rename vault file first.
        // - If renameVaultFile throws: keychain is unchanged, vault still at oldName (fully recoverable).
        // - If storeVaultKey throws: vault file is rolled back to oldName (see catch below).
        await renameVaultFile(oldName, newName);
        try {
          await storeVaultKey(getVaultKeyChainKey(newName), vaultKey);
        } catch (err) {
          // Rollback: rename vault file back so oldName is fully accessible again.
          await renameVaultFile(newName, oldName).catch((rollbackErr) => {
            console.error(
              `[keplr] CRITICAL: vault rename rollback failed. ` +
                `File at "${newName}.enc", key at "vault-key:${oldName}". ` +
                `Manual intervention required.`,
              (rollbackErr as Error).message,
            );
          });
          throw err;
        }
        // Best-effort cleanup — failure must not abort the rename that already succeeded
        await deleteVaultKey(getVaultKeyChainKey(oldName)).catch((err) => {
          console.error(
            `[keplr] Old vault key cleanup failed (non-fatal):`,
            (err as Error).message,
          );
        });
      } finally {
        vaultKey.fill(0);
      }
    } else {
      // Legacy fallback path (pre-vault accounts)
      const kt = await getKeytar();
      const mnemonic = await kt.getPassword(
        SERVICE_NAME,
        getKeychainKey(oldName),
      );
      if (mnemonic) {
        await saveMnemonicForAccount(newName, mnemonic);
        await kt.deletePassword(SERVICE_NAME, getKeychainKey(oldName));
      }
    }
  }

  // Update config
  config.accounts[newName] = config.accounts[oldName];
  delete config.accounts[oldName];
  if (config.activeAccount === oldName) {
    config.activeAccount = newName;
  }
  await saveAccountsConfig(config);
}

/**
 * List all accounts.
 */
export async function listAccounts(): Promise<AccountsConfig> {
  return loadAccountsConfig();
}

/**
 * Get the mnemonic for the currently active account.
 * Returns null if no account is active, account is not mnemonic-based,
 * or the mnemonic isn't stored.
 */
export async function getActiveMnemonic(): Promise<string | null> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) {
    return null;
  }

  const config = await loadAccountsConfig();
  const accountInfo = config.accounts[activeAccount];
  if (!accountInfo || accountInfo.type !== "mnemonic") {
    return null;
  }

  // "env" account reads directly from the environment variable on every call.
  // The mnemonic is never persisted to the OS keychain for this account type.
  if (activeAccount === ENV_MNEMONIC_ACCOUNT_NAME) {
    const envMnemonic = process.env.KEPLR_MNEMONIC?.trim();
    if (!envMnemonic) {
      console.error(
        "[keplr] KEPLR_MNEMONIC env var is no longer set but 'env' account is active",
      );
      return null;
    }
    return envMnemonic;
  }

  return loadMnemonicForAccount(activeAccount);
}

/**
 * Get the account type for a named account.
 * @deprecated Use getAccountKeyProviderType for new code
 */
export async function getAccountType(
  name: string,
): Promise<AccountType | null> {
  const config = await loadAccountsConfig();
  const accountInfo = config.accounts[name];
  const type = accountInfo?.type;
  // Only return legacy AccountType values for backward compatibility
  if (type === "mnemonic") {
    return type;
  }
  return null;
}

/**
 * Get the KeyProviderType for a named account.
 */
export async function getAccountKeyProviderType(
  name: string,
): Promise<KeyProviderType | null> {
  const config = await loadAccountsConfig();
  const accountInfo = config.accounts[name];
  return accountInfo?.type || null;
}

/**
 * Vault integrity check result.
 */
export interface VaultIntegrityResult {
  /** Accounts with valid vault file and accessible vault key */
  healthy: string[];
  /** Accounts in config but missing vault file */
  orphaned: string[];
  /** Accounts with vault file but inaccessible vault key */
  keyMissing: string[];
  /** Vault files on disk with no matching account entry */
  dangling: string[];
  /** Env or non-mnemonic accounts (not checked) */
  skipped: string[];
  /** Accounts with corrupt or unreadable vault files */
  corrupt: string[];
  /** Accounts successfully repaired (restored from backup or dangling cleaned) */
  repaired: string[];
  /** Accounts that could not be repaired (re-import required) */
  unrecoverable: string[];
  /** Accounts where keychain was inaccessible (e.g. locked) — retry later */
  keychainError: string[];
}

/**
 * Check vault integrity for all mnemonic accounts.
 *
 * Detects:
 * - Orphaned accounts: config entry exists but .enc file is missing
 * - Missing keys: .enc file exists but vault key not in any keychain
 * - Dangling vaults: .enc file exists but no account entry in config
 */
export async function checkVaultIntegrity(options?: {
  repair?: boolean;
  deleteDangling?: boolean;
}): Promise<VaultIntegrityResult> {
  const repair = options?.repair ?? false;
  const deleteDangling = options?.deleteDangling ?? false;
  const config = await loadAccountsConfig();
  const result: VaultIntegrityResult = {
    healthy: [],
    orphaned: [],
    keyMissing: [],
    dangling: [],
    skipped: [],
    corrupt: [],
    repaired: [],
    unrecoverable: [],
    keychainError: [],
  };

  const allAccountNames = new Set(Object.keys(config.accounts));

  for (const [name, info] of Object.entries(config.accounts)) {
    if (info.type !== "mnemonic" || name === ENV_MNEMONIC_ACCOUNT_NAME) {
      result.skipped.push(name);
      continue;
    }

    // Classify vault key status without prompting user interaction.
    // - "accessible": key found in keytar or native keychain
    // - "missing": key not found in any keychain
    // - "error": keychain error (e.g. locked) — cannot determine status
    const classifyKeyStatus = async (
      accountName: string,
    ): Promise<"accessible" | "missing" | "error"> => {
      const keychainKey = getVaultKeyChainKey(accountName);
      try {
        if (await checkVaultKeyInKeytar(keychainKey)) {
          return "accessible";
        }
      } catch {
        // keytar unavailable — continue to native check
      }
      return await checkVaultKeyInNative(keychainKey);
    };

    try {
      const vault = await readVaultFile(name);
      if (!vault) {
        if (repair) {
          const restored = await restoreVaultFromBackup(name);
          if (restored) {
            const keyStatus = await classifyKeyStatus(name);
            if (keyStatus === "accessible") {
              result.repaired.push(name);
            } else if (keyStatus === "error") {
              result.keychainError.push(name);
            } else {
              result.unrecoverable.push(name);
            }
          } else {
            result.unrecoverable.push(name);
          }
        } else {
          result.orphaned.push(name);
        }
        continue;
      }

      // Classify vault key status (keytar or native keychain).
      const keyStatus = await classifyKeyStatus(name);
      if (keyStatus === "accessible") {
        result.healthy.push(name);
      } else if (keyStatus === "error") {
        result.keychainError.push(name);
      } else {
        if (repair) {
          result.unrecoverable.push(name);
        } else {
          result.keyMissing.push(name);
        }
      }
    } catch (err) {
      console.error(
        `[keplr] Vault integrity: failed to read vault for "${name}":`,
        (err as Error).message,
      );
      if (repair) {
        const restored = await restoreVaultFromBackup(name);
        if (restored) {
          const keyStatus = await classifyKeyStatus(name);
          if (keyStatus === "accessible") {
            result.repaired.push(name);
          } else if (keyStatus === "error") {
            result.keychainError.push(name);
          } else {
            result.unrecoverable.push(name);
          }
        } else {
          result.unrecoverable.push(name);
        }
      } else {
        result.corrupt.push(name);
      }
    }
  }

  // Dangling: .enc files without matching account
  const vaultNames = await listVaultFiles();
  for (const vaultName of vaultNames) {
    if (!allAccountNames.has(vaultName)) {
      if (deleteDangling) {
        try {
          await deleteVaultFile(vaultName);
          result.repaired.push(vaultName);
        } catch {
          result.dangling.push(vaultName);
        }
      } else {
        result.dangling.push(vaultName);
      }
    }
  }

  return result;
}

/**
 * Check if an account exists.
 */
export async function accountExists(name: string): Promise<boolean> {
  const config = await loadAccountsConfig();
  return name in config.accounts;
}

/**
 * Import account from KEPLR_MNEMONIC environment variable.
 *
 * If the env var is set:
 * 1. Validates the mnemonic
 * 2. Creates an "env" account if it doesn't exist
 * 3. Updates the mnemonic if account exists but mnemonic differs
 * 4. Sets it as active account
 *
 * @returns true if account was imported/updated, false if env var not set
 */
export async function importFromEnvMnemonic(): Promise<boolean> {
  const envMnemonic = process.env.KEPLR_MNEMONIC;
  if (!envMnemonic) {
    return false;
  }

  const trimmed = envMnemonic.trim();

  // Validate mnemonic
  const words = trimmed.split(/\s+/);
  const validWordCounts = [12, 15, 18, 21, 24];
  if (!validWordCounts.includes(words.length)) {
    console.error(
      `[keplr] Invalid KEPLR_MNEMONIC: expected ${validWordCounts.join("/")} words, got ${words.length}`,
    );
    return false;
  }

  try {
    new EnglishMnemonic(trimmed);
  } catch {
    console.error(
      "[keplr] Invalid KEPLR_MNEMONIC: BIP39 checksum verification failed",
    );
    return false;
  }

  const config = await loadAccountsConfig();

  // Check if "env" account already exists
  if (config.accounts[ENV_MNEMONIC_ACCOUNT_NAME]) {
    // Account exists - env var is the source of truth, no keychain save needed.
    // Just ensure the account is active.
    if (config.activeAccount !== ENV_MNEMONIC_ACCOUNT_NAME) {
      config.activeAccount = ENV_MNEMONIC_ACCOUNT_NAME;
      await saveAccountsConfig(config);
      console.error(
        `[keplr] Switched to env account: ${ENV_MNEMONIC_ACCOUNT_NAME}`,
      );
    } else {
      console.error(
        `[keplr] Env account already active, KEPLR_MNEMONIC read on demand: ${ENV_MNEMONIC_ACCOUNT_NAME}`,
      );
    }
    return true;
  }

  // Create new "env" account (metadata only — mnemonic is never saved to keychain)
  console.error(
    `[keplr] Importing account from KEPLR_MNEMONIC as "${ENV_MNEMONIC_ACCOUNT_NAME}"...`,
  );

  config.accounts[ENV_MNEMONIC_ACCOUNT_NAME] = {
    type: "mnemonic",
    createdAt: new Date().toISOString(),
    description: "Imported from KEPLR_MNEMONIC environment variable",
  };
  config.activeAccount = ENV_MNEMONIC_ACCOUNT_NAME;
  await saveAccountsConfig(config);

  console.error(
    `[keplr] Account imported. Active account: ${ENV_MNEMONIC_ACCOUNT_NAME}`,
  );
  return true;
}

// ============================================================================
// ============================================================================
// Passkey Account Management
// ============================================================================

/**
 * Passkey account creation parameters.
 */
export interface PasskeyAccountParams {
  /** Account name */
  name: string;
  /** WebAuthn credential ID (base64url encoded) */
  credentialId: string;
  /** Public key from registration (base64url encoded) */
  publicKey: string;
  /** Smart account address (counterfactual) */
  smartAccountAddress: string;
  /** Factory contract address */
  factoryAddress: string;
  /** Initial chain ID */
  chainId: number;

  /** Optional description */
  description?: string;
}

/**
 * Add a new passkey-based account to the configuration.
 */
export async function addPasskeyAccount(
  params: PasskeyAccountParams,
): Promise<void> {
  const config = await loadAccountsConfig();
  if (config.accounts[params.name]) {
    throw new Error(`Account "${params.name}" already exists.`);
  }

  config.accounts[params.name] = {
    type: "passkey",
    createdAt: new Date().toISOString(),
    description: params.description,
    passkeyCredentialId: params.credentialId,
    passkeyPublicKey: params.publicKey,
    smartAccountAddress: params.smartAccountAddress,
    smartAccountFactoryAddress: params.factoryAddress,
    passkeyChainId: params.chainId,
  };

  // If this is the first account, make it active
  if (config.activeAccount === null) {
    config.activeAccount = params.name;
  }

  await saveAccountsConfig(config);
}

/**
 * Get passkey info for a named account.
 * Returns null if account doesn't exist or is not passkey-based.
 */
export async function getPasskeyAccountInfo(
  name: string,
): Promise<AccountInfo | null> {
  const config = await loadAccountsConfig();
  const accountInfo = config.accounts[name];
  if (!accountInfo || accountInfo.type !== "passkey") {
    return null;
  }
  return accountInfo;
}

/**
 * Get the passkey info for the currently active account.
 * Returns null if no account is active or account is not passkey-based.
 */
export async function getActivePasskeyInfo(): Promise<AccountInfo | null> {
  const activeAccount = await getActiveAccount();
  if (!activeAccount) {
    return null;
  }
  return getPasskeyAccountInfo(activeAccount);
}

/**
 * Get all passkey accounts.
 */
export async function getAllPasskeyAccounts(): Promise<
  Array<{ accountName: string; info: AccountInfo }>
> {
  const config = await loadAccountsConfig();
  const results: Array<{ accountName: string; info: AccountInfo }> = [];

  for (const [accountName, accountInfo] of Object.entries(config.accounts)) {
    if (accountInfo.type !== "passkey") {
      continue;
    }
    results.push({ accountName, info: accountInfo });
  }

  return results;
}

// ============================================================================
// Legacy Migration
// ============================================================================

/**
 * Migrate from the legacy keychain storage format.
 *
 * Legacy format: (keplr-mcp-server, mnemonic)
 * New format: (keplr-mcp-server, account:{name})
 *
 * If a legacy mnemonic is found:
 * 1. Creates a "default" account in accounts.json
 * 2. Moves the mnemonic to the new keychain key
 * 3. Deletes the legacy keychain entry
 *
 * @returns true if migration was performed, false otherwise
 */
export async function migrateFromLegacy(): Promise<boolean> {
  const kt = await getKeytar();
  const legacyMnemonic = await kt.getPassword(
    SERVICE_NAME,
    LEGACY_ACCOUNT_NAME,
  );
  if (!legacyMnemonic) {
    return false;
  }

  const config = await loadAccountsConfig();
  if (config.accounts.default) {
    // Already migrated, just clean up legacy key if it exists
    await kt.deletePassword(SERVICE_NAME, LEGACY_ACCOUNT_NAME);
    return false;
  }

  console.error("[keplr] Migrating legacy mnemonic to account:default...");

  await saveMnemonicForAccount("default", legacyMnemonic);

  config.accounts.default = {
    type: "mnemonic",
    createdAt: new Date().toISOString(),
    description: "Migrated from legacy storage",
  };
  config.activeAccount = "default";
  await saveAccountsConfig(config);

  await kt.deletePassword(SERVICE_NAME, LEGACY_ACCOUNT_NAME);

  console.error("[keplr] Migration complete. Active account: default");
  return true;
}

/**
 * Migrate mnemonic accounts from legacy keytar plaintext storage to vault format.
 *
 * For each mnemonic account:
 * - If old keytar entry (account:<name>) exists and vault file doesn't → encrypt to vault, delete old entry
 * - If vault already exists → just clean up old keytar entry if present
 * - Skips "env" account (reads from env var, no storage)
 *
 * @returns number of accounts migrated
 */
export async function migrateToVault(): Promise<number> {
  const config = await loadAccountsConfig();
  const kt = await getKeytar();
  let migrated = 0;

  for (const [name, info] of Object.entries(config.accounts)) {
    if (info.type !== "mnemonic" || name === ENV_MNEMONIC_ACCOUNT_NAME) {
      continue;
    }

    const keychainKey = getKeychainKey(name);
    const plaintext = await kt.getPassword(SERVICE_NAME, keychainKey);
    if (!plaintext) continue;

    const vault = await readVaultFile(name);
    if (!vault) {
      console.error(`[keplr] Migrating account "${name}" to vault...`);
      await saveMnemonicForAccount(name, plaintext);
      migrated++;
    }

    // Clean up legacy entry regardless
    await kt.deletePassword(SERVICE_NAME, keychainKey);
  }

  if (migrated > 0) {
    console.error(`[keplr] Migrated ${migrated} account(s) to vault format.`);
  }
  return migrated;
}

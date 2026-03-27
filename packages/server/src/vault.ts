import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { getConfigDir } from "./config-storage.js";

const execFileAsync = promisify(execFile);

const VAULT_VERSION = 1;
const VAULTS_SUBDIR = "vaults";
const VAULTS_BACKUP_SUBDIR = "vaults-backup";

export interface EncryptedVault {
  version: number;
  iv: string; // base64, 12 bytes
  ciphertext: string; // base64
  authTag: string; // base64, 16 bytes
}

// ── Encrypt / Decrypt ─────────────────────────────────────────────────────

export function encryptMnemonic(
  mnemonic: string,
  vaultKey: Buffer,
): EncryptedVault {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(mnemonic, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    version: VAULT_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptMnemonic(
  vault: EncryptedVault,
  vaultKey: Buffer,
): string {
  const iv = Buffer.from(vault.iv, "base64");
  const ciphertext = Buffer.from(vault.ciphertext, "base64");
  const authTag = Buffer.from(vault.authTag, "base64");

  const decipher = createDecipheriv("aes-256-gcm", vaultKey, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const mnemonic = plaintext.toString("utf-8");
  // Zero the Buffer to reduce window for memory scraping.
  // Note: the `mnemonic` string is a JS immutable primitive on the V8 heap
  // and cannot be explicitly zeroed — this is a known limitation of JS.
  plaintext.fill(0);
  return mnemonic;
}

// ── File I/O ──────────────────────────────────────────────────────────────

function getVaultsDir(): string {
  return join(getConfigDir(), VAULTS_SUBDIR);
}

function validateAccountName(accountName: string): void {
  if (accountName.includes("/") || accountName.includes("\\")) {
    throw new Error(`Invalid account name: ${accountName}`);
  }
}

function getVaultFilePath(accountName: string): string {
  validateAccountName(accountName);
  const vaultsDir = getVaultsDir();
  const resolved = resolve(vaultsDir, `${accountName}.enc`);
  if (!resolved.startsWith(vaultsDir + sep)) {
    throw new Error(`Invalid account name: ${accountName}`);
  }
  return resolved;
}

function getBackupFilePath(accountName: string): string {
  validateAccountName(accountName);
  const backupDir = join(getConfigDir(), VAULTS_BACKUP_SUBDIR);
  const resolved = resolve(backupDir, `${accountName}.enc`);
  if (!resolved.startsWith(backupDir + sep)) {
    throw new Error(`Invalid account name: ${accountName}`);
  }
  return resolved;
}

async function ensureVaultsDir(): Promise<void> {
  await mkdir(getVaultsDir(), { recursive: true, mode: 0o700 });
}

// ── macOS immutable flag ─────────────────────────────────────────────────

async function setImmutable(filePath: string): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await execFileAsync("chflags", ["uchg", filePath]);
  } catch {
    // Non-fatal: immutability is a defense-in-depth measure
  }
}

async function clearImmutable(filePath: string): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await execFileAsync("chflags", ["nouchg", filePath]);
  } catch {
    // Non-fatal: file may not have the flag set
  }
}

function validateEncryptedVault(parsed: unknown): EncryptedVault {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).version !== "number" ||
    typeof (parsed as Record<string, unknown>).iv !== "string" ||
    typeof (parsed as Record<string, unknown>).ciphertext !== "string" ||
    typeof (parsed as Record<string, unknown>).authTag !== "string"
  ) {
    throw new Error("Invalid vault file: missing required fields");
  }
  return parsed as EncryptedVault;
}

export async function readVaultFile(
  accountName: string,
): Promise<EncryptedVault | null> {
  try {
    const content = await readFile(getVaultFilePath(accountName), "utf-8");
    return validateEncryptedVault(JSON.parse(content));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeVaultFile(
  accountName: string,
  vault: EncryptedVault,
): Promise<void> {
  const finalPath = getVaultFilePath(accountName);
  const tmpPath = `${finalPath}.tmp`;
  await ensureVaultsDir();
  await writeFile(tmpPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await clearImmutable(finalPath);
  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    // Clean up orphan .tmp to avoid leaving unprotected secrets on disk
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
  await setImmutable(finalPath);
}

export async function deleteVaultFile(accountName: string): Promise<boolean> {
  const filePath = getVaultFilePath(accountName);
  try {
    await clearImmutable(filePath);
    await unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export async function renameVaultFile(
  oldName: string,
  newName: string,
): Promise<void> {
  const oldPath = getVaultFilePath(oldName);
  const newPath = getVaultFilePath(newName);
  await ensureVaultsDir();
  await clearImmutable(oldPath);
  await rename(oldPath, newPath);
  await setImmutable(newPath);
}

/**
 * Back up a vault file to ~/.keplr-mcp/vaults-backup/.
 * Non-fatal: failure is logged but does not throw.
 * Scope: protects against external file deletion (path A). Does NOT protect
 * against vault key loss — that requires separate key backup mechanisms.
 */
export async function backupVaultFile(accountName: string): Promise<void> {
  try {
    const srcPath = getVaultFilePath(accountName);
    const destPath = getBackupFilePath(accountName);
    await mkdir(join(getConfigDir(), VAULTS_BACKUP_SUBDIR), {
      recursive: true,
      mode: 0o700,
    });
    await copyFile(srcPath, destPath);
  } catch (err) {
    console.error(
      `[keplr] Vault backup failed for "${accountName}":`,
      (err as Error).message,
    );
  }
}

/**
 * Restore a vault file from backup.
 * Returns true if restore succeeded, false if no backup or backup is invalid.
 */
export const restoreVaultFromBackup = async (
  accountName: string,
): Promise<boolean> => {
  try {
    const backupPath = getBackupFilePath(accountName);
    const content = await readFile(backupPath, "utf-8");
    const vault = validateEncryptedVault(JSON.parse(content));
    await writeVaultFile(accountName, vault);
    const verified = await readVaultFile(accountName);
    return verified !== null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[keplr] Vault restore failed for "${accountName}":`,
        (err as Error).message,
      );
    }
    return false;
  }
};

/**
 * List account names that have vault files on disk.
 */
export async function listVaultFiles(): Promise<string[]> {
  try {
    const files = await readdir(getVaultsDir());
    return files.filter((f) => f.endsWith(".enc")).map((f) => f.slice(0, -4));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

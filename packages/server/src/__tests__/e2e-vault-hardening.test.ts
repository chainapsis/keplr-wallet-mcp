import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Layer 1: Explicitly mock vault-key.js to prevent any keychain access.
// These tests verify vault FILE operations (encryption, backup, restore).
// Keychain operations are out of scope — they are tested in vault-key.test.ts.
//
// Without this mock, checkVaultIntegrity() → classifyKeyStatus() →
// checkVaultKeyInKeytar() would call real keytar, and storeVaultKey()
// could invoke the real BiometricAuth binary on macOS.
vi.mock("../vault-key.js", () => ({
  storeVaultKey: vi.fn().mockResolvedValue(undefined),
  loadVaultKey: vi.fn().mockResolvedValue(null),
  deleteVaultKey: vi.fn().mockResolvedValue(undefined),
  checkVaultKeyInKeytar: vi.fn().mockResolvedValue(true),
  isNativeKeychainAvailable: vi.fn().mockReturnValue(false),
}));

/**
 * E2E integration tests for vault hardening features.
 *
 * All tests run against an isolated HOME directory (temp dir) so the real
 * ~/.keplr-mcp/ is never touched. vault-key.js is mocked to prevent real
 * keychain access (macOS Keychain is per-user, not per-HOME).
 */
describe("e2e vault hardening", () => {
  const TEST_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  let originalHome: string;
  let tempHome: string;

  beforeEach(async () => {
    originalHome = process.env.HOME!;
    // Create an isolated temp HOME
    tempHome = join(
      tmpdir(),
      `keplr-vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempHome, { recursive: true });
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    // Clean up temp dir (remove immutable flags first)
    try {
      if (process.platform === "darwin") {
        execSync(`chflags -R nouchg "${tempHome}" 2>/dev/null || true`);
      }
      await rm(tempHome, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  /**
   * Helper: assert we are operating in the isolated temp HOME.
   */
  const assertIsolatedHome = () => {
    expect(process.env.HOME).not.toBe(originalHome);
    expect(process.env.HOME).toBe(tempHome);
  };

  it("writeVaultFile creates an .enc file in the isolated vaults dir", async () => {
    assertIsolatedHome();

    const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("test-account", vault);

    const vaultsDir = join(tempHome, ".keplr-mcp", "vaults");
    const filePath = join(vaultsDir, "test-account.enc");
    expect(existsSync(filePath)).toBe(true);

    // Verify the file content is valid JSON matching the vault
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.version).toBe(1);
    expect(content.iv).toBe(vault.iv);
    expect(content.ciphertext).toBe(vault.ciphertext);
    expect(content.authTag).toBe(vault.authTag);
  });

  it("backupVaultFile creates a copy in vaults-backup/", async () => {
    assertIsolatedHome();

    const { writeVaultFile, backupVaultFile, encryptMnemonic } = await import(
      "../vault.js"
    );
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("backup-test", vault);
    await backupVaultFile("backup-test");

    const backupDir = join(tempHome, ".keplr-mcp", "vaults-backup");
    const backupPath = join(backupDir, "backup-test.enc");
    expect(existsSync(backupPath)).toBe(true);

    // Verify backup content matches original
    const originalPath = join(
      tempHome,
      ".keplr-mcp",
      "vaults",
      "backup-test.enc",
    );
    const originalContent = readFileSync(originalPath, "utf-8");
    const backupContent = readFileSync(backupPath, "utf-8");
    expect(backupContent).toBe(originalContent);
  });

  it("overwrites an existing immutable vault file without EPERM", async () => {
    if (process.platform !== "darwin") return;
    assertIsolatedHome();

    const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
    const vaultKey = randomBytes(32);
    const vault1 = encryptMnemonic("first mnemonic words ...", vaultKey);
    const vault2 = encryptMnemonic("second mnemonic words ...", vaultKey);

    await writeVaultFile("overwrite-test", vault1);
    await expect(
      writeVaultFile("overwrite-test", vault2),
    ).resolves.not.toThrow();

    const filePath = join(
      tempHome,
      ".keplr-mcp",
      "vaults",
      "overwrite-test.enc",
    );
    const lsOutput = execSync(`ls -lO "${filePath}"`).toString();
    expect(lsOutput).toContain("uchg");
  });

  it("writeVaultFile sets the macOS immutable flag (chflags uchg)", async () => {
    if (process.platform !== "darwin") {
      return; // Skip on non-macOS
    }
    assertIsolatedHome();

    const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("immutable-test", vault);

    const filePath = join(
      tempHome,
      ".keplr-mcp",
      "vaults",
      "immutable-test.enc",
    );
    const lsOutput = execSync(`ls -lO "${filePath}"`).toString();
    expect(lsOutput).toContain("uchg");
  });

  it("deleteVaultFile clears the immutable flag and removes the file", async () => {
    assertIsolatedHome();

    const { writeVaultFile, deleteVaultFile, encryptMnemonic } = await import(
      "../vault.js"
    );
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("delete-test", vault);
    const filePath = join(tempHome, ".keplr-mcp", "vaults", "delete-test.enc");
    expect(existsSync(filePath)).toBe(true);

    const deleted = await deleteVaultFile("delete-test");
    expect(deleted).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it("deleteVaultFile returns false for non-existent file", async () => {
    assertIsolatedHome();

    const { deleteVaultFile } = await import("../vault.js");
    const deleted = await deleteVaultFile("non-existent-account");
    expect(deleted).toBe(false);
  });

  it("renameVaultFile clears old immutable flag, sets new one", async () => {
    if (process.platform !== "darwin") {
      return; // Skip on non-macOS
    }
    assertIsolatedHome();

    const { writeVaultFile, renameVaultFile, encryptMnemonic } = await import(
      "../vault.js"
    );
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("old-name", vault);
    const oldPath = join(tempHome, ".keplr-mcp", "vaults", "old-name.enc");
    const newPath = join(tempHome, ".keplr-mcp", "vaults", "new-name.enc");

    await renameVaultFile("old-name", "new-name");

    // Old file should be gone
    expect(existsSync(oldPath)).toBe(false);

    // New file should exist with immutable flag
    expect(existsSync(newPath)).toBe(true);
    const lsOutput = execSync(`ls -lO "${newPath}"`).toString();
    expect(lsOutput).toContain("uchg");
  });

  it("listVaultFiles lists .enc files correctly", async () => {
    assertIsolatedHome();

    const { writeVaultFile, listVaultFiles, encryptMnemonic } = await import(
      "../vault.js"
    );
    const vaultKey = randomBytes(32);

    // Create multiple vault files
    const vault1 = encryptMnemonic(TEST_MNEMONIC, vaultKey);
    const vault2 = encryptMnemonic(TEST_MNEMONIC, vaultKey);
    const vault3 = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("alice", vault1);
    await writeVaultFile("bob", vault2);
    await writeVaultFile("charlie", vault3);

    // Also create a non-.enc file to verify it's excluded
    const vaultsDir = join(tempHome, ".keplr-mcp", "vaults");
    await writeFile(join(vaultsDir, "not-a-vault.txt"), "garbage");

    const files = await listVaultFiles();
    expect(files).toHaveLength(3);
    expect(files.sort()).toEqual(["alice", "bob", "charlie"]);
  });

  it("listVaultFiles returns empty array when vaults dir does not exist", async () => {
    assertIsolatedHome();

    const { listVaultFiles } = await import("../vault.js");
    const files = await listVaultFiles();
    expect(files).toEqual([]);
  });

  it("readVaultFile returns null for non-existent file", async () => {
    assertIsolatedHome();

    const { readVaultFile } = await import("../vault.js");
    const result = await readVaultFile("non-existent");
    expect(result).toBeNull();
  });

  it("readVaultFile returns the encrypted vault for an existing file", async () => {
    assertIsolatedHome();

    const { writeVaultFile, readVaultFile, encryptMnemonic } = await import(
      "../vault.js"
    );
    const vaultKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

    await writeVaultFile("read-test", vault);
    const loaded = await readVaultFile("read-test");

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(vault.version);
    expect(loaded!.iv).toBe(vault.iv);
    expect(loaded!.ciphertext).toBe(vault.ciphertext);
    expect(loaded!.authTag).toBe(vault.authTag);
  });

  describe("path traversal prevention", () => {
    it("rejects account names containing forward slash", async () => {
      assertIsolatedHome();

      const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      await expect(writeVaultFile("../evil", vault)).rejects.toThrow(
        /Invalid account name/,
      );
    });

    it("rejects account names containing backslash", async () => {
      assertIsolatedHome();

      const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      await expect(writeVaultFile("..\\evil", vault)).rejects.toThrow(
        /Invalid account name/,
      );
    });
  });

  describe("checkVaultIntegrity", () => {
    /**
     * Helper: write accounts.json in the isolated config dir.
     */
    const writeAccountsConfig = async (
      accounts: Record<
        string,
        { type: string; createdAt: string; description?: string }
      >,
      activeAccount: string | null = null,
    ) => {
      const configDir = join(tempHome, ".keplr-mcp");
      await mkdir(configDir, { recursive: true });
      const config = {
        version: 3,
        activeAccount,
        accounts,
      };
      await writeFile(
        join(configDir, "accounts.json"),
        JSON.stringify(config, null, 2),
        "utf-8",
      );
    };

    it("detects orphaned accounts (config entry exists but .enc missing)", async () => {
      assertIsolatedHome();

      const { checkVaultIntegrity } = await import("../accounts.js");

      // Create accounts.json with an account but no vault file
      await writeAccountsConfig({
        orphan: {
          type: "mnemonic",
          createdAt: new Date().toISOString(),
        },
      });

      const result = await checkVaultIntegrity();
      expect(result.orphaned).toContain("orphan");
      expect(result.healthy).not.toContain("orphan");
    });

    it("detects dangling vaults (.enc file exists but no account entry)", async () => {
      assertIsolatedHome();

      const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      // Create a vault file with no corresponding account entry
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);
      await writeVaultFile("dangling-account", vault);

      // Create an empty accounts.json
      await writeAccountsConfig({});

      const result = await checkVaultIntegrity();
      expect(result.dangling).toContain("dangling-account");
    });

    it("skips non-mnemonic and env accounts", async () => {
      assertIsolatedHome();

      const { checkVaultIntegrity } = await import("../accounts.js");

      await writeAccountsConfig({
        env: {
          type: "mnemonic",
          createdAt: new Date().toISOString(),
        },
        "my-passkey": {
          type: "passkey",
          createdAt: new Date().toISOString(),
        },
      });

      const result = await checkVaultIntegrity();
      expect(result.skipped).toContain("env");
      expect(result.skipped).toContain("my-passkey");
      expect(result.orphaned).toHaveLength(0);
    });
  });

  describe("restoreVaultFromBackup", () => {
    it("restores vault from backup when backup exists", async () => {
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        deleteVaultFile,
        readVaultFile,
        restoreVaultFromBackup,
        encryptMnemonic,
      } = await import("../vault.js");
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Create vault and backup, then delete original
      await writeVaultFile("restore-test", vault);
      await backupVaultFile("restore-test");
      await deleteVaultFile("restore-test");

      // Verify vault is gone
      const gone = await readVaultFile("restore-test");
      expect(gone).toBeNull();

      // Restore from backup
      const restored = await restoreVaultFromBackup("restore-test");
      expect(restored).toBe(true);

      // Verify restored content matches original
      const restoredVault = await readVaultFile("restore-test");
      expect(restoredVault).not.toBeNull();
      expect(restoredVault!.iv).toBe(vault.iv);
      expect(restoredVault!.ciphertext).toBe(vault.ciphertext);
      expect(restoredVault!.authTag).toBe(vault.authTag);
    });

    it("returns false when no backup exists", async () => {
      assertIsolatedHome();

      const { restoreVaultFromBackup } = await import("../vault.js");
      const result = await restoreVaultFromBackup("no-backup-account");
      expect(result).toBe(false);
    });

    it("returns false when backup is corrupt", async () => {
      assertIsolatedHome();

      const { restoreVaultFromBackup } = await import("../vault.js");

      // Create a corrupt backup file
      const backupDir = join(tempHome, ".keplr-mcp", "vaults-backup");
      await mkdir(backupDir, { recursive: true });
      await writeFile(
        join(backupDir, "corrupt-account.enc"),
        "not valid json {{{",
      );

      const result = await restoreVaultFromBackup("corrupt-account");
      expect(result).toBe(false);
    });

    it("returns false and logs error when writeVaultFile throws during restore", async () => {
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        deleteVaultFile,
        restoreVaultFromBackup,
        encryptMnemonic,
        readVaultFile,
      } = await import("../vault.js");
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Create vault, back up, then delete original
      await writeVaultFile("restore-fail", vault);
      await backupVaultFile("restore-fail");
      await deleteVaultFile("restore-fail");

      // Make vaults dir read-only so writeVaultFile fails
      const vaultsDir = join(tempHome, ".keplr-mcp", "vaults");
      await chmod(vaultsDir, 0o444);

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const restored = await restoreVaultFromBackup("restore-fail");
        expect(restored).toBe(false);

        // Verify error was logged (not silently swallowed)
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Vault restore failed"),
          expect.any(String),
        );

        // Vault should still not exist
        await chmod(vaultsDir, 0o755);
        const vaultStill = await readVaultFile("restore-fail");
        expect(vaultStill).toBeNull();
      } finally {
        errorSpy.mockRestore();
        await chmod(vaultsDir, 0o755).catch(() => {});
      }
    });
  });

  describe("writeVaultFile rename failure cleanup", () => {
    it("cleans up orphan .tmp file when rename fails", async () => {
      assertIsolatedHome();

      const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // First write succeeds — creates vaults directory and a .enc file
      await writeVaultFile("tmp-cleanup", vault);

      // Make vaults dir read-only so new writeFile(.tmp) fails
      const vaultsDir = join(tempHome, ".keplr-mcp", "vaults");
      await chmod(vaultsDir, 0o555);

      await expect(writeVaultFile("new-orphan-test", vault)).rejects.toThrow();

      // Restore permissions to check directory contents
      await chmod(vaultsDir, 0o755);

      // Verify no .tmp file is left on disk
      const files = readdirSync(vaultsDir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toEqual([]);
    });
  });

  describe("listVaultFiles non-ENOENT rethrow", () => {
    it("rethrows non-ENOENT errors from readdir", async () => {
      assertIsolatedHome();

      const { listVaultFiles, writeVaultFile, encryptMnemonic } = await import(
        "../vault.js"
      );

      // Create vaults directory by writing a vault
      const vaultKey = randomBytes(32);
      await writeVaultFile(
        "dir-setup",
        encryptMnemonic(TEST_MNEMONIC, vaultKey),
      );

      // Lock down vaults directory so readdir fails with EACCES
      const vaultsDir = join(tempHome, ".keplr-mcp", "vaults");
      await chmod(vaultsDir, 0o000);

      try {
        await expect(listVaultFiles()).rejects.toThrow();
      } finally {
        await chmod(vaultsDir, 0o755);
      }
    });
  });

  describe("checkVaultIntegrity repair", () => {
    /**
     * Helper: write accounts.json in the isolated config dir.
     */
    const writeAccountsConfig = async (
      accounts: Record<
        string,
        { type: string; createdAt: string; description?: string }
      >,
      activeAccount: string | null = null,
    ) => {
      const configDir = join(tempHome, ".keplr-mcp");
      await mkdir(configDir, { recursive: true });
      const config = {
        version: 3,
        activeAccount,
        accounts,
      };
      await writeFile(
        join(configDir, "accounts.json"),
        JSON.stringify(config, null, 2),
        "utf-8",
      );
    };

    it("restores orphaned vault file from backup", async () => {
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        deleteVaultFile,
        readVaultFile,
        encryptMnemonic,
      } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Create vault, backup, then delete original to make orphaned
      await writeVaultFile("orphan-repair", vault);
      await backupVaultFile("orphan-repair");
      await deleteVaultFile("orphan-repair");

      await writeAccountsConfig(
        {
          "orphan-repair": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
        "orphan-repair",
      );

      const result = await checkVaultIntegrity({ repair: true });

      // Vault file should be restored regardless of key availability
      const restored = await readVaultFile("orphan-repair");
      expect(restored).not.toBeNull();
      expect(restored!.iv).toBe(vault.iv);
      // Key check determines repaired vs unrecoverable (environment-dependent),
      // but the account must not remain in orphaned
      expect(result.orphaned).not.toContain("orphan-repair");
    });

    it("restores corrupt vault file from backup", async () => {
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        readVaultFile,
        encryptMnemonic,
      } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      await writeVaultFile("corrupt-repair", vault);
      await backupVaultFile("corrupt-repair");

      // Corrupt the vault file
      const vaultPath = join(
        tempHome,
        ".keplr-mcp",
        "vaults",
        "corrupt-repair.enc",
      );
      if (process.platform === "darwin") {
        execSync(`chflags nouchg "${vaultPath}" 2>/dev/null || true`);
      }
      await writeFile(vaultPath, "garbage data {{{");

      await writeAccountsConfig(
        {
          "corrupt-repair": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
        "corrupt-repair",
      );

      const result = await checkVaultIntegrity({ repair: true });

      // Vault file should be restored from backup
      const restored = await readVaultFile("corrupt-repair");
      expect(restored).not.toBeNull();
      expect(restored!.iv).toBe(vault.iv);
      // Must not remain in corrupt
      expect(result.corrupt).not.toContain("corrupt-repair");
    });

    it("cleans up dangling vault files", async () => {
      assertIsolatedHome();

      const { writeVaultFile, encryptMnemonic } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Create vault with no account config
      await writeVaultFile("dangling-cleanup", vault);
      await writeAccountsConfig({});

      const result = await checkVaultIntegrity({
        repair: true,
        deleteDangling: true,
      });
      expect(result.repaired).toContain("dangling-cleanup");

      // Verify .enc file was deleted
      const vaultPath = join(
        tempHome,
        ".keplr-mcp",
        "vaults",
        "dangling-cleanup.enc",
      );
      expect(existsSync(vaultPath)).toBe(false);
    });

    it("marks unrecoverable when no backup exists", async () => {
      assertIsolatedHome();

      const { checkVaultIntegrity } = await import("../accounts.js");

      // Config with account but no vault and no backup
      await writeAccountsConfig(
        {
          "no-backup": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
        "no-backup",
      );

      const result = await checkVaultIntegrity({ repair: true });
      expect(result.unrecoverable).toContain("no-backup");
    });

    it("restores structurally valid but cryptographically tampered backup (known limitation: decrypt fails at use time)", async () => {
      // Known limitation: restoreVaultFromBackup only validates structural integrity
      // (version, iv, ciphertext, authTag fields). It does NOT verify that the
      // ciphertext can actually be decrypted. Trial decryption is not performed
      // because the vault key may not be available at restore time.
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        deleteVaultFile,
        encryptMnemonic,
        decryptMnemonic,
        readVaultFile,
      } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Setup: create account with vault + backup
      // Note: storeVaultKey is NOT called — e2e tests share the real system
      // keychain (only HOME/file paths are isolated). This test only verifies
      // file-level restore behavior, not key accessibility.
      await writeVaultFile("tampered", vault);
      await backupVaultFile("tampered");

      // Tamper the backup's ciphertext
      const backupPath = join(
        tempHome,
        ".keplr-mcp",
        "vaults-backup",
        "tampered.enc",
      );
      const backupContent = JSON.parse(await readFile(backupPath, "utf-8"));
      backupContent.ciphertext =
        Buffer.from("tampered-data").toString("base64");
      await writeFile(backupPath, JSON.stringify(backupContent));

      // Delete original vault to trigger restore from backup
      await deleteVaultFile("tampered");

      await writeAccountsConfig(
        {
          tampered: {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
        "tampered",
      );

      // Restore succeeds (structural validation only)
      const result = await checkVaultIntegrity({ repair: true });
      expect(result.repaired).toContain("tampered");

      // But decryption fails with the tampered ciphertext
      const restoredVault = await readVaultFile("tampered");
      expect(restoredVault).not.toBeNull();
      expect(() => decryptMnemonic(restoredVault!, vaultKey)).toThrow();
    });

    it("repair=false skips all repair actions", async () => {
      assertIsolatedHome();

      const {
        writeVaultFile,
        backupVaultFile,
        deleteVaultFile,
        readVaultFile,
        encryptMnemonic,
      } = await import("../vault.js");
      const { checkVaultIntegrity } = await import("../accounts.js");

      const vaultKey = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, vaultKey);

      // Create orphaned state with backup available
      await writeVaultFile("no-repair", vault);
      await backupVaultFile("no-repair");
      await deleteVaultFile("no-repair");

      await writeAccountsConfig(
        {
          "no-repair": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
        "no-repair",
      );

      const result = await checkVaultIntegrity({ repair: false });
      expect(result.orphaned).toContain("no-repair");

      // Vault should still be missing
      const stillMissing = await readVaultFile("no-repair");
      expect(stillMissing).toBeNull();
    });
  });
});

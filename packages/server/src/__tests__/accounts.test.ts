import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock keytar (OS keychain)
vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    deletePassword: vi.fn().mockResolvedValue(true),
  },
}));

// Mock config-storage
const mockConfigStore = new Map<string, unknown>();

vi.mock("../config-storage.js", () => ({
  readJsonConfig: vi.fn((filename: string) => {
    return Promise.resolve(mockConfigStore.get(filename) || null);
  }),
  writeJsonConfig: vi.fn((filename: string, data: unknown) => {
    mockConfigStore.set(filename, data);
    return Promise.resolve();
  }),
}));

// Mock vault.js
vi.mock("../vault.js", () => ({
  encryptMnemonic: vi.fn((mnemonic: string) => ({
    version: 1,
    iv: "aXY=",
    ciphertext: Buffer.from(mnemonic).toString("base64"),
    authTag: "dGFn",
  })),
  decryptMnemonic: vi.fn((vault: { ciphertext: string }) =>
    Buffer.from(vault.ciphertext, "base64").toString("utf-8"),
  ),
  readVaultFile: vi.fn().mockResolvedValue(null),
  writeVaultFile: vi.fn().mockResolvedValue(undefined),
  deleteVaultFile: vi.fn().mockResolvedValue(true),
  renameVaultFile: vi.fn().mockResolvedValue(undefined),
  listVaultFiles: vi.fn().mockResolvedValue([]),
  backupVaultFile: vi.fn().mockResolvedValue(undefined),
  restoreVaultFromBackup: vi.fn().mockResolvedValue(false),
}));

// Mock vault-key.js
const mockVaultKey = {
  storeVaultKey: vi.fn().mockResolvedValue(undefined),
  loadVaultKey: vi.fn().mockResolvedValue(null),
  deleteVaultKey: vi.fn().mockResolvedValue(undefined),
  checkVaultKeyInKeytar: vi.fn().mockResolvedValue(false),
  checkVaultKeyInNative: vi.fn().mockResolvedValue("missing"),
  isNativeKeychainAvailable: vi.fn().mockReturnValue(false),
};

vi.mock("../vault-key.js", () => mockVaultKey);

describe("Accounts Module", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConfigStore.clear();
    // Reset vault mock defaults
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue(null);
    vi.mocked(vaultMod.writeVaultFile).mockResolvedValue(undefined);
    vi.mocked(vaultMod.deleteVaultFile).mockResolvedValue(true);
    vi.mocked(vaultMod.renameVaultFile).mockResolvedValue(undefined);
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue([]);
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(false);
    // Reset vault-key mock defaults
    mockVaultKey.storeVaultKey.mockResolvedValue(undefined);
    mockVaultKey.loadVaultKey.mockResolvedValue(null);
    mockVaultKey.deleteVaultKey.mockResolvedValue(undefined);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("missing");
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Account Creation", () => {
    it("should add a new mnemonic account", async () => {
      const { addAccount, loadAccountsConfig } = await import("../accounts.js");

      await addAccount("test-account", "Test description");

      const config = await loadAccountsConfig();
      expect(config.accounts["test-account"]).toBeDefined();
      expect(config.accounts["test-account"].type).toBe("mnemonic");
      expect(config.accounts["test-account"].description).toBe(
        "Test description",
      );
      expect(config.accounts["test-account"].createdAt).toBeDefined();
    });

    it("should set first account as active", async () => {
      const { addAccount, loadAccountsConfig } = await import("../accounts.js");

      await addAccount("first-account");

      const config = await loadAccountsConfig();
      expect(config.activeAccount).toBe("first-account");
    });

    it("should not change active account when adding subsequent accounts", async () => {
      const { addAccount, loadAccountsConfig } = await import("../accounts.js");

      await addAccount("first-account");
      await addAccount("second-account");

      const config = await loadAccountsConfig();
      expect(config.activeAccount).toBe("first-account");
    });

    it("should reject duplicate account names", async () => {
      const { addAccount } = await import("../accounts.js");

      await addAccount("duplicate");

      await expect(addAccount("duplicate")).rejects.toThrow(/already exists/);
    });
  });

  describe("Mnemonic Storage", () => {
    it("should save mnemonic to vault and backup", async () => {
      const { saveMnemonicForAccount } = await import("../accounts.js");
      const vaultMod = await import("../vault.js");
      const mnemonic =
        "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12";

      await saveMnemonicForAccount("test", mnemonic);

      expect(vaultMod.writeVaultFile).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ version: 1 }),
      );
      expect(mockVaultKey.storeVaultKey).toHaveBeenCalledWith(
        "vault-key:test",
        expect.any(Buffer),
      );
      expect(vaultMod.backupVaultFile).toHaveBeenCalledWith("test");
    });

    it("should succeed even when backup fails (non-fatal)", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.backupVaultFile).mockRejectedValueOnce(
        new Error("Disk full"),
      );

      const { saveMnemonicForAccount } = await import("../accounts.js");

      await expect(
        saveMnemonicForAccount(
          "test",
          "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
        ),
      ).resolves.toBeUndefined();
    });

    it("should load mnemonic from vault", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
        version: 1,
        iv: "aXY=",
        ciphertext: Buffer.from("stored mnemonic phrase").toString("base64"),
        authTag: "dGFn",
      });
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(Buffer.alloc(32));

      const { loadMnemonicForAccount } = await import("../accounts.js");
      const result = await loadMnemonicForAccount("test");

      expect(result).toBe("stored mnemonic phrase");
    });

    it("should return null when no vault file exists", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.readVaultFile).mockResolvedValue(null);

      const { loadMnemonicForAccount } = await import("../accounts.js");
      const result = await loadMnemonicForAccount("test");

      expect(result).toBeNull();
    });

    it("should return null and log error when vault exists but vault key is missing", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
        version: 1,
        iv: "aXY=",
        ciphertext: "dGVzdA==",
        authTag: "dGFn",
      });
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(null);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { loadMnemonicForAccount } = await import("../accounts.js");
      const result = await loadMnemonicForAccount("test-account");

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Vault key not found or access denied"),
      );
      expect(vaultMod.decryptMnemonic).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should propagate decryption error and zero vault key", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
        version: 1,
        iv: "aXY=",
        ciphertext: "corrupted",
        authTag: "dGFn",
      });
      const fakeKey = Buffer.alloc(32, 0xaa);
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(fakeKey);
      vi.mocked(vaultMod.decryptMnemonic).mockImplementationOnce(() => {
        throw new Error("Unsupported state or unable to authenticate data");
      });

      const { loadMnemonicForAccount } = await import("../accounts.js");
      await expect(loadMnemonicForAccount("test")).rejects.toThrow(
        /unable to authenticate data/,
      );
      // vaultKey must be zeroed even on decrypt failure (finally block)
      expect(fakeKey.every((b) => b === 0)).toBe(true);
    });

    it("should preserve vault file when storeVaultKey fails (fail-closed)", async () => {
      mockVaultKey.storeVaultKey.mockRejectedValueOnce(
        new Error("Keychain write failed"),
      );

      const { saveMnemonicForAccount } = await import("../accounts.js");
      const vaultMod = await import("../vault.js");

      await expect(
        saveMnemonicForAccount(
          "test",
          "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
        ),
      ).rejects.toThrow("Keychain write failed");

      // Vault file should have been written but NOT deleted (fail-closed)
      expect(vaultMod.writeVaultFile).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ version: 1 }),
      );
      expect(vaultMod.deleteVaultFile).not.toHaveBeenCalled();
    });

    it("should delete mnemonic (vault file + vault key)", async () => {
      const { deleteMnemonicForAccount } = await import("../accounts.js");
      const vaultMod = await import("../vault.js");

      await deleteMnemonicForAccount("test");

      expect(vaultMod.deleteVaultFile).toHaveBeenCalledWith("test");
      expect(mockVaultKey.deleteVaultKey).toHaveBeenCalledWith(
        "vault-key:test",
      );
    });

    it("should get active mnemonic via vault", async () => {
      const vaultMod = await import("../vault.js");
      vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
        version: 1,
        iv: "aXY=",
        ciphertext: Buffer.from("active account mnemonic").toString("base64"),
        authTag: "dGFn",
      });
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(Buffer.alloc(32));

      // Setup an active mnemonic account
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "main",
        accounts: {
          main: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { getActiveMnemonic } = await import("../accounts.js");
      const result = await getActiveMnemonic();

      expect(result).toBe("active account mnemonic");
    });

    it("should return null when no active account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: null,
        accounts: {},
      });

      const { getActiveMnemonic } = await import("../accounts.js");
      const result = await getActiveMnemonic();

      expect(result).toBeNull();
    });

    it("should return null for non-mnemonic accounts", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "passkey-account",
        accounts: {
          "passkey-account": {
            type: "passkey",
            createdAt: new Date().toISOString(),
            ecosystem: "cosmos",
          },
        },
      });

      const { getActiveMnemonic } = await import("../accounts.js");
      const result = await getActiveMnemonic();

      expect(result).toBeNull();
    });
  });

  describe("Account Switching", () => {
    it("should switch to existing account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
          account2: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { setActiveAccount, getActiveAccount } = await import(
        "../accounts.js"
      );

      await setActiveAccount("account2");
      const active = await getActiveAccount();

      expect(active).toBe("account2");
    });

    it("should reject switching to non-existent account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { setActiveAccount } = await import("../accounts.js");

      await expect(setActiveAccount("nonexistent")).rejects.toThrow(
        /does not exist/,
      );
    });
  });

  describe("Account Removal", () => {
    it("should remove existing account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
          account2: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { removeAccount, loadAccountsConfig } = await import(
        "../accounts.js"
      );

      const result = await removeAccount("account2");

      expect(result).toBe(true);
      const config = await loadAccountsConfig();
      expect(config.accounts.account2).toBeUndefined();
    });

    it("should update active account when removing active account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
          account2: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { removeAccount, getActiveAccount } = await import(
        "../accounts.js"
      );

      await removeAccount("account1");
      const active = await getActiveAccount();

      // Should switch to remaining account
      expect(active).toBe("account2");
    });

    it("should set active to null when removing last account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "only-account",
        accounts: {
          "only-account": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
      });

      const { removeAccount, getActiveAccount } = await import(
        "../accounts.js"
      );

      await removeAccount("only-account");
      const active = await getActiveAccount();

      expect(active).toBeNull();
    });

    it("should return false for non-existent account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: null,
        accounts: {},
      });

      const { removeAccount } = await import("../accounts.js");

      const result = await removeAccount("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("Account Renaming", () => {
    it("should rename mnemonic account (vault-based)", async () => {
      const vaultKeyBuf = Buffer.from("dmF1bHRLZXk=", "base64"); // vault key buffer
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(vaultKeyBuf); // vault-key:old-name

      mockConfigStore.set("accounts.json", {
        version: 3,
        activeAccount: "old-name",
        accounts: {
          "old-name": { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { renameAccount, loadAccountsConfig } = await import(
        "../accounts.js"
      );

      await renameAccount("old-name", "new-name");

      const config = await loadAccountsConfig();
      expect(config.accounts["old-name"]).toBeUndefined();
      expect(config.accounts["new-name"]).toBeDefined();
      expect(config.activeAccount).toBe("new-name");

      const vaultMod = await import("../vault.js");
      expect(vaultMod.renameVaultFile).toHaveBeenCalledWith(
        "old-name",
        "new-name",
      );
      expect(mockVaultKey.storeVaultKey).toHaveBeenCalledWith(
        "vault-key:new-name",
        vaultKeyBuf,
      );
      expect(mockVaultKey.deleteVaultKey).toHaveBeenCalledWith(
        "vault-key:old-name",
      );
    });

    it("should reject renaming non-existent account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: null,
        accounts: {},
      });

      const { renameAccount } = await import("../accounts.js");

      await expect(renameAccount("nonexistent", "new-name")).rejects.toThrow(
        /does not exist/,
      );
    });

    it("should reject renaming to existing name", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
          account2: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { renameAccount } = await import("../accounts.js");

      await expect(renameAccount("account1", "account2")).rejects.toThrow(
        /already exists/,
      );
    });

    it("should fall back to legacy keytar path when vault key is not found during rename", async () => {
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(null);

      mockConfigStore.set("accounts.json", {
        version: 3,
        activeAccount: "old-name",
        accounts: {
          "old-name": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
      });

      const { renameAccount, loadAccountsConfig } = await import(
        "../accounts.js"
      );
      const vaultMod = await import("../vault.js");

      // Legacy keytar has no mnemonic either — rename still updates config
      await renameAccount("old-name", "new-name");

      // No vault file operations attempted (legacy path)
      expect(vaultMod.renameVaultFile).not.toHaveBeenCalled();
      expect(mockVaultKey.storeVaultKey).not.toHaveBeenCalled();
      expect(mockVaultKey.deleteVaultKey).not.toHaveBeenCalled();

      // Config should be updated
      const config = await loadAccountsConfig();
      expect(config.accounts["new-name"]).toBeDefined();
      expect(config.accounts["old-name"]).toBeUndefined();
    });

    it("should succeed even when deleteVaultKey fails after rename (best-effort cleanup)", async () => {
      const vaultKeyBuf = Buffer.from("dmF1bHRLZXk=", "base64");
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(vaultKeyBuf);
      mockVaultKey.deleteVaultKey.mockRejectedValueOnce(
        new Error("Keychain deletion failed"),
      );

      mockConfigStore.set("accounts.json", {
        version: 3,
        activeAccount: "old-name",
        accounts: {
          "old-name": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
        },
      });

      const { renameAccount, loadAccountsConfig } = await import(
        "../accounts.js"
      );
      const vaultMod = await import("../vault.js");

      // Should NOT throw — old key cleanup is best-effort
      await renameAccount("old-name", "new-name");

      // Vault file renamed and new key stored
      expect(vaultMod.renameVaultFile).toHaveBeenCalledWith(
        "old-name",
        "new-name",
      );
      expect(mockVaultKey.storeVaultKey).toHaveBeenCalledWith(
        "vault-key:new-name",
        vaultKeyBuf,
      );

      // Config should be updated (rename succeeded)
      const config = await loadAccountsConfig();
      expect(config.accounts["new-name"]).toBeDefined();
      expect(config.accounts["old-name"]).toBeUndefined();
      expect(config.activeAccount).toBe("new-name");
    });

    it("should rollback vault file rename if storeVaultKey fails during rename", async () => {
      const vaultKeyBuf = Buffer.from("dmF1bHRLZXk=", "base64");
      mockVaultKey.loadVaultKey.mockResolvedValueOnce(vaultKeyBuf);
      // storeVaultKey for new name fails
      mockVaultKey.storeVaultKey.mockRejectedValueOnce(
        new Error("Keychain write failed"),
      );

      mockConfigStore.set("accounts.json", {
        version: 3,
        activeAccount: "old-name",
        accounts: {
          "old-name": { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { renameAccount } = await import("../accounts.js");
      const vaultMod = await import("../vault.js");

      await expect(renameAccount("old-name", "new-name")).rejects.toThrow(
        "Keychain write failed",
      );

      // renameVaultFile should have been called twice: forward then backward rollback
      expect(vaultMod.renameVaultFile).toHaveBeenCalledTimes(2);
      expect(vaultMod.renameVaultFile).toHaveBeenNthCalledWith(
        1,
        "old-name",
        "new-name",
      );
      expect(vaultMod.renameVaultFile).toHaveBeenNthCalledWith(
        2,
        "new-name",
        "old-name",
      );
    });
  });

  describe("Config Migration", () => {
    it("should migrate v1 config to v2", async () => {
      // V1 config without type field
      mockConfigStore.set("accounts.json", {
        version: 1,
        activeAccount: "old-account",
        accounts: {
          "old-account": {
            createdAt: "2024-01-01T00:00:00.000Z",
            description: "Legacy account",
          },
        },
      });

      const { loadAccountsConfig } = await import("../accounts.js");
      const config = await loadAccountsConfig();

      // Should be migrated to v2
      expect(config.accounts["old-account"].type).toBe("mnemonic");
    });
  });

  describe("Account Info", () => {
    it("should get active account info", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "main",
        accounts: {
          main: {
            type: "mnemonic",
            createdAt: "2024-01-01T00:00:00.000Z",
            description: "Main wallet",
          },
        },
      });

      const { getActiveAccountInfo } = await import("../accounts.js");
      const info = await getActiveAccountInfo();

      expect(info).toBeDefined();
      expect(info?.type).toBe("mnemonic");
      expect(info?.description).toBe("Main wallet");
    });

    it("should return null when no active account", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: null,
        accounts: {},
      });

      const { getActiveAccountInfo } = await import("../accounts.js");
      const info = await getActiveAccountInfo();

      expect(info).toBeNull();
    });

    it("should check if account exists", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "existing",
        accounts: {
          existing: { type: "mnemonic", createdAt: new Date().toISOString() },
        },
      });

      const { accountExists } = await import("../accounts.js");

      expect(await accountExists("existing")).toBe(true);
      expect(await accountExists("nonexistent")).toBe(false);
    });

    it("should get account type", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "mnemonic-acc",
        accounts: {
          "mnemonic-acc": {
            type: "mnemonic",
            createdAt: new Date().toISOString(),
          },
          "passkey-acc": {
            type: "passkey",
            createdAt: new Date().toISOString(),
            ecosystem: "cosmos",
          },
        },
      });

      const { getAccountType, getAccountKeyProviderType } = await import(
        "../accounts.js"
      );

      expect(await getAccountType("mnemonic-acc")).toBe("mnemonic");
      // getAccountType only returns legacy AccountType ("mnemonic"), use getAccountKeyProviderType for others
      expect(await getAccountType("passkey-acc")).toBeNull();
      expect(await getAccountKeyProviderType("passkey-acc")).toBe("passkey");
      expect(await getAccountType("nonexistent")).toBeNull();
    });
  });

  describe("List Accounts", () => {
    it("should list all accounts", async () => {
      mockConfigStore.set("accounts.json", {
        version: 2,
        activeAccount: "account1",
        accounts: {
          account1: { type: "mnemonic", createdAt: new Date().toISOString() },
          account2: {
            type: "passkey",
            createdAt: new Date().toISOString(),
            ecosystem: "cosmos",
          },
        },
      });

      const { listAccounts } = await import("../accounts.js");
      const config = await listAccounts();

      expect(Object.keys(config.accounts)).toHaveLength(2);
      expect(config.accounts.account1).toBeDefined();
      expect(config.accounts.account2).toBeDefined();
    });
  });
});

describe("checkVaultIntegrity", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConfigStore.clear();
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue(null);
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue([]);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("missing");
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports healthy account when vault and keytar key exist", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["alice"]);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(true);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.healthy).toEqual(["alice"]);
    expect(result.orphaned).toEqual([]);
    expect(result.keyMissing).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it("reports orphaned account when vault file is missing", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.orphaned).toEqual(["alice"]);
    expect(result.healthy).toEqual([]);
  });

  it("reports keyMissing when vault exists but keytar key is missing (non-native)", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.keyMissing).toEqual(["alice"]);
  });

  it("classifies account as healthy when key exists in native keychain", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("accessible");

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.healthy).toEqual(["alice"]);
    expect(result.keyMissing).toEqual([]);
  });

  it("falls back to native-only check when checkVaultKeyInKeytar throws", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["alice"]);
    // keytar import fails at runtime
    mockVaultKey.checkVaultKeyInKeytar.mockRejectedValue(
      new Error("keytar unavailable"),
    );
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    // With keytar failing and native unavailable → keyMissing
    expect(result.keyMissing).toContain("alice");
    expect(result.healthy).not.toContain("alice");
  });

  it("classifies account as healthy when keytar throws but key exists in native keychain", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["alice"]);
    mockVaultKey.checkVaultKeyInKeytar.mockRejectedValue(
      new Error("keytar unavailable"),
    );
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("accessible");

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.healthy).toContain("alice");
    expect(result.keyMissing).not.toContain("alice");
  });

  it("classifies account as keychainError when native keychain returns error", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["alice"]);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("error");

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.keychainError).toContain("alice");
    expect(result.keyMissing).not.toContain("alice");
    expect(result.healthy).not.toContain("alice");
  });

  it("reports dangling vault files without account entries", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: null,
      accounts: {},
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["ghost"]);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.dangling).toEqual(["ghost"]);
  });

  it("skips env and non-mnemonic accounts", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "env",
      accounts: {
        env: { type: "mnemonic", createdAt: "2026-01-01" },
        "passkey-acc": { type: "passkey", createdAt: "2026-01-01" },
      },
    });

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.skipped).toEqual(["env", "passkey-acc"]);
    expect(result.healthy).toEqual([]);
    expect(result.orphaned).toEqual([]);
  });

  it("reports corrupt account and continues checking remaining accounts", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: {
        alice: { type: "mnemonic", createdAt: "2026-01-01" },
        bob: { type: "mnemonic", createdAt: "2026-01-01" },
      },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockImplementation(
      async (name: string) => {
        if (name === "alice") {
          throw new Error("Invalid vault file: missing required fields");
        }
        return null;
      },
    );

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.corrupt).toEqual(["alice"]);
    expect(result.orphaned).toEqual(["bob"]);
  });

  it("returns empty results for empty config", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: null,
      accounts: {},
    });

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    expect(result.healthy).toEqual([]);
    expect(result.orphaned).toEqual([]);
    expect(result.keyMissing).toEqual([]);
    expect(result.dangling).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.corrupt).toEqual([]);
  });
});

describe("checkVaultIntegrity repair", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConfigStore.clear();
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue(null);
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue([]);
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(false);
    vi.mocked(vaultMod.deleteVaultFile).mockResolvedValue(true);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.checkVaultKeyInNative.mockResolvedValue("missing");
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("orphaned + backup exists → repaired", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(true);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(true);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.repaired).toContain("alice");
    expect(result.orphaned).not.toContain("alice");
    expect(result.unrecoverable).not.toContain("alice");
  });

  it("orphaned + no backup → unrecoverable", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.unrecoverable).toContain("alice");
    expect(result.orphaned).not.toContain("alice");
  });

  it("corrupt + backup exists → repaired", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockRejectedValue(
      new Error("Invalid vault file: missing required fields"),
    );
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(true);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(true);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.repaired).toContain("alice");
    expect(result.corrupt).not.toContain("alice");
  });

  it("corrupt + no backup → unrecoverable", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockRejectedValue(
      new Error("Invalid vault file"),
    );
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.unrecoverable).toContain("alice");
    expect(result.corrupt).not.toContain("alice");
  });

  it("dangling without deleteDangling → stays dangling", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: null,
      accounts: {},
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["orphan"]);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.dangling).toContain("orphan");
    expect(result.repaired).not.toContain("orphan");
  });

  it("dangling + deleteDangling + delete succeeds → repaired", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: null,
      accounts: {},
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["orphan"]);
    vi.mocked(vaultMod.deleteVaultFile).mockResolvedValue(true);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({
      repair: true,
      deleteDangling: true,
    });

    expect(result.repaired).toContain("orphan");
    expect(result.dangling).not.toContain("orphan");
  });

  it("dangling + deleteDangling + delete fails → stays dangling", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: null,
      accounts: {},
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["orphan"]);
    vi.mocked(vaultMod.deleteVaultFile).mockRejectedValue(
      new Error("Permission denied"),
    );

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({
      repair: true,
      deleteDangling: true,
    });

    expect(result.dangling).toContain("orphan");
    expect(result.repaired).not.toContain("orphan");
  });

  it("keyMissing → unrecoverable", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.readVaultFile).mockResolvedValue({
      version: 1,
      iv: "aXY=",
      ciphertext: "dGVzdA==",
      authTag: "dGFn",
    });
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.unrecoverable).toContain("alice");
    expect(result.keyMissing).not.toContain("alice");
  });

  it("repair=false → no repair attempted", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: false });

    expect(result.orphaned).toContain("alice");
    expect(vaultMod.restoreVaultFromBackup).not.toHaveBeenCalled();
  });

  it("orphaned + vault restored + key missing → unrecoverable", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "alice",
      accounts: { alice: { type: "mnemonic", createdAt: "2026-01-01" } },
    });
    const vaultMod = await import("../vault.js");
    vi.mocked(vaultMod.restoreVaultFromBackup).mockResolvedValue(true);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(false);
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity({ repair: true });

    expect(result.unrecoverable).toContain("alice");
    expect(result.repaired).not.toContain("alice");
  });
});

describe("VaultIntegrityResult partition invariant", () => {
  it("each config account appears in exactly one category (no duplicates, no omissions)", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "healthy-acc",
      accounts: {
        "healthy-acc": { type: "mnemonic", createdAt: "2026-01-01" },
        "orphaned-acc": { type: "mnemonic", createdAt: "2026-01-01" },
        "passkey-acc": {
          type: "passkey",
          createdAt: "2026-01-01",
          passkeyCredentialId: "cred",
        },
        env: { type: "mnemonic", createdAt: "2026-01-01" },
      },
    });
    const vaultMod = await import("../vault.js");
    // healthy-acc has vault, orphaned-acc does not
    vi.mocked(vaultMod.readVaultFile).mockImplementation(
      async (name: string) => {
        if (name === "healthy-acc")
          return {
            version: 1,
            iv: "aXY=",
            ciphertext: "dGVzdA==",
            authTag: "dGFn",
          };
        return null;
      },
    );
    vi.mocked(vaultMod.listVaultFiles).mockResolvedValue(["healthy-acc"]);
    mockVaultKey.checkVaultKeyInKeytar.mockResolvedValue(true);
    mockVaultKey.isNativeKeychainAvailable.mockReturnValue(false);

    const { checkVaultIntegrity } = await import("../accounts.js");
    const result = await checkVaultIntegrity();

    const allCategorized = [
      ...result.healthy,
      ...result.orphaned,
      ...result.keyMissing,
      ...result.skipped,
      ...result.corrupt,
      ...result.repaired,
      ...result.unrecoverable,
      ...result.keychainError,
    ];
    const configAccountNames = [
      "healthy-acc",
      "orphaned-acc",
      "passkey-acc",
      "env",
    ];

    expect(allCategorized.sort()).toEqual(configAccountNames.sort());
    expect(new Set(allCategorized).size).toBe(allCategorized.length);
  });
});

describe("Non-mnemonic account rename", () => {
  it("should rename passkey account without vault operations", async () => {
    mockConfigStore.set("accounts.json", {
      version: 3,
      activeAccount: "my-passkey",
      accounts: {
        "my-passkey": {
          type: "passkey",
          createdAt: new Date().toISOString(),
          passkeyCredentialId: "cred-id",
        },
      },
    });

    const { renameAccount, loadAccountsConfig } = await import(
      "../accounts.js"
    );
    const vaultMod = await import("../vault.js");

    await renameAccount("my-passkey", "renamed-passkey");

    const config = await loadAccountsConfig();
    expect(config.accounts["renamed-passkey"]).toBeDefined();
    expect(config.accounts["renamed-passkey"].type).toBe("passkey");
    expect(config.accounts["my-passkey"]).toBeUndefined();
    expect(config.activeAccount).toBe("renamed-passkey");

    // No vault/key operations should be attempted for non-mnemonic
    expect(vaultMod.renameVaultFile).not.toHaveBeenCalled();
    expect(mockVaultKey.loadVaultKey).not.toHaveBeenCalled();
    expect(mockVaultKey.storeVaultKey).not.toHaveBeenCalled();
  });
});

describe("Key zeroing verification", () => {
  it("zeroes vaultKey buffer after successful saveMnemonicForAccount", async () => {
    let capturedKey: Buffer | null = null;
    mockVaultKey.storeVaultKey.mockImplementationOnce(
      async (_account: string, key: Buffer) => {
        capturedKey = Buffer.from(key);
        // Snapshot: key should NOT be zeroed yet at this point
        expect(key.some((b: number) => b !== 0)).toBe(true);
      },
    );

    const { saveMnemonicForAccount } = await import("../accounts.js");
    await saveMnemonicForAccount(
      "test",
      "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
    );

    // After completion, the original key (which was randomBytes(32)) should be zeroed.
    // We captured a copy, so we verify via the storeVaultKey call args.
    // The actual Buffer passed to storeVaultKey is zeroed by the finally block.
    const actualKey = mockVaultKey.storeVaultKey.mock.calls[0][1] as Buffer;
    expect(actualKey.every((b: number) => b === 0)).toBe(true);
    expect(capturedKey).not.toBeNull();
  });
});

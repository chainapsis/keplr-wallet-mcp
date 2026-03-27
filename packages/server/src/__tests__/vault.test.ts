import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptMnemonic, encryptMnemonic, writeVaultFile } from "../vault.js";

describe("vault", () => {
  const TEST_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  it("round-trips a mnemonic", () => {
    const key = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);
    const result = decryptMnemonic(vault, key);
    expect(result).toBe(TEST_MNEMONIC);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const key = randomBytes(32);
    const v1 = encryptMnemonic(TEST_MNEMONIC, key);
    const v2 = encryptMnemonic(TEST_MNEMONIC, key);
    expect(v1.iv).not.toBe(v2.iv);
    expect(v1.ciphertext).not.toBe(v2.ciphertext);
  });

  it("throws on wrong key", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);
    expect(() => decryptMnemonic(vault, wrongKey)).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const key = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);
    const tampered = { ...vault, ciphertext: "dGFtcGVyZWQ=" };
    expect(() => decryptMnemonic(tampered, key)).toThrow();
  });

  describe("writeVaultFile path traversal guard", () => {
    it("should throw on path traversal in account name", async () => {
      const key = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, key);
      await expect(writeVaultFile("../../etc/passwd", vault)).rejects.toThrow(
        "Invalid account name",
      );
    });

    it("should throw on absolute path as account name", async () => {
      const key = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, key);
      await expect(writeVaultFile("/etc/passwd", vault)).rejects.toThrow(
        "Invalid account name",
      );
    });

    it("should throw on account name with forward slash", async () => {
      const key = randomBytes(32);
      const vault = encryptMnemonic(TEST_MNEMONIC, key);
      await expect(writeVaultFile("foo/bar", vault)).rejects.toThrow(
        "Invalid account name",
      );
    });
  });

  it("throws on tampered authTag", () => {
    const key = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);

    // Flip a bit in the authTag
    const authTagBuf = Buffer.from(vault.authTag, "base64");
    authTagBuf[0] ^= 0xff;
    const tampered = { ...vault, authTag: authTagBuf.toString("base64") };

    expect(() => decryptMnemonic(tampered, key)).toThrow();
  });

  it("throws on tampered IV", () => {
    const key = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);

    // Flip a bit in the IV
    const ivBuf = Buffer.from(vault.iv, "base64");
    ivBuf[0] ^= 0xff;
    const tampered = { ...vault, iv: ivBuf.toString("base64") };

    expect(() => decryptMnemonic(tampered, key)).toThrow();
  });

  it("throws when vault key is wrong length (16 bytes instead of 32)", () => {
    const key = randomBytes(32);
    const vault = encryptMnemonic(TEST_MNEMONIC, key);

    const shortKey = randomBytes(16);
    expect(() => decryptMnemonic(vault, shortKey)).toThrow();
  });
});

/**
 * Address derivation verification test.
 *
 * Derives addresses from a well-known BIP39 test mnemonic using our implementation,
 * then asserts against golden values. These golden values can be cross-checked
 * against Keplr extension or other wallets that support the same chains.
 *
 * To verify manually:
 *   1. Import the test mnemonic into Keplr
 *   2. Enable each chain and compare addresses
 *   3. Update the golden values below if needed
 */

import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { describe, expect, it } from "vitest";
import { EthermintHdWallet } from "../../clients/ethermint-wallet.js";

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/**
 * Derive and print all addresses for cross-checking.
 * Run with: pnpm test packages/server/src/__tests__/clients/cointype-verification.test.ts
 */
describe("Address derivation golden values", () => {
  // ────────────────────────────────────────────
  // Standard Cosmos chains (ripemd160 + bech32)
  // ────────────────────────────────────────────

  it("Cosmos Hub (coinType 118) — baseline", async () => {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
      prefix: "cosmos",
      hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
    });
    const [account] = await wallet.getAccounts();
    console.log(`  Cosmos Hub (118): ${account.address}`);
    expect(account.address).toBe(
      "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
    );
  });

  it("Terra Classic (coinType 330)", async () => {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
      prefix: "terra",
      hdPaths: [stringToPath("m/44'/330'/0'/0/0")],
    });
    const [account] = await wallet.getAccounts();
    console.log(`  Terra Classic (330): ${account.address}`);
    expect(account.address).toBe(
      "terra1amdttz2937a3dytmxmkany53pp6ma6dy4vsllv",
    );
  });

  it("Terra Classic (coinType 118) — legacy", async () => {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
      prefix: "terra",
      hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
    });
    const [account] = await wallet.getAccounts();
    console.log(`  Terra Classic (118 legacy): ${account.address}`);
    expect(account.address).toBe(
      "terra19rl4cm2hmr8afy4kldpxz3fka4jguq0a6yhaa4",
    );
  });

  it("Provenance (coinType 505)", async () => {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
      prefix: "pb",
      hdPaths: [stringToPath("m/44'/505'/0'/0/0")],
    });
    const [account] = await wallet.getAccounts();
    console.log(`  Provenance (505): ${account.address}`);
    expect(account.address).toBe("pb1fpwxdyscnu2dzjwghpstx7l9xtvsap48l5gnrm");
  });

  it("Provenance (coinType 118) — legacy", async () => {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(TEST_MNEMONIC, {
      prefix: "pb",
      hdPaths: [stringToPath("m/44'/118'/0'/0/0")],
    });
    const [account] = await wallet.getAccounts();
    console.log(`  Provenance (118 legacy): ${account.address}`);
    expect(account.address).toBe("pb19rl4cm2hmr8afy4kldpxz3fka4jguq0a4wxcjf");
  });

  // ────────────────────────────────────────────
  // Ethermint chains (keccak256 + bech32)
  // ────────────────────────────────────────────

  it("Injective (coinType 60, keccak256)", async () => {
    const wallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "inj",
      "m/44'/60'/0'/0/0",
    );
    const [account] = await wallet.getAccounts();
    console.log(`  Injective (60 keccak256): ${account.address}`);
    expect(account.address).toBe("inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz");
  });

  it("XRPL EVM (coinType 60, keccak256)", async () => {
    const wallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "ethm",
      "m/44'/60'/0'/0/0",
    );
    const [account] = await wallet.getAccounts();
    console.log(`  XRPL EVM (60 keccak256): ${account.address}`);
    expect(account.address).toBe("ethm1npvwllfr9dqr8erajqqr6s0vxnk2ak55j7ufuc");
  });

  it("Dymension (coinType 60, keccak256)", async () => {
    const wallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "dym",
      "m/44'/60'/0'/0/0",
    );
    const [account] = await wallet.getAccounts();
    console.log(`  Dymension (60 keccak256): ${account.address}`);
    expect(account.address).toBe("dym1npvwllfr9dqr8erajqqr6s0vxnk2ak55md7d65");
  });

  // ────────────────────────────────────────────
  // Cross-reference: EVM hex address
  // ────────────────────────────────────────────

  it("EVM hex address matches keccak256 derivation", async () => {
    const {
      keccak256,
      Secp256k1,
      Bip39,
      EnglishMnemonic,
      Slip10,
      Slip10Curve,
      stringToPath,
    } = await import("@cosmjs/crypto");
    const { fromBech32, toHex } = await import("@cosmjs/encoding");

    // Derive the EVM address from first principles
    const englishMnemonic = new EnglishMnemonic(TEST_MNEMONIC);
    const seed = await Bip39.mnemonicToSeed(englishMnemonic);
    const { privkey } = Slip10.derivePath(
      Slip10Curve.Secp256k1,
      seed,
      stringToPath("m/44'/60'/0'/0/0"),
    );
    const keypair = await Secp256k1.makeKeypair(privkey);
    const rawAddress = keccak256(keypair.pubkey.slice(1)).slice(12);
    const evmHex = `0x${toHex(rawAddress)}`;

    console.log(`  EVM hex (m/44'/60'/0'/0/0): ${evmHex}`);

    // Well-known: this is the standard Ethereum "abandon" mnemonic address
    // (same as MetaMask derivation for this mnemonic)
    expect(evmHex).toBe("0x9858effd232b4033e47d90003d41ec34ecaeda94");

    // Verify our EthermintHdWallet matches
    const wallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "inj",
      "m/44'/60'/0'/0/0",
    );
    const [account] = await wallet.getAccounts();
    const decoded = fromBech32(account.address);
    const bech32Hex = `0x${toHex(decoded.data)}`;
    expect(bech32Hex).toBe(evmHex);
  });

  // ────────────────────────────────────────────
  // Consistency: same coinType = same raw address across prefixes
  // ────────────────────────────────────────────

  it("same coinType+hash produces same raw address regardless of prefix", async () => {
    const { fromBech32, toHex } = await import("@cosmjs/encoding");

    const injWallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "inj",
      "m/44'/60'/0'/0/0",
    );
    const ethmWallet = await EthermintHdWallet.fromMnemonic(
      TEST_MNEMONIC,
      "ethm",
      "m/44'/60'/0'/0/0",
    );

    const [injAccount] = await injWallet.getAccounts();
    const [ethmAccount] = await ethmWallet.getAccounts();

    const injRaw = toHex(fromBech32(injAccount.address).data);
    const ethmRaw = toHex(fromBech32(ethmAccount.address).data);

    expect(injRaw).toBe(ethmRaw);
  });
});

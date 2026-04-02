/**
 * E2E derivation test: uses the actual CosmosClient → getWallet() → getAddress() path
 * to verify that the production code derives correct addresses for each chain.
 */

import { describe, expect, it } from "vitest";
import { getChainConfig } from "../../chains/cosmos.js";
import { CosmosClient } from "../../clients/cosmos.js";

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/**
 * Create a CosmosClient and derive the address for a given chain,
 * exercising the full getWallet() → getAddress() production path.
 */
const deriveAddress = async (chainId: string): Promise<string> => {
  const chain = getChainConfig(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found`);
  const client = new CosmosClient(TEST_MNEMONIC);
  return client.getAddress(chain);
};

describe("E2E: CosmosClient address derivation by chain", () => {
  // ── Standard Cosmos chains (coinType 118) ──

  it("Cosmos Hub — coinType 118", async () => {
    const address = await deriveAddress("cosmoshub-4");
    console.log(`  cosmoshub-4: ${address}`);
    expect(address).toBe("cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4");
  });

  it("Osmosis — coinType 118", async () => {
    const address = await deriveAddress("osmosis-1");
    console.log(`  osmosis-1: ${address}`);
    expect(address).toMatch(/^osmo1/);
  });

  // ── Non-118 Cosmos chains ──

  it("Terra Classic — coinType 330", async () => {
    const chain = getChainConfig("columbus-5");
    expect(chain?.bip44.coinType).toBe(330);

    const address = await deriveAddress("columbus-5");
    console.log(`  columbus-5 (Terra Classic): ${address}`);
    expect(address).toBe("terra1amdttz2937a3dytmxmkany53pp6ma6dy4vsllv");
  });

  it("Terra (Phoenix) — coinType 330", async () => {
    const chain = getChainConfig("phoenix-1");
    if (!chain) return; // skip if not in registry
    expect(chain.bip44.coinType).toBe(330);

    const address = await deriveAddress("phoenix-1");
    console.log(`  phoenix-1 (Terra): ${address}`);
    // Same coinType + same prefix = same address as Columbus
    expect(address).toBe("terra1amdttz2937a3dytmxmkany53pp6ma6dy4vsllv");
  });

  // ── Ethermint chains (coinType 60, keccak256) ──

  it("Injective — coinType 60, eth-address-gen", async () => {
    const chain = getChainConfig("injective-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("injective-1");
    console.log(`  injective-1: ${address}`);
    expect(address).toBe("inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz");
  });

  it("XRPL EVM — coinType 60, eth-address-gen", async () => {
    const chain = getChainConfig("xrplevm_1440000-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("xrplevm_1440000-1");
    console.log(`  xrplevm_1440000-1: ${address}`);
    expect(address).toBe("ethm1npvwllfr9dqr8erajqqr6s0vxnk2ak55j7ufuc");
  });

  it("Dymension — coinType 60, eth-address-gen", async () => {
    const chain = getChainConfig("dymension_1100-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("dymension_1100-1");
    console.log(`  dymension_1100-1: ${address}`);
    expect(address).toBe("dym1npvwllfr9dqr8erajqqr6s0vxnk2ak55md7d65");
  });

  // ── eth-address-gen chains with standard BaseAccount (not custom EthAccount) ──

  it("XPLA — coinType 60, eth-address-gen, standard BaseAccount", async () => {
    const chain = getChainConfig("dimension_37-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("dimension_37-1");
    console.log(`  dimension_37-1 (XPLA): ${address}`);
    expect(address).toBe("xpla1npvwllfr9dqr8erajqqr6s0vxnk2ak55hh2h5f");
  });

  it("ZetaChain — coinType 60, eth-address-gen, standard BaseAccount", async () => {
    const chain = getChainConfig("zetachain_7000-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("zetachain_7000-1");
    console.log(`  zetachain_7000-1: ${address}`);
    expect(address).toBe("zeta1npvwllfr9dqr8erajqqr6s0vxnk2ak55l5u792");
  });

  it("Initia — coinType 60, eth-address-gen, standard BaseAccount", async () => {
    const chain = getChainConfig("interwoven-1");
    expect(chain?.bip44.coinType).toBe(60);
    expect(chain?.features).toContain("eth-address-gen");

    const address = await deriveAddress("interwoven-1");
    console.log(`  interwoven-1 (Initia): ${address}`);
    expect(address).toBe("init1npvwllfr9dqr8erajqqr6s0vxnk2ak558xjc5c");
  });

  // ── Verify address changes vs old behavior ──

  it("Terra Classic address differs from old hardcoded 118 derivation", async () => {
    const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");

    // Old behavior: always used coinType 118
    const oldWallet = await DirectSecp256k1HdWallet.fromMnemonic(
      TEST_MNEMONIC,
      { prefix: "terra" },
    );
    const [oldAccount] = await oldWallet.getAccounts();

    // New behavior: uses coinType 330 from chain config
    const newAddress = await deriveAddress("columbus-5");

    console.log(`  Old (118): ${oldAccount.address}`);
    console.log(`  New (330): ${newAddress}`);
    expect(newAddress).not.toBe(oldAccount.address);
  });

  it("Injective address differs from old hardcoded 118 derivation", async () => {
    const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");

    // Old behavior: coinType 118 + ripemd160
    const oldWallet = await DirectSecp256k1HdWallet.fromMnemonic(
      TEST_MNEMONIC,
      { prefix: "inj" },
    );
    const [oldAccount] = await oldWallet.getAccounts();

    // New behavior: coinType 60 + keccak256
    const newAddress = await deriveAddress("injective-1");

    console.log(`  Old (118+ripemd): ${oldAccount.address}`);
    console.log(`  New (60+keccak):  ${newAddress}`);
    expect(newAddress).not.toBe(oldAccount.address);
  });
});

import type { ChainInfo } from "@keplr-wallet/types";
import { describe, expect, it } from "vitest";
import {
  getEthermintPubkeyTypeUrl,
  needsEthermintSigning,
} from "../../../clients/ethermint/helpers.js";

const makeChain = (chainId: string, features?: string[]): ChainInfo =>
  ({
    chainId,
    features,
  }) as unknown as ChainInfo;

describe("needsEthermintSigning", () => {
  it("returns true for injective-1", () => {
    expect(
      needsEthermintSigning(
        makeChain("injective-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns true for dymension_1100-1", () => {
    expect(
      needsEthermintSigning(
        makeChain("dymension_1100-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns true for xrplevm_1440000-1", () => {
    expect(
      needsEthermintSigning(
        makeChain("xrplevm_1440000-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns true for zetachain", () => {
    expect(
      needsEthermintSigning(
        makeChain("zetachain_7000-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns true for XPLA", () => {
    expect(
      needsEthermintSigning(
        makeChain("dimension_37-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns true for Initia", () => {
    expect(
      needsEthermintSigning(
        makeChain("interwoven-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns false for non-ethermint chain", () => {
    expect(
      needsEthermintSigning(makeChain("cosmoshub-4", ["ibc-transfer"])),
    ).toBe(false);
  });
});

describe("getEthermintPubkeyTypeUrl", () => {
  it("returns Injective-specific pubkey typeUrl for injective chain", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("injective-1"))).toBe(
      "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
    );
  });

  it("returns default ethermint pubkey typeUrl for dymension", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("dymension_1100-1"))).toBe(
      "/ethermint.crypto.v1.ethsecp256k1.PubKey",
    );
  });

  it("returns default ethermint pubkey typeUrl for xrplevm", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("xrplevm_1440000-1"))).toBe(
      "/ethermint.crypto.v1.ethsecp256k1.PubKey",
    );
  });

  it("returns default ethermint pubkey typeUrl for zetachain", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("zetachain_7000-1"))).toBe(
      "/ethermint.crypto.v1.ethsecp256k1.PubKey",
    );
  });

  it("returns Initia-specific pubkey typeUrl for interwoven chain", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("interwoven-1"))).toBe(
      "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
    );
  });

  it("returns Initia-specific pubkey typeUrl for interwoven testnet", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("interwoven-2"))).toBe(
      "/initia.crypto.v1beta1.ethsecp256k1.PubKey",
    );
  });

  it("returns Stratos-specific pubkey typeUrl for stratos chain", () => {
    expect(getEthermintPubkeyTypeUrl(makeChain("stratos-1"))).toBe(
      "/stratos.crypto.v1.ethsecp256k1.PubKey",
    );
  });

  it("returns cosmos.evm pubkey typeUrl for eth-secp256k1-cosmos feature", () => {
    expect(
      getEthermintPubkeyTypeUrl(
        makeChain("somechain-1", ["eth-key-sign", "eth-secp256k1-cosmos"]),
      ),
    ).toBe("/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");
  });

  it("returns initia pubkey typeUrl for eth-secp256k1-initia feature", () => {
    expect(
      getEthermintPubkeyTypeUrl(
        makeChain("somechain-1", ["eth-key-sign", "eth-secp256k1-initia"]),
      ),
    ).toBe("/initia.crypto.v1beta1.ethsecp256k1.PubKey");
  });
});

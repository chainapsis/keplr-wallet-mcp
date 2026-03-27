import type { ChainInfo } from "@keplr-wallet/types";
import { describe, expect, it } from "vitest";
import {
  getEthermintPubkeyTypeUrl,
  isEthermintLike,
  needsEthermintSigning,
} from "../../../clients/ethermint/helpers.js";

const makeChain = (chainId: string, features?: string[]): ChainInfo =>
  ({
    chainId,
    features,
  }) as unknown as ChainInfo;

describe("isEthermintLike", () => {
  it("returns true for chain with eth-address-gen feature", () => {
    expect(
      isEthermintLike(
        makeChain("injective-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(true);
  });

  it("returns false for chain without eth-address-gen", () => {
    expect(isEthermintLike(makeChain("cosmoshub-4", ["ibc-transfer"]))).toBe(
      false,
    );
  });

  it("returns false when features is undefined", () => {
    expect(isEthermintLike(makeChain("cosmoshub-4"))).toBe(false);
  });

  it("returns false when features is empty", () => {
    expect(isEthermintLike(makeChain("cosmoshub-4", []))).toBe(false);
  });
});

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

  it("returns false for zetachain (uses standard BaseAccount)", () => {
    expect(
      needsEthermintSigning(
        makeChain("zetachain_7000-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(false);
  });

  it("returns false for XPLA (uses standard BaseAccount)", () => {
    expect(
      needsEthermintSigning(
        makeChain("dimension_37-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(false);
  });

  it("returns false for Initia (uses standard BaseAccount)", () => {
    expect(
      needsEthermintSigning(
        makeChain("interwoven-1", ["eth-address-gen", "eth-key-sign"]),
      ),
    ).toBe(false);
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
});

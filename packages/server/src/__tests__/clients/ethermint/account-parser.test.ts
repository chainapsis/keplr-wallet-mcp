import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { describe, expect, it } from "vitest";
import { ethermintAccountParser } from "../../../clients/ethermint/account-parser.js";

/**
 * Build a mock EthAccount protobuf Any value.
 *
 * EthAccount proto:
 *   field 1 (BaseAccount) = tag 0x0a + varint length + BaseAccount bytes
 *   field 2 (code_hash)   = tag 0x12 + varint length + string bytes
 */
const buildEthAccountAny = (
  typeUrl: string,
  address: string,
  accountNumber: bigint,
  sequence: bigint,
): Any => {
  const baseAccountBytes = BaseAccount.encode({
    address,
    pubKey: undefined,
    accountNumber,
    sequence,
  }).finish();

  const codeHash = new TextEncoder().encode(
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  );

  // Manually build EthAccount proto: field 1 + field 2
  const parts: number[] = [];
  // Field 1: tag = (1 << 3) | 2 = 0x0a
  parts.push(0x0a);
  pushVarint(parts, baseAccountBytes.length);
  parts.push(...baseAccountBytes);
  // Field 2: tag = (2 << 3) | 2 = 0x12
  parts.push(0x12);
  pushVarint(parts, codeHash.length);
  parts.push(...codeHash);

  return Any.fromPartial({
    typeUrl,
    value: new Uint8Array(parts),
  });
};

/** Encode a varint into a number array */
const pushVarint = (arr: number[], value: number): void => {
  let v = value;
  while (v > 0x7f) {
    arr.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  arr.push(v);
};

describe("ethermintAccountParser", () => {
  it("parses Injective EthAccount correctly", () => {
    const input = buildEthAccountAny(
      "/injective.types.v1beta1.EthAccount",
      "inj1fm3p52hq93xdtazr809dvc9fgv7g90cgdc2vet",
      1635031n,
      0n,
    );

    const account = ethermintAccountParser(input);
    expect(account.address).toBe("inj1fm3p52hq93xdtazr809dvc9fgv7g90cgdc2vet");
    expect(account.accountNumber).toBe(1635031);
    expect(account.sequence).toBe(0);
    expect(account.pubkey).toBeNull();
  });

  it("parses Dymension EthAccount correctly", () => {
    const input = buildEthAccountAny(
      "/ethermint.types.v1.EthAccount",
      "dym1qqqqpq4uj9jk3j6y08f6yxx6lfswhw39njgrj4",
      75n,
      1n,
    );

    const account = ethermintAccountParser(input);
    expect(account.address).toBe("dym1qqqqpq4uj9jk3j6y08f6yxx6lfswhw39njgrj4");
    expect(account.accountNumber).toBe(75);
    expect(account.sequence).toBe(1);
  });

  it("handles accounts with large sequence numbers", () => {
    const input = buildEthAccountAny(
      "/injective.types.v1beta1.EthAccount",
      "inj1test",
      999999n,
      12345n,
    );

    const account = ethermintAccountParser(input);
    expect(account.accountNumber).toBe(999999);
    expect(account.sequence).toBe(12345);
  });

  it("falls back to default parser for standard BaseAccount", () => {
    const baseAccountBytes = BaseAccount.encode({
      address: "cosmos1test",
      pubKey: undefined,
      accountNumber: 42n,
      sequence: 5n,
    }).finish();

    const input = Any.fromPartial({
      typeUrl: "/cosmos.auth.v1beta1.BaseAccount",
      value: baseAccountBytes,
    });

    const account = ethermintAccountParser(input);
    expect(account.address).toBe("cosmos1test");
    expect(account.accountNumber).toBe(42);
    expect(account.sequence).toBe(5);
  });

  it("handles BaseAccount with ethermint pubkey (Dymension active account)", () => {
    const baseAccountBytes = BaseAccount.encode({
      address: "dym19p6ngtmggatpfphu7jm9u2ddc843p86ayqh6xk",
      pubKey: {
        typeUrl: "/ethermint.crypto.v1.ethsecp256k1.PubKey",
        value: new Uint8Array([3, 98, 62, 231]),
      },
      accountNumber: 708313n,
      sequence: 28n,
    }).finish();

    const input = Any.fromPartial({
      typeUrl: "/cosmos.auth.v1beta1.BaseAccount",
      value: baseAccountBytes,
    });

    const account = ethermintAccountParser(input);
    expect(account.address).toBe("dym19p6ngtmggatpfphu7jm9u2ddc843p86ayqh6xk");
    expect(account.accountNumber).toBe(708313);
    expect(account.sequence).toBe(28);
    expect(account.pubkey).toBeNull();
  });

  it("throws for unsupported account type", () => {
    const input = Any.fromPartial({
      typeUrl: "/cosmos.unknown.v1.SomeAccount",
      value: new Uint8Array([]),
    });

    expect(() => ethermintAccountParser(input)).toThrow("Unsupported type");
  });
});

import { describe, expect, it } from "vitest";
import { isBabylonChain, wrapForBabylon } from "../../utils/babylon.js";

describe("isBabylonChain", () => {
  it("returns true for bbn-1", () => {
    expect(isBabylonChain("bbn-1")).toBe(true);
  });

  it("returns true for testnet chains", () => {
    expect(isBabylonChain("bbn-test-5")).toBe(true);
    expect(isBabylonChain("bbn-test-6")).toBe(true);
  });

  it("returns false for other chains", () => {
    expect(isBabylonChain("cosmoshub-4")).toBe(false);
    expect(isBabylonChain("osmosis-1")).toBe(false);
  });
});

describe("wrapForBabylon", () => {
  it("passes through for non-Babylon chains", () => {
    const msg = {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: {
        delegatorAddress: "cosmos1abc",
        validatorAddress: "cosmosvaloper1abc",
        amount: { denom: "uatom", amount: "1000000" },
      },
    };
    expect(wrapForBabylon("cosmoshub-4", msg)).toBe(msg);
  });

  it("wraps MsgDelegate for bbn-1", () => {
    const innerValue = {
      delegatorAddress: "bbn1abc",
      validatorAddress: "bbnvaloper1abc",
      amount: { denom: "ubbn", amount: "1000000" },
    };
    const msg = {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: innerValue,
    };
    expect(wrapForBabylon("bbn-1", msg)).toEqual({
      typeUrl: "/babylon.epoching.v1.MsgWrappedDelegate",
      value: { msg: innerValue },
    });
  });

  it("wraps MsgUndelegate for bbn-1", () => {
    const innerValue = {
      delegatorAddress: "bbn1abc",
      validatorAddress: "bbnvaloper1abc",
      amount: { denom: "ubbn", amount: "500000" },
    };
    const msg = {
      typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
      value: innerValue,
    };
    expect(wrapForBabylon("bbn-1", msg)).toEqual({
      typeUrl: "/babylon.epoching.v1.MsgWrappedUndelegate",
      value: { msg: innerValue },
    });
  });

  it("wraps MsgBeginRedelegate for bbn-1", () => {
    const innerValue = {
      delegatorAddress: "bbn1abc",
      validatorSrcAddress: "bbnvaloper1src",
      validatorDstAddress: "bbnvaloper1dst",
      amount: { denom: "ubbn", amount: "100000" },
    };
    const msg = {
      typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
      value: innerValue,
    };
    expect(wrapForBabylon("bbn-1", msg)).toEqual({
      typeUrl: "/babylon.epoching.v1.MsgWrappedBeginRedelegate",
      value: { msg: innerValue },
    });
  });

  it("wraps MsgCancelUnbondingDelegation for bbn-1", () => {
    const innerValue = {
      delegatorAddress: "bbn1abc",
      validatorAddress: "bbnvaloper1abc",
      amount: { denom: "ubbn", amount: "200000" },
      creationHeight: BigInt(12345),
    };
    const msg = {
      typeUrl: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
      value: innerValue,
    };
    expect(wrapForBabylon("bbn-1", msg)).toEqual({
      typeUrl: "/babylon.epoching.v1.MsgWrappedCancelUnbondingDelegation",
      value: { msg: innerValue },
    });
  });

  it("passes through non-staking messages on bbn-1", () => {
    const msg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: "bbn1abc",
        toAddress: "bbn1def",
        amount: [{ denom: "ubbn", amount: "1000" }],
      },
    };
    expect(wrapForBabylon("bbn-1", msg)).toBe(msg);
  });
});

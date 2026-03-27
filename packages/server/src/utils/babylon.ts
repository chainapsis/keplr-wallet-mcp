import type { EncodeObject } from "@cosmjs/proto-signing";

export const isBabylonChain = (chainId: string): boolean =>
  chainId.startsWith("bbn-");

const BABYLON_WRAP_MAP: Record<string, string> = {
  "/cosmos.staking.v1beta1.MsgDelegate":
    "/babylon.epoching.v1.MsgWrappedDelegate",
  "/cosmos.staking.v1beta1.MsgUndelegate":
    "/babylon.epoching.v1.MsgWrappedUndelegate",
  "/cosmos.staking.v1beta1.MsgBeginRedelegate":
    "/babylon.epoching.v1.MsgWrappedBeginRedelegate",
  "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation":
    "/babylon.epoching.v1.MsgWrappedCancelUnbondingDelegation",
};

/**
 * Wraps standard Cosmos staking messages for Babylon's epoching module.
 * No-op for non-Babylon chains or non-staking messages.
 */
export const wrapForBabylon = (
  chainId: string,
  msg: EncodeObject,
): EncodeObject => {
  if (!isBabylonChain(chainId)) return msg;
  const wrappedTypeUrl = BABYLON_WRAP_MAP[msg.typeUrl];
  if (!wrappedTypeUrl) return msg;
  return { typeUrl: wrappedTypeUrl, value: { msg: msg.value } };
};

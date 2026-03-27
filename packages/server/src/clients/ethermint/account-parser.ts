import type { Account } from "@cosmjs/stargate";
import { accountFromAny } from "@cosmjs/stargate";
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth.js";
import type { Any } from "cosmjs-types/google/protobuf/any.js";
import {
  ETHERMINT_ACCOUNT_TYPE_URLS,
  type EthermintAccountTypeUrl,
} from "./types.js";

/**
 * Decode a protobuf varint at the given offset.
 * Returns [value, newOffset].
 */
const decodeVarint = (bytes: Uint8Array, offset: number): [number, number] => {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < bytes.length) {
    const byte = bytes[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
};

/**
 * Extract field 1 (length-delimited) from protobuf bytes.
 *
 * Both `/injective.types.v1beta1.EthAccount` and `/ethermint.types.v1.EthAccount`
 * share the same proto structure:
 *   message EthAccount {
 *     cosmos.auth.v1beta1.BaseAccount base_account = 1;
 *     string code_hash = 2;
 *   }
 */
const extractBaseAccountBytes = (ethAccountValue: Uint8Array): Uint8Array => {
  let offset = 0;
  while (offset < ethAccountValue.length) {
    const [tag, tagEnd] = decodeVarint(ethAccountValue, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    offset = tagEnd;

    if (fieldNumber === 1 && wireType === 2) {
      const [len, lenEnd] = decodeVarint(ethAccountValue, offset);
      return ethAccountValue.slice(lenEnd, lenEnd + len);
    }

    // Skip other fields
    if (wireType === 0) {
      // varint
      const [, newOffset] = decodeVarint(ethAccountValue, offset);
      offset = newOffset;
    } else if (wireType === 2) {
      // length-delimited
      const [len, lenEnd] = decodeVarint(ethAccountValue, offset);
      offset = lenEnd + len;
    } else if (wireType === 1) {
      offset += 8; // 64-bit
    } else if (wireType === 5) {
      offset += 4; // 32-bit
    } else {
      throw new Error(`Unknown wire type: ${wireType}`);
    }
  }
  throw new Error("BaseAccount field not found in EthAccount");
};

const isEthermintAccountType = (
  typeUrl: string,
): typeUrl is EthermintAccountTypeUrl =>
  (ETHERMINT_ACCOUNT_TYPE_URLS as readonly string[]).includes(typeUrl);

/**
 * AccountParser for ethermint-based chains.
 * Handles EthAccount types by extracting the embedded BaseAccount,
 * and falls back to CosmJS default for standard account types.
 */
export const ethermintAccountParser = (input: Any): Account => {
  if (isEthermintAccountType(input.typeUrl)) {
    const baseAccountBytes = extractBaseAccountBytes(input.value);
    const baseAccount = BaseAccount.decode(baseAccountBytes);
    return {
      address: baseAccount.address,
      pubkey: null,
      accountNumber: Number(baseAccount.accountNumber),
      sequence: Number(baseAccount.sequence),
    };
  }

  // Standard account types (e.g. BaseAccount) on ethermint chains may have
  // ethsecp256k1 pubkeys that CosmJS's decodePubkey doesn't recognize.
  try {
    return accountFromAny(input);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not recognized") &&
      input.typeUrl === "/cosmos.auth.v1beta1.BaseAccount"
    ) {
      const baseAccount = BaseAccount.decode(input.value);
      return {
        address: baseAccount.address,
        pubkey: null,
        accountNumber: Number(baseAccount.accountNumber),
        sequence: Number(baseAccount.sequence),
      };
    }
    throw error;
  }
};

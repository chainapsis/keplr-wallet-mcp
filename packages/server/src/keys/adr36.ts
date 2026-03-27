/**
 * ADR-36: Cosmos Arbitrary Message Signing
 *
 * This module implements ADR-36 (Arbitrary Message Signing) for Cosmos SDK chains.
 * ADR-36 allows signing arbitrary data to prove address ownership without
 * broadcasting a transaction to the chain.
 *
 * @see https://docs.cosmos.network/main/architecture/adr-036-arbitrary-signature
 */

import { type StdSignDoc, serializeSignDoc } from "@cosmjs/amino";

/**
 * ADR-36 message type constant.
 */
export const ADR36_MSG_TYPE = "sign/MsgSignData";

/**
 * ADR-36 sign document structure.
 * This is a special amino sign doc format for arbitrary message signing.
 */
export interface Adr36SignDoc extends StdSignDoc {
  chain_id: "";
  account_number: "0";
  sequence: "0";
  fee: {
    gas: "0";
    amount: [];
  };
  msgs: [
    {
      type: typeof ADR36_MSG_TYPE;
      value: {
        signer: string;
        data: string; // base64 encoded
      };
    },
  ];
  memo: "";
}

/**
 * Create an ADR-36 sign document for arbitrary message signing.
 *
 * @param signer - The bech32 address of the signer
 * @param data - The message data to sign (will be base64 encoded)
 * @returns ADR-36 formatted sign document
 */
export function makeAdr36SignDoc(
  signer: string,
  data: Uint8Array | string,
): Adr36SignDoc {
  // Convert string to Uint8Array if needed
  const dataBytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  // Base64 encode the data
  const dataBase64 = Buffer.from(dataBytes).toString("base64");

  return {
    chain_id: "",
    account_number: "0",
    sequence: "0",
    fee: {
      gas: "0",
      amount: [],
    },
    msgs: [
      {
        type: ADR36_MSG_TYPE,
        value: {
          signer,
          data: dataBase64,
        },
      },
    ],
    memo: "",
  };
}

/**
 * Serialize an ADR-36 sign document to bytes for signing.
 * Uses the same serialization as amino sign docs (sorted JSON).
 *
 * @param signDoc - The ADR-36 sign document
 * @returns Serialized bytes ready for signing
 */
export function serializeAdr36SignDoc(signDoc: Adr36SignDoc): Uint8Array {
  return serializeSignDoc(signDoc);
}

/**
 * Verify that a sign doc is a valid ADR-36 format.
 *
 * @param signDoc - The sign document to verify
 * @returns true if the sign doc is valid ADR-36 format
 */
export function isValidAdr36SignDoc(signDoc: unknown): signDoc is Adr36SignDoc {
  if (!signDoc || typeof signDoc !== "object") return false;

  const doc = signDoc as Record<string, unknown>;

  // Check required fields
  if (doc.chain_id !== "") return false;
  if (doc.account_number !== "0") return false;
  if (doc.sequence !== "0") return false;
  if (doc.memo !== "") return false;

  // Check fee
  const fee = doc.fee as { gas?: string; amount?: unknown[] } | undefined;
  if (
    !fee ||
    fee.gas !== "0" ||
    !Array.isArray(fee.amount) ||
    fee.amount.length !== 0
  ) {
    return false;
  }

  // Check msgs
  const msgs = doc.msgs as
    | Array<{ type?: string; value?: { signer?: string; data?: string } }>
    | undefined;
  if (!Array.isArray(msgs) || msgs.length !== 1) return false;

  const msg = msgs[0];
  if (msg.type !== ADR36_MSG_TYPE) return false;
  if (
    !msg.value ||
    typeof msg.value.signer !== "string" ||
    typeof msg.value.data !== "string"
  ) {
    return false;
  }

  return true;
}

/**
 * Extract the original message data from an ADR-36 sign doc.
 *
 * @param signDoc - The ADR-36 sign document
 * @returns The decoded message data
 */
export function extractAdr36Data(signDoc: Adr36SignDoc): Uint8Array {
  const dataBase64 = signDoc.msgs[0].value.data;
  return new Uint8Array(Buffer.from(dataBase64, "base64"));
}

/**
 * Extract the signer address from an ADR-36 sign doc.
 *
 * @param signDoc - The ADR-36 sign document
 * @returns The signer's bech32 address
 */
export function extractAdr36Signer(signDoc: Adr36SignDoc): string {
  return signDoc.msgs[0].value.signer;
}

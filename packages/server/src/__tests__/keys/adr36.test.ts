import { describe, expect, it } from "vitest";
import {
  ADR36_MSG_TYPE,
  extractAdr36Data,
  extractAdr36Signer,
  isValidAdr36SignDoc,
  makeAdr36SignDoc,
  serializeAdr36SignDoc,
} from "../../keys/adr36.js";

describe("ADR-36 (Cosmos Arbitrary Message Signing)", () => {
  const testAddress = "cosmos1abc123xyz";
  const testMessage = "Hello, Cosmos!";

  describe("makeAdr36SignDoc", () => {
    it("should create a valid ADR-36 sign doc from string message", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);

      expect(signDoc.chain_id).toBe("");
      expect(signDoc.account_number).toBe("0");
      expect(signDoc.sequence).toBe("0");
      expect(signDoc.fee).toEqual({ gas: "0", amount: [] });
      expect(signDoc.memo).toBe("");
      expect(signDoc.msgs).toHaveLength(1);
      expect(signDoc.msgs[0].type).toBe(ADR36_MSG_TYPE);
      expect(signDoc.msgs[0].value.signer).toBe(testAddress);
      // Message should be base64 encoded
      expect(signDoc.msgs[0].value.data).toBe(
        Buffer.from(testMessage).toString("base64"),
      );
    });

    it("should create a valid ADR-36 sign doc from Uint8Array", () => {
      const messageBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const signDoc = makeAdr36SignDoc(testAddress, messageBytes);

      expect(signDoc.msgs[0].value.data).toBe(
        Buffer.from(messageBytes).toString("base64"),
      );
    });

    it("should handle empty message", () => {
      const signDoc = makeAdr36SignDoc(testAddress, "");

      expect(signDoc.msgs[0].value.data).toBe("");
    });

    it("should handle unicode messages", () => {
      const unicodeMessage = "Hello 👋 Cosmos 🌌";
      const signDoc = makeAdr36SignDoc(testAddress, unicodeMessage);

      const decoded = Buffer.from(
        signDoc.msgs[0].value.data,
        "base64",
      ).toString("utf-8");
      expect(decoded).toBe(unicodeMessage);
    });
  });

  describe("serializeAdr36SignDoc", () => {
    it("should serialize to sorted JSON bytes", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      const serialized = serializeAdr36SignDoc(signDoc);

      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(serialized.length).toBeGreaterThan(0);

      // Parse back to verify it's valid JSON
      const jsonString = new TextDecoder().decode(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.chain_id).toBe("");
      expect(parsed.msgs[0].type).toBe(ADR36_MSG_TYPE);
    });

    it("should produce consistent output for same input", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      const serialized1 = serializeAdr36SignDoc(signDoc);
      const serialized2 = serializeAdr36SignDoc(signDoc);

      expect(serialized1).toEqual(serialized2);
    });
  });

  describe("isValidAdr36SignDoc", () => {
    it("should return true for valid ADR-36 sign doc", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      expect(isValidAdr36SignDoc(signDoc)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isValidAdr36SignDoc(null)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isValidAdr36SignDoc("not an object")).toBe(false);
      expect(isValidAdr36SignDoc(123)).toBe(false);
    });

    it("should return false if chain_id is not empty", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        chain_id: "cosmoshub-4",
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if account_number is not 0", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        account_number: "1",
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if sequence is not 0", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        sequence: "1",
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if fee gas is not 0", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        fee: { gas: "1000", amount: [] },
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if fee amount is not empty", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        fee: { gas: "0", amount: [{ denom: "uatom", amount: "1000" }] },
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if memo is not empty", () => {
      const signDoc = {
        ...makeAdr36SignDoc(testAddress, testMessage),
        memo: "some memo",
      };
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if msg type is wrong", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      signDoc.msgs[0].type = "cosmos-sdk/MsgSend" as typeof ADR36_MSG_TYPE;
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });

    it("should return false if multiple messages", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      (signDoc.msgs as unknown[]).push(signDoc.msgs[0]);
      expect(isValidAdr36SignDoc(signDoc)).toBe(false);
    });
  });

  describe("extractAdr36Data", () => {
    it("should extract original message from sign doc", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      const extracted = extractAdr36Data(signDoc);

      expect(new TextDecoder().decode(extracted)).toBe(testMessage);
    });

    it("should extract binary data correctly", () => {
      const originalData = new Uint8Array([0, 1, 2, 255, 254, 253]);
      const signDoc = makeAdr36SignDoc(testAddress, originalData);
      const extracted = extractAdr36Data(signDoc);

      expect(extracted).toEqual(originalData);
    });
  });

  describe("extractAdr36Signer", () => {
    it("should extract signer address from sign doc", () => {
      const signDoc = makeAdr36SignDoc(testAddress, testMessage);
      const signer = extractAdr36Signer(signDoc);

      expect(signer).toBe(testAddress);
    });
  });

  describe("ADR36_MSG_TYPE", () => {
    it("should be the correct message type", () => {
      expect(ADR36_MSG_TYPE).toBe("sign/MsgSignData");
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  P256Signer,
  type WebAuthnAssertion,
  type WebAuthnAssertionOptions,
  type WebAuthnInteractionHandler,
} from "../../../keys/signers/p256.js";
import { SignerError, SignerErrorCode } from "../../../keys/signers/types.js";

// Mock WebAuthn interaction handler for testing
class MockWebAuthnHandler implements WebAuthnInteractionHandler {
  private response: WebAuthnAssertion | null = null;
  private shouldFail = false;
  private failMessage = "";

  setResponse(response: WebAuthnAssertion): void {
    this.response = response;
  }

  setFailure(message: string): void {
    this.shouldFail = true;
    this.failMessage = message;
  }

  async requestAssertion(
    _options: WebAuthnAssertionOptions,
  ): Promise<WebAuthnAssertion> {
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    if (!this.response) {
      throw new Error("No mock response set");
    }
    return this.response;
  }
}

// Valid P-256 public key (uncompressed, 65 bytes starting with 0x04)
// This is a test key - DO NOT use for real funds
const TEST_PUBLIC_KEY_UNCOMPRESSED = new Uint8Array([
  0x04, // Uncompressed point prefix
  // X coordinate (32 bytes)
  0x5a,
  0x99,
  0x1f,
  0x74,
  0x2c,
  0x08,
  0x1a,
  0x9f,
  0xef,
  0x9a,
  0x47,
  0x5c,
  0x4d,
  0x14,
  0x8f,
  0x2c,
  0x0a,
  0x6c,
  0x89,
  0x56,
  0x1f,
  0x23,
  0x18,
  0x34,
  0x5f,
  0x6b,
  0x7e,
  0x0c,
  0xce,
  0x01,
  0x89,
  0x2e,
  // Y coordinate (32 bytes)
  0xd7,
  0x5b,
  0x00,
  0x2a,
  0x05,
  0xf9,
  0x3e,
  0xed,
  0x54,
  0xb4,
  0x7c,
  0x3f,
  0xe5,
  0x76,
  0x0b,
  0x6a,
  0x4d,
  0xc9,
  0x99,
  0x1f,
  0x0b,
  0x12,
  0x53,
  0x1f,
  0x22,
  0x39,
  0xdc,
  0x1e,
  0x65,
  0x5f,
  0x88,
  0x37,
]);

// Compressed version (33 bytes)
const TEST_PUBLIC_KEY_COMPRESSED = new Uint8Array([
  0x02, // Even Y prefix
  0x5a,
  0x99,
  0x1f,
  0x74,
  0x2c,
  0x08,
  0x1a,
  0x9f,
  0xef,
  0x9a,
  0x47,
  0x5c,
  0x4d,
  0x14,
  0x8f,
  0x2c,
  0x0a,
  0x6c,
  0x89,
  0x56,
  0x1f,
  0x23,
  0x18,
  0x34,
  0x5f,
  0x6b,
  0x7e,
  0x0c,
  0xce,
  0x01,
  0x89,
  0x2e,
]);

const TEST_CREDENTIAL_ID = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
  0x0e, 0x0f, 0x10,
]);

// Mock WebAuthn signature (DER encoded) - proper 70 byte signature
const MOCK_DER_SIGNATURE = new Uint8Array([
  0x30,
  0x44, // SEQUENCE, 68 bytes
  0x02,
  0x20, // INTEGER, 32 bytes (r)
  0x9c,
  0x21,
  0xe2,
  0x4e,
  0x5d,
  0x15,
  0x8a,
  0x8a,
  0x0c,
  0x18,
  0x3d,
  0x39,
  0x6f,
  0x5b,
  0x4e,
  0x5c,
  0x2b,
  0x8d,
  0x56,
  0x8f,
  0x34,
  0x75,
  0xae,
  0x3e,
  0x8e,
  0xd8,
  0x55,
  0x2a,
  0x4b,
  0xa8,
  0x93,
  0x01,
  0x02,
  0x20, // INTEGER, 32 bytes (s)
  0x4f,
  0x5d,
  0x7c,
  0x77,
  0x7c,
  0x9a,
  0x8d,
  0x7f,
  0x4e,
  0x15,
  0x7f,
  0xcc,
  0x2a,
  0x2f,
  0xe9,
  0x7e,
  0x9f,
  0xf2,
  0x78,
  0xc2,
  0x6f,
  0x5c,
  0x8d,
  0x4a,
  0x8e,
  0x4c,
  0x3e,
  0x4a,
  0x8c,
  0x8e,
  0x9f,
  0xa2,
]);

// Mock authenticator data (37 bytes minimum)
const MOCK_AUTHENTICATOR_DATA = new Uint8Array([
  // RP ID Hash (32 bytes)
  0x49, 0x96, 0x0d, 0xe5, 0x88, 0x0e, 0x8c, 0x68, 0x74, 0x34, 0x17, 0x0f, 0x64,
  0x76, 0x60, 0x5b, 0x8f, 0xe4, 0xae, 0xb9, 0xa2, 0x86, 0x32, 0xc7, 0x99, 0x5c,
  0xf3, 0xba, 0x83, 0x1d, 0x97, 0x63,
  // Flags (1 byte): UP=1, UV=1
  0x05,
  // Sign count (4 bytes, big endian)
  0x00, 0x00, 0x00, 0x01,
]);

describe("P256Signer", () => {
  describe("fromCredential", () => {
    it("should create signer from credential data", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      expect(signer).toBeInstanceOf(P256Signer);
      expect(signer.curve).toBe("p256");
      expect(signer.requiresInteraction).toBe(true);
    });

    it("should accept compressed public key", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_COMPRESSED,
        interactionHandler: handler,
      });

      expect(signer).toBeInstanceOf(P256Signer);
    });

    it("should throw for invalid public key length", async () => {
      const handler = new MockWebAuthnHandler();
      const invalidKey = new Uint8Array(10);

      await expect(
        P256Signer.fromCredential({
          credentialId: TEST_CREDENTIAL_ID,
          publicKey: invalidKey,
          interactionHandler: handler,
        }),
      ).rejects.toThrow(SignerError);
    });

    it("should throw for empty credential ID", async () => {
      const handler = new MockWebAuthnHandler();

      await expect(
        P256Signer.fromCredential({
          credentialId: new Uint8Array(0),
          publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
          interactionHandler: handler,
        }),
      ).rejects.toThrow(SignerError);
    });
  });

  describe("getPublicKey", () => {
    it("should return compressed public key (33 bytes)", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const pubkey = await signer.getPublicKey();

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey.length).toBe(33);
      // Compressed P-256 starts with 0x02 or 0x03
      expect(pubkey[0] === 0x02 || pubkey[0] === 0x03).toBe(true);
    });

    it("should cache public key", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const pubkey1 = await signer.getPublicKey();
      const pubkey2 = await signer.getPublicKey();

      expect(pubkey1).toBe(pubkey2);
    });
  });

  describe("getUncompressedPublicKey", () => {
    it("should return uncompressed public key (65 bytes)", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const pubkey = await signer.getUncompressedPublicKey();

      expect(pubkey).toBeInstanceOf(Uint8Array);
      expect(pubkey.length).toBe(65);
      expect(pubkey[0]).toBe(0x04);
    });
  });

  describe("signHash", () => {
    it("should sign a 32-byte hash via WebAuthn", async () => {
      const handler = new MockWebAuthnHandler();
      handler.setResponse({
        signature: MOCK_DER_SIGNATURE,
        authenticatorData: MOCK_AUTHENTICATOR_DATA,
        clientDataJSON: new TextEncoder().encode(
          JSON.stringify({
            type: "webauthn.get",
            challenge: "test",
            origin: "https://example.com",
          }),
        ),
      });

      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const hash = new Uint8Array(32).fill(0xab);
      const result = await signer.signHash(hash);

      expect(result.signature).toBeInstanceOf(Uint8Array);
      expect(result.signature.length).toBe(64); // r + s, each 32 bytes
      // WebAuthn signatures include authenticator data
      expect(result.webauthn).toBeDefined();
      expect(result.webauthn?.authenticatorData).toEqual(
        MOCK_AUTHENTICATOR_DATA,
      );
    });

    it("should normalize DER signature to r||s format", async () => {
      const handler = new MockWebAuthnHandler();
      handler.setResponse({
        signature: MOCK_DER_SIGNATURE,
        authenticatorData: MOCK_AUTHENTICATOR_DATA,
        clientDataJSON: new TextEncoder().encode("{}"),
      });

      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const hash = new Uint8Array(32).fill(0xcd);
      const result = await signer.signHash(hash);

      // Result should be 64 bytes: r (32) + s (32)
      expect(result.signature.length).toBe(64);
    });

    it("should throw for non-32-byte hash", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const invalidHash = new Uint8Array(16);

      await expect(signer.signHash(invalidHash)).rejects.toThrow(SignerError);
      await expect(signer.signHash(invalidHash)).rejects.toMatchObject({
        code: SignerErrorCode.SIGNING_FAILED,
      });
    });

    it("should throw USER_CANCELLED when user cancels", async () => {
      const handler = new MockWebAuthnHandler();
      handler.setFailure("User cancelled");

      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const hash = new Uint8Array(32).fill(0x00);

      await expect(signer.signHash(hash)).rejects.toThrow(SignerError);
      await expect(signer.signHash(hash)).rejects.toMatchObject({
        code: SignerErrorCode.USER_CANCELLED,
      });
    });

    it("should throw SIGNING_FAILED for other errors", async () => {
      const handler = new MockWebAuthnHandler();
      handler.setFailure("Hardware error");

      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const hash = new Uint8Array(32).fill(0x00);

      await expect(signer.signHash(hash)).rejects.toThrow(SignerError);
    });
  });

  describe("getCredentialId", () => {
    it("should return credential ID", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      const credentialId = signer.getCredentialId();

      expect(credentialId).toEqual(TEST_CREDENTIAL_ID);
    });
  });

  describe("curve property", () => {
    it("should be p256", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      expect(signer.curve).toBe("p256");
    });
  });

  describe("requiresInteraction property", () => {
    it("should be true", async () => {
      const handler = new MockWebAuthnHandler();
      const signer = await P256Signer.fromCredential({
        credentialId: TEST_CREDENTIAL_ID,
        publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
        interactionHandler: handler,
      });

      expect(signer.requiresInteraction).toBe(true);
    });
  });
});

describe("WebAuthn signature normalization", () => {
  it("should handle signature with leading zero in r", async () => {
    const handler = new MockWebAuthnHandler();

    // Signature where r has leading zero
    const derSigWithLeadingZero = new Uint8Array([
      0x30,
      0x45, // SEQUENCE
      0x02,
      0x21, // INTEGER r, 33 bytes (with leading 0)
      0x00,
      ...new Uint8Array(32).fill(0x12),
      0x02,
      0x20, // INTEGER s, 32 bytes
      ...new Uint8Array(32).fill(0x34),
    ]);

    handler.setResponse({
      signature: derSigWithLeadingZero,
      authenticatorData: MOCK_AUTHENTICATOR_DATA,
      clientDataJSON: new TextEncoder().encode("{}"),
    });

    const signer = await P256Signer.fromCredential({
      credentialId: TEST_CREDENTIAL_ID,
      publicKey: TEST_PUBLIC_KEY_UNCOMPRESSED,
      interactionHandler: handler,
    });

    const result = await signer.signHash(new Uint8Array(32).fill(0xab));

    // Should strip leading zero and pad to 32 bytes
    expect(result.signature.length).toBe(64);
    expect(result.signature.slice(0, 32)).toEqual(
      new Uint8Array(32).fill(0x12),
    );
  });
});

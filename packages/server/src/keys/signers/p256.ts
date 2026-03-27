/**
 * P256 Signer Implementation
 *
 * Provides P-256 (secp256r1/prime256v1) signing via WebAuthn/Passkey.
 * This curve is natively supported by browser WebAuthn APIs and is used
 * by Coinbase Smart Wallet and other smart account implementations.
 */

import {
  type CurveType,
  type Signer,
  SignerError,
  SignerErrorCode,
  type SignerSignature,
} from "./types.js";

/**
 * WebAuthn assertion options for signing.
 */
export interface WebAuthnAssertionOptions {
  /** The challenge (hash) to sign */
  challenge: Uint8Array;
  /** Credential ID to use */
  credentialId: Uint8Array;
  /** Relying Party ID (domain) */
  rpId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** User verification requirement */
  userVerification?: "required" | "preferred" | "discouraged";
}

/**
 * WebAuthn assertion response from authenticator.
 */
export interface WebAuthnAssertion {
  /** DER-encoded ECDSA signature */
  signature: Uint8Array;
  /** Authenticator data (includes flags and sign count) */
  authenticatorData: Uint8Array;
  /** Client data JSON */
  clientDataJSON: Uint8Array;
  /** User handle (optional) */
  userHandle?: Uint8Array;
}

/**
 * Handler for WebAuthn interactions.
 *
 * This interface abstracts the platform-specific WebAuthn implementation,
 * allowing the P256Signer to work with different platforms:
 * - Browser: Uses Web Authentication API directly
 * - CLI/Node.js: Uses platform-specific tools (Swift for macOS, libfido2 for Linux)
 */
export interface WebAuthnInteractionHandler {
  /**
   * Request a WebAuthn assertion (signature).
   *
   * @param options - Assertion options including challenge and credential ID
   * @returns The WebAuthn assertion response
   * @throws Error if user cancels or authentication fails
   */
  requestAssertion(
    options: WebAuthnAssertionOptions,
  ): Promise<WebAuthnAssertion>;
}

/**
 * Extended signature result for P256 including WebAuthn-specific data.
 */
export interface P256SignerSignature extends SignerSignature {
  /** WebAuthn-specific data (authenticator data, client data) */
  webauthn?: {
    authenticatorData: Uint8Array;
    clientDataJSON: Uint8Array;
  };
}

/**
 * Configuration for creating a P256Signer.
 */
export interface P256SignerConfig {
  /** The credential ID from WebAuthn registration */
  credentialId: Uint8Array;
  /** The public key (compressed 33 bytes or uncompressed 65 bytes) */
  publicKey: Uint8Array;
  /** Handler for WebAuthn interactions */
  interactionHandler: WebAuthnInteractionHandler;
  /** Optional RP ID for WebAuthn assertion */
  rpId?: string;
}

/**
 * P256Signer provides signing using the P-256 (secp256r1) elliptic curve.
 *
 * This signer is used with WebAuthn/Passkey credentials and requires
 * user interaction (biometric or PIN) for each signature.
 *
 * Key features:
 * - Native support in browsers and hardware security modules
 * - Required user interaction provides strong security
 * - Compatible with smart account implementations (Coinbase Smart Wallet)
 *
 * Note: P-256 is NOT compatible with standard Cosmos or EVM EOA addresses.
 * It requires a smart account wrapper that can verify P-256 signatures.
 *
 * @example
 * ```typescript
 * const signer = await P256Signer.fromCredential({
 *   credentialId: credId,
 *   publicKey: pubkey,
 *   interactionHandler: webauthnHandler,
 * });
 *
 * // Sign a hash (will prompt for biometric)
 * const signature = await signer.signHash(messageHash);
 * ```
 */
export class P256Signer implements Signer {
  readonly curve: CurveType = "p256";
  readonly requiresInteraction = true;

  private credentialId: Uint8Array;
  private uncompressedPublicKey: Uint8Array;
  private compressedPublicKeyCache?: Uint8Array;
  private interactionHandler: WebAuthnInteractionHandler;
  private rpId?: string;

  private constructor(
    credentialId: Uint8Array,
    uncompressedPublicKey: Uint8Array,
    interactionHandler: WebAuthnInteractionHandler,
    rpId?: string,
  ) {
    this.credentialId = credentialId;
    this.uncompressedPublicKey = uncompressedPublicKey;
    this.interactionHandler = interactionHandler;
    this.rpId = rpId;
  }

  /**
   * Create a P256Signer from WebAuthn credential data.
   *
   * @param config - Configuration including credential ID and public key
   * @returns A P256Signer instance
   * @throws SignerError if configuration is invalid
   */
  static async fromCredential(config: P256SignerConfig): Promise<P256Signer> {
    // Validate credential ID
    if (!config.credentialId || config.credentialId.length === 0) {
      throw new SignerError(
        "Credential ID is required",
        SignerErrorCode.INVALID_PUBLIC_KEY,
      );
    }

    // Validate and normalize public key
    let uncompressedKey: Uint8Array;

    if (config.publicKey.length === 65) {
      // Uncompressed: 0x04 || x || y
      if (config.publicKey[0] !== 0x04) {
        throw new SignerError(
          "Invalid uncompressed public key prefix (expected 0x04)",
          SignerErrorCode.INVALID_PUBLIC_KEY,
        );
      }
      uncompressedKey = config.publicKey;
    } else if (config.publicKey.length === 33) {
      // Compressed: 0x02 or 0x03 || x
      if (config.publicKey[0] !== 0x02 && config.publicKey[0] !== 0x03) {
        throw new SignerError(
          "Invalid compressed public key prefix (expected 0x02 or 0x03)",
          SignerErrorCode.INVALID_PUBLIC_KEY,
        );
      }
      // Decompress the key
      uncompressedKey = await decompressP256PublicKey(config.publicKey);
    } else {
      throw new SignerError(
        `Invalid public key length: expected 33 (compressed) or 65 (uncompressed), got ${config.publicKey.length}`,
        SignerErrorCode.INVALID_PUBLIC_KEY,
      );
    }

    return new P256Signer(
      config.credentialId,
      uncompressedKey,
      config.interactionHandler,
      config.rpId,
    );
  }

  /**
   * Get the compressed public key (33 bytes).
   */
  async getPublicKey(): Promise<Uint8Array> {
    if (this.compressedPublicKeyCache) {
      return this.compressedPublicKeyCache;
    }

    this.compressedPublicKeyCache = compressP256PublicKey(
      this.uncompressedPublicKey,
    );
    return this.compressedPublicKeyCache;
  }

  /**
   * Get the uncompressed public key (65 bytes).
   */
  async getUncompressedPublicKey(): Promise<Uint8Array> {
    return this.uncompressedPublicKey;
  }

  /**
   * Sign a pre-hashed message using WebAuthn.
   *
   * This will prompt the user for biometric or PIN verification.
   *
   * @param hash - The message hash to sign (must be 32 bytes)
   * @returns The signature with WebAuthn metadata
   */
  async signHash(hash: Uint8Array): Promise<P256SignerSignature> {
    if (hash.length !== 32) {
      throw new SignerError(
        `Invalid hash length: expected 32 bytes, got ${hash.length}`,
        SignerErrorCode.SIGNING_FAILED,
      );
    }

    try {
      const assertion = await this.interactionHandler.requestAssertion({
        challenge: hash,
        credentialId: this.credentialId,
        rpId: this.rpId,
        userVerification: "required",
      });

      // Parse DER-encoded signature to r || s format
      const rawSignature = parseDerSignature(assertion.signature);

      return {
        signature: rawSignature,
        webauthn: {
          authenticatorData: assertion.authenticatorData,
          clientDataJSON: assertion.clientDataJSON,
        },
      };
    } catch (error) {
      if (error instanceof SignerError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);

      // Check for user cancellation
      if (
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("user")
      ) {
        throw new SignerError(
          "User cancelled signing",
          SignerErrorCode.USER_CANCELLED,
          error instanceof Error ? error : undefined,
        );
      }

      throw new SignerError(
        `Signing failed: ${message}`,
        SignerErrorCode.SIGNING_FAILED,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get the credential ID.
   */
  getCredentialId(): Uint8Array {
    return this.credentialId;
  }
}

/**
 * Compress a P-256 public key.
 *
 * @param uncompressed - Uncompressed public key (65 bytes, 0x04 || x || y)
 * @returns Compressed public key (33 bytes, 0x02/0x03 || x)
 */
function compressP256PublicKey(uncompressed: Uint8Array): Uint8Array {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new SignerError(
      "Invalid uncompressed public key",
      SignerErrorCode.INVALID_PUBLIC_KEY,
    );
  }

  const x = uncompressed.slice(1, 33);
  const y = uncompressed.slice(33, 65);

  // Determine prefix based on y parity (last bit of y)
  const prefix = y[31] % 2 === 0 ? 0x02 : 0x03;

  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(x, 1);

  return compressed;
}

/**
 * Decompress a P-256 public key.
 *
 * Uses the curve equation: y² = x³ - 3x + b (mod p)
 * where b is the P-256 curve parameter.
 *
 * @param compressed - Compressed public key (33 bytes, 0x02/0x03 || x)
 * @returns Uncompressed public key (65 bytes, 0x04 || x || y)
 */
async function decompressP256PublicKey(
  compressed: Uint8Array,
): Promise<Uint8Array> {
  if (compressed.length !== 33) {
    throw new SignerError(
      "Invalid compressed public key length",
      SignerErrorCode.INVALID_PUBLIC_KEY,
    );
  }

  const prefix = compressed[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new SignerError(
      "Invalid compressed public key prefix",
      SignerErrorCode.INVALID_PUBLIC_KEY,
    );
  }

  // P-256 curve parameters
  const p = BigInt(
    "0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF",
  );
  const a = BigInt(
    "0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC",
  );
  const b = BigInt(
    "0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B",
  );

  // Get x coordinate
  const x = bytesToBigInt(compressed.slice(1));

  // Calculate y² = x³ + ax + b (mod p)
  const x3 = modPow(x, 3n, p);
  const ax = (a * x) % p;
  const y2 = (x3 + ax + b) % p;

  // Calculate y = √y² (mod p) using Tonelli-Shanks
  let y = modSqrt(y2, p);

  // Choose correct y based on prefix
  const yIsOdd = y % 2n === 1n;
  const wantOdd = prefix === 0x03;
  if (yIsOdd !== wantOdd) {
    y = p - y;
  }

  // Build uncompressed key
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(compressed.slice(1), 1); // x
  uncompressed.set(bigIntToBytes(y, 32), 33); // y

  return uncompressed;
}

/**
 * Parse a DER-encoded ECDSA signature to raw r || s format.
 *
 * WebAuthn returns signatures in ASN.1 DER format:
 * SEQUENCE { INTEGER r, INTEGER s }
 *
 * We need to convert to 64 bytes: r (32 bytes) || s (32 bytes)
 *
 * @param der - DER-encoded signature
 * @returns Raw signature (64 bytes)
 */
function parseDerSignature(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new SignerError(
      "Invalid DER signature format",
      SignerErrorCode.SIGNING_FAILED,
    );
  }

  let offset = 2; // Skip SEQUENCE tag and length

  // Parse r
  if (der[offset] !== 0x02) {
    throw new SignerError(
      "Invalid DER signature: expected INTEGER for r",
      SignerErrorCode.SIGNING_FAILED,
    );
  }
  offset++;
  const rLength = der[offset];
  offset++;
  const r = der.slice(offset, offset + rLength);
  offset += rLength;

  // Parse s
  if (der[offset] !== 0x02) {
    throw new SignerError(
      "Invalid DER signature: expected INTEGER for s",
      SignerErrorCode.SIGNING_FAILED,
    );
  }
  offset++;
  const sLength = der[offset];
  offset++;
  const s = der.slice(offset, offset + sLength);

  // Remove leading zeros and pad to 32 bytes
  const rNorm = normalizeInteger(r, 32);
  const sNorm = normalizeInteger(s, 32);

  // Concatenate r || s
  const signature = new Uint8Array(64);
  signature.set(rNorm, 0);
  signature.set(sNorm, 32);

  return signature;
}

/**
 * Normalize an integer to a fixed length.
 * Removes leading zeros and pads to the target length.
 */
function normalizeInteger(bytes: Uint8Array, length: number): Uint8Array {
  // Remove leading zeros (DER often adds 0x00 for positive integers with high bit set)
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start++;
  }

  const trimmed = bytes.slice(start);

  if (trimmed.length > length) {
    throw new SignerError(
      `Integer too long: ${trimmed.length} > ${length}`,
      SignerErrorCode.SIGNING_FAILED,
    );
  }

  // Pad with leading zeros if needed
  const result = new Uint8Array(length);
  result.set(trimmed, length - trimmed.length);

  return result;
}

/**
 * Convert bytes to BigInt.
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Convert BigInt to bytes with fixed length.
 */
function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let remaining = n;
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

/**
 * Modular exponentiation: base^exp mod mod
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Modular square root using Tonelli-Shanks algorithm.
 * For P-256, p ≡ 3 (mod 4), so we can use the simpler formula.
 */
function modSqrt(n: bigint, p: bigint): bigint {
  // For p ≡ 3 (mod 4): sqrt(n) = n^((p+1)/4) mod p
  // P-256's p is ≡ 3 (mod 4)
  return modPow(n, (p + 1n) / 4n, p);
}

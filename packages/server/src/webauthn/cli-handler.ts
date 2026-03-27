/**
 * WebAuthn CLI Handler
 *
 * Provides platform-specific WebAuthn credential management and signing
 * for CLI/Node.js environments.
 *
 * Platform support:
 * - macOS: Uses Swift CLI tool with Security framework
 * - Linux: Uses libfido2 (fido2-token, fido2-assert)
 * - Windows: Uses Windows Hello (future)
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type {
  WebAuthnAssertion,
  WebAuthnAssertionOptions,
  WebAuthnInteractionHandler,
} from "../keys/signers/p256.js";
import { resolveBiometricBinary } from "../native/resolve.js";

const execFileAsync = promisify(execFile);

/** Timeout for WebAuthn operations (60 seconds) */
const WEBAUTHN_TIMEOUT_MS = 60_000;

/**
 * WebAuthn credential registration options.
 */
export interface WebAuthnRegistrationOptions {
  /** Relying Party ID (typically domain name) */
  rpId: string;
  /** Relying Party name */
  rpName: string;
  /** User ID (opaque identifier) */
  userId: Uint8Array;
  /** User display name */
  userName: string;
  /** Challenge from server */
  challenge: Uint8Array;
  /** Require user verification (biometric/PIN) */
  userVerification?: "required" | "preferred" | "discouraged";
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * WebAuthn credential registration result.
 */
export interface WebAuthnRegistrationResult {
  /** Credential ID */
  credentialId: Uint8Array;
  /** Public key in COSE format */
  publicKey: Uint8Array;
  /** Attestation object */
  attestationObject: Uint8Array;
  /** Client data JSON */
  clientDataJSON: Uint8Array;
}

/**
 * Platform detection.
 */
function detectPlatform(): "macos" | "linux" | "windows" | "unknown" {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

/**
 * Platform-specific WebAuthn implementation interface.
 */
interface WebAuthnPlatformImpl {
  /** Check if WebAuthn is available */
  isAvailable(): Promise<boolean>;
  /** Register a new credential */
  register(
    options: WebAuthnRegistrationOptions,
  ): Promise<WebAuthnRegistrationResult>;
  /** Get an assertion (sign) */
  assert(options: WebAuthnAssertionOptions): Promise<WebAuthnAssertion>;
}

/**
 * macOS implementation using Security framework via Swift CLI.
 */
class MacOSWebAuthnImpl implements WebAuthnPlatformImpl {
  private binaryPath: string | null = null;

  constructor() {
    this.binaryPath = resolveBiometricBinary();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      return false;
    }

    try {
      const { stdout } = await execFileAsync(this.binaryPath, ["check"], {
        timeout: 5000,
      });
      // Format: "available:touchID" or "available:faceID" or "unavailable"
      return stdout.trim().startsWith("available:");
    } catch {
      return false;
    }
  }

  async register(
    options: WebAuthnRegistrationOptions,
  ): Promise<WebAuthnRegistrationResult> {
    if (!this.binaryPath) {
      throw new Error("WebAuthn CLI not available");
    }

    const args = [
      "register",
      "--rp-id",
      options.rpId,
      "--rp-name",
      options.rpName,
      "--user-id",
      Buffer.from(options.userId).toString("base64url"),
      "--user-name",
      options.userName,
      "--challenge",
      Buffer.from(options.challenge).toString("base64url"),
    ];

    if (options.userVerification) {
      args.push("--user-verification", options.userVerification);
    }

    try {
      const { stdout } = await execFileAsync(this.binaryPath, args, {
        timeout: options.timeout || WEBAUTHN_TIMEOUT_MS,
      });

      const result = JSON.parse(stdout);
      return {
        credentialId: Buffer.from(result.credentialId, "base64url"),
        publicKey: Buffer.from(result.publicKey, "base64url"),
        attestationObject: Buffer.from(result.attestationObject, "base64url"),
        clientDataJSON: Buffer.from(result.clientDataJSON, "base64url"),
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async assert(options: WebAuthnAssertionOptions): Promise<WebAuthnAssertion> {
    if (!this.binaryPath) {
      throw new Error("WebAuthn CLI not available");
    }

    const args = [
      "assert",
      "--credential-id",
      Buffer.from(options.credentialId).toString("base64url"),
      "--challenge",
      Buffer.from(options.challenge).toString("base64url"),
    ];

    if (options.rpId) {
      args.push("--rp-id", options.rpId);
    }
    if (options.userVerification) {
      args.push("--user-verification", options.userVerification);
    }

    try {
      const { stdout } = await execFileAsync(this.binaryPath, args, {
        timeout: options.timeout || WEBAUTHN_TIMEOUT_MS,
      });

      const result = JSON.parse(stdout);
      return {
        signature: Buffer.from(result.signature, "base64url"),
        authenticatorData: Buffer.from(result.authenticatorData, "base64url"),
        clientDataJSON: Buffer.from(result.clientDataJSON, "base64url"),
        userHandle: result.userHandle
          ? Buffer.from(result.userHandle, "base64url")
          : undefined,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): Error {
    if (error instanceof Error) {
      const stderr =
        "stderr" in error ? (error as { stderr: string }).stderr : "";

      if (stderr.includes("cancelled") || stderr.includes("user")) {
        return new Error("User cancelled");
      }
      if (stderr.includes("not_available")) {
        return new Error("WebAuthn not available");
      }
      if (stderr.includes("not_found")) {
        return new Error("Credential not found");
      }

      return new Error(`WebAuthn error: ${error.message}`);
    }
    return new Error("Unknown WebAuthn error");
  }
}

/**
 * Linux implementation using libfido2.
 */
class LinuxWebAuthnImpl implements WebAuthnPlatformImpl {
  private fido2TokenPath: string | null = null;
  private fido2AssertPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      this.fido2TokenPath = await this.findCommand("fido2-token");
      this.fido2AssertPath = await this.findCommand("fido2-assert");
      return !!(this.fido2TokenPath && this.fido2AssertPath);
    } catch {
      return false;
    }
  }

  async register(
    _options: WebAuthnRegistrationOptions,
  ): Promise<WebAuthnRegistrationResult> {
    // libfido2 credential registration is complex and device-specific
    throw new Error(
      "WebAuthn registration via libfido2 not yet implemented. " +
        "Please use a browser to register credentials.",
    );
  }

  async assert(options: WebAuthnAssertionOptions): Promise<WebAuthnAssertion> {
    if (!this.fido2AssertPath) {
      throw new Error("fido2-assert not found. Please install libfido2.");
    }

    // Find connected FIDO2 device
    const device = await this.findDevice();
    if (!device) {
      throw new Error("No FIDO2 device connected");
    }

    // Create challenge file (fido2-assert reads from file)
    const challengeB64 = Buffer.from(options.challenge).toString("base64url");

    try {
      const args = [
        "-G", // Get assertion
        "-h", // HMAC
        device,
      ];

      if (options.userVerification === "required") {
        args.push("-t", "up", "-t", "uv");
      }

      // Note: This is a simplified implementation
      // Real implementation would need proper credential ID handling
      // fido2-assert reads challenge from stdin, but execFileAsync doesn't support input
      // For now, pass challenge as argument (some versions support this)
      args.push("-c", challengeB64);
      const { stdout } = await execFileAsync(this.fido2AssertPath, args, {
        timeout: options.timeout || WEBAUTHN_TIMEOUT_MS,
      });

      // Parse fido2-assert output
      const lines = stdout.trim().split("\n");
      return {
        signature: Buffer.from(lines[0] || "", "base64"),
        authenticatorData: Buffer.from(lines[1] || "", "base64"),
        clientDataJSON: new Uint8Array(0), // Not provided by fido2-assert
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("timeout")) {
          throw new Error("User cancelled (timeout)");
        }
        throw new Error(`FIDO2 error: ${error.message}`);
      }
      throw error;
    }
  }

  private async findCommand(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("which", [command]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async findDevice(): Promise<string | null> {
    if (!this.fido2TokenPath) return null;

    try {
      const { stdout } = await execFileAsync(this.fido2TokenPath, ["-L"], {
        timeout: 5000,
      });

      // Parse device list (format: /dev/hidrawN: vendor info)
      const match = stdout.match(/^(\/dev\/hidraw\d+)/m);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}

/**
 * Windows implementation placeholder.
 */
class WindowsWebAuthnImpl implements WebAuthnPlatformImpl {
  async isAvailable(): Promise<boolean> {
    // TODO: Implement Windows Hello detection
    return false;
  }

  async register(
    _options: WebAuthnRegistrationOptions,
  ): Promise<WebAuthnRegistrationResult> {
    throw new Error("Windows Hello WebAuthn not yet implemented");
  }

  async assert(_options: WebAuthnAssertionOptions): Promise<WebAuthnAssertion> {
    throw new Error("Windows Hello WebAuthn not yet implemented");
  }
}

/**
 * Get the platform-specific WebAuthn implementation.
 */
function getPlatformImpl(): WebAuthnPlatformImpl | null {
  const platform = detectPlatform();
  switch (platform) {
    case "macos":
      return new MacOSWebAuthnImpl();
    case "linux":
      return new LinuxWebAuthnImpl();
    case "windows":
      return new WindowsWebAuthnImpl();
    default:
      return null;
  }
}

/**
 * CLI WebAuthn Handler
 *
 * Implements WebAuthnInteractionHandler for CLI environments.
 */
export class CLIWebAuthnHandler implements WebAuthnInteractionHandler {
  private impl: WebAuthnPlatformImpl | null;

  constructor() {
    this.impl = getPlatformImpl();
  }

  /**
   * Check if WebAuthn is available on this platform.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.impl) {
      return false;
    }
    return this.impl.isAvailable();
  }

  /**
   * Register a new WebAuthn credential.
   */
  async register(
    options: WebAuthnRegistrationOptions,
  ): Promise<WebAuthnRegistrationResult> {
    if (!this.impl) {
      throw new Error("WebAuthn not available on this platform");
    }

    const available = await this.impl.isAvailable();
    if (!available) {
      throw new Error("WebAuthn not available. Please check your device.");
    }

    return this.impl.register(options);
  }

  /**
   * Request a WebAuthn assertion (signature).
   */
  async requestAssertion(
    options: WebAuthnAssertionOptions,
  ): Promise<WebAuthnAssertion> {
    if (!this.impl) {
      throw new Error("WebAuthn not available on this platform");
    }

    const available = await this.impl.isAvailable();
    if (!available) {
      throw new Error("WebAuthn not available. Please check your device.");
    }

    return this.impl.assert(options);
  }
}

/**
 * Create a CLI WebAuthn handler.
 */
export const createCLIWebAuthnHandler = (): CLIWebAuthnHandler => {
  return new CLIWebAuthnHandler();
};

/**
 * Check if WebAuthn is available on the current platform.
 */
export const isWebAuthnAvailable = async (): Promise<boolean> => {
  const handler = new CLIWebAuthnHandler();
  return handler.isAvailable();
};

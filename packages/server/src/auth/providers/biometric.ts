/**
 * Biometric Authentication Provider
 *
 * Supports Touch ID (macOS), Face ID, Windows Hello, etc.
 * Platform-specific implementation is abstracted via BiometricImpl interface.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolveBiometricBinary } from "../../native/resolve.js";
import type {
  AuthContext,
  AuthProvider,
  AuthResult,
  AuthSetupContext,
  AuthSetupResult,
} from "../types.js";

const execFileAsync = promisify(execFile);

/** Timeout for biometric authentication (30 seconds) */
const AUTH_TIMEOUT_MS = 30_000;

/**
 * Platform-specific biometric implementation interface
 */
export interface BiometricImpl {
  /** Check if biometric hardware is available */
  isAvailable(): Promise<boolean>;
  /** Authenticate with biometric */
  authenticate(reason: string): Promise<void>;
}

/**
 * Detect current platform
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
 * macOS implementation using Touch ID / Face ID via Swift CLI
 *
 * This implementation uses a Swift CLI tool that wraps the LocalAuthentication
 * framework. The CLI must be built first using:
 *   cd native/macos && ./build.sh
 *
 * The app bundle is required for Touch ID to work properly.
 */
class MacOSBiometricImpl implements BiometricImpl {
  private binaryPath: string | null = null;
  private biometryType: string | null = null;

  constructor() {
    this.binaryPath = resolveBiometricBinary();
  }

  /**
   * Check if Touch ID / Face ID is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      // Binary not built yet
      return false;
    }

    try {
      const { stdout } = await execFileAsync(
        this.binaryPath,
        ["check", "--device-owner"],
        { timeout: 5000 },
      );

      const output = stdout.trim();
      if (output.startsWith("available:")) {
        this.biometryType = output.split(":")[1] || "unknown";
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Authenticate using Touch ID with system password fallback.
   * Uses deviceOwnerAuthentication policy so clamshell mode falls back to
   * macOS login password instead of failing outright.
   */
  async authenticate(reason: string): Promise<void> {
    if (!this.binaryPath || !existsSync(this.binaryPath)) {
      throw new Error(
        "Biometric authentication binary not found. " +
          "Please build the native module: cd native/macos && ./build.sh",
      );
    }

    try {
      const { stdout } = await execFileAsync(
        this.binaryPath,
        ["auth", reason, "--device-owner"],
        { timeout: AUTH_TIMEOUT_MS },
      );

      const output = stdout.trim();
      if (output === "success") {
        return;
      }

      throw new Error("Authentication failed.");
    } catch (error) {
      if (error instanceof Error) {
        // Check for timeout
        if ("killed" in error && error.killed) {
          throw new Error("Authentication timed out. Please try again.");
        }

        // Parse error from stderr
        const stderr =
          "stderr" in error ? (error as { stderr: string }).stderr : "";

        if (stderr.includes("error:cancelled")) {
          throw new Error("Authentication cancelled by user.");
        }
        if (stderr.includes("error:not_available")) {
          throw new Error(
            "Biometric authentication is not available on this device.",
          );
        }
        if (stderr.includes("error:not_enrolled")) {
          throw new Error(
            "No biometric data enrolled. Please set up Touch ID or Face ID in System Settings.",
          );
        }
        if (stderr.includes("error:lockout")) {
          throw new Error(
            "Biometric authentication is locked due to too many failed attempts. " +
              "Please use your device passcode to unlock.",
          );
        }
        if (stderr.includes("error:failed")) {
          throw new Error("Biometric authentication failed. Please try again.");
        }
        if (stderr.includes("error:fallback")) {
          throw new Error(
            "User chose to use password instead of biometric authentication.",
          );
        }

        // Check exit code
        if ("code" in error) {
          const exitCode = (error as { code: number }).code;
          if (exitCode === 1) {
            throw new Error("Authentication failed.");
          }
          if (exitCode === 2) {
            throw new Error("Biometric authentication is not available.");
          }
        }

        throw new Error(`Authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get the biometry type (touchID, faceID, etc.)
   */
  getBiometryType(): string | null {
    return this.biometryType;
  }
}

/**
 * Linux implementation using fprintd (Fingerprint Daemon)
 *
 * Requires fprintd to be installed and user fingerprint enrolled:
 *   - Ubuntu/Debian: sudo apt install fprintd
 *   - Fedora: sudo dnf install fprintd
 *   - Arch: sudo pacman -S fprintd
 *
 * Enroll fingerprint: fprintd-enroll
 * Verify enrollment: fprintd-list $USER
 */
class LinuxBiometricImpl implements BiometricImpl {
  private fprintdVerifyPath: string | null = null;
  private fprintdListPath: string | null = null;

  /**
   * Check if fprintd is available and user has enrolled fingerprints
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Find fprintd-verify command
      const verifyPath = await this.findCommand("fprintd-verify");
      if (!verifyPath) {
        return false;
      }
      this.fprintdVerifyPath = verifyPath;

      // Find fprintd-list command
      const listPath = await this.findCommand("fprintd-list");
      if (!listPath) {
        return false;
      }
      this.fprintdListPath = listPath;

      // Check if current user has enrolled fingerprints
      const hasEnrolled = await this.checkEnrollment();
      return hasEnrolled;
    } catch {
      return false;
    }
  }

  /**
   * Authenticate using fprintd-verify
   */
  async authenticate(_reason: string): Promise<void> {
    if (!this.fprintdVerifyPath) {
      // Try to find it again in case isAvailable wasn't called
      this.fprintdVerifyPath = await this.findCommand("fprintd-verify");
      if (!this.fprintdVerifyPath) {
        throw new Error("fprintd-verify not found. Please install fprintd.");
      }
    }

    try {
      // Run fprintd-verify with timeout
      // fprintd-verify exits 0 on success, non-zero on failure
      await execFileAsync(this.fprintdVerifyPath, [], {
        timeout: AUTH_TIMEOUT_MS,
        // Note: reason is not displayed by fprintd-verify
        // The fingerprint prompt appears on the system
      });
    } catch (error) {
      if (error instanceof Error) {
        // Check for timeout
        if ("killed" in error && error.killed) {
          throw new Error("Authentication timed out. Please try again.");
        }

        // Check exit code for verification failure
        if ("code" in error) {
          const exitCode = (error as { code: number }).code;
          if (exitCode === 1) {
            throw new Error("Fingerprint verification failed.");
          }
          if (exitCode === 2) {
            throw new Error(
              "No enrolled fingerprints. Run 'fprintd-enroll' to enroll.",
            );
          }
        }

        // Check for cancellation
        if (error.message.includes("cancel")) {
          throw new Error("Authentication cancelled by user.");
        }

        throw new Error(`Fingerprint authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Find a command in PATH
   */
  private async findCommand(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("which", [command]);
      const path = stdout.trim();
      return path || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if current user has enrolled fingerprints
   */
  private async checkEnrollment(): Promise<boolean> {
    if (!this.fprintdListPath) {
      return false;
    }

    try {
      const username = process.env.USER || process.env.USERNAME;
      if (!username) {
        return false;
      }

      const { stdout } = await execFileAsync(this.fprintdListPath, [username], {
        timeout: 5000,
      });

      // fprintd-list output includes "enrolled" or finger names when enrolled
      // Output example: "   - #0: right-index-finger"
      // or "has no enrolled fingerprints"
      const hasEnrolled =
        !stdout.includes("no enrolled") &&
        (stdout.includes("-finger") ||
          stdout.includes("enrolled") ||
          stdout.includes("#"));

      return hasEnrolled;
    } catch {
      return false;
    }
  }
}

/**
 * Placeholder Windows implementation (Windows Hello)
 * TODO: Implement using Windows Hello API
 */
class WindowsBiometricImpl implements BiometricImpl {
  async isAvailable(): Promise<boolean> {
    // TODO: Check for Windows Hello availability
    return false;
  }

  async authenticate(_reason: string): Promise<void> {
    throw new Error(
      "Biometric authentication not implemented. " +
        "Platform-specific implementation required for Windows Hello.",
    );
  }
}

/**
 * Get platform-specific biometric implementation
 */
function getPlatformImpl(): BiometricImpl | null {
  const platform = detectPlatform();
  switch (platform) {
    case "macos":
      return new MacOSBiometricImpl();
    case "linux":
      return new LinuxBiometricImpl();
    case "windows":
      return new WindowsBiometricImpl();
    default:
      return null;
  }
}

/**
 * Biometric Authentication Provider
 */
export class BiometricProvider implements AuthProvider {
  readonly id = "biometric";
  readonly name = "Biometric (Touch ID / Face ID)";

  private impl: BiometricImpl | null;

  constructor() {
    this.impl = getPlatformImpl();
  }

  /**
   * Check if biometric auth is available on this system
   */
  async isAvailable(): Promise<boolean> {
    if (!this.impl) {
      return false;
    }
    return this.impl.isAvailable();
  }

  /**
   * Setup biometric auth (enrollment)
   */
  async setup(_context: AuthSetupContext): Promise<AuthSetupResult> {
    // For biometric, setup typically means verifying hardware availability
    // Actual enrollment happens at OS level, not in our app

    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        error:
          "Biometric authentication is not available on this system. " +
          "Please ensure your device has Touch ID, Face ID, or equivalent hardware configured.",
      };
    }

    return {
      success: true,
      data: {
        platform: detectPlatform(),
        message:
          "Biometric authentication is available. " +
          "You will be prompted to authenticate for protected actions (e.g., deleting an account).",
      },
    };
  }

  /**
   * Authenticate using biometric
   */
  async authenticate(context: AuthContext): Promise<AuthResult> {
    if (!this.impl) {
      return {
        success: false,
        error: "Biometric authentication is not supported on this platform.",
      };
    }

    try {
      // Build authentication reason message
      const reason = this.buildAuthReason(context);
      await this.impl.authenticate(reason);
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Authentication failed";

      // Check for user cancellation
      if (
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("user")
      ) {
        return {
          success: false,
          error: "Authentication cancelled by user.",
        };
      }

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Disable biometric auth
   */
  async disable(): Promise<void> {
    // Nothing to clean up for biometric
    // The actual biometric data is managed by the OS
  }

  /**
   * Build the authentication reason message shown to user
   */
  private buildAuthReason(context: AuthContext): string {
    const parts: string[] = ["Keplr MCP Server"];

    switch (context.action) {
      case "delete_account":
        parts.push("Delete account");
        break;
      default:
        parts.push("Authentication required");
    }

    if (context.summary) {
      parts.push(context.summary);
    } else if (context.amount && context.chain) {
      parts.push(`${context.amount} on ${context.chain}`);
    }

    return parts.join(": ");
  }
}

/**
 * Create a new BiometricProvider instance
 */
export function createBiometricProvider(): BiometricProvider {
  return new BiometricProvider();
}

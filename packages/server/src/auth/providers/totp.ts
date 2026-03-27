/**
 * TOTP Authentication Provider
 *
 * Supports Google Authenticator and other TOTP-compatible apps.
 * Uses RFC 6238 TOTP standard with 30-second time steps.
 *
 * Security: TOTP secrets are stored in OS Keychain (via keytar), not in config files.
 */

import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { loadAuthConfig, saveAuthConfig } from "../config.js";
import type {
  AuthContext,
  AuthenticatorType,
  AuthProvider,
  AuthResult,
  AuthSetupContext,
  AuthSetupResult,
} from "../types.js";

/**
 * Generate an ASCII QR code string for display in response.
 * Uses utf8 format for better compatibility across terminals.
 */
async function generateQrCode(uri: string): Promise<string | null> {
  try {
    return await QRCode.toString(uri, {
      type: "utf8",
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}

// Lazy-load keytar to allow running without native binding (e.g. CI with KEPLR_MNEMONIC).
let _keytar: typeof import("keytar") | undefined;
async function getKeytar(): Promise<typeof import("keytar")> {
  if (!_keytar) {
    _keytar = (await import("keytar"))
      .default as unknown as typeof import("keytar");
  }
  return _keytar;
}

/** Keychain service name for TOTP secrets */
const KEYCHAIN_SERVICE = "keplr-mcp-server";
/** Keychain account name for TOTP secret */
const KEYCHAIN_TOTP_ACCOUNT = "totp-secret";

/** Default issuer name shown in authenticator apps */
const DEFAULT_ISSUER = "Keplr";

/** TOTP configuration */
const TOTP_CONFIG = {
  digits: 6 as const,
  period: 30, // 30-second window
  epochTolerance: 30, // Allow ±30 seconds for clock drift (1 time step)
};

/**
 * Pending TOTP setup (in-memory, not persisted)
 * Used during the setup flow before verification
 */
interface PendingTotpSetup {
  secret: string;
  createdAt: number;
  authenticatorType: AuthenticatorType;
}

/** Setup expires after 10 minutes */
const SETUP_EXPIRY_MS = 10 * 60 * 1000;

/** Maximum verification attempts before lockout */
const MAX_VERIFY_ATTEMPTS = 5;

/** Lockout duration after max attempts (5 minutes) */
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

/**
 * Verification attempt tracking (in-memory)
 */
interface VerifyAttemptTracker {
  attempts: number;
  lastAttempt: number;
  lockedUntil?: number;
}

/**
 * Generate a TOTP URI for QR codes
 */
function generateTotpUri(
  secret: string,
  accountLabel: string,
  issuer: string,
): string {
  return generateURI({
    issuer,
    label: accountLabel,
    secret,
    digits: TOTP_CONFIG.digits,
    period: TOTP_CONFIG.period,
  });
}

/**
 * Verify a TOTP token against a secret
 */
function verifyTotpToken(token: string, secret: string): boolean {
  const result = verifySync({
    secret,
    token,
    epochTolerance: TOTP_CONFIG.epochTolerance,
  });
  return result.valid;
}

/**
 * Save TOTP secret to OS Keychain
 */
async function saveTotpSecret(secret: string): Promise<void> {
  await (await getKeytar()).setPassword(
    KEYCHAIN_SERVICE,
    KEYCHAIN_TOTP_ACCOUNT,
    secret,
  );
}

/**
 * Load TOTP secret from OS Keychain
 */
async function loadTotpSecret(): Promise<string | null> {
  return (await getKeytar()).getPassword(
    KEYCHAIN_SERVICE,
    KEYCHAIN_TOTP_ACCOUNT,
  );
}

/**
 * Delete TOTP secret from OS Keychain
 */
async function deleteTotpSecret(): Promise<boolean> {
  return (await getKeytar()).deletePassword(
    KEYCHAIN_SERVICE,
    KEYCHAIN_TOTP_ACCOUNT,
  );
}

/**
 * Migrate legacy secret from config to keychain (one-time migration)
 */
async function migrateLegacySecret(): Promise<void> {
  const config = await loadAuthConfig();
  const legacySecret = config.providers.otp?.secret;

  if (legacySecret) {
    // Save to keychain
    await saveTotpSecret(legacySecret);

    // Update config: remove secret, set hasSecret flag
    config.providers.otp = {
      enabled: config.providers.otp?.enabled ?? false,
      hasSecret: true,
      verifiedAt: config.providers.otp?.verifiedAt,
      authenticatorType: config.providers.otp?.authenticatorType,
      secret: undefined,
    };
    await saveAuthConfig(config);
  }
}

/**
 * TOTP Authentication Provider
 *
 * Provides two-factor authentication using time-based one-time passwords.
 * Currently branded as "Google Authenticator" but internally uses standard TOTP
 * that works with any compatible app.
 */
export class TotpProvider implements AuthProvider {
  readonly id = "totp";

  private authenticatorType: AuthenticatorType;
  private pendingSetup: PendingTotpSetup | null = null;
  private verifyTracker: VerifyAttemptTracker = {
    attempts: 0,
    lastAttempt: 0,
  };

  constructor(authenticatorType: AuthenticatorType = "google") {
    this.authenticatorType = authenticatorType;
  }

  /**
   * Get user-facing name based on authenticator type
   */
  get name(): string {
    switch (this.authenticatorType) {
      case "google":
        return "Google Authenticator";
      case "authy":
        return "Authy";
      case "microsoft":
        return "Microsoft Authenticator";
      default:
        return "Authenticator App";
    }
  }

  /**
   * Check if TOTP is available (secret is configured and verified)
   */
  async isAvailable(): Promise<boolean> {
    // Migrate legacy secret if needed
    await migrateLegacySecret();

    const config = await loadAuthConfig();
    if (!config.providers.otp?.enabled) {
      return false;
    }

    // Check if secret exists in keychain
    if (config.providers.otp?.hasSecret) {
      const secret = await loadTotpSecret();
      return secret !== null;
    }

    return false;
  }

  /**
   * Check if TOTP setup is in progress
   */
  hasSetupInProgress(): boolean {
    if (!this.pendingSetup) {
      return false;
    }
    // Check if setup expired
    if (Date.now() - this.pendingSetup.createdAt > SETUP_EXPIRY_MS) {
      this.pendingSetup = null;
      return false;
    }
    return true;
  }

  /**
   * Start TOTP setup - generates secret and returns QR code
   *
   * This does NOT save the secret yet. Call verifySetup() with a valid
   * code to complete setup and persist the secret.
   */
  async setup(context: AuthSetupContext): Promise<AuthSetupResult> {
    // Guard: refuse to generate a new secret when TOTP is already configured.
    // Callers should use enableProviderForAction() to add TOTP to new actions.
    if (await this.isAvailable()) {
      return {
        success: false,
        error:
          "TOTP is already configured. To add TOTP to additional actions, the existing secret will be reused automatically.",
      };
    }

    // Generate a new secret (20 bytes = 32 base32 characters)
    const secret = generateSecret({ length: 20 });

    // Store pending setup (not persisted until verified)
    this.pendingSetup = {
      secret,
      createdAt: Date.now(),
      authenticatorType: this.authenticatorType,
    };

    // Generate otpauth URL for QR code
    const accountLabel = context.account || "wallet";
    const otpauthUrl = generateTotpUri(secret, accountLabel, DEFAULT_ISSUER);

    // Generate ASCII QR code for terminal display
    const qrCode = await generateQrCode(otpauthUrl);

    if (qrCode) {
      // QR code generated successfully - minimal response with QR first
      return {
        success: true,
        data: {
          qrCode,
          manualEntryKey: secret,
          expiresIn: "10 minutes",
        },
      };
    }

    // QR code generation failed - show manual entry as primary
    return {
      success: true,
      data: {
        manualSetupInstructions: [
          `1. Open ${this.name} app on your phone`,
          "2. Tap the '+' button (bottom right)",
          "3. Select 'Enter a setup key' (NOT 'Scan QR code')",
          `4. Enter account name: ${DEFAULT_ISSUER}`,
          `5. Enter key: ${secret}`,
          "6. Make sure 'Time based' is selected",
          "7. Tap 'Add'",
        ],
        manualEntryKey: secret,
        expiresIn: "10 minutes",
      },
    };
  }

  /**
   * Verify setup with a code from the authenticator app
   *
   * If successful, persists the secret to OS Keychain (not config file).
   */
  async verifySetup(code: string): Promise<AuthSetupResult> {
    // Check lockout (rate limiting for setup verification too)
    if (this.isLockedOut()) {
      const remainingMs = (this.verifyTracker.lockedUntil || 0) - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      return {
        success: false,
        error: `Too many failed attempts. Please try again in ${remainingSec} seconds.`,
      };
    }

    if (!this.pendingSetup) {
      return {
        success: false,
        error:
          "No setup in progress. Please start setup first with auth-setup --provider totp.",
      };
    }

    // Check if setup expired
    if (Date.now() - this.pendingSetup.createdAt > SETUP_EXPIRY_MS) {
      this.pendingSetup = null;
      return {
        success: false,
        error:
          "Setup expired. Please start again with auth-setup --provider totp.",
      };
    }

    // Verify the code
    const isValid = verifyTotpToken(code, this.pendingSetup.secret);

    // Track attempt for rate limiting
    this.verifyTracker.lastAttempt = Date.now();

    if (!isValid) {
      this.verifyTracker.attempts++;

      // Check if should lock out
      if (this.verifyTracker.attempts >= MAX_VERIFY_ATTEMPTS) {
        this.verifyTracker.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        return {
          success: false,
          error: "Too many failed attempts. Locked for 5 minutes.",
        };
      }

      const remaining = MAX_VERIFY_ATTEMPTS - this.verifyTracker.attempts;
      return {
        success: false,
        error: `Invalid code. Please check ${this.name} and try again. ${remaining} attempts remaining.`,
      };
    }

    // Save secret to OS Keychain (secure storage)
    await saveTotpSecret(this.pendingSetup.secret);

    // Update config with hasSecret flag (not the actual secret)
    const config = await loadAuthConfig();
    config.providers.otp = {
      enabled: true,
      hasSecret: true,
      verifiedAt: Date.now(),
      authenticatorType: this.pendingSetup.authenticatorType,
    };
    await saveAuthConfig(config);

    // Clear pending setup
    this.pendingSetup = null;

    // Reset rate limit tracker on success
    this.verifyTracker = {
      attempts: 0,
      lastAttempt: Date.now(),
    };

    return {
      success: true,
      data: {
        message: `${this.name} setup complete`,
        verifiedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Authenticate user with a TOTP code
   *
   * If context.totpCode is provided, verifies it directly.
   * Otherwise, returns requiresInput=true to signal that user input is needed.
   * Lockout returns a hard failure (no requiresInput) since it can't be resolved by input.
   */
  async authenticate(context: AuthContext): Promise<AuthResult> {
    // Lockout is a hard failure — user can't provide input to resolve it
    // In "any" mode, this still allows fallback to biometric via lastError path
    if (this.isLockedOut()) {
      const remainingMs = (this.verifyTracker.lockedUntil || 0) - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      return {
        success: false,
        error: `Too many failed attempts. Please try again in ${remainingSec} seconds.`,
        provider: this.id,
      };
    }

    // If TOTP code is provided in context, verify it directly
    if (context.totpCode) {
      const result = await this.verifyCode(context.totpCode);
      return {
        ...result,
        provider: this.id,
      };
    }

    // No code provided - indicate that this provider requires user input
    // This allows AuthManager to fallback to other providers (e.g., biometric)
    return {
      success: false,
      error:
        "TOTP verification requires a 6-digit code from your authenticator app.",
      requiresInput: true,
      provider: this.id,
    };
  }

  /**
   * Verify a TOTP code for authentication
   */
  async verifyCode(code: string): Promise<AuthResult> {
    // Check lockout
    if (this.isLockedOut()) {
      const remainingMs = (this.verifyTracker.lockedUntil || 0) - Date.now();
      const remainingSec = Math.ceil(remainingMs / 1000);
      return {
        success: false,
        error: `Too many failed attempts. Please try again in ${remainingSec} seconds.`,
      };
    }

    // Migrate legacy secret if needed
    await migrateLegacySecret();

    // Load secret from OS Keychain
    const secret = await loadTotpSecret();

    if (!secret) {
      return {
        success: false,
        error: `${this.name} is not set up. Use auth-setup --provider totp first.`,
      };
    }

    // Verify the code
    const isValid = verifyTotpToken(code, secret);

    // Track attempt
    this.verifyTracker.lastAttempt = Date.now();

    if (!isValid) {
      this.verifyTracker.attempts++;

      // Check if should lock out
      if (this.verifyTracker.attempts >= MAX_VERIFY_ATTEMPTS) {
        this.verifyTracker.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        return {
          success: false,
          error: "Too many failed attempts. Locked for 5 minutes.",
        };
      }

      const remaining = MAX_VERIFY_ATTEMPTS - this.verifyTracker.attempts;
      return {
        success: false,
        error: `Invalid code. ${remaining} attempts remaining.`,
        requiresInput: true,
      };
    }

    // Success - reset tracker
    this.verifyTracker = {
      attempts: 0,
      lastAttempt: Date.now(),
    };

    return {
      success: true,
    };
  }

  /**
   * Check if currently locked out
   */
  private isLockedOut(): boolean {
    if (!this.verifyTracker.lockedUntil) {
      return false;
    }
    if (Date.now() >= this.verifyTracker.lockedUntil) {
      // Lockout expired, reset
      this.verifyTracker = {
        attempts: 0,
        lastAttempt: 0,
      };
      return false;
    }
    return true;
  }

  /**
   * Disable TOTP authentication
   */
  async disable(): Promise<void> {
    // Delete secret from OS Keychain
    await deleteTotpSecret();

    // Update config
    const config = await loadAuthConfig();
    config.providers.otp = {
      enabled: false,
      hasSecret: false,
    };
    await saveAuthConfig(config);

    // Clear any pending setup
    this.pendingSetup = null;

    // Reset verification tracker
    this.verifyTracker = {
      attempts: 0,
      lastAttempt: 0,
    };
  }

  /**
   * Get current TOTP status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    configured: boolean;
    authenticatorType?: AuthenticatorType;
    verifiedAt?: string;
    setupInProgress: boolean;
  }> {
    // Migrate legacy secret if needed
    await migrateLegacySecret();

    const config = await loadAuthConfig();
    const otpConfig = config.providers.otp;

    // Check if secret exists in keychain
    let hasSecretInKeychain = false;
    if (otpConfig?.hasSecret) {
      const secret = await loadTotpSecret();
      hasSecretInKeychain = secret !== null;
    }

    return {
      enabled: otpConfig?.enabled ?? false,
      configured: !!(otpConfig?.enabled && hasSecretInKeychain),
      authenticatorType: otpConfig?.authenticatorType,
      verifiedAt: otpConfig?.verifiedAt
        ? new Date(otpConfig.verifiedAt).toISOString()
        : undefined,
      setupInProgress: this.hasSetupInProgress(),
    };
  }
}

/**
 * Create a new TotpProvider instance
 */
export function createTotpProvider(
  authenticatorType: AuthenticatorType = "google",
): TotpProvider {
  return new TotpProvider(authenticatorType);
}

/**
 * Authentication System Types
 *
 * Defines interfaces for the extensible authentication system.
 * Supports multiple auth providers (biometric, OTP, PIN, etc.)
 */

/**
 * Actions that can require authentication
 */
export type AuthAction = "delete_account" | "export_mnemonic";

/**
 * Context provided when requesting authentication
 */
export interface AuthContext {
  /** What triggered auth (e.g., "delete_account") */
  action: AuthAction;
  /** Chain ID if applicable */
  chain?: string;
  /** Account name */
  account?: string;
  /** Transaction summary (for display to user) */
  summary?: string;
  /** Amount in display format (e.g., "1 ATOM") */
  amount?: string;
  /** TOTP code (if provided for TOTP authentication) */
  totpCode?: string;
  /** Preferred authentication method (for method selection) */
  preferredMethod?: string;
  /** Skip the global `config.enabled` check (used by auth-enable to verify identity before activating) */
  skipEnabledCheck?: boolean;
}

/**
 * Result of an authentication attempt
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /**
   * True = provider needs user input (retryable via manager's elicitation/fallback).
   * Undefined = hard failure (not recoverable by user input, e.g., lockout).
   * Manager uses this to decide fallback strategy.
   */
  requiresInput?: boolean;
  /** Provider ID that returned this result */
  provider?: string;
}

/**
 * Context for setting up an auth provider
 */
export interface AuthSetupContext {
  /** Account name to set up auth for */
  account?: string;
}

/**
 * Result of setting up an auth provider
 */
export interface AuthSetupResult {
  /** Whether setup succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional data (e.g., QR code for OTP) */
  data?: Record<string, unknown>;
}

/**
 * Base interface for authentication providers
 */
export interface AuthProvider {
  /** Provider identifier (e.g., "biometric", "otp", "pin") */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Check if this provider is available on current system */
  isAvailable(): Promise<boolean>;

  /** Setup/enroll this auth method */
  setup(context: AuthSetupContext): Promise<AuthSetupResult>;

  /** Authenticate user */
  authenticate(context: AuthContext): Promise<AuthResult>;

  /** Teardown/disable this auth method */
  disable(): Promise<void>;
}

/**
 * Auth requirement for a specific action
 */
export interface AuthRequirement {
  /** Whether auth is required for this action */
  enabled: boolean;
  /** Provider IDs required (e.g., ["biometric", "otp"]) */
  providers: string[];
}

/**
 * Biometric provider configuration
 */
export interface BiometricConfig {
  /** Whether biometric auth is enabled */
  enabled: boolean;
}

/**
 * Supported authenticator app types
 */
export type AuthenticatorType = "google" | "authy" | "microsoft" | "other";

/**
 * OTP/TOTP provider configuration
 *
 * Note: The TOTP secret is stored in OS Keychain (via keytar), not in this config.
 * The `hasSecret` field indicates whether a secret exists in the keychain.
 */
export interface OtpConfig {
  /** Whether OTP auth is enabled */
  enabled: boolean;
  /**
   * Whether a TOTP secret exists in the OS Keychain.
   * The actual secret is never stored in the config file for security.
   */
  hasSecret?: boolean;
  /**
   * @deprecated Use hasSecret instead. Kept for migration from older versions.
   * If present, will be migrated to keychain and removed.
   */
  secret?: string;
  /** Timestamp when TOTP was verified and setup completed */
  verifiedAt?: number;
  /** Which authenticator app was used for setup */
  authenticatorType?: AuthenticatorType;
}

/**
 * Main authentication configuration
 */
export interface AuthConfig {
  /** Enable authentication system */
  enabled: boolean;

  /** Auth requirements by action */
  requirements: Record<AuthAction, AuthRequirement>;

  /** Enabled providers */
  providers: {
    biometric?: BiometricConfig;
    otp?: OtpConfig;
  };
}

/**
 * Default auth requirement (disabled)
 */
export const DEFAULT_AUTH_REQUIREMENT: AuthRequirement = {
  enabled: false,
  providers: [],
};

/**
 * Default auth configuration
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabled: false,
  requirements: {
    delete_account: { ...DEFAULT_AUTH_REQUIREMENT },
    export_mnemonic: { ...DEFAULT_AUTH_REQUIREMENT },
  },
  providers: {},
};

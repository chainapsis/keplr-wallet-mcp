/**
 * User preferences and app-level settings.
 *
 * Stored in ~/.keplr-mcp/preferences.json
 */

import { readJsonConfig, writeJsonConfig } from "./config-storage.js";

const PREFERENCES_CONFIG_FILE = "preferences.json";

/**
 * User preferences configuration.
 */
export interface UserPreferences {
  version: 1;

  /** Whether the user has completed the initial onboarding flow */
  onboardingCompleted: boolean;

  /** Timestamp when onboarding was completed (ISO string) */
  onboardingCompletedAt?: string;

  /** Whether the user has dismissed the welcome message */
  welcomeDismissed: boolean;

  /** User's preferred default chain for balance checks */
  defaultChain?: string;

  /** Whether to show security tips in responses */
  showSecurityTips: boolean;
}

/**
 * Default preferences for new users.
 */
const DEFAULT_PREFERENCES: UserPreferences = {
  version: 1,
  onboardingCompleted: false,
  welcomeDismissed: false,
  showSecurityTips: true,
};

/**
 * Load user preferences from disk.
 */
export async function loadPreferences(): Promise<UserPreferences> {
  const prefs = await readJsonConfig<UserPreferences>(PREFERENCES_CONFIG_FILE);
  if (prefs) {
    // Merge with defaults to handle new fields added in updates
    return { ...DEFAULT_PREFERENCES, ...prefs };
  }
  return { ...DEFAULT_PREFERENCES };
}

/**
 * Save user preferences to disk.
 */
export async function savePreferences(prefs: UserPreferences): Promise<void> {
  await writeJsonConfig(PREFERENCES_CONFIG_FILE, prefs);
}

/**
 * Mark onboarding as completed.
 */
export async function markOnboardingCompleted(): Promise<void> {
  const prefs = await loadPreferences();
  prefs.onboardingCompleted = true;
  prefs.onboardingCompletedAt = new Date().toISOString();
  await savePreferences(prefs);
}

/**
 * Dismiss the welcome message.
 */
export async function dismissWelcome(): Promise<void> {
  const prefs = await loadPreferences();
  prefs.welcomeDismissed = true;
  await savePreferences(prefs);
}

/**
 * Check if this is a first-time user (never completed onboarding).
 */
export async function isFirstTimeUser(): Promise<boolean> {
  const prefs = await loadPreferences();
  return !prefs.onboardingCompleted;
}

/**
 * Update a specific preference.
 */
export async function updatePreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
): Promise<void> {
  const prefs = await loadPreferences();
  prefs[key] = value;
  await savePreferences(prefs);
}

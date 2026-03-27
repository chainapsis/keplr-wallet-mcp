/**
 * Authentication Configuration Management
 *
 * Handles loading and saving auth configuration from persistent storage.
 */

import { readJsonConfig, writeJsonConfig } from "../config-storage.js";
import {
  type AuthAction,
  type AuthConfig,
  type AuthRequirement,
  DEFAULT_AUTH_CONFIG,
} from "./types.js";

const AUTH_CONFIG_FILE = "auth.json";

/** In-memory cache to avoid disk I/O on every tx confirmation */
let cachedConfig: AuthConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Load auth configuration from storage.
 * Results are cached for up to 1 minute; writes invalidate the cache.
 */
export async function loadAuthConfig(): Promise<AuthConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return { ...cachedConfig };
  }

  const stored = await readJsonConfig<Partial<AuthConfig>>(AUTH_CONFIG_FILE);

  // Only pick valid AuthAction keys from stored requirements to discard stale actions
  const config: AuthConfig = stored
    ? {
        enabled: stored.enabled ?? DEFAULT_AUTH_CONFIG.enabled,
        requirements: Object.fromEntries(
          (Object.keys(DEFAULT_AUTH_CONFIG.requirements) as AuthAction[]).map(
            (action) => {
              const storedReq = stored.requirements?.[action];
              const defaultReq = DEFAULT_AUTH_CONFIG.requirements[action];

              // Migration: when auth is enabled and a new action is missing from stored config,
              // inherit delete_account's settings to prevent sensitive actions from being unprotected
              if (
                !storedReq &&
                stored.enabled &&
                stored.requirements?.delete_account
              ) {
                return [
                  action,
                  { ...defaultReq, ...stored.requirements.delete_account },
                ];
              }

              return [action, { ...defaultReq, ...storedReq }];
            },
          ),
        ) as Record<AuthAction, AuthRequirement>,
        providers: {
          ...DEFAULT_AUTH_CONFIG.providers,
          ...stored.providers,
        },
      }
    : { ...DEFAULT_AUTH_CONFIG };

  cachedConfig = config;
  cacheTimestamp = now;
  return { ...config };
}

/**
 * Save auth configuration to storage
 */
export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await writeJsonConfig(AUTH_CONFIG_FILE, config);
  cachedConfig = null; // Invalidate cache on write
}

/** Reset cache (for testing) */
export const _resetAuthConfigCache = (): void => {
  cachedConfig = null;
  cacheTimestamp = 0;
};

/**
 * Enable authentication system
 */
export async function enableAuth(): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  config.enabled = true;
  await saveAuthConfig(config);
  return config;
}

/**
 * Disable authentication system
 */
export async function disableAuth(): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  config.enabled = false;
  await saveAuthConfig(config);
  return config;
}

/**
 * Update auth requirement for a specific action
 */
export async function updateAuthRequirement(
  action: AuthAction,
  requirement: Partial<AuthRequirement>,
): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  config.requirements[action] = {
    ...config.requirements[action],
    ...requirement,
  };
  await saveAuthConfig(config);
  return config;
}

/**
 * Enable a provider for an action
 */
export async function enableProviderForAction(
  action: AuthAction,
  providerId: string,
): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  const requirement = config.requirements[action];

  if (!requirement.providers.includes(providerId)) {
    requirement.providers.push(providerId);
  }
  requirement.enabled = true;

  await saveAuthConfig(config);
  return config;
}

/**
 * Disable a provider for an action
 */
export async function disableProviderForAction(
  action: AuthAction,
  providerId: string,
): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  const requirement = config.requirements[action];

  requirement.providers = requirement.providers.filter((p) => p !== providerId);

  // If no providers left, disable the requirement
  if (requirement.providers.length === 0) {
    requirement.enabled = false;
  }

  await saveAuthConfig(config);
  return config;
}

/**
 * Enable biometric provider
 */
export async function enableBiometric(): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  config.providers.biometric = { enabled: true };
  await saveAuthConfig(config);
  return config;
}

/**
 * Disable biometric provider
 */
export async function disableBiometric(): Promise<AuthConfig> {
  const config = await loadAuthConfig();
  config.providers.biometric = { enabled: false };

  // Remove biometric from all requirements
  for (const action of Object.keys(config.requirements) as AuthAction[]) {
    config.requirements[action].providers = config.requirements[
      action
    ].providers.filter((p) => p !== "biometric");

    if (config.requirements[action].providers.length === 0) {
      config.requirements[action].enabled = false;
    }
  }

  await saveAuthConfig(config);
  return config;
}

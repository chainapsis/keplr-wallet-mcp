/**
 * Vitest global setup file.
 * Mocks native modules that require system dependencies.
 *
 * SAFETY: Two independent guards prevent tests from accessing the real
 * system keychain:
 *
 * 1. keytar mock (below): intercepts all keytar calls so they never
 *    reach the OS keychain API.
 * 2. __KEPLR_TEST_NO_NATIVE_KEYCHAIN env var: checked by vault-key.ts
 *    nativeAvailable() to skip the BiometricAuth binary path, which
 *    bypasses keytar entirely on macOS.
 *
 * Both guards must be present. The keytar mock alone is insufficient
 * because vault-key.ts has a native code path (execFile BiometricAuth)
 * that doesn't use keytar at all.
 */

import { vi } from "vitest";

// Guard: disable native keychain binary path in vault-key.ts.
// This prevents execFile(BiometricAuth, ...) from running, which would
// access the real macOS Keychain regardless of whether keytar is mocked.
// Tests that need to exercise the native code path (e.g. vault-key.test.ts)
// mock child_process and fs.existsSync directly and can delete this env var.
process.env.__KEPLR_TEST_NO_NATIVE_KEYCHAIN = "1";

// Mock keytar - native module that requires system keychain.
// This intercepts the keytar import path used by vault-key.ts and accounts.ts.
vi.mock("keytar", () => ({
  getPassword: vi.fn().mockResolvedValue(null),
  setPassword: vi.fn().mockResolvedValue(undefined),
  deletePassword: vi.fn().mockResolvedValue(true),
  findCredentials: vi.fn().mockResolvedValue([]),
  findPassword: vi.fn().mockResolvedValue(null),
}));

/**
 * Legacy keychain interface.
 *
 * These functions delegate to the accounts module using the "default" account
 * for backward compatibility. New code should use the accounts module directly.
 *
 * @deprecated Use the accounts module instead.
 */

import {
  deleteMnemonicForAccount,
  getActiveMnemonic,
  saveMnemonicForAccount,
} from "./accounts.js";

const DEFAULT_ACCOUNT = "default";

/**
 * Save a mnemonic to the keychain.
 * @deprecated Use saveMnemonicForAccount from accounts.ts
 */
export async function saveMnemonic(mnemonic: string): Promise<void> {
  await saveMnemonicForAccount(DEFAULT_ACCOUNT, mnemonic);
}

/**
 * Load the mnemonic from the keychain.
 * Returns the active account's mnemonic.
 * @deprecated Use getActiveMnemonic from accounts.ts
 */
export async function loadMnemonic(): Promise<string | null> {
  return getActiveMnemonic();
}

/**
 * Delete the mnemonic from the keychain.
 * @deprecated Use deleteMnemonicForAccount from accounts.ts
 */
export async function deleteMnemonic(): Promise<boolean> {
  return deleteMnemonicForAccount(DEFAULT_ACCOUNT);
}

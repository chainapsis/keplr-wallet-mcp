/**
 * Account Layer Exports
 *
 * Layer 2 of the key abstraction hierarchy.
 * Provides account type abstractions (EOA, Smart Account).
 */

// Implementations
export { createEOAAccount, EOAAccountImpl } from "./eoa.js";
// Types
export {
  type Account,
  AccountError,
  AccountErrorCode,
  type AccountKind,
  type AddressContext,
  type EOAAccount,
} from "./types.js";

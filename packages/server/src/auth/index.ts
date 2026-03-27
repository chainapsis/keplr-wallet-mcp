/**
 * Authentication Module
 *
 * Extensible authentication system for transaction signing.
 */

export * from "./config.js";
export {
  AuthManager,
  getAuthManager,
  initializeAuthManager,
} from "./manager.js";
export * from "./types.js";

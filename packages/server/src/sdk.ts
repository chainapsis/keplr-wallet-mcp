/**
 * Keplr MCP Server SDK
 *
 * Single entry point for external packages (adapters, protocols).
 * Import from "@keplr-wallet/mcp-server/sdk" to access all SDK exports.
 *
 * @example
 * ```typescript
 * import {
 *   SDK_VERSION,
 *   type EcosystemAdapter,
 *   type ProtocolPlugin,
 *   store,
 *   KeplrEventTypes,
 *   formatCurrencyAmount,
 *   type McpCurrency,
 * } from "@keplr-wallet/keplr-wallet-mcp/sdk";
 *
 * // Plugin development
 * import { defineConfig, type KeplrMcpPlugin } from "@keplr-wallet/keplr-wallet-mcp/config";
 * ```
 */

// ============================================
// Re-exported from @keplr-wallet/cosmos
// ============================================
export { Bech32Address } from "@keplr-wallet/cosmos";
// ============================================
// Currency Types (from @keplr-wallet/types)
// ============================================
export type {
  AppCurrency,
  Bech32Config,
  Currency as KeplrCurrency,
  FeeCurrency as KeplrFeeCurrency,
} from "@keplr-wallet/types";
// ============================================
// Re-exported from @keplr-wallet/unit
// ============================================
export {
  CoinPretty,
  CoinUtils,
  Dec,
  DecUtils,
  Int,
  IntPretty,
  PricePretty,
  RatePretty,
  Uint,
} from "@keplr-wallet/unit";
export { getAuthManager } from "./auth/manager.js";
export { getChainConfig } from "./chains/cosmos.js";
// ============================================
// Chain Configuration Helpers
// ============================================
export {
  createBech32Config,
  createCurrency,
  createFeeCurrencyFromGasPrice,
} from "./chains/migration.js";
// ============================================
// Balance Enricher
// ============================================
export type { BalanceResult } from "./clients/cosmos.js";
export type {
  ExternalPluginContext,
  ExternalPluginFactory,
  KeplrMcpConfig,
  KeplrMcpPlugin,
  RpcConfig,
  ToolsetConfig,
} from "./config/index.js";
// ============================================
// Config / Extensibility API
// ============================================
export { defineConfig, loadConfig } from "./config/index.js";
// ============================================
// Ecosystem Types
// ============================================
export type { EcosystemAdapter, EcosystemClient } from "./ecosystem.js";
// ============================================
// Error Utilities
// ============================================
export type {
  ClassifiedError,
  RetryAction,
  SetupGuide,
  SetupOption,
  SuggestedAction,
  TransactionAmount,
  TransactionPreview,
  TransactionWarning,
  TransactionWarningLevel,
} from "./errors.js";
export {
  classifyError,
  createSetupRequiredResponse,
  DEFAULT_SETUP_GUIDE,
  ErrorCategory,
  enhanceWithRetryAction,
  formatClassifiedError,
  generateTransactionWarnings,
  isSetupRequiredError,
  TransactionWarningCodes,
} from "./errors.js";
// ============================================
// Event System
// ============================================
export type {
  KeplrEvent,
  KeplrEventListener,
  KeplrEventType,
} from "./events.js";
export { createEvent, KeplrEventTypes } from "./events.js";
export {
  createKeyProvider,
  createMnemonicKeyProvider,
  getSupportedKeyProviderTypes,
  isKeyProviderTypeSupported,
  MnemonicKeyProvider,
  validateKeyProviderConfig,
} from "./keys/index.js";
// ============================================
// Key Management
// ============================================
export type {
  AddressContext,
  CurveType,
  KeyProvider,
  KeyProviderCapabilities,
  KeyProviderConfig,
  KeyProviderFactory,
  KeyProviderType,
  MnemonicKeyProviderConfig,
  PasskeyKeyProviderConfig,
  SignRequest,
  SignResponse,
  SignType,
  SmartAccountKeyProviderConfig,
} from "./keys/types.js";
export {
  KeyProviderError,
  KeyProviderErrorCode,
} from "./keys/types.js";
// ============================================
// Plugin Types
// ============================================
export type { KeplrPlugin } from "./plugins/types.js";
export type { ResolvedEndpoint } from "./rpc/resolver.js";
export { getRpcResolver, RpcResolver } from "./rpc/resolver.js";
// ============================================
// Store
// ============================================
export type { KeplrStore, PendingAction } from "./store.js";
export { store } from "./store.js";
export { pickTip } from "./tips.js";
// ============================================
// MCP Currency Types and Utilities
// ============================================
export type {
  McpCurrency,
  McpFeeCurrency,
  TokenInfo,
} from "./types/currency.js";
export {
  createFeeCurrency,
  createMcpCurrency,
  getTokenDecimals,
  KNOWN_18_DECIMAL_DENOMS,
  parseGasPriceStep,
  toMcpCurrency,
} from "./types/currency.js";
export type { BalanceEnricher } from "./utils/balance-enricher.js";
export { balanceEnricherRegistry } from "./utils/balance-enricher.js";
// ============================================
// Formatting Utilities
// ============================================
export type { FormatCurrencyInfo, ParsedGasPrice } from "./utils/format.js";
export {
  addAmounts,
  calculateFee,
  compareAmounts,
  formatCurrencyAmount,
  formatDisplayValue,
  parseCurrencyAmount,
  parseGasPrice,
  subtractAmounts,
} from "./utils/format.js";
// ============================================
// Transaction Elicitation
// ============================================
export type { TxElicitationResult } from "./utils/tx-elicitation.js";
export { elicitTxConfirmation } from "./utils/tx-elicitation.js";
// ============================================
// Version
// ============================================

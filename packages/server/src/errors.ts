/**
 * Error Classification System
 *
 * Provides utilities for categorizing errors and suggesting recovery actions.
 */

/**
 * Error categories for classifying different types of failures
 */
export enum ErrorCategory {
  /** Network-related errors (timeouts, connection failures) */
  NETWORK = "network",
  /** Validation errors (invalid input, insufficient balance) */
  VALIDATION = "validation",
  /** Wallet-related errors (signing failures, session issues) */
  WALLET = "wallet",
  /** Timeout errors (operation took too long) */
  TIMEOUT = "timeout",
  /** Authentication/authorization errors */
  AUTH = "auth",
  /** Chain/RPC errors */
  CHAIN = "chain",
  /** Setup required (no account/wallet configured) */
  SETUP_REQUIRED = "setup_required",
  /** Unknown/unclassified errors */
  UNKNOWN = "unknown",
}

/**
 * A setup option for guiding users through wallet setup
 */
export interface SetupOption {
  /** Tool name to call */
  tool: string;
  /** Human-readable description of this option */
  description: string;
  /** When this option is recommended */
  recommendedFor?: string;
}

/**
 * Setup guide for helping users configure their wallet
 */
export interface SetupGuide {
  /** Available setup options */
  options: SetupOption[];
  /** Recommended option (tool name) */
  recommendation: string;
  /** Additional context or tips */
  tip?: string;
}

/**
 * Retry action for recoverable errors
 */
export interface RetryAction {
  /** Tool to call for retry */
  tool: string;
  /** Parameters to pass (optional) */
  params?: Record<string, unknown>;
  /** Whether auto-retry is recommended */
  autoRetry?: boolean;
  /** Delay before retry in milliseconds (optional) */
  delayMs?: number;
}

/**
 * Suggested action for guiding users to next steps
 */
export interface SuggestedAction {
  /** Tool name to call */
  tool: string;
  /** Human-readable reason why this action is suggested */
  reason: string;
  /** Parameters to pass (optional) */
  params?: Record<string, unknown>;
  /** Priority level (lower = higher priority) */
  priority?: number;
}

/**
 * Classified error with category, recovery info, and suggestions
 */
export interface ClassifiedError {
  /** Error category */
  category: ErrorCategory;
  /** Original error message */
  message: string;
  /** Whether the operation can be retried */
  recoverable: boolean;
  /** Suggestion for how to resolve the error */
  suggestion?: string;
  /** Action to retry the operation (for recoverable errors) */
  retryAction?: RetryAction;
  /** Setup guide (for SETUP_REQUIRED errors) */
  setupGuide?: SetupGuide;
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Array<{
  patterns: RegExp[];
  category: ErrorCategory;
  recoverable: boolean;
  suggestion: string;
}> = [
  // Timeout errors
  {
    patterns: [/timeout/i, /timed out/i, /deadline exceeded/i],
    category: ErrorCategory.TIMEOUT,
    recoverable: true,
    suggestion:
      "The operation timed out. Check your network connection and try again.",
  },

  // Network errors
  {
    patterns: [
      /network/i,
      /econnrefused/i,
      /enotfound/i,
      /fetch failed/i,
      /connection refused/i,
      /failed to fetch/i,
    ],
    category: ErrorCategory.NETWORK,
    recoverable: true,
    suggestion:
      "Network error occurred. Check your internet connection and try again.",
  },

  // Insufficient balance errors
  {
    patterns: [
      /insufficient/i,
      /not enough/i,
      /balance.*low/i,
      /low balance/i,
      /balance is lower/i,
    ],
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion:
      "Insufficient balance. Please add funds to your wallet and try again.",
  },

  // CosmWasm message parsing errors (must precede gas — these errors often contain "gas used" suffix)
  {
    patterns: [
      /unknown variant/i,
      /Error parsing into type/i,
      /missing field.*expected/i,
    ],
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion:
      "The contract message format is incorrect. Check the error for valid message variants and retry with the correct format.",
  },

  // Gas errors (refined to avoid false positives from "gas used: <n>" in contract errors)
  {
    patterns: [
      /out of gas/i,
      /gas estimation failed/i,
      /gas price too low/i,
      /gas limit exceeded/i,
      /gas wanted.*exceeded/i,
    ],
    category: ErrorCategory.CHAIN,
    recoverable: true,
    suggestion:
      "Gas estimation failed. The transaction may require more gas. Try again with a higher gas limit.",
  },

  // Invalid address errors
  {
    patterns: [
      /invalid.*address/i,
      /address.*invalid/i,
      /bech32/i,
      /checksum/i,
    ],
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion: "The address format is invalid. Please check and correct it.",
  },

  // Signing errors
  {
    patterns: [
      /user rejected/i,
      /user denied/i,
      /rejected by user/i,
      /cancelled/i,
      /signing failed/i,
    ],
    category: ErrorCategory.WALLET,
    recoverable: true,
    suggestion:
      "The transaction was rejected or cancelled. You can try again if needed.",
  },

  // Chain/RPC errors
  {
    patterns: [
      /rpc.*error/i,
      /chain.*error/i,
      /broadcast.*fail/i,
      /sequence mismatch/i,
      /account sequence/i,
    ],
    category: ErrorCategory.CHAIN,
    recoverable: true,
    suggestion:
      "Chain RPC error occurred. Wait a moment and try again. If the issue persists, the chain may be congested.",
  },

  // Token expired
  {
    patterns: [
      /expired.*token/i,
      /token.*expired/i,
      /invalid.*token/i,
      /confirmation.*expired/i,
    ],
    category: ErrorCategory.TIMEOUT,
    recoverable: true,
    suggestion:
      "The confirmation token expired. Please request the transaction again.",
  },

  // Slippage errors
  {
    patterns: [/slippage/i, /price.*impact/i, /price moved/i],
    category: ErrorCategory.VALIDATION,
    recoverable: true,
    suggestion:
      "The price moved beyond slippage tolerance. Try again with higher slippage or a smaller amount.",
  },

  // EVM: Nonce errors
  {
    patterns: [
      /nonce too low/i,
      /nonce.*already.*used/i,
      /replacement.*underpriced/i,
      /transaction underpriced/i,
    ],
    category: ErrorCategory.CHAIN,
    recoverable: true,
    suggestion:
      "Transaction nonce conflict. A previous transaction may be pending. Wait a moment and try again.",
  },

  // EVM: Contract execution errors
  {
    patterns: [
      /execution reverted/i,
      /revert/i,
      /require.*failed/i,
      /vm exception/i,
      /evm.*error/i,
      /call exception/i,
    ],
    category: ErrorCategory.CHAIN,
    recoverable: false,
    suggestion:
      "Smart contract execution failed. The transaction conditions were not met (e.g., insufficient allowance, invalid parameters).",
  },

  // EVM: Contract not found
  {
    patterns: [
      /contract.*not.*found/i,
      /no contract.*deployed/i,
      /contract.*does not exist/i,
      /code.*empty/i,
    ],
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion:
      "No contract found at the specified address. Check the contract address and chain.",
  },

  // EVM: ABI errors
  {
    patterns: [
      /abi.*invalid/i,
      /invalid.*abi/i,
      /function.*not found/i,
      /no matching function/i,
      /unknown fragment/i,
    ],
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion:
      "Invalid ABI or function name. Check the contract ABI and function signature.",
  },

  // LCD JSON parse errors
  {
    patterns: [
      /non-json response/i,
      /LcdParseError/i,
      /unexpected token.*in json/i,
    ],
    category: ErrorCategory.CHAIN,
    recoverable: true,
    suggestion:
      "The chain endpoint returned an invalid response. Try again or check endpoint health.",
  },

  // Rate limiting
  {
    patterns: [/rate.*limit/i, /too many requests/i, /429/i],
    category: ErrorCategory.NETWORK,
    recoverable: true,
    suggestion:
      "Rate limit exceeded. Please wait a moment before trying again.",
  },

  // Setup required (no mnemonic/account configured)
  {
    patterns: [
      /no mnemonic configured/i,
      /no active account/i,
      /no account.*active/i,
      /account.*not found/i,
      /mnemonic.*not.*stored/i,
      /use.*create-account/i,
      /use.*import-account/i,
    ],
    category: ErrorCategory.SETUP_REQUIRED,
    recoverable: true,
    suggestion:
      "No wallet is configured yet. Create a new account or import an existing wallet to get started.",
  },
];

/**
 * Parsed CosmWasm message error with structured information
 */
export interface CosmWasmMsgError {
  errorType: "unknown_variant" | "missing_field" | "unknown_field";
  targetType: string;
  sentValue?: string;
  availableVariants?: string[];
  missingField?: string;
  unknownField?: string;
  expectedFields?: string[];
}

/**
 * Parse CosmWasm contract message errors into structured information.
 * Extracts variant/field details from chain error messages.
 */
export const parseCosmWasmMsgError = (
  message: string,
): CosmWasmMsgError | null => {
  // Type names contain :: (e.g. "drop_staking_base::msg::factory::ExecuteMsg")
  // so we use (.+?) with lazy matching and anchor on ": unknown variant" (colon + space)

  // unknown variant: "Error parsing into type <Type>: unknown variant `<sent>`, expected one of <variants>"
  const unknownVariant =
    /Error parsing into type (.+?):\s*unknown variant \x60([^\x60]+)\x60,\s*expected one of (.+?)(?:\s*:|$)/i;
  const uvMatch = message.match(unknownVariant);
  if (uvMatch) {
    const variants = uvMatch[3]
      .split(",")
      .map((v) => v.trim().replace(/^\x60|\x60$/g, ""))
      .filter(Boolean);
    return {
      errorType: "unknown_variant",
      targetType: uvMatch[1].trim(),
      sentValue: uvMatch[2],
      availableVariants: variants,
    };
  }

  // missing field: "Error parsing into type <Type>: missing field `<field>`"
  const missingField =
    /Error parsing into type (.+?):\s*missing field \x60([^\x60]+)\x60/i;
  const mfMatch = message.match(missingField);
  if (mfMatch) {
    return {
      errorType: "missing_field",
      targetType: mfMatch[1].trim(),
      missingField: mfMatch[2],
    };
  }

  // unknown field: "Error parsing into type <Type>: unknown field `<field>`, expected one of <fields>"
  const unknownField =
    /Error parsing into type (.+?):\s*unknown field \x60([^\x60]+)\x60(?:,\s*expected one of (.+?))?(?:\s*:|$)/i;
  const ufMatch = message.match(unknownField);
  if (ufMatch) {
    const expectedFields = ufMatch[3]
      ? ufMatch[3]
          .split(",")
          .map((f) => f.trim().replace(/^\x60|\x60$/g, ""))
          .filter(Boolean)
      : undefined;
    return {
      errorType: "unknown_field",
      targetType: ufMatch[1].trim(),
      unknownField: ufMatch[2],
      expectedFields,
    };
  }

  return null;
};

/**
 * Classify an error into a category with recovery information
 */
export function classifyError(error: Error | string): ClassifiedError {
  const message = typeof error === "string" ? error : error.message;
  const lowerMessage = message.toLowerCase();

  // Check each pattern group
  for (const {
    patterns,
    category,
    recoverable,
    suggestion,
  } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(lowerMessage)) {
        return {
          category,
          message,
          recoverable,
          suggestion,
        };
      }
    }
  }

  // Default: unknown error
  return {
    category: ErrorCategory.UNKNOWN,
    message,
    recoverable: false,
    suggestion:
      "An unexpected error occurred. Please try again or contact support if the issue persists.",
  };
}

/**
 * Format a classified error for display in tool responses
 */
export function formatClassifiedError(classified: ClassifiedError): {
  isError: true;
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  retryAction?: RetryAction;
  setupGuide?: SetupGuide;
} {
  return {
    isError: true,
    category: classified.category,
    message: classified.message,
    recoverable: classified.recoverable,
    ...(classified.suggestion && { suggestion: classified.suggestion }),
    ...(classified.retryAction && { retryAction: classified.retryAction }),
    ...(classified.setupGuide && { setupGuide: classified.setupGuide }),
  };
}

/**
 * Default setup guide for wallet configuration
 */
export const DEFAULT_SETUP_GUIDE: SetupGuide = {
  options: [
    {
      tool: "create-account",
      description: "Generate a new wallet with a fresh mnemonic phrase",
      recommendedFor: "New users who don't have an existing wallet",
    },
    {
      tool: "import-account",
      description: "Import an existing wallet using your mnemonic phrase",
      recommendedFor: "Users who already have a wallet they want to use",
    },
  ],
  recommendation: "create-account",
  tip: "For best security, enable biometric authentication with 'auth-setup' after creating your account.",
};

/**
 * Check if an error indicates that wallet setup is required
 */
export function isSetupRequiredError(error: Error | string): boolean {
  const message = typeof error === "string" ? error : error.message;
  const lowerMessage = message.toLowerCase();

  const setupPatterns = [
    /no mnemonic configured/i,
    /no active account/i,
    /no account.*active/i,
    /mnemonic.*not.*stored/i,
    /use.*create-account/i,
    /use.*import-account/i,
  ];

  return setupPatterns.some((pattern) => pattern.test(lowerMessage));
}

/**
 * Create a setup required response (not an error, but a guide)
 * Use this instead of returning an error when wallet setup is needed.
 */
export function createSetupRequiredResponse(context?: {
  /** What the user was trying to do */
  attemptedAction?: string;
  /** Custom setup guide (uses default if not provided) */
  setupGuide?: SetupGuide;
}): {
  status: "setup_required";
  message: string;
  attemptedAction?: string;
  setupGuide: SetupGuide;
} {
  const guide = context?.setupGuide ?? DEFAULT_SETUP_GUIDE;

  return {
    status: "setup_required",
    message:
      "No wallet is configured yet. Choose one of the options below to get started.",
    ...(context?.attemptedAction && {
      attemptedAction: context.attemptedAction,
    }),
    setupGuide: guide,
  };
}

/**
 * Enhance a classified error with retry action based on category
 */
export function enhanceWithRetryAction(
  classified: ClassifiedError,
  originalTool?: string,
  originalParams?: Record<string, unknown>,
): ClassifiedError {
  // Only add retry action for recoverable errors
  if (!classified.recoverable) {
    return classified;
  }

  // For setup required errors, add setup guide
  if (classified.category === ErrorCategory.SETUP_REQUIRED) {
    return {
      ...classified,
      setupGuide: DEFAULT_SETUP_GUIDE,
    };
  }

  // For other recoverable errors, suggest retry with the original tool
  if (originalTool) {
    const retryAction: RetryAction = {
      tool: originalTool,
      ...(originalParams && { params: originalParams }),
    };

    // Add delay for rate limiting
    if (classified.category === ErrorCategory.NETWORK) {
      if (classified.message.toLowerCase().includes("rate")) {
        retryAction.delayMs = 5000;
      }
    }

    // Auto-retry for transient errors
    if (
      classified.category === ErrorCategory.TIMEOUT ||
      classified.category === ErrorCategory.NETWORK
    ) {
      retryAction.autoRetry = true;
    }

    return {
      ...classified,
      retryAction,
    };
  }

  return classified;
}

/**
 * Transaction Preview Types
 *
 * Provides structured preview information for transactions before confirmation.
 */

/**
 * Warning level for transaction warnings
 */
export type TransactionWarningLevel = "info" | "warning" | "critical";

/**
 * Transaction warning with severity and message
 */
export interface TransactionWarning {
  /** Severity level */
  level: TransactionWarningLevel;
  /** Machine-readable warning code (e.g., "INSUFFICIENT_FOR_FEE", "LARGE_AMOUNT") */
  code: string;
  /** Human-readable warning message */
  message: string;
}

/**
 * Amount with value and denomination
 */
export interface TransactionAmount {
  /** Raw value (e.g., "1000000" for 1 ATOM in uatom) */
  value: string;
  /** Denomination (e.g., "uatom", "ETH") */
  denom: string;
  /** Formatted display value (e.g., "1 ATOM", "0.5 ETH") */
  formatted?: string;
}

/**
 * Fee estimation method indicator
 */
export type FeeEstimationMethod = "simulated" | "fallback";

/**
 * Transaction preview information
 */
export interface TransactionPreview {
  /** Human-readable summary of the transaction (e.g., "Send 1 ATOM to cosmos1...") */
  summary?: string;
  /** Sender address */
  from: string;
  /** Recipient address (if applicable) */
  to?: string;
  /** Transaction amount (if applicable) */
  amount?: TransactionAmount;
  /** Estimated fee for the transaction */
  estimatedFee?: TransactionAmount;
  /** How the fee was estimated: "simulated" (accurate) or "fallback" (conservative default) */
  feeEstimationMethod?: FeeEstimationMethod;
  /** Warning message if fee estimation used fallback method */
  feeWarning?: string;
  /** Balance before transaction */
  balanceBefore?: TransactionAmount;
  /** Projected balance after transaction (amount + fee deducted) */
  balanceAfter?: TransactionAmount;
  /** Warnings about the transaction (insufficient funds, large amount, etc.) */
  warnings?: TransactionWarning[];
}

/**
 * Warning codes for transaction warnings
 */
export const TransactionWarningCodes = {
  /** Insufficient balance to cover amount + fees */
  INSUFFICIENT_FOR_FEE: "INSUFFICIENT_FOR_FEE",
  /** Transaction uses a large portion of balance (>90%) */
  LARGE_AMOUNT: "LARGE_AMOUNT",
  /** Low balance remaining after transaction (<10%) */
  LOW_BALANCE_AFTER: "LOW_BALANCE_AFTER",
  /** Unstaking period applies (for undelegate operations) */
  UNSTAKING_PERIOD: "UNSTAKING_PERIOD",
  /** Gas token balance will be too low for future transactions after this transfer */
  GAS_TOKEN_EXHAUSTION: "GAS_TOKEN_EXHAUSTION",
  /** Requested denom not found in on-chain balances */
  DENOM_NOT_IN_BALANCES: "DENOM_NOT_IN_BALANCES",
} as const;

/**
 * Generate transaction warnings based on balance and amount
 */
export function generateTransactionWarnings(params: {
  amount: bigint;
  balance: bigint;
  estimatedFee: bigint;
  isUndelegate?: boolean;
}): TransactionWarning[] {
  const { amount, balance, estimatedFee, isUndelegate } = params;
  const warnings: TransactionWarning[] = [];
  const total = amount + estimatedFee;

  // Check if insufficient balance for amount + fee
  if (total > balance) {
    warnings.push({
      level: "critical",
      code: TransactionWarningCodes.INSUFFICIENT_FOR_FEE,
      message: "Insufficient balance to cover amount + estimated fees",
    });
  }

  // Check if using large portion of balance (>90%)
  if (balance > 0n && amount > (balance * 90n) / 100n) {
    const percentage = Number((amount * 100n) / balance);
    warnings.push({
      level: "warning",
      code: TransactionWarningCodes.LARGE_AMOUNT,
      message: `This transaction uses ${percentage}% of your balance`,
    });
  }

  // Check if low balance remaining after transaction (<10% of original)
  if (balance > 0n && total <= balance) {
    const remaining = balance - total;
    if (remaining < (balance * 10n) / 100n && remaining > 0n) {
      warnings.push({
        level: "warning",
        code: TransactionWarningCodes.LOW_BALANCE_AFTER,
        message:
          "Less than 10% of your balance will remain after this transaction",
      });
    }
  }

  // Add unstaking period warning for undelegate operations
  if (isUndelegate) {
    warnings.push({
      level: "info",
      code: TransactionWarningCodes.UNSTAKING_PERIOD,
      message:
        "Unbonding period applies (typically 21 days). Tokens will not be available until then.",
    });
  }

  return warnings;
}

import { fromBech32 } from "@cosmjs/encoding";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { coin } from "@cosmjs/stargate";
import type { ChainInfo } from "@keplr-wallet/types";
import { z } from "zod";
import {
  findChainByBech32Prefix,
  getBech32Prefix,
  getGasPrice,
  getStakeDecimals,
  getStakeDenom,
  getStakeMinimalDenom,
} from "../../chains/cosmos.js";
import { getAllFeeTokens } from "../../chains/fee-tokens.js";
import type {
  BalanceResult,
  CosmosClient,
  TxResult,
} from "../../clients/cosmos.js";
import {
  classifyError,
  createSetupRequiredResponse,
  ErrorCategory,
  enhanceWithRetryAction,
  type FeeEstimationMethod,
  formatClassifiedError,
  generateTransactionWarnings,
  isSetupRequiredError,
  type SuggestedAction,
  type TransactionPreview,
  type TransactionWarning,
  TransactionWarningCodes,
} from "../../errors.js";
import { storePending } from "../../pending-action.js";
import { getTtlInfo, store } from "../../store.js";
import { pickTip } from "../../tips.js";
import { getTokenDecimals } from "../../types/currency.js";
import { validateAddressForChain } from "../../utils/address-validation.js";
import {
  AmountParseError,
  formatDisplayAmount,
  parseHumanAmount,
} from "../../utils/amount-parser.js";
import { wrapForBabylon } from "../../utils/babylon.js";
import {
  formatCurrencyAmount,
  getGasAdjustment,
  parseGasPrice,
} from "../../utils/format.js";
import { resolveIbcDenom } from "../../utils/ibc-resolver.js";
import { resolveIbcChannelViaSkip } from "../../utils/skip-ibc.js";
import { formatPreviewForElicitation } from "../../utils/tx-elicitation.js";
import { CHAIN_PARAM_DESC, resolveChain } from "../shared.js";
import type { KeplrPlugin, ToolContext } from "../types.js";

/**
 * Transaction response status
 */
type TxResponseStatus = "pending_confirmation" | "success" | "cancelled";

/**
 * Build a JSON response for transaction tools
 */
function buildTxResponse(data: {
  status: TxResponseStatus;
  summary: string;
  chain: string;
  preview?: TransactionPreview;
  confirmationToken?: string;
  transactionHash?: string;
  gasUsed?: string;
  message?: string;
  suggestedActions?: SuggestedAction[];
  tip?: string;
}) {
  const ttlInfo = data.confirmationToken ? getTtlInfo() : undefined;

  const response: Record<string, unknown> = {
    status: data.status,
    summary: data.summary,
    chain: data.chain,
  };

  if (data.preview) {
    response.preview = data.preview;
  }

  if (data.confirmationToken) {
    response.confirmationToken = data.confirmationToken;
    response.expiresIn = ttlInfo?.expiresIn;
    response.expiresAt = ttlInfo?.expiresAt;
    response.ttlWarning = ttlInfo?.ttlWarning;
    response.instruction = "Call confirm-action with this token to execute.";
  }

  if (data.transactionHash) {
    response.transactionHash = data.transactionHash;
  }

  if (data.gasUsed) {
    response.gasUsed = data.gasUsed;
  }

  if (data.message) {
    response.message = data.message;
  }

  if (data.suggestedActions && data.suggestedActions.length > 0) {
    response.suggestedActions = data.suggestedActions;
  }

  if (data.tip) {
    response.tip = data.tip;
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

/**
 * Build suggested actions for successful transaction
 */
function buildSuccessSuggestedActions(
  chain: ChainInfo,
  txHash: string,
): SuggestedAction[] {
  return [
    {
      tool: "get-transaction-status",
      reason: "Check transaction confirmation status",
      params: { chain: chain.chainId, txHash },
      priority: 1,
    },
    {
      tool: "get-balances",
      reason: "Check updated token balances",
      params: { chain: chain.chainId },
      priority: 2,
    },
    {
      tool: "get-staking-info",
      reason: "Check updated staking positions and rewards",
      params: { chain: chain.chainId },
      priority: 3,
    },
  ];
}

/**
 * Handle transaction: always use confirmation token flow.
 * Elicitation is deferred to confirm-action so the user sees
 * the confirmation prompt only at the actual execution step.
 */
async function handleTransactionWithElicitation(
  _ctx: ToolContext,
  params: {
    summary: string;
    chain: ChainInfo;
    preview: TransactionPreview;
    execute: () => Promise<TxResult>;
    tip?: string;
    suggestedActions?: SuggestedAction[];
  },
) {
  const { summary, chain, preview, execute, tip, suggestedActions } = params;

  // Add summary to preview for elicitation display at confirm time
  preview.summary = summary;

  const elicitationSummary = formatPreviewForElicitation(preview);
  const confirmationToken = storePending(
    summary,
    chain.chainId,
    execute,
    undefined,
    elicitationSummary,
  );
  return buildTxResponse({
    status: "pending_confirmation",
    summary,
    chain: chain.chainId,
    preview,
    confirmationToken,
    suggestedActions,
    tip,
  });
}

/**
 * Handle transaction errors with classification, retry actions, and suggested actions
 */
function handleTransactionError(
  error: unknown,
  toolName: string,
  chain?: string,
  originalParams?: Record<string, unknown>,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  // Check if this is a setup required error
  if (isSetupRequiredError(errorObj.message)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            createSetupRequiredResponse({ attemptedAction: toolName }),
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Classify the error and enhance with retry action
  const classified = classifyError(errorObj);
  const enhanced = enhanceWithRetryAction(classified, toolName, originalParams);
  const formatted = formatClassifiedError(enhanced);

  // Add context-aware suggested actions
  const suggestedActions: SuggestedAction[] = [];

  if (chain) {
    suggestedActions.push({
      tool: "get-balances",
      reason: "Check your token balances",
      params: { chain },
      priority: 1,
    });
  }

  // Add retry suggestion for transient errors (if not already in retryAction)
  if (
    !enhanced.retryAction &&
    (classified.category === ErrorCategory.NETWORK ||
      classified.category === ErrorCategory.CHAIN ||
      classified.category === ErrorCategory.TIMEOUT)
  ) {
    suggestedActions.push({
      tool: toolName,
      reason: "Retry the transaction (network issue may be temporary)",
      params: originalParams,
      priority: 2,
    });
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...formatted,
            ...(suggestedActions.length > 0 && { suggestedActions }),
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Parse amount input, supporting both human-readable ("1 ATOM") and minimal ("1000000") formats.
 * Returns the amount in minimal denomination.
 */
async function parseAmount(
  input: string,
  chain: ChainInfo,
  explicitDenom?: string,
): Promise<{ amount: string; denom: string; displayAmount: string }> {
  // Resolve decimals for IBC denoms not registered in chain config
  // When explicitDenom is not provided, try extracting denom from input (e.g. "0.5 ibc/ABC...")
  const denomForResolution =
    explicitDenom ??
    (() => {
      const parts = input.trim().split(/\s+/);
      return parts.length === 2 && parts[1].startsWith("ibc/")
        ? parts[1]
        : undefined;
    })();

  let overrideDecimals: number | undefined;
  if (denomForResolution?.startsWith("ibc/")) {
    try {
      const metadata = await resolveIbcDenom(chain, denomForResolution);
      if (metadata) {
        overrideDecimals = metadata.decimals;
      }
    } catch {
      // Fallback to heuristic on resolution failure
    }
    overrideDecimals ??= getTokenDecimals(denomForResolution);
  }

  try {
    // Try human-readable parsing first
    const parsed = parseHumanAmount(input, chain, overrideDecimals);
    const denom = explicitDenom ?? parsed.denom;
    const displayAmount = parsed.wasDisplayFormat
      ? input
      : formatDisplayAmount(parsed.amount, chain, denom);
    return { amount: parsed.amount, denom, displayAmount };
  } catch (error) {
    if (error instanceof AmountParseError) {
      // Fall back to treating input as minimal amount (backwards compatibility)
      const denom = explicitDenom ?? getStakeMinimalDenom(chain);
      const displayAmount = formatDisplayAmount(input, chain, denom);
      return { amount: input, denom, displayAmount };
    }
    throw error;
  }
}

/**
 * Format amount for display using the unified formatting utility.
 * Handles native tokens via chain config, and other tokens via getTokenDecimals.
 */
function formatCosmosAmount(
  amount: string,
  denom: string,
  chain: ChainInfo,
): string {
  const minimalDenom = getStakeMinimalDenom(chain);
  const isNative = denom === minimalDenom;
  const decimals = isNative ? getStakeDecimals(chain) : getTokenDecimals(denom);
  const displayDenom = isNative ? getStakeDenom(chain) : denom;

  return formatCurrencyAmount(amount, {
    decimals,
    symbol: displayDenom,
  });
}

/**
 * Select the best fee denomination based on user's balances.
 * If a specific feeDenom is provided and valid, use it.
 * Otherwise, find the first fee currency the user has sufficient balance for.
 * Falls back to the chain's default fee currency if no suitable balance found.
 *
 * For chains with dynamic fee tokens (e.g., Osmosis), fetches available tokens from chain.
 */
async function selectFeeDenom(
  client: CosmosClient,
  chain: ChainInfo,
  estimatedFeeAmount: bigint,
  preferredFeeDenom?: string,
  existingBalances?: BalanceResult[],
): Promise<{ feeDenom: string; gasPrice: string }> {
  // Get all available fee tokens (static + dynamic for chains like Osmosis)
  const allFeeTokens = await getAllFeeTokens(chain);

  // If a specific fee denom is requested, check if it's valid
  if (preferredFeeDenom) {
    const preferredToken = allFeeTokens.find(
      (fc) => fc.coinMinimalDenom === preferredFeeDenom,
    );
    if (preferredToken) {
      const price = preferredToken.gasPriceStep?.average ?? 0.025;
      return {
        feeDenom: preferredFeeDenom,
        gasPrice: `${price}${preferredFeeDenom}`,
      };
    }
    // Invalid fee denom requested, fall through to auto-selection
  }

  // Get user's balances (reuse pre-fetched if provided)
  const balances = existingBalances ?? (await client.getBalances(chain));

  // Find a fee currency the user has sufficient balance for
  for (const feeCurrency of allFeeTokens) {
    const balance = balances.find(
      (b) => b.denom === feeCurrency.coinMinimalDenom,
    );
    if (balance && BigInt(balance.amount) >= estimatedFeeAmount) {
      const price = feeCurrency.gasPriceStep?.average ?? 0.025;
      return {
        feeDenom: feeCurrency.coinMinimalDenom,
        gasPrice: `${price}${feeCurrency.coinMinimalDenom}`,
      };
    }
  }

  // Fall back to default (first) fee currency
  const defaultToken = allFeeTokens[0];
  if (defaultToken) {
    const price = defaultToken.gasPriceStep?.average ?? 0.025;
    return {
      feeDenom: defaultToken.coinMinimalDenom,
      gasPrice: `${price}${defaultToken.coinMinimalDenom}`,
    };
  }

  return { feeDenom: "", gasPrice: getGasPrice(chain) };
}

const GAS_RESERVE_MULTIPLIER = 3n;

/**
 * Detect when a transfer would leave insufficient gas tokens for future transactions.
 * Returns a warning + suggestedActions, or null if no risk detected.
 */
function generateGasExhaustionWarning(params: {
  sendAmount: bigint;
  sendDenom: string;
  sendDenomBalance: bigint;
  feeDenom: string;
  estimatedFee: bigint;
  feeDenomBalance: bigint;
  availableFeeTokens: string[];
  allBalances: Array<{ denom: string; amount: string }>;
  chain: ChainInfo;
}): {
  warning: TransactionWarning;
  suggestedActions: SuggestedAction[];
} | null {
  const {
    sendAmount,
    sendDenom,
    sendDenomBalance,
    feeDenom,
    estimatedFee,
    feeDenomBalance,
    availableFeeTokens,
    allBalances,
    chain,
  } = params;

  const reserveAmount = estimatedFee * GAS_RESERVE_MULTIPLIER;

  // Case 1: Sending the same denom used for fees
  if (sendDenom === feeDenom) {
    const remaining = sendDenomBalance - sendAmount - estimatedFee;
    if (remaining >= reserveAmount) {
      return null;
    }

    const suggestedActions: SuggestedAction[] = [];

    // Suggest a safe reduced amount
    const safeAmount = sendDenomBalance - estimatedFee - reserveAmount;
    if (safeAmount > 0n) {
      suggestedActions.push({
        tool: "send-tokens",
        reason: `Reduce amount to ${formatCosmosAmount(safeAmount.toString(), sendDenom, chain)} to reserve gas for future transactions`,
        params: { amount: safeAmount.toString(), denom: sendDenom },
        priority: 1,
      });
    }

    // Suggest an alternative fee denom if available
    for (const altDenom of availableFeeTokens) {
      if (altDenom === feeDenom) continue;
      const altBalance = allBalances.find((b) => b.denom === altDenom);
      if (altBalance && BigInt(altBalance.amount) > 0n) {
        suggestedActions.push({
          tool: "send-tokens",
          reason: `Pay fees in ${altDenom} instead to preserve full ${formatCosmosAmount(sendDenomBalance.toString(), sendDenom, chain)} balance`,
          params: { feeDenom: altDenom },
          priority: 2,
        });
        break;
      }
    }

    suggestedActions.push({
      tool: "get-balances",
      reason: "Check current balances before proceeding",
      params: { chain: chain.chainId },
      priority: 3,
    });

    const isCritical = remaining < 0n;
    return {
      warning: {
        level: isCritical ? "critical" : "warning",
        code: TransactionWarningCodes.GAS_TOKEN_EXHAUSTION,
        message: isCritical
          ? `This transaction will leave zero ${formatCosmosAmount("0", sendDenom, chain).split(" ").pop() ?? sendDenom} for future transaction fees. Subsequent transactions will fail.`
          : `After this transaction, remaining ${formatCosmosAmount(remaining.toString(), sendDenom, chain)} may not cover fees for future transactions (estimated ${formatCosmosAmount(reserveAmount.toString(), sendDenom, chain)} needed for ~${GAS_RESERVE_MULTIPLIER} transactions).`,
      },
      suggestedActions,
    };
  }

  // Case 2: Sending a different denom — check fee token balance independently
  const feeTokenRemaining = feeDenomBalance - estimatedFee;
  if (feeTokenRemaining >= reserveAmount) {
    return null;
  }

  const suggestedActions: SuggestedAction[] = [];

  for (const altDenom of availableFeeTokens) {
    if (altDenom === feeDenom) continue;
    const altBalance = allBalances.find((b) => b.denom === altDenom);
    if (altBalance && BigInt(altBalance.amount) > 0n) {
      suggestedActions.push({
        tool: "send-tokens",
        reason: `Pay fees in ${altDenom} instead`,
        params: { feeDenom: altDenom },
        priority: 1,
      });
      break;
    }
  }

  suggestedActions.push({
    tool: "get-balances",
    reason: "Check current balances before proceeding",
    params: { chain: chain.chainId },
    priority: 2,
  });

  const isCritical = feeTokenRemaining < 0n;
  return {
    warning: {
      level: isCritical ? "critical" : "warning",
      code: TransactionWarningCodes.GAS_TOKEN_EXHAUSTION,
      message: `Fee token balance is low. After paying this transaction's fee, remaining ${formatCosmosAmount(feeTokenRemaining > 0n ? feeTokenRemaining.toString() : "0", feeDenom, chain)} may not cover fees for future transactions.`,
    },
    suggestedActions,
  };
}

/**
 * Build a transaction preview with balance checks and warnings
 */
async function buildTransactionPreview(
  client: CosmosClient,
  chain: ChainInfo,
  messages: EncodeObject[],
  params: {
    to?: string;
    amount?: string;
    denom?: string;
    feeDenom?: string;
    isUndelegate?: boolean;
    balances?: BalanceResult[];
  },
): Promise<
  TransactionPreview & {
    selectedFeeDenom?: string;
    availableFeeTokens?: string[];
    gasExhaustionSuggestedActions?: SuggestedAction[];
  }
> {
  const address = await client.getAddress(chain);
  const txDenom = params.denom ?? getStakeMinimalDenom(chain);

  // Get current balance for the transaction denom (reuse pre-fetched if provided)
  const balances = params.balances ?? (await client.getBalances(chain));
  const currentBalance =
    balances.find((b) => b.denom === txDenom)?.amount ?? "0";

  let denomWarning: TransactionWarning | undefined;
  if (
    !balances.some((b) => b.denom === txDenom) &&
    balances.length > 0 &&
    params.denom
  ) {
    const msg =
      `Denom "${txDenom}" not found in ${balances.length} balances on ${chain.chainId}. ` +
      `Available: ${balances.map((b) => b.denom).join(", ")}`;
    console.warn(`[tx-preview] ${msg}`);
    denomWarning = {
      level: "warning",
      code: TransactionWarningCodes.DENOM_NOT_IN_BALANCES,
      message: msg,
    };
  }

  // Get available fee tokens for this chain (including dynamic ones for Osmosis, etc.)
  const allFeeTokens = await getAllFeeTokens(chain);
  const availableFeeTokens = allFeeTokens.map((fc) => fc.coinMinimalDenom);

  // Estimate fee - first get a rough estimate to help with fee token selection
  let feeEstimate = { feeAmount: "0", feeDenom: txDenom, gasEstimate: "0" };
  let feeEstimationMethod: FeeEstimationMethod = "simulated";
  let feeWarning: string | undefined;
  let selectedFeeDenom: string | undefined;

  try {
    // Get initial fee estimate (uses default fee denom)
    const initialEstimate = await client.simulateFee(chain, messages);

    // Select the best fee denom based on user preference and balances
    const feeSelection = await selectFeeDenom(
      client,
      chain,
      BigInt(initialEstimate.feeAmount),
      params.feeDenom,
      balances,
    );
    selectedFeeDenom = feeSelection.feeDenom;

    // Recalculate fee with selected denom if different
    if (selectedFeeDenom !== initialEstimate.feeDenom) {
      const parsedGasPrice = parseGasPrice(feeSelection.gasPrice);
      const gasEstimate = Number.parseInt(initialEstimate.gasEstimate, 10);
      feeEstimate = {
        gasEstimate: initialEstimate.gasEstimate,
        feeAmount: Math.ceil(
          gasEstimate * parsedGasPrice.amount * getGasAdjustment(chain),
        ).toString(),
        feeDenom: selectedFeeDenom,
      };
    } else {
      feeEstimate = initialEstimate;
    }
  } catch {
    // Fee estimation may fail if account doesn't exist on chain yet
    // Use a default estimate based on chain's gas price
    feeEstimationMethod = "fallback";
    feeWarning =
      "Gas estimation failed (account may not exist on-chain yet). Using conservative estimate (200k gas).";
    try {
      // Try to select a fee denom the user has balance for
      const defaultGas = 200000;
      const defaultFeeAmount = BigInt(
        Math.ceil(defaultGas * 0.1 * getGasAdjustment(chain)),
      );

      const feeSelection = await selectFeeDenom(
        client,
        chain,
        defaultFeeAmount,
        params.feeDenom,
        balances,
      );
      selectedFeeDenom = feeSelection.feeDenom;

      const parsedGasPrice = parseGasPrice(feeSelection.gasPrice);
      feeEstimate = {
        gasEstimate: defaultGas.toString(),
        feeAmount: Math.ceil(
          defaultGas * parsedGasPrice.amount * getGasAdjustment(chain),
        ).toString(),
        feeDenom: selectedFeeDenom,
      };
    } catch {
      // Keep default values if gas price parsing fails
      const parsedGasPrice = parseGasPrice(getGasPrice(chain));
      const defaultGas = 200000;
      feeEstimate = {
        gasEstimate: defaultGas.toString(),
        feeAmount: Math.ceil(
          defaultGas * parsedGasPrice.amount * getGasAdjustment(chain),
        ).toString(),
        feeDenom: parsedGasPrice.denom,
      };
      selectedFeeDenom = parsedGasPrice.denom;
    }
  }

  // Calculate balance after (if applicable)
  const txAmount = params.amount ? BigInt(params.amount) : 0n;
  const feeAmount = BigInt(feeEstimate.feeAmount);
  const balanceBigInt = BigInt(currentBalance);

  // Generate warnings
  let warnings: TransactionWarning[] = [];
  if (params.amount) {
    warnings = generateTransactionWarnings({
      amount: txAmount,
      balance: balanceBigInt,
      estimatedFee: feeAmount,
      isUndelegate: params.isUndelegate,
    });
  } else if (params.isUndelegate) {
    // For claim-rewards, still add unstaking warning if applicable
    warnings = generateTransactionWarnings({
      amount: 0n,
      balance: balanceBigInt,
      estimatedFee: feeAmount,
      isUndelegate: true,
    });
  }

  // Gas exhaustion guard
  let gasExhaustionSuggestedActions: SuggestedAction[] | undefined;
  if (params.amount) {
    const actualFeeDenom = selectedFeeDenom ?? feeEstimate.feeDenom;
    const feeDenomBalance =
      balances.find((b) => b.denom === actualFeeDenom)?.amount ?? "0";

    const exhaustionResult = generateGasExhaustionWarning({
      sendAmount: txAmount,
      sendDenom: txDenom,
      sendDenomBalance: balanceBigInt,
      feeDenom: actualFeeDenom,
      estimatedFee: feeAmount,
      feeDenomBalance: BigInt(feeDenomBalance),
      availableFeeTokens,
      allBalances: balances,
      chain,
    });

    if (exhaustionResult) {
      warnings.push(exhaustionResult.warning);
      gasExhaustionSuggestedActions = exhaustionResult.suggestedActions;
    }
  }

  // Build preview
  const preview: TransactionPreview = {
    from: address,
  };

  if (params.to) {
    preview.to = params.to;
  }

  if (params.amount) {
    preview.amount = {
      value: params.amount,
      denom: txDenom,
      formatted: formatCosmosAmount(params.amount, txDenom, chain),
    };

    // Calculate balance after
    const balanceAfter =
      balanceBigInt -
      txAmount -
      (feeEstimate.feeDenom === txDenom ? feeAmount : 0n);

    preview.balanceBefore = {
      value: currentBalance,
      denom: txDenom,
      formatted: formatCosmosAmount(currentBalance, txDenom, chain),
    };

    preview.balanceAfter = {
      value: balanceAfter > 0n ? balanceAfter.toString() : "0",
      denom: txDenom,
      formatted: formatCosmosAmount(
        balanceAfter > 0n ? balanceAfter.toString() : "0",
        txDenom,
        chain,
      ),
    };
  }

  preview.estimatedFee = {
    value: feeEstimate.feeAmount,
    denom: feeEstimate.feeDenom,
    formatted: formatCosmosAmount(
      feeEstimate.feeAmount,
      feeEstimate.feeDenom,
      chain,
    ),
  };

  // Add fee estimation method and warning
  preview.feeEstimationMethod = feeEstimationMethod;
  if (feeWarning) {
    preview.feeWarning = feeWarning;
  }

  if (denomWarning) {
    warnings.push(denomWarning);
  }
  if (warnings.length > 0) {
    preview.warnings = warnings;
  }

  return {
    ...preview,
    selectedFeeDenom,
    availableFeeTokens,
    gasExhaustionSuggestedActions,
  };
}

const transactionPlugin: KeplrPlugin = {
  name: "cosmos-transaction",
  register(server, store) {
    server.registerTool(
      "send-tokens",
      {
        description:
          "Send tokens to a recipient address on a specific chain. Supports human-readable amounts like '1 ATOM' or '1.5'. Returns transaction hash on success.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          recipientAddress: z
            .string()
            .min(1, "Recipient address cannot be empty")
            .refine((addr) => {
              try {
                fromBech32(addr);
                return true;
              } catch {
                return false;
              }
            }, "Invalid bech32 address format")
            .describe("Bech32 recipient address"),
          amount: z
            .string()
            .describe(
              "Amount to send. Supports: '1 ATOM', '1.5', or '1000000' (minimal denom)",
            ),
          denom: z
            .string()
            .optional()
            .describe(
              "Token denomination (optional, auto-detected from amount)",
            ),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        recipientAddress,
        amount: amountInput,
        denom,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          validateAddressForChain(recipientAddress, chain);

          // Parse human-readable amount
          const {
            amount,
            denom: sendDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);
          const summary = `Send ${displayAmount} to ${recipientAddress} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);

          // Self-send detection
          const selfSendWarnings: TransactionWarning[] = [];
          if (address === recipientAddress) {
            selfSendWarnings.push({
              level: "warning",
              code: "SELF_SEND",
              message:
                "Sender and recipient are the same address. You will pay gas fees but net balance remains unchanged.",
            });
          }

          const sendMsg: EncodeObject = {
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: address,
              toAddress: recipientAddress,
              amount: [coin(amount, sendDenom)],
            },
          };

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, [sendMsg], {
            to: recipientAddress,
            amount,
            denom: sendDenom,
            feeDenom,
          });

          // Add self-send warnings
          if (selfSendWarnings.length > 0) {
            preview.warnings = [
              ...(preview.warnings ?? []),
              ...selfSendWarnings,
            ];
          }

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.sendTokens(
                  chain,
                  recipientAddress,
                  amount,
                  sendDenom,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("send-tokens"),
              suggestedActions: preview.gasExhaustionSuggestedActions,
            },
          );
        } catch (error) {
          return handleTransactionError(error, "send-tokens", chainInput);
        }
      },
    );

    server.registerTool(
      "ibc-transfer",
      {
        description:
          "Transfer tokens to another chain via IBC (Inter-Blockchain Communication). Supports human-readable amounts. Source channel is auto-resolved via Skip API if omitted.",
        inputSchema: {
          chain: z
            .string()
            .describe(
              "Source chain ID or name (e.g., 'cosmoshub-4', 'osmosis')",
            ),
          recipientAddress: z
            .string()
            .min(1, "Recipient address cannot be empty")
            .refine((addr) => {
              try {
                fromBech32(addr);
                return true;
              } catch {
                return false;
              }
            }, "Invalid bech32 address format")
            .describe("Recipient address on the destination chain"),
          amount: z
            .string()
            .describe(
              "Amount to transfer. Supports: '10 ATOM', '10.5', or '10000000' (minimal denom)",
            ),
          denom: z
            .string()
            .describe(
              "Token denomination on the SOURCE chain (e.g., 'uatom' on cosmoshub-4, 'uosmo' on osmosis-1). Must be a denom that exists in your source chain balance. Do NOT use the destination chain's IBC hash.",
            ),
          sourcePort: z
            .enum(["transfer"])
            .default("transfer")
            .describe("IBC source port (must be 'transfer')"),
          destChain: z
            .string()
            .optional()
            .describe(
              "Destination chain ID or name. Required when the recipient address prefix is ambiguous (e.g., 'terra' matches both Terra and Terra Classic).",
            ),
          sourceChannel: z
            .string()
            .regex(
              /^channel-\d+$/,
              "sourceChannel must match format 'channel-<number>' (e.g., 'channel-0')",
            )
            .optional()
            .describe(
              "IBC source channel (e.g., 'channel-0'). If omitted, automatically resolved via Skip API.",
            ),
          timeoutMinutes: z
            .number()
            .default(10)
            .describe("Timeout in minutes (default: 10)"),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        recipientAddress,
        amount: amountInput,
        denom,
        destChain: destChainInput,
        sourcePort,
        sourceChannel,
        timeoutMinutes,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Resolve IBC channel
          let resolvedChannel: string;
          let resolvedPort: string;

          if (sourceChannel) {
            // Explicit channel: verify via LCD
            const channelStatus = await c.verifyIbcChannel(
              chain,
              sourceChannel,
              sourcePort,
            );
            if (!channelStatus.exists) {
              throw new Error(
                `IBC channel ${sourceChannel} does not exist on ${chain.chainId} for port ${sourcePort}. Use list-ibc-channels to find valid channels.`,
              );
            }
            if (channelStatus.state !== "STATE_OPEN") {
              throw new Error(
                `IBC channel ${sourceChannel} is not open (state: ${channelStatus.state}). Use list-ibc-channels to find active channels.`,
              );
            }
            resolvedChannel = sourceChannel;
            resolvedPort = sourcePort;
          } else {
            // Auto-resolve via Skip Route API
            let destChain: ChainInfo | undefined;
            if (destChainInput) {
              destChain = resolveChain(destChainInput);
            } else {
              const { prefix } = fromBech32(recipientAddress);
              destChain = findChainByBech32Prefix(prefix);
            }
            if (!destChain) {
              throw new Error(
                `Cannot determine destination chain. Provide destChain or sourceChannel explicitly.`,
              );
            }

            // Validate recipientAddress matches destChain's bech32 prefix
            const { prefix: addrPrefix } = fromBech32(recipientAddress);
            const expectedPrefix = getBech32Prefix(destChain);
            if (addrPrefix !== expectedPrefix) {
              throw new Error(
                `Recipient address prefix '${addrPrefix}' does not match destination chain ${destChain.chainId} (expected '${expectedPrefix}'). Check destChain or recipientAddress.`,
              );
            }

            try {
              const skipResult = await resolveIbcChannelViaSkip(
                chain.chainId,
                denom,
                destChain.chainId,
              );
              resolvedChannel = skipResult.sourceChannel;
              resolvedPort = skipResult.port;
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              throw new Error(`Failed to auto-resolve IBC channel: ${reason}`);
            }
          }

          // Parse human-readable amount (resolves display denom → minimal denom)
          const {
            amount,
            denom: resolvedDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);

          // Validate resolved denom exists on source chain.
          // Hard error here (vs. soft warning in buildTransactionPreview for send-tokens)
          // because IBC with an invalid denom risks permanent fund lock.
          const balances = await c.getBalances(chain);
          const denomExists = balances.some((b) => b.denom === resolvedDenom);
          if (!denomExists) {
            const availableDenoms = balances
              .map(
                (b) =>
                  `${b.denom}${b.displayDenom !== b.denom ? ` (${b.displayDenom})` : ""}`,
              )
              .join(", ");
            throw new Error(
              `Denom "${resolvedDenom}" not found on source chain ${chain.chainId}. ` +
                `The denom must exist on the source chain, not the destination chain. ` +
                `If you have an IBC hash from the destination chain, use the corresponding native or IBC denom on the source chain instead. ` +
                `Available denoms: ${availableDenoms || "(no balances)"}`,
            );
          }

          const summary = `IBC transfer ${displayAmount} to ${recipientAddress} via ${resolvedPort}/${resolvedChannel} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const timeoutTimestamp = BigInt(
            (Date.now() + timeoutMinutes * 60 * 1000) * 1_000_000,
          );
          const ibcMsg: EncodeObject = {
            typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
            value: {
              sourcePort: resolvedPort,
              sourceChannel: resolvedChannel,
              token: coin(amount, resolvedDenom),
              sender: address,
              receiver: recipientAddress,
              timeoutHeight: {
                revisionHeight: BigInt(0),
                revisionNumber: BigInt(0),
              },
              timeoutTimestamp,
              memo: "",
            },
          };

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, [ibcMsg], {
            to: recipientAddress,
            amount,
            denom: resolvedDenom,
            feeDenom,
            balances,
          });

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.ibcTransfer(
                  chain,
                  recipientAddress,
                  amount,
                  resolvedDenom,
                  resolvedPort,
                  resolvedChannel,
                  timeoutMinutes,
                ),
              tip: pickTip("ibc-transfer"),
              suggestedActions: preview.gasExhaustionSuggestedActions,
            },
          );
        } catch (error) {
          return handleTransactionError(error, "ibc-transfer", chainInput);
        }
      },
    );

    server.registerTool(
      "delegate",
      {
        description:
          "Delegate (stake) tokens to a validator on a specific chain. Supports human-readable amounts like '10 ATOM'.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          validatorAddress: z
            .string()
            .describe("Validator operator address (e.g., 'cosmosvaloper1...')"),
          amount: z
            .string()
            .describe(
              "Amount to delegate. Supports: '10 ATOM', '10.5', or '10000000' (minimal denom)",
            ),
          denom: z
            .string()
            .optional()
            .describe(
              "Token denomination (optional, auto-detected from amount)",
            ),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        validatorAddress,
        amount: amountInput,
        denom,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Parse human-readable amount
          const {
            amount,
            denom: stakeDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);
          const summary = `Delegate ${displayAmount} to ${validatorAddress} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const delegateMsg = wrapForBabylon(chain.chainId, {
            typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
            value: {
              delegatorAddress: address,
              validatorAddress,
              amount: coin(amount, stakeDenom),
            },
          } as EncodeObject);

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(
            c,
            chain,
            [delegateMsg],
            {
              to: validatorAddress,
              amount,
              denom: stakeDenom,
              feeDenom,
            },
          );

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.delegate(
                  chain,
                  validatorAddress,
                  amount,
                  stakeDenom,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("delegate"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "delegate", chainInput);
        }
      },
    );

    server.registerTool(
      "undelegate",
      {
        description:
          "Undelegate (unstake) tokens from a validator. Supports human-readable amounts. Note: unstaking has a chain-specific unbonding period (usually 21 days).",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          validatorAddress: z.string().describe("Validator operator address"),
          amount: z
            .string()
            .describe(
              "Amount to undelegate. Supports: '5 ATOM', '5.5', or '5000000' (minimal denom)",
            ),
          denom: z
            .string()
            .optional()
            .describe(
              "Token denomination (optional, auto-detected from amount)",
            ),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        validatorAddress,
        amount: amountInput,
        denom,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Parse human-readable amount
          const {
            amount,
            denom: stakeDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);
          const summary = `Undelegate ${displayAmount} from ${validatorAddress} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const undelegateMsg = wrapForBabylon(chain.chainId, {
            typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
            value: {
              delegatorAddress: address,
              validatorAddress,
              amount: coin(amount, stakeDenom),
            },
          } as EncodeObject);

          // Generate preview with unstaking warning and fee denom selection
          const preview = await buildTransactionPreview(
            c,
            chain,
            [undelegateMsg],
            {
              to: validatorAddress,
              amount,
              denom: stakeDenom,
              feeDenom,
              isUndelegate: true,
            },
          );

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.undelegate(
                  chain,
                  validatorAddress,
                  amount,
                  stakeDenom,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("undelegate"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "undelegate", chainInput);
        }
      },
    );

    server.registerTool(
      "redelegate",
      {
        description:
          "Redelegate (move) staked tokens from one validator to another without unbonding. This allows immediate transfer of delegation without the 21-day unbonding period.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          srcValidatorAddress: z
            .string()
            .describe(
              "Source validator operator address to redelegate FROM (e.g., 'cosmosvaloper1...')",
            ),
          dstValidatorAddress: z
            .string()
            .describe(
              "Destination validator operator address to redelegate TO (e.g., 'cosmosvaloper1...')",
            ),
          amount: z
            .string()
            .describe(
              "Amount to redelegate. Supports: '10 ATOM', '10.5', or '10000000' (minimal denom)",
            ),
          denom: z
            .string()
            .optional()
            .describe(
              "Token denomination (optional, auto-detected from amount)",
            ),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        srcValidatorAddress,
        dstValidatorAddress,
        amount: amountInput,
        denom,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Parse human-readable amount
          const {
            amount,
            denom: stakeDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);
          const summary = `Redelegate ${displayAmount} from ${srcValidatorAddress} to ${dstValidatorAddress} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const redelegateMsg = wrapForBabylon(chain.chainId, {
            typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
            value: {
              delegatorAddress: address,
              validatorSrcAddress: srcValidatorAddress,
              validatorDstAddress: dstValidatorAddress,
              amount: coin(amount, stakeDenom),
            },
          } as EncodeObject);

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(
            c,
            chain,
            [redelegateMsg],
            {
              to: dstValidatorAddress,
              amount,
              denom: stakeDenom,
              feeDenom,
            },
          );

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.redelegate(
                  chain,
                  srcValidatorAddress,
                  dstValidatorAddress,
                  amount,
                  stakeDenom,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("redelegate"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "redelegate", chainInput);
        }
      },
    );

    server.registerTool(
      "cancel-unbonding",
      {
        description:
          "Cancel an unbonding delegation and return tokens to staked state. Requires Cosmos SDK v0.46+. Use get-unbonding to find unbonding entries with their creation heights.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          validatorAddress: z
            .string()
            .describe("Validator operator address (e.g., 'cosmosvaloper1...')"),
          amount: z
            .string()
            .describe(
              "Amount to cancel unbonding. Supports: '10 ATOM', '10.5', or '10000000' (minimal denom)",
            ),
          creationHeight: z
            .string()
            .describe(
              "Creation height of the unbonding entry (from get-unbonding output)",
            ),
          denom: z
            .string()
            .optional()
            .describe("Token denomination (optional, defaults to stake denom)"),
          feeDenom: z.string().optional().describe("Fee token denomination"),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({
        chain: chainInput,
        validatorAddress,
        amount: amountInput,
        creationHeight,
        denom,
        feeDenom,
      }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Parse human-readable amount
          const {
            amount,
            denom: stakeDenom,
            displayAmount,
          } = await parseAmount(amountInput, chain, denom);
          const summary = `Cancel unbonding ${displayAmount} from ${validatorAddress.slice(0, 20)}... on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const cancelMsg = wrapForBabylon(chain.chainId, {
            typeUrl: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
            value: {
              delegatorAddress: address,
              validatorAddress,
              amount: coin(amount, stakeDenom),
              creationHeight: BigInt(creationHeight),
            },
          } as EncodeObject);

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, [cancelMsg], {
            amount,
            denom: stakeDenom,
            feeDenom,
          });

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.cancelUnbonding(
                  chain,
                  validatorAddress,
                  amount,
                  creationHeight,
                  stakeDenom,
                  preview.selectedFeeDenom,
                ),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "cancel-unbonding", chainInput);
        }
      },
    );

    server.registerTool(
      "claim-rewards",
      {
        description: "Claim staking rewards from a specific validator",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          validatorAddress: z
            .string()
            .describe("Validator operator address to claim rewards from"),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ chain: chainInput, validatorAddress, feeDenom }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const summary = `Claim staking rewards from ${validatorAddress} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const claimMsg: EncodeObject = {
            typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
            value: {
              delegatorAddress: address,
              validatorAddress,
            },
          };

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, [claimMsg], {
            to: validatorAddress,
            feeDenom,
          });

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.claimRewards(
                  chain,
                  validatorAddress,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("claim-rewards"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "claim-rewards", chainInput);
        }
      },
    );

    server.registerTool(
      "claim-all-rewards",
      {
        description:
          "Claim staking rewards from all validators at once. This batches multiple claim transactions into a single transaction for efficiency.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ chain: chainInput, feeDenom }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);

          // Get all delegations to find validators with potential rewards
          const delegations = await c.getDelegations(chain);

          if (delegations.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "no_delegations",
                      message:
                        "No delegations found. You need to delegate tokens before you can claim rewards.",
                      suggestedActions: [
                        {
                          tool: "delegate",
                          reason: "Stake tokens to start earning rewards",
                          params: { chain: chain.chainId },
                          priority: 1,
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Get rewards to check if there are any to claim
          const rewards = await c.getRewards(chain);
          const validatorsWithRewards = rewards
            .filter((r) =>
              r.rewards?.some((coin) => BigInt(coin.amount.split(".")[0]) > 0),
            )
            .map((r) => r.validatorAddress);

          if (validatorsWithRewards.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "no_rewards",
                      message: "No pending rewards to claim.",
                      delegations: delegations.length,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const summary = `Claim rewards from ${validatorsWithRewards.length} validator(s) on ${chain.chainId}`;

          // Build messages for all validators with rewards
          const address = await c.getAddress(chain);
          const claimMsgs: EncodeObject[] = validatorsWithRewards.map(
            (validatorAddress) => ({
              typeUrl:
                "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
              value: {
                delegatorAddress: address,
                validatorAddress,
              },
            }),
          );

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, claimMsgs, {
            feeDenom,
          });

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.claimAllRewards(
                  chain,
                  validatorsWithRewards,
                  preview.selectedFeeDenom,
                ),
              tip: pickTip("claim-all-rewards"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "claim-all-rewards", chainInput);
        }
      },
    );

    server.registerTool(
      "vote-governance",
      {
        description: "Vote on a governance proposal",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          proposalId: z.string().describe("Proposal ID to vote on"),
          option: z
            .enum(["yes", "no", "abstain", "no_with_veto"])
            .describe("Vote option"),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination. If not specified, auto-selects from available balance.",
            ),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ chain: chainInput, proposalId, option, feeDenom }) => {
        try {
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(chainInput);
          const summary = `Vote "${option}" on proposal #${proposalId} on ${chain.chainId}`;

          // Build message for simulation
          const address = await c.getAddress(chain);
          const voteOptionMap: Record<string, number> = {
            yes: 1,
            abstain: 2,
            no: 3,
            no_with_veto: 4,
          };
          const voteMsg: EncodeObject = {
            typeUrl: "/cosmos.gov.v1beta1.MsgVote",
            value: {
              proposalId: BigInt(proposalId),
              voter: address,
              option: voteOptionMap[option],
            },
          };

          // Generate preview with fee denom selection
          const preview = await buildTransactionPreview(c, chain, [voteMsg], {
            feeDenom,
          });

          // Handle transaction with elicitation support
          return await handleTransactionWithElicitation(
            { server: server.server, store },
            {
              summary,
              chain,
              preview,
              execute: () =>
                c.vote(chain, proposalId, option, preview.selectedFeeDenom),
              tip: pickTip("vote-governance"),
            },
          );
        } catch (error) {
          return handleTransactionError(error, "vote-governance", chainInput);
        }
      },
    );
  },
};

export default transactionPlugin;

import { fromBech32 } from "@cosmjs/encoding";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { coin } from "@cosmjs/stargate";
import type { ChainInfo } from "@keplr-wallet/types";
import { z } from "zod";
import { getStakeMinimalDenom } from "../../chains/cosmos.js";
import type { CosmosClient } from "../../clients/cosmos.js";
import {
  classifyError,
  createSetupRequiredResponse,
  formatClassifiedError,
  isSetupRequiredError,
  type SuggestedAction,
} from "../../errors.js";
import { storePending } from "../../pending-action.js";
import {
  type ActionItem,
  formatTimeRemaining,
  getTtlInfo,
} from "../../store.js";
import { validateAddressForChain } from "../../utils/address-validation.js";
import { wrapForBabylon } from "../../utils/babylon.js";
import {
  formatIbcTransferSummary,
  preloadIbcChannels,
} from "../../utils/ibc-resolver.js";
import { CHAIN_PARAM_DESC, resolveChain } from "../shared.js";
import type { KeplrPlugin } from "../types.js";

/**
 * Supported Cosmos action types for multi-action transactions
 */
const COSMOS_ACTION_TYPES = [
  "send",
  "delegate",
  "undelegate",
  "redelegate",
  "cancel-unbonding",
  "claim-rewards",
  "vote",
  "ibc-transfer",
  "cosmwasm-execute",
] as const;

type CosmosActionType = (typeof COSMOS_ACTION_TYPES)[number];

/**
 * Maximum number of actions allowed in a single multi-action transaction.
 * Prevents gas simulation timeouts and tx size limits.
 */
const MAX_ACTIONS = 30;

/**
 * Action types that grant permissions or delegate authority to other addresses.
 * Multi-action-add and multi-action-preview emit warnings when these are present.
 */
const HIGH_RISK_ACTION_TYPES: ReadonlySet<CosmosActionType> =
  new Set<CosmosActionType>();

/**
 * Human-readable warning messages for high-risk action types.
 */
const HIGH_RISK_WARNINGS: Partial<Record<CosmosActionType, string>> = {};

/**
 * Simulation result for gas savings display
 */
interface SimulationResult {
  gasEstimate: string;
  gasEstimateIndividual?: string;
  gasSavings?: string;
}

/**
 * Build JSON response for multi-action tools
 */
function buildMultiActionResponse(data: {
  actionId?: string;
  chain?: string;
  ecosystem?: string;
  actionCount?: number;
  actions?: Array<{ index: number; type: string; summary: string }>;
  message?: string;
  expiresIn?: string;
  suggestedActions?: SuggestedAction[];
  confirmationToken?: string;
  transactionHash?: string;
  gasUsed?: string;
  status?: string;
  warnings?: Array<{ level: string; message: string }>;
  simulation?: SimulationResult;
  /** Set true to mark this as an MCP-level error (isError flag in protocol) */
  isError?: true;
}) {
  const response: Record<string, unknown> = {};

  if (data.status) response.status = data.status;
  if (data.actionId) response.actionId = data.actionId;
  if (data.chain) response.chain = data.chain;
  if (data.ecosystem) response.ecosystem = data.ecosystem;
  if (data.actionCount !== undefined) response.actionCount = data.actionCount;
  if (data.actions) response.actions = data.actions;
  if (data.message) response.message = data.message;
  if (data.expiresIn) response.expiresIn = data.expiresIn;
  if (data.warnings && data.warnings.length > 0)
    response.warnings = data.warnings;
  if (data.simulation) response.simulation = data.simulation;
  if (data.confirmationToken) {
    const ttlInfo = getTtlInfo();
    response.confirmationToken = data.confirmationToken;
    response.expiresIn = ttlInfo.expiresIn;
    response.expiresAt = ttlInfo.expiresAt;
    response.ttlWarning = ttlInfo.ttlWarning;
    response.instruction =
      "Call confirm-action with this token to execute all actions.";
  }
  if (data.transactionHash) response.transactionHash = data.transactionHash;
  if (data.gasUsed) response.gasUsed = data.gasUsed;
  if (data.suggestedActions && data.suggestedActions.length > 0) {
    response.suggestedActions = data.suggestedActions;
  }

  const result: {
    content: Array<{ type: "text"; text: string }>;
    isError?: true;
  } = {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };

  if (data.isError) {
    result.isError = true;
  }

  return result;
}

/**
 * Handle multi-action errors with classification
 */
function handleMultiActionError(
  error: unknown,
  toolName: string,
): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const errorObj = error instanceof Error ? error : new Error(String(error));

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

  const classified = classifyError(errorObj);
  const formatted = formatClassifiedError(classified);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(formatted, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Generate human-readable summary for an action
 */
function generateActionSummary(action: ActionItem, chain: ChainInfo): string {
  const { type, params, label } = action;

  if (label) return label;

  switch (type) {
    case "send": {
      const amount = params.amount as string;
      const to = params.recipientAddress as string;
      return `Send ${amount} to ${to?.slice(0, 12)}...`;
    }
    case "delegate": {
      const amount = params.amount as string;
      const validator = params.validatorAddress as string;
      return `Delegate ${amount} to ${validator?.slice(0, 16)}...`;
    }
    case "undelegate": {
      const amount = params.amount as string;
      const validator = params.validatorAddress as string;
      return `Undelegate ${amount} from ${validator?.slice(0, 16)}...`;
    }
    case "redelegate": {
      const amount = params.amount as string;
      return `Redelegate ${amount}`;
    }
    case "claim-rewards": {
      const validator = params.validatorAddress as string;
      return validator
        ? `Claim rewards from ${validator.slice(0, 16)}...`
        : "Claim all rewards";
    }
    case "vote": {
      const proposalId = params.proposalId as string;
      const option = params.option as string;
      return `Vote ${option} on proposal #${proposalId}`;
    }
    case "ibc-transfer": {
      const amount = params.amount as string;
      const channel = params.sourceChannel as string;
      // Use IBC resolver for human-readable destination chain name
      return formatIbcTransferSummary(amount, channel, chain.chainId);
    }
    case "cosmwasm-execute": {
      const contract = params.contractAddress as string;
      return `Execute contract ${contract?.slice(0, 12)}...`;
    }
    default:
      return `${type} action`;
  }
}

/**
 * Convert an ActionItem to an EncodeObject for Cosmos transactions
 */
async function actionToEncodeObject(
  action: ActionItem,
  chain: ChainInfo,
  address: string,
): Promise<EncodeObject> {
  const { type, params } = action;
  const stakeDenom = getStakeMinimalDenom(chain);

  const validateAmount = (amount: unknown, actionType: string): string => {
    const s = amount as string;
    if (!s || !/^\d+$/.test(s)) {
      throw new Error(
        `Invalid ${actionType} amount: "${s}". Must be a positive integer (minimal denom units).`,
      );
    }
    return s;
  };

  switch (type) {
    case "send": {
      const amount = validateAmount(params.amount, "send");
      const denom = (params.denom as string) || stakeDenom;
      const recipientAddress = params.recipientAddress as string;

      try {
        fromBech32(recipientAddress);
      } catch {
        throw new Error(
          `Invalid recipientAddress "${recipientAddress}": must be a valid bech32 address`,
        );
      }
      validateAddressForChain(recipientAddress, chain);

      return {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          fromAddress: address,
          toAddress: recipientAddress,
          amount: [coin(amount, denom)],
        },
      };
    }

    case "delegate": {
      const amount = validateAmount(params.amount, "delegate");
      const denom = (params.denom as string) || stakeDenom;
      return wrapForBabylon(chain.chainId, {
        typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
        value: {
          delegatorAddress: address,
          validatorAddress: params.validatorAddress as string,
          amount: coin(amount, denom),
        },
      });
    }

    case "undelegate": {
      const amount = validateAmount(params.amount, "undelegate");
      const denom = (params.denom as string) || stakeDenom;
      return wrapForBabylon(chain.chainId, {
        typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
        value: {
          delegatorAddress: address,
          validatorAddress: params.validatorAddress as string,
          amount: coin(amount, denom),
        },
      });
    }

    case "redelegate": {
      const amount = validateAmount(params.amount, "redelegate");
      const denom = (params.denom as string) || stakeDenom;
      return wrapForBabylon(chain.chainId, {
        typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
        value: {
          delegatorAddress: address,
          validatorSrcAddress: params.srcValidatorAddress as string,
          validatorDstAddress: params.dstValidatorAddress as string,
          amount: coin(amount, denom),
        },
      });
    }

    case "cancel-unbonding": {
      const amount = validateAmount(params.amount, "cancel-unbonding");
      const denom = (params.denom as string) || stakeDenom;
      return wrapForBabylon(chain.chainId, {
        typeUrl: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
        value: {
          delegatorAddress: address,
          validatorAddress: params.validatorAddress as string,
          amount: coin(amount, denom),
          creationHeight: BigInt(params.creationHeight as string),
        },
      });
    }

    case "claim-rewards": {
      return {
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        value: {
          delegatorAddress: address,
          validatorAddress: params.validatorAddress as string,
        },
      };
    }

    case "vote": {
      const voteOptionMap: Record<string, number> = {
        yes: 1,
        abstain: 2,
        no: 3,
        no_with_veto: 4,
      };
      const option = params.option as string;
      const voteOption = voteOptionMap[option];
      if (voteOption === undefined) {
        throw new Error(
          `Invalid vote option: "${option}". Valid options: ${Object.keys(voteOptionMap).join(", ")}`,
        );
      }
      return {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
          proposalId: BigInt(params.proposalId as string),
          voter: address,
          option: voteOption,
        },
      };
    }

    case "ibc-transfer": {
      const amount = validateAmount(params.amount, "ibc-transfer");
      const denom = params.denom as string;
      const sourceChannel = params.sourceChannel as string;
      const sourcePort = (params.sourcePort as string) || "transfer";
      const recipientAddress = params.recipientAddress as string;

      // Validate recipientAddress bech32 format
      try {
        fromBech32(recipientAddress);
      } catch {
        throw new Error(
          `Invalid recipientAddress "${recipientAddress}": must be a valid bech32 address`,
        );
      }

      // Validate sourceChannel format
      if (!/^channel-\d+$/.test(sourceChannel)) {
        throw new Error(
          `Invalid sourceChannel "${sourceChannel}": must match format 'channel-<number>' (e.g., 'channel-0')`,
        );
      }
      // Validate sourcePort
      if (sourcePort !== "transfer") {
        throw new Error(
          `Invalid sourcePort "${sourcePort}": must be 'transfer'`,
        );
      }

      const timeoutMinutes = (params.timeoutMinutes as number) || 10;
      const timeoutTimestamp = BigInt(
        (Date.now() + timeoutMinutes * 60 * 1000) * 1_000_000,
      );
      return {
        typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
        value: {
          sourcePort,
          sourceChannel,
          token: coin(amount, denom),
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
    }

    case "cosmwasm-execute": {
      let executeMsg: unknown;
      try {
        executeMsg = JSON.parse(params.executeMsg as string);
      } catch {
        throw new Error(
          `Invalid JSON in executeMsg: ${(params.executeMsg as string).slice(0, 100)}`,
        );
      }
      let funds: { denom: string; amount: string }[] = [];
      if (params.funds) {
        try {
          funds = JSON.parse(params.funds as string);
        } catch {
          throw new Error(
            `Invalid JSON in funds: ${(params.funds as string).slice(0, 100)}`,
          );
        }
      }

      return {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: {
          sender: address,
          contract: params.contractAddress as string,
          msg: Buffer.from(JSON.stringify(executeMsg)),
          funds,
        },
      };
    }

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

const multiActionPlugin: KeplrPlugin = {
  name: "cosmos-multi-action",
  register(server, store) {
    // --- multi-action-create ---
    server.registerTool(
      "multi-action-create",
      {
        description:
          "Start a new multi-action transaction to combine multiple operations into a single transaction. " +
          "This saves on gas fees and ensures all operations succeed or fail together (atomic).",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const chain = resolveChain(chainInput);
          const actionId = store.createMultiAction(chain.chainId, "cosmos");

          return buildMultiActionResponse({
            status: "created",
            actionId,
            chain: chain.chainId,
            ecosystem: "cosmos",
            actionCount: 0,
            message:
              "Multi-action created. Add your actions using multi-action-add.",
            suggestedActions: [
              {
                tool: "multi-action-add",
                reason: "Add an action to this multi-action",
                params: { actionId },
                priority: 1,
              },
            ],
          });
        } catch (error) {
          return handleMultiActionError(error, "multi-action-create");
        }
      },
    );

    // --- multi-action-add ---
    server.registerTool(
      "multi-action-add",
      {
        description:
          "Add an action to your multi-action transaction. Supported actions: " +
          COSMOS_ACTION_TYPES.join(", "),
        inputSchema: {
          actionId: z
            .string()
            .describe("The multi-action ID from multi-action-create"),
          type: z.enum(COSMOS_ACTION_TYPES).describe("Type of action to add"),
          params: z
            .record(z.unknown())
            .describe(
              "Action parameters (varies by type). For 'send': {recipientAddress, amount, denom?}. " +
                "For 'delegate': {validatorAddress, amount, denom?}. " +
                "For 'claim-rewards': {validatorAddress}. etc.",
            ),
          label: z
            .string()
            .optional()
            .describe("Optional human-readable label for this action"),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({ actionId, type, params, label }) => {
        try {
          const multiAction = store.getMultiAction(actionId);
          if (!multiAction) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              message: `Multi-action "${actionId}" not found or expired. Create a new one with multi-action-create.`,
              suggestedActions: [
                {
                  tool: "multi-action-create",
                  reason: "Create a new multi-action",
                  priority: 1,
                },
              ],
            });
          }

          if (multiAction.previewed) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              actionId,
              message:
                "Session is locked after preview. Cancel and recreate, or execute as previewed.",
              suggestedActions: [
                {
                  tool: "multi-action-execute",
                  reason: "Execute the previewed multi-action",
                  params: { actionId },
                  priority: 1,
                },
                {
                  tool: "multi-action-cancel",
                  reason: "Cancel and recreate with different actions",
                  params: { actionId },
                  priority: 2,
                },
              ],
            });
          }

          const chain = resolveChain(multiAction.chain);

          if (multiAction.actions.length >= MAX_ACTIONS) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              actionId,
              message: `Cannot add more actions. Maximum of ${MAX_ACTIONS} actions per multi-action transaction.`,
              suggestedActions: [
                {
                  tool: "multi-action-preview",
                  reason: "Preview and execute current actions",
                  params: { actionId },
                  priority: 1,
                },
              ],
            });
          }

          const action: ActionItem = {
            type,
            params: params as Record<string, unknown>,
            label,
          };

          store.addMultiAction(actionId, action);

          const updatedMultiAction = store.getMultiAction(actionId)!;
          const actions = updatedMultiAction.actions.map((a, i) => ({
            index: i,
            type: a.type,
            summary: generateActionSummary(a, chain),
          }));

          // Emit warnings for high-risk action types
          const warnings: Array<{ level: string; message: string }> = [];
          if (HIGH_RISK_ACTION_TYPES.has(type)) {
            warnings.push({
              level: "high",
              message:
                HIGH_RISK_WARNINGS[type] ?? `${type} is a high-risk action.`,
            });
          }

          return buildMultiActionResponse({
            status: "action_added",
            actionId,
            chain: multiAction.chain,
            actionCount: updatedMultiAction.actions.length,
            actions,
            warnings,
            expiresIn: formatTimeRemaining(updatedMultiAction.expiresAt),
            message: `Action added. ${updatedMultiAction.actions.length} action(s) in this multi-action.`,
            suggestedActions: [
              {
                tool: "multi-action-add",
                reason: "Add another action",
                params: { actionId },
                priority: 1,
              },
              {
                tool: "multi-action-preview",
                reason: "Preview and simulate the multi-action",
                params: { actionId },
                priority: 2,
              },
            ],
          });
        } catch (error) {
          return handleMultiActionError(error, "multi-action-add");
        }
      },
    );

    // --- multi-action-remove ---
    server.registerTool(
      "multi-action-remove",
      {
        description:
          "Remove an action from your multi-action transaction by index",
        inputSchema: {
          actionId: z.string().describe("The multi-action ID"),
          index: z.number().describe("Index of the action to remove (0-based)"),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({ actionId, index }) => {
        try {
          const multiAction = store.getMultiAction(actionId);
          if (!multiAction) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              message: `Multi-action "${actionId}" not found or expired.`,
            });
          }

          if (multiAction.previewed) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              actionId,
              message:
                "Session is locked after preview. Cancel and recreate, or execute as previewed.",
              suggestedActions: [
                {
                  tool: "multi-action-execute",
                  reason: "Execute the previewed multi-action",
                  params: { actionId },
                  priority: 1,
                },
                {
                  tool: "multi-action-cancel",
                  reason: "Cancel and recreate with different actions",
                  params: { actionId },
                  priority: 2,
                },
              ],
            });
          }

          const chain = resolveChain(multiAction.chain);
          store.removeMultiAction(actionId, index);

          const updatedMultiAction = store.getMultiAction(actionId)!;
          const actions = updatedMultiAction.actions.map((a, i) => ({
            index: i,
            type: a.type,
            summary: generateActionSummary(a, chain),
          }));

          return buildMultiActionResponse({
            status: "action_removed",
            actionId,
            chain: multiAction.chain,
            actionCount: updatedMultiAction.actions.length,
            actions,
            message: `Action at index ${index} removed.`,
          });
        } catch (error) {
          return handleMultiActionError(error, "multi-action-remove");
        }
      },
    );

    // --- multi-action-preview ---
    server.registerTool(
      "multi-action-preview",
      {
        description:
          "Preview and simulate your multi-action transaction before execution. " +
          "Shows estimated gas, fee, and balance changes.",
        inputSchema: {
          actionId: z.string().describe("The multi-action ID"),
          feeDenom: z
            .string()
            .optional()
            .describe(
              "Fee token denomination (optional, auto-selects if not specified)",
            ),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({ actionId, feeDenom }) => {
        try {
          const multiAction = store.getMultiAction(actionId);
          if (!multiAction) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              message: `Multi-action "${actionId}" not found or expired.`,
            });
          }

          if (multiAction.actions.length === 0) {
            return buildMultiActionResponse({
              status: "empty",
              isError: true,
              actionId,
              message: "No actions in this multi-action. Add actions first.",
              suggestedActions: [
                {
                  tool: "multi-action-add",
                  reason: "Add an action",
                  params: { actionId },
                  priority: 1,
                },
              ],
            });
          }

          // Lock the session immediately on preview entry.
          // Even if simulation fails, the session stays locked to prevent
          // TOCTOU attacks where an attacker intentionally causes simulation
          // failure to bypass the lock. Users can cancel and recreate if needed.
          store.markPreviewed(actionId);

          try {
            const c = await store.getClientFor<CosmosClient>("cosmos");
            const chain = resolveChain(multiAction.chain);
            const address = await c.getAddress(chain);

            // Preload IBC channel mappings for better action summaries
            const ibcChannels = multiAction.actions
              .filter((a) => a.type === "ibc-transfer")
              .map((a) => a.params.sourceChannel as string)
              .filter(Boolean);
            if (ibcChannels.length > 0) {
              await preloadIbcChannels(c, chain, ibcChannels);
            }

            // Convert all actions to EncodeObjects
            const messages: EncodeObject[] = [];
            for (const action of multiAction.actions) {
              const msg = await actionToEncodeObject(action, chain, address);
              messages.push(msg);
            }

            // Simulate to get gas estimate with savings calculation
            const simulation = await c.simulateMultiActionWithSavings(
              chain,
              messages,
            );

            // Build action summaries
            const actions = multiAction.actions.map((a, i) => ({
              index: i,
              type: a.type,
              summary: generateActionSummary(a, chain),
            }));

            // Build simulation result for response
            const simulationResult: SimulationResult = {
              gasEstimate: simulation.gasEstimate,
            };
            if (simulation.gasEstimateIndividual) {
              simulationResult.gasEstimateIndividual =
                simulation.gasEstimateIndividual;
            }
            if (simulation.gasSavingsPercent) {
              simulationResult.gasSavings = `~${simulation.gasSavingsPercent}%`;
            }

            // Collect high-risk warnings (deduplicated by action type)
            const warnings: Array<{ level: string; message: string }> = [];
            const warnedTypes = new Set<CosmosActionType>();
            for (const action of multiAction.actions) {
              const actionType = action.type as CosmosActionType;
              if (
                HIGH_RISK_ACTION_TYPES.has(actionType) &&
                !warnedTypes.has(actionType)
              ) {
                warnedTypes.add(actionType);
                warnings.push({
                  level: "high",
                  message:
                    HIGH_RISK_WARNINGS[actionType] ??
                    `${actionType} is a high-risk action.`,
                });
              }
            }

            // Build message with savings info
            let message = `Multi-action preview. Estimated gas: ${simulation.gasEstimate}`;
            if (
              simulation.gasSavingsPercent &&
              simulation.gasSavingsPercent > 0
            ) {
              message += ` (save ~${simulation.gasSavingsPercent}% vs individual transactions)`;
            }
            message +=
              ". Session is now locked — no further modifications allowed.";

            return buildMultiActionResponse({
              status: "preview",
              actionId,
              chain: multiAction.chain,
              actionCount: multiAction.actions.length,
              actions,
              warnings,
              simulation: simulationResult,
              expiresIn: formatTimeRemaining(multiAction.expiresAt),
              message,
              suggestedActions: [
                {
                  tool: "multi-action-execute",
                  reason: "Execute all actions",
                  params: { actionId, feeDenom },
                  priority: 1,
                },
                {
                  tool: "multi-action-cancel",
                  reason: "Cancel this multi-action",
                  params: { actionId },
                  priority: 3,
                },
              ],
            });
          } catch (simError) {
            const errorObj =
              simError instanceof Error
                ? simError
                : new Error(String(simError));

            // Setup-required errors (e.g. no mnemonic) must reach outer catch
            // where handleMultiActionError provides proper setup guidance.
            if (isSetupRequiredError(errorObj.message)) {
              throw simError;
            }

            const classified = classifyError(errorObj);
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              actionId,
              message: `Preview simulation failed: ${classified.message}. Session is now locked — use multi-action-cancel to discard and recreate.`,
              suggestedActions: [
                {
                  tool: "multi-action-cancel",
                  reason: "Cancel and recreate with different actions",
                  params: { actionId },
                  priority: 1,
                },
              ],
            });
          }
        } catch (error) {
          return handleMultiActionError(error, "multi-action-preview");
        }
      },
    );

    // --- multi-action-execute ---
    server.registerTool(
      "multi-action-execute",
      {
        description:
          "Execute all actions in your multi-action transaction. " +
          "Returns a confirmation token that must be confirmed with confirm-action.",
        inputSchema: {
          actionId: z.string().describe("The multi-action ID"),
          feeDenom: z
            .string()
            .optional()
            .describe("Fee token denomination (optional)"),
        },
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ actionId, feeDenom }) => {
        try {
          const multiAction = store.getMultiAction(actionId);
          if (!multiAction) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              message: `Multi-action "${actionId}" not found or expired.`,
            });
          }

          if (!multiAction.previewed) {
            return buildMultiActionResponse({
              status: "error",
              isError: true,
              actionId,
              message:
                "Preview is required before execution. Call multi-action-preview first.",
              suggestedActions: [
                {
                  tool: "multi-action-preview",
                  reason: "Preview and lock the multi-action before execution",
                  params: { actionId },
                  priority: 1,
                },
              ],
            });
          }

          if (multiAction.actions.length === 0) {
            return buildMultiActionResponse({
              status: "empty",
              isError: true,
              actionId,
              message: "No actions in this multi-action. Add actions first.",
            });
          }

          const c = await store.getClientFor<CosmosClient>("cosmos");
          const chain = resolveChain(multiAction.chain);
          const address = await c.getAddress(chain);

          // Preload IBC channel mappings for better action summaries
          const ibcChannels = multiAction.actions
            .filter((a) => a.type === "ibc-transfer")
            .map((a) => a.params.sourceChannel as string)
            .filter(Boolean);
          if (ibcChannels.length > 0) {
            await preloadIbcChannels(c, chain, ibcChannels);
          }

          // Convert all actions to EncodeObjects
          const messages: EncodeObject[] = [];
          for (const action of multiAction.actions) {
            const msg = await actionToEncodeObject(action, chain, address);
            messages.push(msg);
          }

          // Build summary
          const actionSummaries = multiAction.actions.map((a) =>
            generateActionSummary(a, chain),
          );
          const summary = `Multi-action on ${chain.chainId}: ${actionSummaries.join(", ")}`;

          // Store pending transaction
          const elicitationSummary = [
            summary,
            `\nActions (${multiAction.actions.length}):`,
            ...actionSummaries.map((s, i) => `  ${i + 1}. ${s}`),
          ].join("\n");
          const confirmationToken = storePending(
            summary,
            chain.chainId,
            async () => {
              const result = await c.executeMultiAction(
                chain,
                messages,
                feeDenom,
              );
              // Clear the multi-action after successful execution
              store.clearMultiAction(actionId);
              return result;
            },
            undefined,
            elicitationSummary,
          );

          const actions = multiAction.actions.map((a, i) => ({
            index: i,
            type: a.type,
            summary: generateActionSummary(a, chain),
          }));

          return buildMultiActionResponse({
            status: "pending_confirmation",
            actionId,
            chain: multiAction.chain,
            actionCount: multiAction.actions.length,
            actions,
            confirmationToken,
            message:
              "Multi-action ready for execution. Confirm with confirm-action.",
          });
        } catch (error) {
          return handleMultiActionError(error, "multi-action-execute");
        }
      },
    );

    // --- multi-action-cancel ---
    server.registerTool(
      "multi-action-cancel",
      {
        description: "Cancel and discard a multi-action transaction",
        inputSchema: {
          actionId: z.string().describe("The multi-action ID to cancel"),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({ actionId }) => {
        try {
          const multiAction = store.getMultiAction(actionId);
          if (!multiAction) {
            return buildMultiActionResponse({
              status: "not_found",
              isError: true,
              message: `Multi-action "${actionId}" not found or already expired.`,
            });
          }

          store.clearMultiAction(actionId);

          return buildMultiActionResponse({
            status: "cancelled",
            actionId,
            message: "Multi-action cancelled and discarded.",
            suggestedActions: [
              {
                tool: "multi-action-create",
                reason: "Create a new multi-action",
                priority: 1,
              },
            ],
          });
        } catch (error) {
          return handleMultiActionError(error, "multi-action-cancel");
        }
      },
    );

    // --- multi-action-list ---
    server.registerTool(
      "multi-action-list",
      {
        description: "List all pending multi-action transactions",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
        },
      },
      async () => {
        try {
          const multiActions = store.getAllMultiActions();

          if (multiActions.length === 0) {
            return buildMultiActionResponse({
              status: "empty",
              message: "No pending multi-actions.",
              suggestedActions: [
                {
                  tool: "multi-action-create",
                  reason: "Create a new multi-action",
                  priority: 1,
                },
              ],
            });
          }

          const list = multiActions.map((ma) => {
            const chain = resolveChain(ma.chain);
            return {
              actionId: ma.id,
              chain: ma.chain,
              ecosystem: ma.ecosystem,
              actionCount: ma.actions.length,
              locked: ma.previewed,
              actions: ma.actions.map((a, i) => ({
                index: i,
                type: a.type,
                summary: generateActionSummary(a, chain),
              })),
              expiresIn: formatTimeRemaining(ma.expiresAt),
            };
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "success",
                    count: multiActions.length,
                    multiActions: list,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleMultiActionError(error, "multi-action-list");
        }
      },
    );
  },
};

export default multiActionPlugin;

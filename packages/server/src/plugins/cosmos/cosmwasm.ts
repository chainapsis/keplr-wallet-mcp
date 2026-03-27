import { z } from "zod";
import type { CosmosClient } from "../../clients/cosmos.js";
import {
  createSetupRequiredResponse,
  isSetupRequiredError,
  parseCosmWasmMsgError,
  type SuggestedAction,
} from "../../errors.js";
import { storePending } from "../../pending-action.js";
import type { KeplrStore } from "../../store.js";
import { sanitizeString, wrapUntrustedData } from "../../utils/sanitize.js";
import { CHAIN_PARAM_DESC, resolveChain } from "../shared.js";
import type { KeplrPlugin } from "../types.js";

/**
 * Chains that support CosmWasm smart contracts.
 * Note: Secret Network uses encrypted CosmWasm (not supported here).
 */
const COSMWASM_CHAINS = new Set([
  "osmosis-1",
  "neutron-1",
  "juno-1",
  "stargaze-1",
  "injective-1",
  "archway-1",
  "columbus-5",
  "sei-pacific-1",
]);

/**
 * Check if a chain supports CosmWasm.
 */
function isCosmWasmChain(chainId: string): boolean {
  return COSMWASM_CHAINS.has(chainId);
}

/**
 * Helper to handle errors in CosmWasm tools.
 */
function handleCosmWasmError(
  error: unknown,
  attemptedAction: string,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (isSetupRequiredError(errorMessage)) {
    const setupResponse = createSetupRequiredResponse({ attemptedAction });
    return {
      content: [{ type: "text", text: JSON.stringify(setupResponse, null, 2) }],
    };
  }

  // Check for CosmWasm message parsing errors (unknown variant, missing field, etc.)
  const parsed = parseCosmWasmMsgError(errorMessage);
  if (parsed) {
    const suggestedActions: SuggestedAction[] = [];

    if (parsed.availableVariants && parsed.availableVariants.length > 0) {
      suggestedActions.push({
        tool: "cosmwasm-execute",
        reason: `Retry with a valid variant: ${parsed.availableVariants.join(", ")}`,
        priority: 1,
      });
    }

    suggestedActions.push({
      tool: "cosmwasm-query",
      reason:
        "Query the contract config to understand how to use the available variants",
      priority: 2,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              isError: true,
              category: "validation",
              message: errorMessage,
              recoverable: false,
              parsed,
              suggestion:
                "The contract does not accept this message format. See 'parsed' for valid options.",
              suggestedActions,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Build generic error response with suggested actions
  const suggestedActions: SuggestedAction[] = [
    {
      tool: "cosmwasm-contract-info",
      reason: "Verify the contract exists and is valid",
      priority: 1,
    },
    {
      tool: "get-balances",
      reason: "Check your token balances",
      priority: 2,
    },
  ];

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            isError: true,
            message: errorMessage,
            suggestedActions,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

const cosmwasmPlugin: KeplrPlugin = {
  name: "cosmos-cosmwasm",
  register(server, store: KeplrStore) {
    // --- Query Tools ---

    server.registerTool(
      "cosmwasm-query",
      {
        description:
          "Query a CosmWasm smart contract. Sends a read-only query to get contract state. The query message format depends on the specific contract's interface.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          contractAddress: z
            .string()
            .describe("Contract address (bech32 format)"),
          queryMsg: z
            .string()
            .describe(
              'Query message as JSON string (e.g., \'{"balance":{"address":"osmo1..."}}\')',
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, contractAddress, queryMsg }) => {
        try {
          const chain = resolveChain(chainInput);

          if (!isCosmWasmChain(chain.chainId)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "not_supported",
                      message: `CosmWasm is not available on ${chain.chainId}`,
                      supportedChains: Array.from(COSMWASM_CHAINS),
                      suggestedActions: [
                        {
                          tool: "list-cosmos-chains",
                          reason: "View all supported chains",
                          priority: 1,
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          const c = await store.getClientFor<CosmosClient>("cosmos");

          // Parse query message
          let parsedQuery: Record<string, unknown>;
          try {
            parsedQuery = JSON.parse(queryMsg);
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "invalid_query",
                      message: "Query message must be valid JSON",
                      example: '{"balance":{"address":"osmo1..."}}',
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          const result = await c.queryContract(
            chain,
            contractAddress,
            parsedQuery,
          );

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "cosmwasm-contract-info",
              reason: "View contract metadata",
              params: { chain: chain.chainId, contractAddress },
              priority: 1,
            },
            {
              tool: "cosmwasm-execute",
              reason: "Execute a contract action",
              params: { chain: chain.chainId, contractAddress },
              priority: 2,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    contractAddress,
                    query: parsedQuery,
                    result: wrapUntrustedData(result.data, "cosmwasm-contract"),
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleCosmWasmError(error, "cosmwasm-query");
        }
      },
    );

    server.registerTool(
      "cosmwasm-contract-info",
      {
        description:
          "Get information about a CosmWasm smart contract. Returns code ID, creator, admin, and label.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          contractAddress: z
            .string()
            .describe("Contract address (bech32 format)"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, contractAddress }) => {
        try {
          const chain = resolveChain(chainInput);

          if (!isCosmWasmChain(chain.chainId)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "not_supported",
                      message: `CosmWasm is not available on ${chain.chainId}`,
                      supportedChains: Array.from(COSMWASM_CHAINS),
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          const c = await store.getClientFor<CosmosClient>("cosmos");
          const info = await c.getContractInfo(chain, contractAddress);

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "cosmwasm-query",
              reason: "Query the contract state",
              params: { chain: chain.chainId, contractAddress },
              priority: 1,
            },
            {
              tool: "cosmwasm-execute",
              reason: "Execute a contract action",
              params: { chain: chain.chainId, contractAddress },
              priority: 2,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    contract: {
                      ...info,
                      label: sanitizeString(info.label),
                    },
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleCosmWasmError(error, "cosmwasm-contract-info");
        }
      },
    );

    server.registerTool(
      "cosmwasm-list-contracts",
      {
        description:
          "List CosmWasm contract addresses by code ID. Use this to discover contracts deployed from a specific code.",
        inputSchema: {
          chain: z
            .string()
            .describe(
              "Chain ID or name (e.g., 'osmosis-1', 'neutron-1', 'juno-1')",
            ),
          codeId: z
            .string()
            .regex(
              /^\d+$/,
              "Code ID must be a numeric value (e.g., '1', '100')",
            )
            .describe("Code ID to search contracts for (numeric)"),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ chain: chainInput, codeId }) => {
        try {
          const chain = resolveChain(chainInput);

          if (!isCosmWasmChain(chain.chainId)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "not_supported",
                      message: `CosmWasm is not available on ${chain.chainId}`,
                      supportedChains: Array.from(COSMWASM_CHAINS),
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          const c = await store.getClientFor<CosmosClient>("cosmos");
          const result = await c.listContractsByCodeId(chain, codeId);

          const suggestedActions: SuggestedAction[] = result.contracts
            .slice(0, 3)
            .map((addr, i) => ({
              tool: "cosmwasm-contract-info",
              reason: `View metadata for contract ${addr.slice(0, 20)}...`,
              params: { chain: chain.chainId, contractAddress: addr },
              priority: i + 1,
            }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chainId: chain.chainId,
                    codeId,
                    totalContracts: result.contracts.length,
                    contracts: result.contracts,
                    ...(result.truncated && {
                      truncated: true,
                      warning:
                        "Results are limited to 1,000 contracts. More contracts exist for this code ID but were not returned.",
                    }),
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleCosmWasmError(error, "cosmwasm-list-contracts");
        }
      },
    );

    // --- Transaction Tools ---

    server.registerTool(
      "cosmwasm-execute",
      {
        description:
          "Execute a CosmWasm smart contract. Sends a transaction to execute a contract action. Returns a confirmation token that must be confirmed with the confirm-action tool.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          contractAddress: z
            .string()
            .describe("Contract address (bech32 format)"),
          executeMsg: z
            .string()
            .describe(
              'Execute message as JSON string (e.g., \'{"transfer":{"recipient":"osmo1...","amount":"1000000"}}\')',
            ),
          funds: z
            .string()
            .optional()
            .describe(
              'Optional funds to send with execution as JSON array (e.g., \'[{"denom":"uosmo","amount":"1000000"}]\')',
            ),
          feeDenom: z
            .string()
            .optional()
            .describe("Fee token denomination (optional)"),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({
        chain: chainInput,
        contractAddress,
        executeMsg,
        funds,
        feeDenom,
      }) => {
        try {
          const chain = resolveChain(chainInput);

          if (!isCosmWasmChain(chain.chainId)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "not_supported",
                      message: `CosmWasm is not available on ${chain.chainId}`,
                      supportedChains: Array.from(COSMWASM_CHAINS),
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Parse execute message
          let parsedMsg: Record<string, unknown>;
          try {
            parsedMsg = JSON.parse(executeMsg);
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "invalid_message",
                      message: "Execute message must be valid JSON",
                      example:
                        '{"transfer":{"recipient":"osmo1...","amount":"1000000"}}',
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Parse funds if provided
          let parsedFunds: { denom: string; amount: string }[] | undefined;
          if (funds) {
            try {
              parsedFunds = JSON.parse(funds);
            } catch {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        error: "invalid_funds",
                        message: "Funds must be valid JSON array",
                        example: '[{"denom":"uosmo","amount":"1000000"}]',
                      },
                      null,
                      2,
                    ),
                  },
                ],
                isError: true,
              };
            }
          }

          // Get client to verify setup
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const senderAddress = await c.getAddress(chain);

          // Build summary for the pending transaction
          const msgType = Object.keys(parsedMsg)[0] || "execute";
          const summary = `Execute CosmWasm contract (${msgType}) on ${chain.chainId}`;

          // Create pending transaction
          const elicitationSummary = [
            summary,
            `\nContract: ${contractAddress}`,
            `Message: ${JSON.stringify(parsedMsg)}`,
            parsedFunds && parsedFunds.length > 0
              ? `Funds: ${JSON.stringify(parsedFunds)}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n");
          const token = storePending(
            summary,
            chain.chainId,
            async () => {
              const client = await store.getClientFor<CosmosClient>("cosmos");
              return client.executeContract(
                chain,
                contractAddress,
                parsedMsg,
                parsedFunds,
                feeDenom,
              );
            },
            undefined,
            elicitationSummary,
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "pending_confirmation",
                    confirmationToken: token,
                    preview: {
                      action: "Execute CosmWasm Contract",
                      chain: chain.chainId,
                      chainName: chain.chainName,
                      contract: contractAddress,
                      message: Object.keys(parsedMsg)[0] || "unknown",
                      messageDetails: parsedMsg,
                      funds: parsedFunds || [],
                      sender: senderAddress,
                    },
                    instructions: `To execute this contract action, call the confirm-action tool with confirmationToken: "${token}"`,
                    warnings: [
                      "Contract executions may transfer tokens or change state",
                      "Verify the contract address and message carefully",
                    ],
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleCosmWasmError(error, "cosmwasm-execute");
        }
      },
    );

    server.registerTool(
      "cosmwasm-instantiate",
      {
        description:
          "Instantiate a new CosmWasm smart contract from existing code. Returns a confirmation token that must be confirmed with the confirm-action tool.",
        inputSchema: {
          chain: z.string().describe(CHAIN_PARAM_DESC),
          codeId: z
            .string()
            .describe("Code ID to instantiate (e.g., '1', '123')"),
          instantiateMsg: z
            .string()
            .describe(
              "Instantiate message as JSON string (format depends on the contract)",
            ),
          label: z.string().describe("Human-readable label for the contract"),
          admin: z
            .string()
            .optional()
            .describe(
              "Admin address for contract migrations (optional, leave empty for immutable)",
            ),
          funds: z
            .string()
            .optional()
            .describe(
              "Optional funds to send with instantiation as JSON array",
            ),
          feeDenom: z
            .string()
            .optional()
            .describe("Fee token denomination (optional)"),
        },
        annotations: {
          readOnlyHint: false,
        },
      },
      async ({
        chain: chainInput,
        codeId,
        instantiateMsg,
        label,
        admin,
        funds,
        feeDenom,
      }) => {
        try {
          const chain = resolveChain(chainInput);

          if (!isCosmWasmChain(chain.chainId)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "not_supported",
                      message: `CosmWasm is not available on ${chain.chainId}`,
                      supportedChains: Array.from(COSMWASM_CHAINS),
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Validate code ID
          const codeIdNum = parseInt(codeId, 10);
          if (Number.isNaN(codeIdNum) || codeIdNum <= 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "invalid_code_id",
                      message: "Code ID must be a positive integer",
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Parse instantiate message
          let parsedMsg: Record<string, unknown>;
          try {
            parsedMsg = JSON.parse(instantiateMsg);
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: "invalid_message",
                      message: "Instantiate message must be valid JSON",
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Parse funds if provided
          let parsedFunds: { denom: string; amount: string }[] | undefined;
          if (funds) {
            try {
              parsedFunds = JSON.parse(funds);
            } catch {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        error: "invalid_funds",
                        message: "Funds must be valid JSON array",
                      },
                      null,
                      2,
                    ),
                  },
                ],
                isError: true,
              };
            }
          }

          // Get client to verify setup
          const c = await store.getClientFor<CosmosClient>("cosmos");
          const senderAddress = await c.getAddress(chain);

          // Build summary for the pending transaction
          const summary = `Instantiate CosmWasm contract (code ${codeId}, "${label}") on ${chain.chainId}`;

          // Create pending transaction
          const elicitationSummary = [
            summary,
            `\nCode ID: ${codeId}`,
            `Label: ${label}`,
            admin ? `Admin: ${admin}` : undefined,
            `Init Msg: ${JSON.stringify(parsedMsg)}`,
            parsedFunds && parsedFunds.length > 0
              ? `Funds: ${JSON.stringify(parsedFunds)}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n");
          const token = storePending(
            summary,
            chain.chainId,
            async () => {
              const client = await store.getClientFor<CosmosClient>("cosmos");
              return client.instantiateContract(
                chain,
                codeId,
                parsedMsg,
                label,
                admin,
                parsedFunds,
                feeDenom,
              );
            },
            undefined,
            elicitationSummary,
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "pending_confirmation",
                    confirmationToken: token,
                    preview: {
                      action: "Instantiate CosmWasm Contract",
                      chain: chain.chainId,
                      chainName: chain.chainName,
                      codeId,
                      label,
                      admin: admin || "(immutable - no migrations allowed)",
                      instantiateMsg: parsedMsg,
                      funds: parsedFunds || [],
                      sender: senderAddress,
                    },
                    instructions: `To instantiate this contract, call the confirm-action tool with confirmationToken: "${token}"`,
                    warnings: [
                      "Contract instantiation creates a new contract instance",
                      admin
                        ? "This contract will have an admin and can be migrated"
                        : "This contract will be immutable (no admin set)",
                    ],
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          return handleCosmWasmError(error, "cosmwasm-instantiate");
        }
      },
    );

    // --- Prompts ---

    server.registerPrompt(
      "cosmwasm-interact",
      {
        description: "Interact with a CosmWasm smart contract (guided)",
        argsSchema: {
          chain: z
            .string()
            .describe("Chain name (e.g., 'osmosis', 'neutron', 'juno')"),
          contractAddress: z
            .string()
            .optional()
            .describe("Contract address (if known)"),
        },
      },
      async ({ chain, contractAddress }) => {
        const parts = [
          `I want to interact with a CosmWasm smart contract on ${chain}.`,
        ];
        if (contractAddress) {
          parts.push(`Contract address: ${contractAddress}`);
          parts.push(
            "",
            "Please help me:",
            "1. Get the contract info (use cosmwasm-contract-info)",
            "2. Understand what queries and actions are available",
            "3. Help me query the contract state or execute an action",
          );
        } else {
          parts.push(
            "",
            "Please help me:",
            "1. Understand what type of contract I want to interact with",
            "2. Find the contract address",
            "3. Get the contract info and explore available actions",
          );
        }
        return {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: parts.join("\n") },
            },
          ],
        };
      },
    );
  },
};

export default cosmwasmPlugin;

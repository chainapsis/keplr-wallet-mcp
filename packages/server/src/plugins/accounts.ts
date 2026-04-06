import { Bip39, EnglishMnemonic, Random } from "@cosmjs/crypto";
import { z } from "zod";
import {
  accountExists,
  addAccount,
  checkVaultIntegrity,
  deleteMnemonicForAccount,
  getAccountKeyProviderType,
  listAccounts,
  loadMnemonicForAccount,
  removeAccount,
  renameAccount,
  saveMnemonicForAccount,
} from "../accounts.js";
import { getAuthManager } from "../auth/manager.js";
import { createSetupRequiredResponse } from "../errors.js";
import {
  elicitForm,
  requestConfirmation,
  requestTotpCode,
  supportsFormElicitation,
} from "../mcp-features/elicitation.js";
import {
  isFirstTimeUser,
  loadPreferences,
  markOnboardingCompleted,
} from "../preferences.js";
import { getRpcResolver } from "../rpc/resolver.js";
import { getTtlInfo } from "../store.js";
import { isNativeKeychainAvailable } from "../vault-key.js";
import type { KeplrPlugin } from "./types.js";

const VALID_WORD_COUNTS = [12, 15, 18, 21, 24];

/**
 * Onboarding step definition
 */
interface OnboardingStep {
  id: string;
  name: string;
  description: string;
  completed: boolean;
  /** Whether this step is required (true) or optional (false) */
  required: boolean;
  tool?: string;
  toolParams?: Record<string, unknown>;
}

/**
 * Get onboarding status with checklist and next steps
 */
async function getOnboardingStatus(
  store: Parameters<KeplrPlugin["register"]>[1],
): Promise<{
  status: "not_started" | "in_progress" | "complete";
  isFirstTime: boolean;
  completedSteps: number;
  totalSteps: number;
  steps: OnboardingStep[];
  nextStep: OnboardingStep | null;
  suggestedAction: {
    tool: string;
    reason: string;
    params?: Record<string, unknown>;
  } | null;
  availableEcosystems: string[];
}> {
  const config = await listAccounts();
  const hasAccount = Object.keys(config.accounts).length > 0;
  const hasActiveAccount = !!config.activeAccount;
  const isFirstTime = await isFirstTimeUser();

  // Try to check if we can get a client (meaning mnemonic/wallet is working)
  let canAccessWallet = false;
  if (hasActiveAccount) {
    try {
      // Just check if adapters are registered - don't actually create client
      // to avoid errors in onboarding status
      canAccessWallet = store.getAdapters().size > 0;
    } catch {
      canAccessWallet = false;
    }
  }

  // Check if auth is configured
  const authManager = await import("../auth/manager.js").then((m) =>
    m.getAuthManager(),
  );
  const hasAuthConfigured = await authManager.isAuthRequired("delete_account");

  // Get available ecosystems from adapters
  const availableEcosystems = Array.from(store.getAdapters().keys());

  // Define onboarding steps
  const steps: OnboardingStep[] = [
    {
      id: "create_account",
      name: "Create or Import Wallet",
      description:
        "Set up a wallet account to interact with blockchain networks",
      completed: hasAccount,
      required: true,
      tool: hasAccount ? undefined : "create-account",
    },
    {
      id: "activate_account",
      name: "Activate Account",
      description: "Set an active account for transactions",
      completed: hasActiveAccount,
      required: true,
      tool: hasActiveAccount ? undefined : "switch-account",
    },
    {
      id: "check_address",
      name: "Get Your Addresses",
      description: "View your wallet addresses across different networks",
      completed: false, // Always show as available action
      required: true,
      tool: "get-account-addresses",
    },
    {
      id: "check_balance",
      name: "Check Balances",
      description: "View your token balances on supported chains",
      completed: false, // Always show as available action
      required: true,
      tool: "get-balances",
      toolParams: { chain: "osmosis" },
    },
    {
      id: "setup_security",
      name: "Set Up Security (Optional)",
      description:
        "Enable biometric authentication for extra security when performing destructive actions",
      completed: hasAuthConfigured,
      required: false,
      tool: hasAuthConfigured ? undefined : "auth-setup",
    },
    {
      id: "setup_api_key",
      name: "Set Up Keplr Infra API Key (Optional)",
      description:
        "Grab your Keplr Infra key and stop dealing with slow, unreliable connections. " +
        "One key instantly connects you to 30+ Cosmos chains with the speed and stability " +
        "that millions of Keplr users already rely on. Just one key and you're good to go! " +
        "Without a key, public endpoints are used automatically. " +
        "Get your API key at https://api.keplr.app",
      completed: getRpcResolver().hasApiKey,
      required: false,
      tool: getRpcResolver().hasApiKey ? undefined : "keplr_api_configure_key",
    },
  ];

  // Mark check_address and check_balance as "completed" if user has active account
  // (meaning they can perform these actions)
  if (hasActiveAccount && canAccessWallet) {
    const addressStep = steps.find((s) => s.id === "check_address");
    const balanceStep = steps.find((s) => s.id === "check_balance");
    if (addressStep) addressStep.completed = true;
    if (balanceStep) balanceStep.completed = true;
  }

  const completedSteps = steps.filter((s) => s.completed).length;
  const totalSteps = steps.length;

  // Determine overall status
  let status: "not_started" | "in_progress" | "complete";
  if (completedSteps === 0) {
    status = "not_started";
  } else if (completedSteps >= 2 && hasActiveAccount) {
    // Account created and active = complete for onboarding
    status = "complete";
  } else {
    status = "in_progress";
  }

  // Find next incomplete step
  const nextStep = steps.find((s) => !s.completed) || null;

  // Build suggested action
  let suggestedAction: {
    tool: string;
    reason: string;
    params?: Record<string, unknown>;
  } | null = null;

  if (!hasAccount) {
    suggestedAction = {
      tool: "create-account",
      reason: "Create your first wallet to get started",
    };
  } else if (!hasActiveAccount) {
    suggestedAction = {
      tool: "switch-account",
      reason: "Activate an account to start using the wallet",
    };
  } else {
    // Has active account - suggest exploring
    suggestedAction = {
      tool: "get-balances",
      reason: "Check your token balances",
      params: { chain: "osmosis" },
    };
  }

  return {
    status,
    isFirstTime,
    completedSteps,
    totalSteps,
    steps,
    nextStep,
    suggestedAction,
    availableEcosystems,
  };
}

const accountsPlugin: KeplrPlugin = {
  name: "accounts",
  register(server, store) {
    // ===== Onboarding Status Tool =====

    server.registerTool(
      "onboarding-status",
      {
        description:
          "Check wallet setup progress and get guidance on next steps. Use this when starting a new session or when unsure what to do next.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const onboarding = await getOnboardingStatus(store);
        const config = await listAccounts();
        const prefs = await loadPreferences();

        // Build a friendly response
        const response: Record<string, unknown> = {
          status: onboarding.status,
          progress: `${onboarding.completedSteps}/${onboarding.totalSteps} steps completed`,
          activeAccount: config.activeAccount || null,
          totalAccounts: Object.keys(config.accounts).length,
        };

        // Add welcome message for first-time users or those who haven't dismissed it
        if (onboarding.isFirstTime || onboarding.status === "not_started") {
          response.welcomeMessage = {
            title: "Welcome to Keplr MCP Server! 🎉",
            description:
              "This is your AI-powered wallet interface for Cosmos blockchains. " +
              "Let's get you set up with a wallet to start exploring DeFi, staking, and more.",
            tips: prefs.showSecurityTips
              ? [
                  "📝 If creating a new wallet, write down your recovery phrase and store it safely",
                  "🚫 Never share your mnemonic phrase with anyone",
                  "🔒 Consider enabling biometric authentication to protect sensitive actions",
                ]
              : undefined,
          };
        }

        // Add ecosystem/chain discovery info
        if (onboarding.availableEcosystems.length > 0) {
          response.supportedEcosystems = onboarding.availableEcosystems.map(
            (eco) => {
              const adapter = store.getAdapters().get(eco);
              return {
                ecosystem: eco,
                name: adapter?.displayName || eco,
                features:
                  eco === "cosmos"
                    ? ["Staking", "Governance", "IBC Transfers", "CosmWasm"]
                    : [],
              };
            },
          );
        }

        // Add steps checklist with required/optional indicator
        response.checklist = onboarding.steps.map((step) => ({
          step: step.name,
          status: step.completed ? "✓ Done" : "○ Pending",
          required: step.required ? "Required" : "Optional",
          description: step.description,
        }));

        // Add next action guidance
        if (onboarding.status === "complete") {
          // Mark onboarding as completed (persists across sessions)
          if (onboarding.isFirstTime) {
            await markOnboardingCompleted();
          }

          response.message =
            "Your wallet is set up and ready to use! Here are some things you can do:";
          response.availableActions = [
            {
              tool: "get-balances",
              description: "Check token balances on any chain",
            },
            {
              tool: "get-staking-info",
              description: "View staking positions and rewards",
            },
            { tool: "send-tokens", description: "Send tokens to an address" },
            { tool: "delegate", description: "Stake tokens to earn rewards" },
            {
              tool: "auth-status",
              description:
                "Check or configure biometric authentication for extra security",
            },
          ];
        } else if (onboarding.suggestedAction) {
          response.message = `Next step: ${onboarding.suggestedAction.reason}`;
          response.nextAction = {
            tool: onboarding.suggestedAction.tool,
            params: onboarding.suggestedAction.params,
          };

          // Show setup options if no account
          if (onboarding.status === "not_started") {
            const setupOptions: Array<{
              tool: string;
              description: string;
              security: string;
              ecosystems: string[];
            }> = [
              {
                tool: "create-account",
                description:
                  "Generate a new wallet with a fresh mnemonic phrase",
                security: "Keys stored in OS Keychain",
                ecosystems: ["Cosmos"],
              },
              {
                tool: "import-account",
                description: "Import existing wallet with your mnemonic phrase",
                security:
                  "⚠️ Mnemonic visible in chat history - use with caution",
                ecosystems: ["Cosmos"],
              },
            ];

            response.setupOptions = setupOptions;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      },
    );

    // ===== Account Management Tools =====

    server.registerTool(
      "list-accounts",
      {
        description:
          "List all accounts with their status (active account marked)",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const config = await listAccounts();
        const accountList = Object.entries(config.accounts).map(
          ([name, info]) => ({
            name,
            type: info.type,
            isActive: name === config.activeAccount,
            createdAt: info.createdAt,
            description: info.description,
          }),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  activeAccount: config.activeAccount,
                  accounts: accountList,
                  totalAccounts: accountList.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "check-vault-health",
      {
        description:
          "Check vault integrity and repair anomalies (orphaned, corrupt, dangling)",
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
        },
        inputSchema: {
          repair: z
            .boolean()
            .default(false)
            .describe("Attempt automatic repair"),
          deleteDangling: z
            .boolean()
            .default(false)
            .describe(
              "Delete vault files without matching account entries (requires repair=true)",
            ),
        },
      },
      async ({ repair, deleteDangling }) => {
        try {
          const result = await checkVaultIntegrity({
            repair,
            deleteDangling,
          });
          const suggestedActions: Array<{
            tool: string;
            reason: string;
            priority: number;
          }> = [];
          for (const name of result.unrecoverable) {
            suggestedActions.push({
              tool: "import-account",
              reason: `Account "${name}" needs mnemonic re-import`,
              priority: 1,
            });
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    summary: {
                      healthy: result.healthy.length,
                      repaired: result.repaired.length,
                      unrecoverable: result.unrecoverable.length,
                      issues:
                        result.orphaned.length +
                        result.keyMissing.length +
                        result.corrupt.length +
                        result.dangling.length +
                        result.keychainError.length,
                    },
                    details: result,
                    suggestedActions,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Vault health check failed",
                    message: (err as Error).message,
                    suggestedActions: [
                      {
                        tool: "check-vault-health",
                        reason: "Retry with repair=false for read-only check",
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
      },
    );

    server.registerTool(
      "create-account",
      {
        description:
          "Create a new account with a freshly generated BIP39 mnemonic",
        annotations: {
          destructiveHint: true,
        },
        inputSchema: {
          name: z
            .string()
            .describe(
              "Unique name for the account (e.g., 'trading', 'savings')",
            ),
          strength: z
            .enum(["12", "24"])
            .default("24")
            .describe("Number of words: 12 or 24 (default: 24)"),
          description: z
            .string()
            .optional()
            .describe("Optional description for the account"),
          setActive: z
            .boolean()
            .default(true)
            .describe(
              "Whether to set this as the active account (default: true)",
            ),
        },
      },
      async ({ name, strength, description, setActive }) => {
        // Validate account name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return {
            content: [
              {
                type: "text",
                text: "Invalid account name. Use only letters, numbers, underscores, and hyphens.",
              },
            ],
            isError: true,
          };
        }

        // Check if account already exists
        if (await accountExists(name)) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${name}" already exists. Use a different name or delete the existing account first.`,
              },
            ],
            isError: true,
          };
        }

        // Generate new mnemonic
        const entropyBytes = strength === "12" ? 16 : 32;
        const entropy = Random.getBytes(entropyBytes);
        const mnemonic = Bip39.encode(entropy).toString();

        // Save mnemonic to keychain
        await saveMnemonicForAccount(name, mnemonic);

        // Add account to config
        await addAccount(name, description);

        // Switch to the new account if requested
        if (setActive) {
          await store.switchAccount(name);
        }

        // Collect display addresses from all adapters
        const addresses: Record<string, string> = {};
        const addressErrors: Record<string, string> = {};
        for (const [type, adapter] of store.getAdapters()) {
          if (adapter.getDisplayAddress) {
            try {
              const client = await store.getClientFor(type);
              addresses[adapter.displayName] =
                await adapter.getDisplayAddress(client);
            } catch (error) {
              addressErrors[adapter.displayName] =
                error instanceof Error ? error.message : String(error);
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  message: `Account "${name}" created successfully!`,
                  account: {
                    name,
                    type: "mnemonic",
                    wordCount: strength === "12" ? 12 : 24,
                    isActive: setActive,
                  },
                  addresses,
                  ...(Object.keys(addressErrors).length > 0 && {
                    addressErrors,
                  }),
                  warning:
                    "⚠️ This mnemonic was transmitted through your AI provider's servers. Store it in a secure location immediately and consider deleting this conversation.",
                  security: {
                    storage:
                      "Encrypted locally (AES-256-GCM), decryption key in OS Keychain",
                    backupRecommendation:
                      "Consider backing up your recovery phrase in a secure location.",
                  },
                  nextSteps: [
                    {
                      step: 1,
                      action: "Fund your wallet",
                      description: "Send tokens to the addresses above",
                    },
                    {
                      step: 2,
                      action: "Check your balances",
                      tool: "get-balances",
                      params: { chain: "osmosis" },
                    },
                    {
                      step: 3,
                      action: "Explore staking",
                      tool: "get-staking-info",
                      params: { chain: "osmosis" },
                    },
                    isNativeKeychainAvailable()
                      ? {
                          step: 4,
                          action: "Set up biometric security (RECOMMENDED)",
                          description: "Protect account deletion with Touch ID",
                          tool: "auth-setup",
                          params: { provider: "biometric" },
                          priority: "high",
                        }
                      : {
                          step: 4,
                          action: "Set up TOTP security (RECOMMENDED)",
                          description:
                            "Protect account deletion with authenticator app",
                          tool: "auth-setup",
                          params: { provider: "totp" },
                          priority: "high",
                        },
                    ...(!getRpcResolver().hasApiKey
                      ? [
                          {
                            step: 5,
                            action: "Connect Keplr Infra API key",
                            description:
                              "Stop dealing with slow, unreliable public endpoints. " +
                              "One key connects you to 30+ Cosmos chains with speed and stability. " +
                              "Get your key at https://api.keplr.app",
                            tool: "keplr_api_configure_key",
                          },
                        ]
                      : []),
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "import-account",
      {
        description:
          "Import an existing mnemonic as a new account. WARNING: The mnemonic will be visible in the AI conversation history.",
        annotations: {
          destructiveHint: true,
        },
        inputSchema: {
          name: z
            .string()
            .describe("Unique name for the account (e.g., 'main', 'trading')"),
          mnemonic: z
            .string()
            .optional()
            .describe(
              "BIP39 mnemonic phrase (12/15/18/21/24 words). If omitted and client supports elicitation, mnemonic will be collected securely via a password form.",
            ),
          description: z
            .string()
            .optional()
            .describe("Optional description for the account"),
          setActive: z
            .boolean()
            .default(true)
            .describe(
              "Whether to set this as the active account (default: true)",
            ),
        },
      },
      async ({ name, mnemonic: mnemonicParam, description, setActive }) => {
        // Validate account name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return {
            content: [
              {
                type: "text",
                text: "Invalid account name. Use only letters, numbers, underscores, and hyphens.",
              },
            ],
            isError: true,
          };
        }

        // Check if account already exists
        if (await accountExists(name)) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${name}" already exists. Use a different name or delete the existing account first.`,
              },
            ],
            isError: true,
          };
        }

        // Collect mnemonic: prefer elicitation (password field) over tool parameter
        let mnemonic: string;
        let usedSecureInput = false;
        if (supportsFormElicitation(server.server)) {
          // Secure path: collect mnemonic via elicitation password field
          const result = await elicitForm<{ mnemonic: string }>(server.server, {
            mode: "form",
            message:
              "Enter your BIP39 mnemonic phrase to import.\n\n" +
              "Using this form reduces your mnemonic's exposure in the AI conversation history.",
            requestedSchema: {
              type: "object" as const,
              properties: {
                mnemonic: {
                  type: "string" as const,
                  title: "Mnemonic Phrase",
                  description: "BIP39 mnemonic phrase (12/15/18/21/24 words)",
                  // Note: MCP elicitation schema does not support format:"password"
                },
              },
              required: ["mnemonic"] as string[],
            },
          });

          const mnemonicSchema = z.object({ mnemonic: z.string().min(1) });
          const parsed = mnemonicSchema.safeParse(result.content);

          if (result.action !== "accept" || !parsed.success) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: parsed.success
                        ? "Import cancelled by user."
                        : "Invalid input received.",
                      alternatives: [
                        {
                          tool: "create-account",
                          description:
                            "Create a fresh wallet with a new mnemonic",
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: !parsed.success,
            };
          }

          mnemonic = parsed.data.mnemonic;
          usedSecureInput = true;
        } else if (mnemonicParam) {
          // Fallback: mnemonic provided as tool parameter (always show security warning)
          const confirmed = await requestConfirmation(server.server, {
            title: "⚠️ Security Warning - Mnemonic Import",
            message:
              "You are about to import a mnemonic phrase. Please understand the security implications:\n\n" +
              "• Your mnemonic phrase is now visible in this AI conversation history\n" +
              "• Anyone with access to this chat can see your recovery phrase\n" +
              "• For high-value wallets, consider using a dedicated signing solution instead\n\n" +
              "Do you want to proceed with the import?",
            confirmLabel: "I understand the risks and want to proceed",
          });

          if (confirmed === false) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: "Import cancelled by user.",
                      alternatives: [
                        {
                          tool: "create-account",
                          description:
                            "Create a fresh wallet with a new mnemonic",
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
          // confirmed === null: elicitation not supported, no way to show a pre-import warning.
          // Security warnings will be included in the success response instead.

          mnemonic = mnemonicParam;
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Mnemonic phrase is required. Your client does not support secure input — please provide the mnemonic as a parameter.",
              },
            ],
            isError: true,
          };
        }

        // Validate mnemonic
        const trimmed = mnemonic.trim();
        const words = trimmed.split(/\s+/);
        if (!VALID_WORD_COUNTS.includes(words.length)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid mnemonic: expected ${VALID_WORD_COUNTS.join("/")} words, got ${words.length}.`,
              },
            ],
            isError: true,
          };
        }

        try {
          new EnglishMnemonic(trimmed);
        } catch {
          return {
            content: [
              {
                type: "text",
                text: "Invalid mnemonic: BIP39 checksum verification failed. Please check for typos or invalid words.",
              },
            ],
            isError: true,
          };
        }

        // Save mnemonic to keychain
        await saveMnemonicForAccount(name, trimmed);

        // Add account to config
        await addAccount(name, description);

        // Switch to the new account if requested
        if (setActive) {
          await store.switchAccount(name);
        }

        // Collect display addresses from all adapters
        const addresses: Record<string, string> = {};
        const addressErrors: Record<string, string> = {};
        for (const [type, adapter] of store.getAdapters()) {
          if (adapter.getDisplayAddress) {
            try {
              const client = await store.getClientFor(type);
              addresses[adapter.displayName] =
                await adapter.getDisplayAddress(client);
            } catch (error) {
              addressErrors[adapter.displayName] =
                error instanceof Error ? error.message : String(error);
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  message: `Account "${name}" imported successfully!`,
                  account: {
                    name,
                    type: "mnemonic",
                    wordCount: words.length,
                    isActive: setActive,
                  },
                  addresses,
                  ...(Object.keys(addressErrors).length > 0 && {
                    addressErrors,
                  }),
                  security: {
                    storage:
                      "Encrypted locally (AES-256-GCM), decryption key in OS Keychain",
                    note: "Your recovery phrase is now stored securely in your system keychain.",
                    warnings: usedSecureInput
                      ? ["🚫 Never share your mnemonic phrase with anyone"]
                      : [
                          "🚨 IMPORTANT: Your mnemonic was provided as a tool parameter and is visible in this conversation",
                          "🔒 Consider clearing chat history if this is a high-value wallet",
                          "🚫 Never share your mnemonic phrase with anyone",
                        ],
                    recommendation: isNativeKeychainAvailable()
                      ? "Enable biometric authentication with 'auth-setup --provider biometric' to protect account deletion."
                      : "Enable TOTP authentication with 'auth-setup --provider totp' to protect account deletion.",
                  },
                  nextSteps: [
                    isNativeKeychainAvailable()
                      ? {
                          step: 1,
                          action: "Set up biometric security (RECOMMENDED)",
                          description: "Protect account deletion with Touch ID",
                          tool: "auth-setup",
                          params: { provider: "biometric" },
                          priority: "high",
                        }
                      : {
                          step: 1,
                          action: "Set up TOTP security (RECOMMENDED)",
                          description:
                            "Protect account deletion with authenticator app",
                          tool: "auth-setup",
                          params: { provider: "totp" },
                          priority: "high",
                        },
                    {
                      step: 2,
                      action: "Check your balances",
                      description: "See what tokens you have across chains",
                      tool: "get-balances",
                      params: { chain: "osmosis" },
                    },
                    {
                      step: 3,
                      action: "View staking positions",
                      tool: "get-staking-info",
                      params: { chain: "osmosis" },
                    },
                    ...(!getRpcResolver().hasApiKey
                      ? [
                          {
                            step: 4,
                            action: "Connect Keplr Infra API key",
                            description:
                              "Stop dealing with slow, unreliable public endpoints. " +
                              "One key connects you to 30+ Cosmos chains with speed and stability. " +
                              "Get your key at https://api.keplr.app",
                            tool: "keplr_api_configure_key",
                          },
                        ]
                      : []),
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "switch-account",
      {
        description: "Switch to a different account as the active account",
        annotations: {
          idempotentHint: true,
        },
        inputSchema: {
          name: z.string().describe("Name of the account to switch to"),
        },
      },
      async ({ name }) => {
        if (!(await accountExists(name))) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${name}" does not exist. Use list-accounts to see available accounts.`,
              },
            ],
            isError: true,
          };
        }

        await store.switchAccount(name);

        // Get account info
        const config = await listAccounts();
        const accountInfo = config.accounts[name];

        // Collect display addresses from all adapters
        const addresses: Record<string, string> = {};
        const addressErrors: Record<string, string> = {};
        for (const [type, adapter] of store.getAdapters()) {
          if (adapter.getDisplayAddress) {
            try {
              const client = await store.getClientFor(type);
              addresses[adapter.displayName] =
                await adapter.getDisplayAddress(client);
            } catch (error) {
              addressErrors[adapter.displayName] =
                error instanceof Error ? error.message : String(error);
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Switched to account "${name}".`,
                  activeAccount: name,
                  type: accountInfo?.type || "mnemonic",
                  addresses,
                  ...(Object.keys(addressErrors).length > 0 && {
                    addressErrors,
                  }),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "rename-account",
      {
        description: "Rename an existing account",
        annotations: {
          idempotentHint: true,
        },
        inputSchema: {
          oldName: z.string().describe("Current name of the account"),
          newName: z.string().describe("New name for the account"),
        },
      },
      async ({ oldName, newName }) => {
        // Validate new name
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
          return {
            content: [
              {
                type: "text",
                text: "Invalid new account name. Use only letters, numbers, underscores, and hyphens.",
              },
            ],
            isError: true,
          };
        }

        if (!(await accountExists(oldName))) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${oldName}" does not exist.`,
              },
            ],
            isError: true,
          };
        }

        if (await accountExists(newName)) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${newName}" already exists.`,
              },
            ],
            isError: true,
          };
        }

        await renameAccount(oldName, newName);

        // Update store if this was the active account
        const config = await listAccounts();
        if (config.activeAccount === newName) {
          await store.resetClients();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Account renamed from "${oldName}" to "${newName}".`,
                  oldName,
                  newName,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "delete-account",
      {
        description:
          "Delete an account and its mnemonic permanently. ⚠️ This action cannot be undone. If you have not backed up your mnemonic, you will permanently lose access to all assets in this account. Returns a confirmation token — call confirm-action with the token to execute.",
        annotations: {
          destructiveHint: true,
        },
        inputSchema: {
          name: z.string().describe("Name of the account to delete"),
        },
      },
      async ({ name }) => {
        if (!(await accountExists(name))) {
          return {
            content: [
              {
                type: "text",
                text: `Account "${name}" does not exist.`,
              },
            ],
            isError: true,
          };
        }

        const config = await listAccounts();
        const isActive = config.activeAccount === name;
        const summary = `Delete account "${name}"${isActive ? " (currently active)" : ""}`;

        // Helper to execute the deletion
        const executeDelete = async () => {
          // Delete mnemonic from keychain
          await deleteMnemonicForAccount(name);
          // Remove account from config
          await removeAccount(name);

          // Reset clients if this was the active account
          if (isActive) {
            await store.resetClients();
            await store.initializeActiveAccount();
          }

          return {
            status: "success" as const,
            deleted: true,
            name,
            message: `Account "${name}" deleted successfully.`,
          };
        };

        // Try elicitation first (1-step confirmation if supported)
        const confirmed = await requestConfirmation(server.server, {
          title: "Delete Account Confirmation",
          message: `Are you sure you want to delete account "${name}"?${isActive ? " This is the currently active account." : ""} This action cannot be undone and the mnemonic will be permanently removed.`,
          confirmLabel: "I want to delete this account",
        });

        // If elicitation returned a result (supported)
        if (confirmed !== null) {
          if (!confirmed) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: "Account deletion was cancelled by user.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Authenticate before destructive action
          const authManager = getAuthManager();
          let authResult = await authManager.authenticate({
            action: "delete_account",
            summary: `Delete account "${name}"`,
          });

          // Biometric failed/cancelled → fall back to TOTP via elicitation (only if TOTP is configured)
          if (
            !authResult.success &&
            (await authManager.getTotpProvider()?.isAvailable())
          ) {
            const totpCode = await requestTotpCode(server.server);
            if (totpCode) {
              authResult = await authManager.authenticate({
                action: "delete_account",
                summary: `Delete account "${name}"`,
                totpCode,
              });
            }
          }

          if (!authResult.success) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: false,
                      error: `Authentication required: ${authResult.error ?? "Unknown error"}`,
                      suggestedActions: [
                        {
                          tool: "auth-available-methods",
                          reason:
                            "Check which authentication methods are available",
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

          const result = await executeDelete();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Elicitation not supported - fall back to confirmation token
        const ttlInfo = getTtlInfo();
        const confirmationToken = store.storePendingAction(
          summary,
          async () => executeDelete(),
          async (context) => {
            const authManager = getAuthManager();
            const authResult = await authManager.authenticate({
              action: "delete_account",
              summary: `Delete account "${name}"`,
              ...context,
            });
            if (!authResult.success) {
              throw new Error(
                `Authentication required: ${authResult.error ?? "Unknown error"}`,
              );
            }
          },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "pending_confirmation",
                  summary,
                  isActiveAccount: isActive,
                  warning: isActive
                    ? "This is the currently active account. Deleting it will switch to another account if available."
                    : undefined,
                  confirmationToken,
                  expiresIn: ttlInfo.expiresIn,
                  expiresAt: ttlInfo.expiresAt,
                  ttlWarning: ttlInfo.ttlWarning,
                  instruction:
                    "Call confirm-action with this token to execute the deletion.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "export-mnemonic",
      {
        description:
          "Export the mnemonic (recovery phrase) for an account. " +
          "⚠️ The mnemonic gives full access to all derived accounts and assets. " +
          "Requires confirmation and authentication when auth is enabled.",
        annotations: {
          destructiveHint: true,
        },
        inputSchema: {
          name: z
            .string()
            .optional()
            .describe(
              "Account name to export. If omitted, uses the active account.",
            ),
          totpCode: z
            .string()
            .length(6)
            .regex(/^\d{6}$/)
            .optional()
            .describe(
              "6-digit TOTP code from authenticator app. Required when TOTP authentication is enabled.",
            ),
        },
      },
      async ({ name: nameParam, totpCode }) => {
        // Resolve account name
        const config = await listAccounts();
        const name = nameParam ?? config.activeAccount;

        if (!name) {
          const setupResponse = createSetupRequiredResponse({
            attemptedAction: "export-mnemonic",
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(setupResponse, null, 2),
              },
            ],
          };
        }

        if (!(await accountExists(name))) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Account "${name}" does not exist.`,
                    suggestedActions: [
                      {
                        tool: "list-accounts",
                        reason: "List available accounts",
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

        // Only mnemonic accounts can export
        const providerType = await getAccountKeyProviderType(name);
        if (providerType !== "mnemonic") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Account "${name}" is a ${providerType} account and does not have an exportable mnemonic.`,
                    suggestedActions: [
                      {
                        tool: "list-accounts",
                        reason: "View account types",
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

        // Helper to execute the export
        const executeExport = async () => {
          const decryptedMnemonic = await loadMnemonicForAccount(name);
          if (!decryptedMnemonic) {
            // Provide a specific error for "env" accounts
            if (name === "env") {
              return {
                success: false,
                error:
                  'The "env" account reads from the KEPLR_MNEMONIC environment variable, ' +
                  "which is not currently set in the server process.",
                suggestedActions: [
                  {
                    tool: "import-account",
                    reason:
                      "Import a mnemonic as a vault-backed account instead",
                    priority: 1,
                  },
                ],
              };
            }
            return {
              success: false,
              error: `Failed to decrypt mnemonic for account "${name}". The vault may be corrupted or the key is inaccessible.`,
              suggestedActions: [
                {
                  tool: "check-vault-health",
                  reason: "Diagnose vault issues",
                  priority: 1,
                },
              ],
            };
          }

          return {
            success: true,
            mnemonic: decryptedMnemonic,
            accountName: name,
            wordCount: decryptedMnemonic.split(" ").length,
            securityWarnings: [
              "This mnemonic gives full access to all derived accounts and assets.",
              "Never share it digitally — store it offline in a secure location.",
              "If compromised, immediately transfer all assets to a new wallet.",
              "Consider deleting this conversation after noting the mnemonic.",
            ],
            suggestedActions: [
              {
                tool: "list-accounts",
                reason: "Verify account details",
                priority: 2,
              },
            ],
          };
        };

        // Try elicitation first (1-step confirmation if supported)
        const confirmed = await requestConfirmation(server.server, {
          title: "Export Mnemonic Confirmation",
          message:
            `Are you sure you want to export the mnemonic for account "${name}"?\n\n` +
            "The recovery phrase will be displayed in this conversation. " +
            "Anyone with access to this phrase has full control over the account's assets.",
          confirmLabel: "I understand, show my mnemonic",
        });

        if (confirmed !== null) {
          if (!confirmed) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "cancelled",
                      message: "Mnemonic export was cancelled by user.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Authenticate before export
          const authManager = getAuthManager();
          let authResult = await authManager.authenticate({
            action: "export_mnemonic",
            summary: `Export mnemonic for account "${name}"`,
            totpCode,
          });

          // Biometric failed/cancelled → fall back to TOTP via elicitation (only if TOTP is configured)
          if (
            !authResult.success &&
            (await authManager.getTotpProvider()?.isAvailable())
          ) {
            const elicitedTotpCode = await requestTotpCode(server.server);
            if (elicitedTotpCode) {
              authResult = await authManager.authenticate({
                action: "export_mnemonic",
                summary: `Export mnemonic for account "${name}"`,
                totpCode: elicitedTotpCode,
              });
            }
          }

          if (!authResult.success) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: false,
                      error: `Authentication required: ${authResult.error ?? "Unknown error"}`,
                      suggestedActions: [
                        {
                          tool: "auth-available-methods",
                          reason:
                            "Check which authentication methods are available",
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

          const result = await executeExport();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: !result.success,
          };
        }

        // Elicitation not supported - fall back to confirmation token
        const ttlInfo = getTtlInfo();
        const confirmationToken = store.storePendingAction(
          `Export mnemonic for account "${name}"`,
          executeExport,
          async (context) => {
            const authManager = getAuthManager();
            const authResult = await authManager.authenticate({
              action: "export_mnemonic",
              totpCode: context?.totpCode,
            });
            if (!authResult.success) {
              throw new Error(
                `Authentication required: ${authResult.error ?? "Unknown error"}`,
              );
            }
          },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "pending_confirmation",
                  summary: `Export mnemonic for account "${name}"`,
                  warning:
                    "The recovery phrase will be displayed after confirmation. " +
                    "Anyone with access to this phrase has full control over the account's assets.",
                  confirmationToken,
                  expiresIn: ttlInfo.expiresIn,
                  expiresAt: ttlInfo.expiresAt,
                  ttlWarning: ttlInfo.ttlWarning,
                  instruction:
                    "Call confirm-action with this token to export the mnemonic.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // ===== Prompts (slash commands) =====

    server.registerPrompt(
      "get-started",
      {
        description:
          "Get started with the wallet - check setup status and see what you can do",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "I want to get started with my wallet.",
                  "",
                  "Please:",
                  "1. Use the onboarding-status tool to check my current setup",
                  "2. If I don't have an account, guide me through creating one",
                  "3. If I have an account, show me my addresses and available actions",
                  "4. Give me a brief overview of what I can do with this wallet",
                  "5. Mention that I can optionally set up biometric authentication (auth-status) for extra security",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "create-account",
      {
        description: "Create a new wallet account with a fresh mnemonic",
        argsSchema: {
          name: z
            .string()
            .optional()
            .describe("Account name (e.g., 'trading', 'savings')"),
          words: z
            .enum(["12", "24"])
            .optional()
            .describe("Mnemonic word count: 12 or 24 (default: 24)"),
        },
      },
      async ({ name, words }) => {
        const parts = ["I want to create a new wallet account."];
        if (name) parts.push(`Name: ${name}`);
        if (words) parts.push(`Word count: ${words}`);
        parts.push(
          "",
          "Please use the create-account tool with these parameters.",
          "After creation, show me the account details and addresses.",
        );
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

    server.registerPrompt(
      "import-account",
      {
        description: "Import an existing wallet using a mnemonic phrase",
        argsSchema: {
          name: z
            .string()
            .optional()
            .describe("Account name for the imported wallet"),
        },
      },
      async ({ name }) => {
        const parts = [
          "I want to import an existing wallet using my mnemonic phrase.",
        ];
        if (name) parts.push(`Account name: ${name}`);
        parts.push(
          "",
          "SECURITY WARNING: The mnemonic will be visible in this conversation.",
          "",
          "Please ask me for:",
          "1. Account name (if not provided)",
          "2. My mnemonic phrase",
          "",
          "Then use the import-account tool to import it.",
        );
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

    server.registerPrompt(
      "delete-account",
      {
        description: "Delete a wallet account (requires confirmation)",
        argsSchema: {
          name: z.string().optional().describe("Name of the account to delete"),
        },
      },
      async ({ name }) => {
        const parts = ["I want to delete a wallet account."];
        if (name) parts.push(`Account name: ${name}`);
        parts.push(
          "",
          "Please:",
          "1. Show me the list of accounts if name not provided",
          "2. Use delete-account tool (returns confirmation token)",
          "3. Ask me to confirm before executing",
          "4. Use confirm-action to complete deletion",
        );
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

    server.registerPrompt(
      "switch-account",
      {
        description: "Switch to a different wallet account",
        argsSchema: {
          name: z
            .string()
            .optional()
            .describe("Name of the account to switch to"),
        },
      },
      async ({ name }) => {
        const parts = ["I want to switch to a different account."];
        if (name) parts.push(`Switch to: ${name}`);
        parts.push(
          "",
          "Please:",
          "1. List available accounts if name not provided",
          "2. Use switch-account tool",
          "3. Show the new active account's addresses",
        );
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

    server.registerPrompt(
      "list-accounts",
      {
        description: "List all wallet accounts and their status",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "Show me all my wallet accounts.",
                  "",
                  "Use the list-accounts tool and display:",
                  "- Account names",
                  "- Account types (mnemonic)",
                  "- Which one is active",
                  "- Creation dates if available",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerTool(
      "get-account-addresses",
      {
        description:
          "Get all wallet addresses for the currently active account across all ecosystems",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const config = await listAccounts();
        if (!config.activeAccount) {
          // Return setup guide instead of error
          const setupResponse = createSetupRequiredResponse({
            attemptedAction: "get-account-addresses",
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(setupResponse, null, 2),
              },
            ],
          };
        }

        const accountInfo = config.accounts[config.activeAccount];
        if (!accountInfo) {
          return {
            content: [
              {
                type: "text",
                text: `Active account "${config.activeAccount}" not found.`,
              },
            ],
            isError: true,
          };
        }

        // Get addresses from all adapters
        const mnemonic = await loadMnemonicForAccount(config.activeAccount);
        if (!mnemonic) {
          // Return setup guide instead of error
          const setupResponse = createSetupRequiredResponse({
            attemptedAction: "get-account-addresses",
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ...setupResponse,
                    note: `Account "${config.activeAccount}" exists but has no mnemonic stored. You may need to re-import or delete and recreate this account.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Collect addresses from all adapters (all chains)
        const addresses: Record<string, Record<string, string>> = {};
        const errors: Record<string, string> = {};

        for (const [type, adapter] of store.getAdapters()) {
          try {
            const client = await store.getClientFor(type);
            if (adapter.getAllAddresses) {
              addresses[adapter.displayName] =
                await adapter.getAllAddresses(client);
            } else if (adapter.getDisplayAddress) {
              addresses[adapter.displayName] = {
                default: await adapter.getDisplayAddress(client),
              };
            }
          } catch (error) {
            errors[adapter.displayName] =
              error instanceof Error ? error.message : String(error);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  account: config.activeAccount,
                  type: "mnemonic",
                  addresses,
                  ...(Object.keys(errors).length > 0 && { errors }),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  },
};

export default accountsPlugin;

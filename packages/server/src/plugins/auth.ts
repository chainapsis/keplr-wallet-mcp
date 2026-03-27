/**
 * Authentication Plugin
 *
 * MCP tools for managing authentication settings.
 * Unified interface for all auth providers (biometric, TOTP, etc.)
 */

import { z } from "zod";
import {
  enableProviderForAction,
  loadAuthConfig,
  saveAuthConfig,
} from "../auth/config.js";
import { getAuthManager } from "../auth/manager.js";
import type { AuthAction } from "../auth/types.js";
import type { SuggestedAction } from "../errors.js";
import {
  requestConfirmation,
  requestTotpCode,
} from "../mcp-features/elicitation.js";
import { getTtlInfo } from "../store.js";
import type { KeplrPlugin } from "./types.js";

const authPlugin: KeplrPlugin = {
  name: "authentication",
  register(server, store) {
    // --- Tools ---

    /**
     * auth-status: Check overall authentication configuration
     * Enhanced to include TOTP status
     */
    server.registerTool(
      "auth-status",
      {
        description:
          "Check authentication configuration, available methods, and their status. " +
          "Shows all providers (biometric, TOTP) with setup state.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const manager = getAuthManager();
        const status = await manager.getStatus();

        // Get TOTP-specific status (using typed helper)
        const totpProvider = manager.getTotpProvider();
        const totpStatus = totpProvider ? await totpProvider.getStatus() : null;

        // Get biometric availability
        const biometricProvider = manager.getProvider("biometric");
        const biometricAvailable = biometricProvider
          ? await biometricProvider.isAvailable()
          : false;

        // Check for unprotected destructive actions
        const warnings: string[] = [];
        if (status.enabled) {
          const config = await loadAuthConfig();
          for (const action of [
            "delete_account",
            "export_mnemonic",
          ] as AuthAction[]) {
            const req = config.requirements[action];
            if (!req?.enabled) {
              warnings.push(
                `'${action}' is not protected by authentication. Use auth-setup with protectDestructiveActions=true to enable.`,
              );
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...status,
                  ...(warnings.length > 0 && { warnings }),
                  providers: {
                    biometric: {
                      available: biometricAvailable,
                      configured: biometricAvailable,
                      note: biometricAvailable
                        ? "Ready to use"
                        : "Hardware not available",
                    },
                    totp: totpStatus
                      ? {
                          available: true,
                          configured: totpStatus.configured,
                          setupInProgress: totpStatus.setupInProgress,
                          authenticatorType: totpStatus.authenticatorType,
                          note: totpStatus.configured
                            ? "Ready to use"
                            : totpStatus.setupInProgress
                              ? "Setup in progress - use auth-verify-setup to complete"
                              : "Not configured - use auth-setup to start",
                        }
                      : { available: false },
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    /**
     * auth-available-methods: Check available auth methods for a specific action
     * (Previously implemented for UX improvement)
     */
    server.registerTool(
      "auth-available-methods",
      {
        description:
          "Check which authentication methods are available and configured for transactions. " +
          "Use this before confirm-action to see what options you have.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
        inputSchema: {
          action: z
            .enum(["delete_account", "export_mnemonic"])
            .optional()
            .default("delete_account")
            .describe("The action to check authentication for"),
        },
      },
      async ({ action }) => {
        const manager = getAuthManager();
        const config = await loadAuthConfig();

        // Check if auth is required for this action
        const requirement = config.requirements[action as AuthAction];
        const isAuthRequired = config.enabled && requirement?.enabled;

        if (!isAuthRequired) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    authRequired: false,
                    message: `Authentication is not required for '${action}'`,
                    tip: "Transactions will execute without authentication",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Get available methods with their status
        const methods: Array<{
          id: string;
          name: string;
          available: boolean;
          configured: boolean;
          requiresCode: boolean;
          note?: string;
        }> = [];

        // Check TOTP
        const totpProvider = manager.getTotpProvider();
        if (totpProvider) {
          const totpStatus = await totpProvider.getStatus();
          methods.push({
            id: "totp",
            name: "Google Authenticator",
            available: true,
            configured: totpStatus.configured,
            requiresCode: true,
            note: totpStatus.configured
              ? "Provide totpCode parameter with 6-digit code"
              : "Not set up. Use auth-setup --provider totp first",
          });
        }

        // Check biometric
        const biometricProvider = manager.getProvider("biometric");
        if (biometricProvider) {
          const biometricAvailable = await biometricProvider.isAvailable();
          methods.push({
            id: "biometric",
            name: "Touch ID / Face ID",
            available: biometricAvailable,
            configured: biometricAvailable,
            requiresCode: false,
            note: biometricAvailable
              ? "Will prompt for biometric scan automatically"
              : "Biometric hardware not available on this system",
          });
        }

        // Build suggested actions
        const suggestedActions: SuggestedAction[] = [];

        const hasTotpConfigured = methods.find(
          (m) => m.id === "totp" && m.configured,
        );
        const hasBiometricAvailable = methods.find(
          (m) => m.id === "biometric" && m.available,
        );

        if (!hasTotpConfigured && !hasBiometricAvailable) {
          suggestedActions.push({
            tool: "auth-setup",
            reason: "Set up TOTP (Google Authenticator) for authentication",
            params: { provider: "totp" },
            priority: 1,
          });
          suggestedActions.push({
            tool: "auth-setup",
            reason: "Set up biometric authentication",
            params: { provider: "biometric" },
            priority: 2,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  authRequired: true,
                  action,
                  methods,
                  usage: {
                    note: "Authentication is handled automatically when calling tools that require it (e.g., delete-account, auth-disable). Biometric is attempted first, with TOTP fallback via elicitation.",
                  },
                  ...(suggestedActions.length > 0 && { suggestedActions }),
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
      "auth-enable",
      {
        description:
          "Enable the authentication system. If providers are already configured, requires authentication first to verify identity.",
        annotations: {
          idempotentHint: true,
        },
      },
      async () => {
        const manager = getAuthManager();
        const config = await loadAuthConfig();

        // Check if any providers are configured
        const hasProviders =
          config.requirements.delete_account.providers.length > 0;

        if (hasProviders) {
          // Providers exist — authenticate before enabling (skipEnabledCheck since auth is currently off)
          let authResult = await manager.authenticate({
            action: "delete_account",
            skipEnabledCheck: true,
          });

          // Biometric failed/cancelled → fall back to TOTP via elicitation (only if TOTP is configured)
          if (
            !authResult.success &&
            (await manager.getTotpProvider()?.isAvailable())
          ) {
            const totpCode = await requestTotpCode(server.server);
            if (totpCode) {
              authResult = await manager.authenticate({
                action: "delete_account",
                skipEnabledCheck: true,
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
                      error: `Authentication failed: ${authResult.error ?? "Unknown error"}`,
                      hint: "You must authenticate with your existing provider before re-enabling authentication.",
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
        } else {
          // No providers configured — suggest setup first
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      "No authentication providers configured. Set up a provider first.",
                    suggestedActions: [
                      {
                        tool: "auth-setup",
                        reason: "Set up biometric authentication",
                        params: { provider: "biometric" },
                        priority: 1,
                      },
                      {
                        tool: "auth-setup",
                        reason: "Set up TOTP authentication",
                        params: { provider: "totp" },
                        priority: 2,
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

        // Enable auth
        config.enabled = true;
        await saveAuthConfig(config);
        await manager.reloadConfig();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "Authentication system enabled",
                  status: await manager.getStatus(),
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
      "auth-disable",
      {
        description:
          "Disable the authentication system. This is a destructive operation that removes all transaction security.",
        annotations: {
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async () => {
        const manager = getAuthManager();

        // Execute the actual disable
        const executeDisable = async () => {
          const config = await loadAuthConfig();
          config.enabled = false;
          await saveAuthConfig(config);
          await getAuthManager().reloadConfig();
          return { success: true, message: "Authentication system disabled" };
        };

        // Step 1: Confirm intent first (before authentication)
        const confirmed = await requestConfirmation(server.server, {
          title: "Disable Authentication",
          message:
            "⚠️ You are about to DISABLE the authentication system.\n\n" +
            "This will allow all transactions to execute without any authentication.\n" +
            "Are you sure you want to proceed?",
          confirmLabel: "I want to disable authentication",
        });

        if (confirmed === false) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: "Cancelled. Authentication system remains enabled.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        if (confirmed === true) {
          // Step 2: Authenticate identity
          let authResult = await manager.authenticate({
            action: "delete_account",
          });

          // Biometric failed/cancelled → fall back to TOTP via elicitation (only if TOTP is configured)
          if (
            !authResult.success &&
            (await manager.getTotpProvider()?.isAvailable())
          ) {
            const totpCode = await requestTotpCode(server.server);
            if (totpCode) {
              authResult = await manager.authenticate({
                action: "delete_account",
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
                      error:
                        "Authentication required to disable the authentication system",
                      hint: "You confirmed intent but authentication failed. Try again.",
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

          const result = await executeDisable();
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // Elicitation not supported — fall back to confirmation token
        const ttlInfo = getTtlInfo();
        const confirmationToken = store.storePendingAction(
          "DISABLE AUTHENTICATION",
          async () => executeDisable(),
          async (context) => {
            const authResult = await manager.authenticate({
              action: "delete_account",
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
                  summary: "Disable the authentication system",
                  warning:
                    "This will allow all transactions to execute without any authentication.",
                  confirmationToken,
                  expiresIn: ttlInfo.expiresIn,
                  expiresAt: ttlInfo.expiresAt,
                  ttlWarning: ttlInfo.ttlWarning,
                  instruction:
                    "Call confirm-action with this token to disable authentication.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    /**
     * auth-setup: Unified setup for all providers
     * - biometric: Single-step setup (completes immediately)
     * - totp: Two-step setup (returns QR code, needs auth-verify-setup)
     */
    server.registerTool(
      "auth-setup",
      {
        description:
          "Setup an authentication provider. " +
          "For biometric: completes immediately if hardware is available. " +
          "For TOTP (Google Authenticator): returns a QR code - use auth-verify-setup to complete.",
        annotations: {
          idempotentHint: false,
        },
        inputSchema: {
          provider: z
            .enum(["biometric", "totp"])
            .describe(
              "Provider to setup: 'biometric' (Touch ID) or 'totp' (Google Authenticator)",
            ),
          action: z
            .enum(["delete_account", "export_mnemonic"])
            .optional()
            .default("delete_account")
            .describe("Action to require authentication for"),
          protectDestructiveActions: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              "Also enable auth for destructive actions (delete_account, export_mnemonic)",
            ),
          // TOTP-specific options
          accountLabel: z
            .string()
            .optional()
            .describe(
              "For TOTP: Label shown in authenticator app (default: 'Keplr Wallet')",
            ),
        },
      },
      async ({ provider, action, protectDestructiveActions, accountLabel }) => {
        const manager = getAuthManager();

        // Handle TOTP setup (two-step process)
        if (provider === "totp") {
          const totpProvider = manager.getTotpProvider();

          if (!totpProvider) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: false,
                      error: "TOTP provider not available",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // If TOTP is already configured, skip setup and just enable for the action
          if (await totpProvider.isAvailable()) {
            await enableProviderForAction(action as AuthAction, "totp");

            const enabledActions: string[] = [action];
            if (protectDestructiveActions) {
              for (const extraAction of [
                "delete_account",
                "export_mnemonic",
              ] as const) {
                if (extraAction !== action) {
                  await enableProviderForAction(extraAction, "totp");
                  enabledActions.push(extraAction);
                }
              }
            }

            const config = await loadAuthConfig();
            if (!config.enabled) {
              config.enabled = true;
              await saveAuthConfig(config);
            }

            await manager.reloadConfig();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      setupPending: false,
                      provider: "totp",
                      message: `TOTP already configured. Enabled for: ${enabledActions.join(", ")}`,
                      status: await manager.getStatus(),
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const result = await totpProvider.setup({ account: accountLabel });

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          // TOTP needs verification - return QR code and instructions
          // Check if QR code was generated (qrCode field exists)
          const hasQrCode = result.data && "qrCode" in result.data;

          if (hasQrCode && typeof result.data?.qrCode === "string") {
            // Return QR code as separate content block for better display
            return {
              content: [
                {
                  type: "text",
                  text: result.data.qrCode,
                },
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      setupPending: true,
                      provider: "totp",
                      manualEntryKey: result.data?.manualEntryKey,
                      expiresIn: result.data?.expiresIn,
                      nextStep: {
                        tool: "auth-verify-setup",
                        params: {
                          provider: "totp",
                          code: "<6-digit code from app>",
                          action,
                          protectDestructiveActions,
                        },
                      },
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // No QR code - show manual entry instructions
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    setupPending: true,
                    provider: "totp",
                    message: "Add this account to Google Authenticator",
                    ...result.data,
                    nextStep: {
                      tool: "auth-verify-setup",
                      params: {
                        provider: "totp",
                        code: "<6-digit code from app>",
                        action,
                      },
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Handle biometric setup (single-step)
        const providerInstance = manager.getProvider(provider);
        if (!providerInstance) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Provider not found: ${provider}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const available = await providerInstance.isAvailable();
        if (!available) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Provider '${provider}' is not available on this system`,
                    hint:
                      provider === "biometric"
                        ? "Biometric authentication requires Touch ID, Face ID, or equivalent hardware"
                        : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Setup the provider
        const setupResult = await manager.setupProvider(provider, {});

        if (!setupResult.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(setupResult, null, 2),
              },
            ],
          };
        }

        // Enable the provider for the specified action
        await enableProviderForAction(action as AuthAction, provider);

        // Also enable for destructive actions if requested
        const enabledActions: string[] = [action];
        if (protectDestructiveActions) {
          for (const extraAction of [
            "delete_account",
            "export_mnemonic",
          ] as const) {
            if (extraAction !== action) {
              await enableProviderForAction(extraAction, provider);
              enabledActions.push(extraAction);
            }
          }
        }

        // Enable auth system if not already enabled
        const config = await loadAuthConfig();
        if (!config.enabled) {
          config.enabled = true;
          await saveAuthConfig(config);
        }

        // Reload config
        await manager.reloadConfig();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  setupPending: false,
                  provider,
                  message: `Authentication provider '${provider}' enabled for: ${enabledActions.join(", ")}`,
                  setupResult: setupResult.data,
                  status: await manager.getStatus(),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    /**
     * auth-verify-setup: Complete two-step setup (for TOTP)
     */
    server.registerTool(
      "auth-verify-setup",
      {
        description:
          "Complete setup for providers that require verification (e.g., TOTP). " +
          "Use this after auth-setup when setupPending is true.",
        annotations: {
          idempotentHint: false,
        },
        inputSchema: {
          provider: z
            .enum(["totp"])
            .describe("Provider to verify setup for (currently only 'totp')"),
          code: z
            .string()
            .length(6)
            .regex(/^\d{6}$/, "Code must be 6 digits")
            .describe("6-digit verification code from authenticator app"),
          action: z
            .enum(["delete_account", "export_mnemonic"])
            .optional()
            .default("delete_account")
            .describe("Action to require authentication for"),
          protectDestructiveActions: z
            .boolean()
            .optional()
            .default(true)
            .describe(
              "Also enable auth for destructive actions (delete_account, export_mnemonic)",
            ),
        },
      },
      async ({ provider, code, action, protectDestructiveActions }) => {
        const manager = getAuthManager();

        if (provider === "totp") {
          const totpProvider = manager.getTotpProvider();

          if (!totpProvider) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: false,
                      error: "TOTP provider not available",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const result = await totpProvider.verifySetup(code);

          if (!result.success) {
            // Add suggestedActions for retry
            const suggestedActions: SuggestedAction[] = [
              {
                tool: "auth-verify-setup",
                reason: "Retry with correct code",
                params: { provider: "totp", code: "<correct 6-digit code>" },
                priority: 1,
              },
              {
                tool: "auth-setup",
                reason: "Start over with new QR code",
                params: { provider: "totp" },
                priority: 2,
              },
            ];

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ...result,
                      suggestedActions,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Enable the provider for the specified action
          await enableProviderForAction(action as AuthAction, "totp");

          // Also enable for destructive actions if requested
          const enabledActions: string[] = [action];
          if (protectDestructiveActions) {
            for (const extraAction of [
              "delete_account",
              "export_mnemonic",
            ] as const) {
              if (extraAction !== action) {
                await enableProviderForAction(extraAction, "totp");
                enabledActions.push(extraAction);
              }
            }
          }

          // Enable auth system if not already enabled
          const config = await loadAuthConfig();
          if (!config.enabled) {
            config.enabled = true;
            await saveAuthConfig(config);
          }

          // Reload config
          await manager.reloadConfig();

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    provider: "totp",
                    message: `TOTP (Google Authenticator) setup complete and enabled for: ${enabledActions.join(", ")}`,
                    ...result.data,
                    status: await manager.getStatus(),
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: `Provider '${provider}' does not require verification step`,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    /**
     * auth-provider-disable: Unified disable for all providers
     * Enhanced to handle TOTP cleanup properly
     */
    server.registerTool(
      "auth-provider-disable",
      {
        description:
          "Disable an authentication provider and remove its configuration. " +
          "For TOTP, this removes the saved secret - you'll need to set up again.",
        annotations: {
          idempotentHint: true,
        },
        inputSchema: {
          provider: z
            .enum(["biometric", "totp"])
            .describe("Provider to disable: 'biometric' or 'totp'"),
        },
      },
      async ({ provider }) => {
        const manager = getAuthManager();

        let authResult = await manager.authenticate({
          action: "delete_account",
        });

        // Biometric failed/cancelled → fall back to TOTP via elicitation (only if TOTP is configured)
        if (
          !authResult.success &&
          (await manager.getTotpProvider()?.isAvailable())
        ) {
          const totpCode = await requestTotpCode(server.server);
          if (totpCode) {
            authResult = await manager.authenticate({
              action: "delete_account",
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
                    error: `Authentication required to disable provider '${provider}'`,
                    hint: "The authentication system is currently enabled. You must authenticate first before disabling a provider.",
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

        try {
          // disableProvider() internally calls provider.disable() (which clears TOTP secret)
          // so we must NOT call totpProvider.disable() before the last-provider guard check
          await manager.disableProvider(provider);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                    suggestedActions: [
                      {
                        tool: "auth-disable",
                        reason:
                          "Disable the entire authentication system instead",
                        priority: 1,
                      },
                      {
                        tool: "auth-status",
                        reason: "View current authentication configuration",
                        priority: 2,
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
        await manager.reloadConfig();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Authentication provider '${provider}' disabled`,
                  hint:
                    provider === "totp"
                      ? "Use auth-setup --provider totp to set up again"
                      : undefined,
                  status: await manager.getStatus(),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    // --- Prompts ---

    server.registerPrompt(
      "setup-authentication",
      {
        description: "Guide for setting up transaction authentication",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "I want to set up authentication for my wallet transactions.",
                  "",
                  "Please help me:",
                  "1. Check what authentication methods are available on my system (auth-status)",
                  "2. Set up my preferred method:",
                  "   - For biometric: auth-setup --provider biometric",
                  "   - For TOTP: auth-setup --provider totp, then auth-verify-setup",
                  "3. Enable authentication with auth-enable",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "setup-totp",
      {
        description: "Guide for setting up TOTP (Google Authenticator) 2FA",
      },
      async () => {
        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: [
                  "I want to set up Google Authenticator for my wallet.",
                  "",
                  "Please help me:",
                  "1. Start setup with auth-setup --provider totp",
                  "2. Show me the QR code to scan with my Google Authenticator app",
                  "3. Ask me to enter the 6-digit code from the app",
                  "4. Verify and complete setup with auth-verify-setup --provider totp --code <my-code>",
                ].join("\n"),
              },
            },
          ],
        };
      },
    );
  },
};

export default authPlugin;

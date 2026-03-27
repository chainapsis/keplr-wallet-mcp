# MCP Implementation Patterns

## Table of Contents
- [1. Confirmation Flow](#1-confirmation-flow)
- [2. Setup Guide Response](#2-setup-guide-response)
- [3. Suggested Actions](#3-suggested-actions)
- [4. Progress Notifications](#4-progress-notifications)
- [5. Error Handling](#5-error-handling)
- [6. Dynamic Tool Enable/Disable](#6-dynamic-tool-enabledisable)

---

## 1. Confirmation Flow

Split dangerous operations into two steps: (1) generate confirmation token, (2) execute after user confirmation.

### Transaction Tool (Token Generation)

```typescript
const pendingActions = new Map<string, {
  action: () => Promise<unknown>;
  summary: string;
  expiresAt: number;
}>();

const TOKEN_TTL_MS = 5 * 60 * 1000;

server.registerTool("send-tokens", {
  description: "Send tokens. Returns confirmation token.",
  inputSchema: {
    to: z.string().describe("Recipient address"),
    amount: z.string().describe("Amount (e.g., '1 ATOM')"),
  },
  annotations: { destructiveHint: true },
}, async ({ to, amount }) => {
  const tx = await prepareSendTransaction({ to, amount });
  const token = crypto.randomUUID();

  pendingActions.set(token, {
    action: () => executeSendTransaction(tx),
    summary: `Send ${amount} to ${to}`,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "pending_confirmation",
        confirmationToken: token,
        summary: `Send ${amount} to ${to}`,
        expiresIn: "5 minutes",
        preview: { from: tx.senderAddress, to, amount: tx.amount, fee: tx.estimatedFee },
        instructions: "Use confirm-action tool to execute.",
      }, null, 2),
    }],
  };
});
```

### Confirmation Tool (Execution)

```typescript
server.registerTool("confirm-action", {
  description: "Confirm and execute pending transaction",
  inputSchema: { confirmationToken: z.string() },
}, async ({ confirmationToken }) => {
  const pending = pendingActions.get(confirmationToken);

  if (!pending || Date.now() > pending.expiresAt) {
    pendingActions.delete(confirmationToken);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "Token not found or expired" }) }],
      isError: true,
    };
  }

  try {
    const result = await pending.action();
    pendingActions.delete(confirmationToken);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, ...result }) }] };
  } catch (error) {
    return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }], isError: true };
  }
});
```

---

## 2. Setup Guide Response

Return guidance instead of error when setup is required.

```typescript
interface SetupGuide {
  options: Array<{ tool: string; description: string; recommendedFor?: string }>;
  recommendation: string;
  tip?: string;
}

const DEFAULT_SETUP_GUIDE: SetupGuide = {
  options: [
    { tool: "create-account", description: "Create new wallet", recommendedFor: "New users" },
    { tool: "import-account", description: "Import existing mnemonic", recommendedFor: "Existing wallet" },
  ],
  recommendation: "create-account",
};

function createSetupRequiredResponse(attemptedAction?: string) {
  return {
    status: "setup_required",
    message: "Wallet setup required. Choose one of the options below.",
    ...(attemptedAction && { attemptedAction }),
    setupGuide: DEFAULT_SETUP_GUIDE,
  };
}

// Usage in tool
server.registerTool("get-balances", { ... }, async ({ chain }) => {
  const account = getActiveAccount();
  if (!account) {
    return {
      content: [{ type: "text", text: JSON.stringify(createSetupRequiredResponse("check balances"), null, 2) }],
    };
  }
  // Normal processing...
});
```

---

## 3. Suggested Actions

Include next-step suggestions in query results.

```typescript
interface SuggestedAction {
  tool: string;
  reason: string;
  params?: Record<string, unknown>;
  priority?: number;  // Lower = higher priority
}

server.registerTool("get-balances", { ... }, async ({ chain }) => {
  const balances = await fetchBalances(chain);
  const staking = await getStakingInfo(chain);

  const suggestedActions: SuggestedAction[] = [];

  if (staking.pendingRewards > 0) {
    suggestedActions.push({
      tool: "claim-rewards",
      reason: `${staking.pendingRewards} rewards available`,
      priority: 0,
    });
  }

  if (balances.total > 0 && staking.delegations.length === 0) {
    suggestedActions.push({
      tool: "delegate",
      reason: "Stake to earn rewards",
      priority: 1,
    });
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        chain,
        balances,
        ...(suggestedActions.length > 0 && {
          suggestedActions: suggestedActions.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)),
        }),
      }, null, 2),
    }],
  };
});
```

---

## 4. Progress Notifications

Report progress for long-running operations.

### Progress Reporter Utility

```typescript
interface ProgressReporter {
  report(progress: number, total?: number, message?: string): Promise<void>;
  complete(message?: string): Promise<void>;
  fail(error: string): Promise<void>;
}

function createProgressReporter(server: Server, progressToken: string | number): ProgressReporter {
  let lastProgress = 0;

  return {
    async report(progress, total, message) {
      if (progress <= lastProgress) progress = lastProgress + 1;
      lastProgress = progress;

      await server.notification({
        method: "notifications/progress",
        params: { progressToken, progress, ...(total && { total }), ...(message && { message }) },
      });
    },
    async complete(message) {
      await server.notification({
        method: "notifications/progress",
        params: { progressToken, progress: 100, total: 100, message },
      });
    },
    async fail(error) {
      await server.notification({
        method: "notifications/progress",
        params: { progressToken, progress: lastProgress, message: `Error: ${error}` },
      });
    },
  };
}
```

### Usage in Tool

```typescript
server.registerTool("confirm-action", { ... }, async ({ confirmationToken }, extra) => {
  const progressToken = extra._meta?.progressToken;
  const reporter = progressToken ? createProgressReporter(server.server, progressToken) : null;

  try {
    await reporter?.report(10, 100, "Preparing transaction...");
    const tx = await prepareTx(confirmationToken);

    await reporter?.report(30, 100, "Signing...");
    const signed = await signTx(tx);

    await reporter?.report(50, 100, "Broadcasting...");
    const result = await broadcastTx(signed);

    await reporter?.report(70, 100, "Waiting for confirmation...");
    await waitForConfirmation(result.txHash);

    await reporter?.complete("Transaction confirmed");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    await reporter?.fail(error.message);
    throw error;
  }
});
```

---

## 5. Error Handling

Classify errors and suggest recovery actions.

```typescript
enum ErrorCategory {
  NETWORK = "network",
  VALIDATION = "validation",
  WALLET = "wallet",
  TIMEOUT = "timeout",
  SETUP_REQUIRED = "setup_required",
  UNKNOWN = "unknown",
}

interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  suggestion?: string;
  retryAction?: { tool: string; params?: Record<string, unknown> };
}

const ERROR_PATTERNS = [
  { patterns: [/timeout/i], category: ErrorCategory.TIMEOUT, recoverable: true, suggestion: "Network timeout. Check connection and retry." },
  { patterns: [/insufficient/i], category: ErrorCategory.VALIDATION, recoverable: false, suggestion: "Insufficient balance." },
  { patterns: [/user rejected/i], category: ErrorCategory.WALLET, recoverable: true, suggestion: "User cancelled. Retry if needed." },
];

function classifyError(error: Error): ClassifiedError {
  for (const { patterns, category, recoverable, suggestion } of ERROR_PATTERNS) {
    if (patterns.some(p => p.test(error.message))) {
      return { category, message: error.message, recoverable, suggestion };
    }
  }
  return { category: ErrorCategory.UNKNOWN, message: error.message, recoverable: false };
}

// Usage
server.registerTool("send-tokens", { ... }, async (args) => {
  try {
    const result = await sendTokens(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const classified = classifyError(error);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          isError: true,
          ...classified,
          ...(classified.recoverable && { retryAction: { tool: "send-tokens", params: args } }),
        }, null, 2),
      }],
      isError: true,
    };
  }
});
```

---

## 6. Dynamic Tool Enable/Disable

Enable/disable tools at runtime based on state.

```typescript
const adminTool = server.registerTool("admin-operation", {
  description: "Admin only operation",
  annotations: { destructiveHint: true },
}, async () => { /* ... */ });

// Initially disabled
adminTool.disable();

// Enable on admin login
function onAdminLogin() {
  adminTool.enable();
  server.sendToolListChanged();
}

function onLogout() {
  adminTool.disable();
  server.sendToolListChanged();
}
```

### Conditional Tool Visibility

```typescript
const sendTool = server.registerTool("send-tokens", { ... }, handler);

function updateToolVisibility() {
  const hasAccount = getActiveAccount() !== null;
  hasAccount ? sendTool.enable() : sendTool.disable();
  server.sendToolListChanged();
}

onAccountChange(() => updateToolVisibility());
```

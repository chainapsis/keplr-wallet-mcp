# MCP Tool 구현 예제

## Query Tool 예제 (읽기 전용)

체인에서 잔액을 조회하는 도구:

```typescript
import { z } from "zod";
import { createSetupRequiredResponse, isSetupRequiredError, type SuggestedAction } from "../../errors.js";
import type { KeplrPlugin } from "../types.js";

const queryPlugin: KeplrPlugin = {
  name: "cosmos-query",
  register(server, store) {
    server.registerTool(
      "get-balances",
      {
        description: "Query all token balances for the wallet on a specific chain",
        inputSchema: {
          chain: z.string().describe("Chain ID or name (e.g., 'cosmoshub-4' or 'osmosis')"),
        },
      },
      async ({ chain: chainInput }) => {
        try {
          const client = await store.getClientFor("cosmos");
          const chain = resolveChain(chainInput);
          const address = await client.getAddress(chain);
          const balances = await client.getBalances(chain);

          // 다음 단계 제안
          const suggestedActions: SuggestedAction[] = [];
          const hasBalance = balances.some((b) => BigInt(b.amount) > 0n);

          if (hasBalance) {
            suggestedActions.push({
              tool: "get-staking-info",
              reason: "Check your staking positions and pending rewards",
              params: { chain: chain.chainId },
              priority: 1,
            });
            suggestedActions.push({
              tool: "delegate",
              reason: "Stake tokens to earn rewards",
              params: { chain: chain.chainId },
              priority: 2,
            });
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                address,
                chainId: chain.chainId,
                balances,
                suggestedActions,
              }, null, 2),
            }],
          };
        } catch (error) {
          // Setup required 에러 처리
          if (isSetupRequiredError(error)) {
            const response = createSetupRequiredResponse({
              attemptedAction: "get-balances",
            });
            return {
              content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
          }
          throw error;
        }
      }
    );
  },
};

export default queryPlugin;
```

## Transaction Tool 예제 (상태 변경)

토큰 전송 도구 (확인 토큰 패턴):

```typescript
import { z } from "zod";
import { storePending } from "../../pending-action.js";
import { getTtlInfo } from "../../store.js";
import type { KeplrPlugin } from "../types.js";

const transactionPlugin: KeplrPlugin = {
  name: "cosmos-transaction",
  register(server, store) {
    server.registerTool(
      "send-tokens",
      {
        description: "Send tokens to a recipient address. Returns a confirmation token.",
        inputSchema: {
          chain: z.string().describe("Chain ID or name"),
          recipientAddress: z.string().describe("Recipient address"),
          amount: z.string().describe("Amount (e.g., '1 ATOM', '1000000')"),
        },
      },
      async ({ chain: chainInput, recipientAddress, amount }) => {
        const client = await store.getClientFor("cosmos");
        const chain = resolveChain(chainInput);
        const summary = `Send ${amount} to ${recipientAddress} on ${chain.chainId}`;

        // 트랜잭션 미리보기 생성
        const preview = await buildTransactionPreview(client, chain, amount, recipientAddress);

        // 실행 함수를 confirmation token과 함께 저장
        const confirmationToken = storePending(
          summary,
          chain.chainId,
          async () => {
            return await client.sendTokens(chain, recipientAddress, amount);
          }
        );

        const ttlInfo = getTtlInfo();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "pending_confirmation",
              summary,
              preview,
              confirmationToken,
              expiresIn: ttlInfo.expiresIn,
              expiresAt: ttlInfo.expiresAt,
              instruction: "Call confirm-action with this token to execute.",
            }, null, 2),
          }],
        };
      }
    );
  },
};

export default transactionPlugin;
```

## Progress 사용 예제

장시간 작업에서 진행 상황 보고:

```typescript
import { createProgressReporter, TX_PROGRESS } from "../../mcp-features/progress.js";

server.registerTool(
  "confirm-action",
  {
    description: "Confirm and execute a pending transaction",
    inputSchema: {
      confirmationToken: z.string().describe("The confirmation token"),
    },
  },
  async ({ confirmationToken }, extra) => {
    const progressToken = extra._meta?.progressToken;
    const reporter = progressToken
      ? createProgressReporter(server.server, progressToken)
      : null;

    try {
      await reporter?.report(10, 100, TX_PROGRESS.PREPARING.message);
      await reporter?.report(30, 100, TX_PROGRESS.SIGNING.message);

      const result = await executePending(confirmationToken);

      await reporter?.report(70, 100, TX_PROGRESS.BROADCASTING.message);
      await reporter?.complete(TX_PROGRESS.CONFIRMED.message);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      await reporter?.fail(error.message);
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);
```

## Resource 예제 (템플릿)

체인별 포트폴리오 리소스:

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chainCompletionProvider } from "../../mcp-features/completions.js";

server.registerResource(
  "chain-portfolio",
  new ResourceTemplate("wallet://portfolio/{chainId}", {
    list: undefined,  // 동적 목록 없음
    complete: {
      chainId: chainCompletionProvider,  // 자동완성 제공
    },
  }),
  { description: "Portfolio for a specific chain (balances + staking)" },
  async (uri, variables) => {
    const chainId = variables.chainId as string;
    const chain = resolveChain(chainId);
    const client = await store.getClientFor("cosmos");

    const [address, balances, delegations, rewards] = await Promise.all([
      client.getAddress(chain),
      client.getBalances(chain),
      client.getDelegations(chain),
      client.getRewards(chain),
    ]);

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          chainId: chain.chainId,
          chainName: chain.chainName,
          address,
          balances,
          staking: { delegations, rewards },
        }, null, 2),
      }],
    };
  }
);
```

## Prompt 예제

가이드 프롬프트:

```typescript
import { z } from "zod";

server.registerPrompt(
  "stake",
  {
    description: "Stake tokens to a validator (guided)",
    argsSchema: {
      chain: z.string().describe("Chain name (e.g., 'cosmos', 'osmosis')"),
      amount: z.string().optional().describe("Amount to stake"),
    },
  },
  async ({ chain, amount }) => {
    const parts = [`I want to stake tokens on ${chain} chain.`];
    if (amount) parts.push(`Amount: ${amount}`);
    parts.push(
      "",
      "Please help me:",
      "1. Check my available balance",
      "2. Show me top validators with their commission rates",
      "3. Prepare the delegation transaction",
      "4. Show me a summary before I confirm"
    );

    return {
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: parts.join("\n"),
        },
      }],
    };
  }
);
```

## Elicitation 예제

사용자 확인이 필요한 위험한 작업:

```typescript
import { requestConfirmation } from "../../mcp-features/elicitation.js";

server.registerTool(
  "delete-account",
  {
    description: "Delete an account permanently",
    inputSchema: {
      name: z.string().describe("Account name to delete"),
    },
  },
  async ({ name }) => {
    const executeDelete = async () => {
      await deleteMnemonicForAccount(name);
      await removeAccount(name);
      return { status: "success", message: `Account "${name}" deleted.` };
    };

    // Elicitation 시도 (클라이언트가 지원하는 경우)
    const confirmed = await requestConfirmation(server.server, {
      title: "Delete Account Confirmation",
      message: `Are you sure you want to delete account "${name}"? This cannot be undone.`,
      confirmLabel: "I want to delete this account",
    });

    // Elicitation 지원됨 - 결과에 따라 처리
    if (confirmed !== null) {
      if (!confirmed) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ status: "cancelled", message: "Deletion cancelled." }, null, 2),
          }],
        };
      }
      const result = await executeDelete();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // Elicitation 미지원 - 확인 토큰 폴백
    const confirmationToken = store.storePendingAction(`Delete account "${name}"`, executeDelete);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "pending_confirmation",
          summary: `Delete account "${name}"`,
          confirmationToken,
          instruction: "Call confirm-action to execute.",
        }, null, 2),
      }],
    };
  }
);
```

## 에러 처리 예제

분류된 에러 응답:

```typescript
import { classifyError, formatClassifiedError, enhanceWithRetryAction } from "../../errors.js";

server.registerTool(
  "risky-operation",
  { description: "An operation that might fail", inputSchema: { /* ... */ } },
  async (args) => {
    try {
      const result = await performOperation(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      let classified = classifyError(errorObj);

      // 재시도 액션 추가
      classified = enhanceWithRetryAction(classified, "risky-operation", args);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(formatClassifiedError(classified), null, 2),
        }],
        isError: true,
      };
    }
  }
);
```

## 완성도 높은 응답 구조

```typescript
// 성공 응답 (suggestedActions 포함)
{
  status: "success",
  data: {
    address: "cosmos1...",
    balances: [{ denom: "uatom", amount: "1000000" }],
  },
  suggestedActions: [
    { tool: "delegate", reason: "Stake to earn rewards", priority: 1 },
    { tool: "send-tokens", reason: "Send tokens", priority: 2 },
  ],
}

// 확인 대기 응답
{
  status: "pending_confirmation",
  summary: "Send 1 ATOM to cosmos1...",
  preview: {
    from: "cosmos1...",
    to: "cosmos1...",
    amount: { value: "1000000", denom: "uatom", formatted: "1 ATOM" },
    estimatedFee: { value: "5000", denom: "uatom", formatted: "0.005 ATOM" },
    warnings: [{ level: "warning", code: "LARGE_AMOUNT", message: "Using 90% of balance" }],
  },
  confirmationToken: "abc123...",
  expiresIn: "5 minutes",
  expiresAt: "2024-01-01T12:05:00Z",
  instruction: "Call confirm-action with this token to execute.",
}

// Setup 필요 응답
{
  status: "setup_required",
  message: "No wallet is configured yet.",
  setupGuide: {
    options: [
      { tool: "create-account", description: "Generate a new wallet" },
      { tool: "import-account", description: "Import existing mnemonic" },
    ],
    recommendation: "create-account",
  },
}

// 에러 응답
{
  isError: true,
  category: "network",
  message: "Connection timeout",
  recoverable: true,
  suggestion: "Check your network and try again.",
  retryAction: { tool: "get-balances", params: { chain: "cosmos" }, autoRetry: true },
}
```

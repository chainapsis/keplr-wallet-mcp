# 프로젝트 특화 패턴

이 문서는 keplr-mcp-server 프로젝트에서 사용하는 MCP 구현 패턴을 설명합니다.

## 플러그인 시스템

### KeplrPlugin 인터페이스

```typescript
// packages/server/src/plugins/types.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeplrStore } from "../store.js";

export interface KeplrPlugin {
  name: string;
  register(server: McpServer, store: KeplrStore): void | Promise<void>;
}
```

### 플러그인 등록 흐름

```typescript
// packages/server/src/plugins/index.ts
export async function registerAll(server: McpServer, store: KeplrStore): Promise<void> {
  // 1. Adapter 등록
  for (const adapter of allAdapters) {
    store.registerAdapter(adapter);
    if (adapter.initialize) await adapter.initialize();
  }

  // 2. 공통 플러그인 등록
  const commonPlugins = [accountsPlugin, confirmPlugin, authPlugin];
  for (const plugin of commonPlugins) {
    await plugin.register(server, store);
  }

  // 3. 생태계별 플러그인 (어댑터에서 제공)
  for (const adapter of allAdapters) {
    for (const plugin of adapter.getPlugins()) {
      await plugin.register(server, store);
    }
  }

  // 4. 프로토콜 플러그인 (Uniswap, Osmosis 등)
  const protocolPlugins = await discoverProtocolPlugins();
  for (const protocol of protocolPlugins) {
    await protocol.register(server, store);
  }
}
```

## Store 접근 패턴

### 클라이언트 가져오기

```typescript
// Cosmos 클라이언트
const cosmosClient = await store.getClientFor<CosmosClient>("cosmos");

// EVM 클라이언트
const evmClient = await store.getClientFor<EvmClient>("evm");
```

### 어댑터 순회

```typescript
for (const [type, adapter] of store.adapters) {
  if (adapter.getDisplayAddress) {
    const client = await store.getClientFor(type);
    const address = await adapter.getDisplayAddress(client);
  }
}
```

## Confirmation Token 패턴

### 토큰 저장

```typescript
import { storePending } from "../pending-action.js";
import { getTtlInfo } from "../store.js";

// 트랜잭션용
const token = storePending(
  summary: string,
  chainId: string,
  execute: () => Promise<TxResult>
);

// 일반 액션용
const token = store.storePendingAction(
  summary: string,
  execute: () => Promise<Result>
);

// TTL 정보
const ttlInfo = getTtlInfo();
// { expiresIn: "5 minutes", expiresAt: "2024-01-01T12:05:00Z", ttlWarning: "..." }
```

### 토큰 실행

```typescript
import { executePending } from "../pending-action.js";

const result = await executePending(confirmationToken);
```

## 에러 처리 패턴

### Setup Required 처리

```typescript
import { createSetupRequiredResponse, isSetupRequiredError } from "../errors.js";

function handleQueryError(error: unknown, attemptedAction: string) {
  if (isSetupRequiredError(error)) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify(createSetupRequiredResponse({ attemptedAction }), null, 2),
      }],
    };
  }
  throw error;
}
```

### 에러 분류

```typescript
import { classifyError, formatClassifiedError, enhanceWithRetryAction } from "../errors.js";

const classified = classifyError(error);
const enhanced = enhanceWithRetryAction(classified, "tool-name", originalParams);
const formatted = formatClassifiedError(enhanced);

return {
  content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
  isError: true,
};
```

### 에러 카테고리

- `network` - 네트워크 오류 (timeout, connection)
- `validation` - 입력 검증 오류 (insufficient balance, invalid address)
- `wallet` - 지갑 오류 (signing failed, session expired)
- `timeout` - 타임아웃
- `auth` - 인증 오류
- `chain` - 체인/RPC 오류
- `setup_required` - 지갑 설정 필요
- `unknown` - 알 수 없는 오류

## Transaction Preview 패턴

```typescript
import { generateTransactionWarnings, type TransactionPreview } from "../errors.js";

async function buildTransactionPreview(
  client: CosmosClient,
  chain: ChainInfo,
  amount: string,
  recipient: string
): Promise<TransactionPreview> {
  const address = await client.getAddress(chain);
  const balances = await client.getBalances(chain);
  const feeEstimate = await client.simulateFee(chain, messages);

  const warnings = generateTransactionWarnings({
    amount: BigInt(amount),
    balance: BigInt(currentBalance),
    estimatedFee: BigInt(feeEstimate.feeAmount),
    isUndelegate: false,
  });

  return {
    summary: `Send ${formattedAmount} to ${recipient}`,
    from: address,
    to: recipient,
    amount: { value: amount, denom, formatted: formattedAmount },
    estimatedFee: { value: feeEstimate.feeAmount, denom: feeEstimate.feeDenom, formatted },
    feeEstimationMethod: "simulated",  // 또는 "fallback"
    balanceBefore: { value: currentBalance, denom, formatted },
    balanceAfter: { value: balanceAfter, denom, formatted },
    warnings,
  };
}
```

## Suggested Actions 패턴

```typescript
import type { SuggestedAction } from "../errors.js";

const suggestedActions: SuggestedAction[] = [];

if (hasBalance) {
  suggestedActions.push({
    tool: "delegate",
    reason: "Stake tokens to earn rewards (typical APR: 10-20%)",
    params: { chain: chain.chainId },
    priority: 1,  // 낮을수록 우선
  });
}

if (chain.chainId === "osmosis-1") {
  suggestedActions.push({
    tool: "osmosis-swap",
    reason: "Swap tokens on Osmosis DEX",
    priority: 2,
  });
}

return {
  content: [{
    type: "text",
    text: JSON.stringify({ data, suggestedActions }, null, 2),
  }],
};
```

## MCP Features 유틸리티

### Progress

```typescript
import { createProgressReporter, TX_PROGRESS, MULTI_STEP_PROGRESS } from "../mcp-features/progress.js";

const reporter = progressToken
  ? createProgressReporter(server.server, progressToken)
  : null;

// 사전 정의된 단계
await reporter?.report(TX_PROGRESS.PREPARING.progress, 100, TX_PROGRESS.PREPARING.message);
await reporter?.report(TX_PROGRESS.SIGNING.progress, 100, TX_PROGRESS.SIGNING.message);

// 다단계 작업
const step = MULTI_STEP_PROGRESS.step(2, 5, "Processing item 2");
await reporter?.report(step.progress, step.total, step.message);

// 완료/실패
await reporter?.complete("Transaction confirmed");
await reporter?.fail("Error occurred");
```

### Logging

```typescript
import { createLogger, LOGGER_NAMES } from "../mcp-features/logging.js";

const logger = createLogger(server, LOGGER_NAMES.TRANSACTION);

await logger.info("Transaction submitted", { txHash, chain });
await logger.warning("High gas price", { gasPrice });
await logger.error("Transaction failed", { error: error.message });
```

### Elicitation

```typescript
import {
  supportsFormElicitation,
  elicitForm,
  requestConfirmation,
  TX_CONFIRM_SCHEMA,
} from "../mcp-features/elicitation.js";

// 간단한 확인
const confirmed = await requestConfirmation(server.server, {
  title: "Confirm Action",
  message: "Are you sure?",
  confirmLabel: "Yes, proceed",
});

if (confirmed === null) {
  // Elicitation 미지원 - 폴백 로직
} else if (confirmed) {
  // 확인됨
} else {
  // 취소됨
}

// 커스텀 폼
const result = await elicitForm<{ slippage: number }>(server.server, {
  mode: "form",
  message: "Configure swap parameters:",
  requestedSchema: {
    type: "object",
    properties: {
      slippage: { type: "number", title: "Slippage %", minimum: 0.1, maximum: 5 },
    },
    required: ["slippage"],
  },
});

if (result.action === "accept" && result.content) {
  const slippage = result.content.slippage;
}
```

### Completions

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { chainCompletionProvider, accountCompletionProvider } from "../mcp-features/completions.js";

server.registerResource(
  "resource-name",
  new ResourceTemplate("scheme://path/{chainId}/{account}", {
    complete: {
      chainId: chainCompletionProvider,
      account: accountCompletionProvider,
    },
  }),
  { description: "..." },
  handler
);
```

## Chain Resolution 패턴

```typescript
// packages/server/src/plugins/shared.ts
import { findChain } from "../chains/cosmos.js";

export function resolveChain(input: string): ChainInfo {
  const chain = findChain(input);
  if (!chain) {
    throw new Error(
      `Unknown chain: ${input}. Use list-cosmos-chains to see available chains.`
    );
  }
  return chain;
}
```

## Amount Parsing 패턴

```typescript
import { parseHumanAmount, formatDisplayAmount, AmountParseError } from "../utils/amount-parser.js";

function parseAmount(input: string, chain: ChainInfo, explicitDenom?: string) {
  try {
    // "1 ATOM", "1.5", "1000000" 모두 지원
    const parsed = parseHumanAmount(input, chain);
    const denom = explicitDenom ?? parsed.denom;
    const displayAmount = parsed.wasDisplayFormat
      ? input
      : formatDisplayAmount(parsed.amount, chain, denom);
    return { amount: parsed.amount, denom, displayAmount };
  } catch (error) {
    if (error instanceof AmountParseError) {
      // 폴백: 최소 단위로 처리
      const denom = explicitDenom ?? getStakeMinimalDenom(chain);
      return { amount: input, denom, displayAmount: formatDisplayAmount(input, chain, denom) };
    }
    throw error;
  }
}
```


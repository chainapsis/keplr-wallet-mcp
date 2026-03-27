---
name: mcp-tool-validator
description: |
  MCP Tool 구현 코드를 검증하고 리뷰. 트리거: "MCP 도구 검증", "MCP 코드 리뷰", "Tool 구현 확인",
  "registerTool 리뷰", "MCP 패턴 검사", "플러그인 검증", "MCP 검수"
---

# MCP Tool Validator

MCP 도구 구현 코드를 검증하고 개선점을 제안하는 스킬.

## 검증 워크플로우

1. 대상 코드 읽기
2. 체크리스트 항목별 검증
3. 검증 보고서 출력

## 검증 체크리스트

### 1. 스키마 검증

| 항목 | 검증 내용 |
|------|----------|
| `describe()` | 모든 파라미터에 설명이 있는가? |
| 기본값 | `optional()` 필드에 `default()` 제공되는가? |
| 타입 제약 | `min()`, `max()`, `enum()` 등 제약 조건 적절한가? |
| Zod import | `zod` 올바르게 import하는가? |

```typescript
// ❌ 나쁜 예
inputSchema: {
  chain: z.string(),
  amount: z.string(),
}

// ✅ 좋은 예
inputSchema: {
  chain: z.string().describe("Chain ID or name (e.g., 'cosmoshub-4', 'cosmos')"),
  amount: z.string().describe("Amount with denom (e.g., '1 ATOM', '1.5')"),
}
```

### 2. 응답 구조 검증

| 항목 | 검증 내용 |
|------|----------|
| JSON 형식 | `JSON.stringify(data, null, 2)` 사용하는가? |
| 일관된 구조 | `status`, `data`, `error` 필드 일관성 |
| `isError` | 에러 시 `isError: true` 반환하는가? |
| `suggestedActions` | 조회 결과에 다음 액션 제안 포함하는가? |

```typescript
// ✅ 좋은 응답 구조
return {
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "success",
      data: { /* ... */ },
      suggestedActions: [
        { tool: "delegate", reason: "Stake to earn rewards", priority: 1 },
      ],
    }, null, 2),
  }],
};
```

### 3. 에러 처리 검증

| 항목 | 검증 내용 |
|------|----------|
| try-catch | 비동기 작업이 try-catch로 감싸져 있는가? |
| 에러 분류 | `classifyError()` 사용하는가? |
| 복구 제안 | 에러에 `suggestion`, `retryAction` 포함하는가? |
| Setup Required | 설정 필요 시 에러 대신 안내 반환하는가? |

```typescript
// ✅ 좋은 에러 처리
try {
  const result = await riskyOperation();
  return { content: [/* ... */] };
} catch (error) {
  const classified = classifyError(error);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        isError: true,
        category: classified.category,
        message: classified.message,
        suggestion: classified.suggestion,
      }, null, 2),
    }],
    isError: true,
  };
}
```

### 4. Tool Annotations 검증

| Annotation | 사용 시점 |
|------------|----------|
| `readOnlyHint: true` | 상태 변경 없는 조회 도구 |
| `destructiveHint: true` | 삭제, 전송 등 위험한 작업 |
| `idempotentHint: true` | 반복 호출해도 동일 결과 |
| `openWorldHint: true` | 블록체인/외부 API 호출 |

```typescript
// ✅ Query Tool
annotations: { readOnlyHint: true, idempotentHint: true }

// ✅ Transaction Tool
annotations: { destructiveHint: true, openWorldHint: true }
```

### 5. Confirmation Flow 검증 (상태 변경 도구)

| 항목 | 검증 내용 |
|------|----------|
| 토큰 발급 | `storePending()` 사용하는가? |
| Preview | 실행 전 미리보기 정보 제공하는가? |
| TTL | 토큰 만료 시간 명시하는가? |
| 분리 | 생성/실행이 별도 도구로 분리되어 있는가? |

```typescript
// ✅ 올바른 Confirmation Flow
return {
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "pending_confirmation",
      confirmationToken: token,
      expiresIn: "5 minutes",
      preview: { from, to, amount, fee },
      instructions: "Use confirm-action to execute.",
    }, null, 2),
  }],
};
```

### 6. Progress 알림 검증

| 항목 | 검증 내용 |
|------|----------|
| 장시간 작업 | Progress 알림 구현되어 있는가? |
| progressToken | `extra._meta?.progressToken` 확인하는가? |
| 단계 | 작업 단계별 메시지 제공하는가? |

### 7. 타입 안전성 검증

| 항목 | 검증 내용 |
|------|----------|
| `as const` | 리터럴 타입에 `as const` 사용하는가? |
| 타입 단언 | 불필요한 `as` 사용 없는가? |
| null 체크 | optional 값에 null 체크 있는가? |

```typescript
// ❌ 나쁜 예
role: "user",
type: "text",

// ✅ 좋은 예
role: "user" as const,
type: "text" as const,
```

## 프로젝트 특화 검증

### KeplrPlugin 패턴

```typescript
// ✅ 올바른 플러그인 구조
const myPlugin: KeplrPlugin = {
  name: "my-plugin",
  register(server, store) {
    server.registerTool("my-tool", { ... }, async (args) => {
      const client = await store.getClientFor("cosmos");
      // ...
    });
  },
};

export default myPlugin;
```

### Store 접근 패턴

```typescript
// ✅ 올바른 Store 사용
const activeAccount = store.getState().activeAccount;
if (!activeAccount) {
  return createSetupRequiredResponse({ attemptedAction: "get-balances" });
}
```

## 검증 보고서 형식

검증 완료 후 다음 형식으로 보고서 출력:

```markdown
## MCP Tool 검증 보고서: {tool-name}

### ✅ 통과 항목
- [x] 스키마에 describe() 있음
- [x] JSON 응답 구조 일관됨
- [x] 에러 처리 try-catch 있음
- [x] Tool Annotations 적절함

### ⚠️ 개선 권장
- [ ] suggestedActions 추가 권장
- [ ] Progress 알림 구현 권장

### ❌ 필수 수정
- [ ] 에러 시 isError: true 누락
- [ ] Confirmation Flow 미구현

### 코드 수정 제안
\`\`\`typescript
// 수정 전
return { content: [...] };

// 수정 후
return { content: [...], isError: true };
\`\`\`
```

## 심각도 분류

| 레벨 | 설명 | 예시 |
|------|------|------|
| ❌ 필수 | 반드시 수정 필요 | 에러 처리 누락, 보안 문제 |
| ⚠️ 권장 | 개선하면 좋음 | describe() 누락, suggestedActions 미구현 |
| 💡 제안 | 선택적 개선 | 코드 스타일, 명명 규칙 |

## 참조 파일

- [examples.md](references/examples.md) - 좋은 구현 예제
- [project-patterns.md](references/project-patterns.md) - 프로젝트 패턴

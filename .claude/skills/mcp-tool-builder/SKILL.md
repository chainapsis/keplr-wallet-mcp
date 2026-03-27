---
name: mcp-tool-builder
description: |
  MCP(Model Context Protocol) 서버에서 Tool, Resource, Prompt 구현 가이드. @modelcontextprotocol/sdk 기반 TypeScript 프로젝트용.
  트리거: "MCP 도구 만들어", "registerTool", "MCP 플러그인 구현", "Tool 추가", "Resource 등록", "Prompt 구현",
  "MCP 서버 개발", "confirmation flow", "progress notification"
---

# MCP Tool Builder

## Quick Start

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "my-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } }
);

// Tool 등록
server.registerTool("greet", {
  description: "Greet a user",
  inputSchema: { name: z.string().describe("User name") },
}, async ({ name }) => ({
  content: [{ type: "text", text: `Hello, ${name}!` }],
}));

// 연결
await server.connect(new StdioServerTransport());
```

## Tool 구현

### 기본 패턴

```typescript
server.registerTool(
  "tool-name",
  {
    title: "Display Name",           // 선택
    description: "Tool description", // 필수
    inputSchema: {                   // Zod 스키마
      param1: z.string().describe("Parameter description"),
      param2: z.number().optional().default(10),
    },
    annotations: {                   // 선택
      readOnlyHint: true,            // 읽기 전용 (상태 변경 없음)
      destructiveHint: false,        // 파괴적 작업 아님
      idempotentHint: true,          // 멱등성 (반복 호출 안전)
    },
  },
  async (args, extra) => {
    // args: 파싱된 인자
    // extra: { signal, sessionId, authInfo, _meta, sendNotification }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);
```

### 응답 타입

```typescript
// 텍스트 (JSON 권장)
{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }

// 에러
{ content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true }

// 이미지
{ content: [{ type: "image", data: base64String, mimeType: "image/png" }] }

// 구조화된 출력 (outputSchema 정의 시)
{
  content: [{ type: "text", text: "..." }],
  structuredContent: { key: "value" }
}
```

### Tool Annotations

| Annotation | 의미 |
|------------|------|
| `readOnlyHint: true` | 상태 변경 없음 (조회만) |
| `destructiveHint: true` | 데이터 삭제/변경 (주의 필요) |
| `idempotentHint: true` | 여러 번 호출해도 동일 결과 |
| `openWorldHint: true` | 외부 시스템에 영향 |

## Resource 구현

### 정적 Resource

```typescript
server.registerResource(
  "config",
  "config://app/settings",
  { description: "App settings", mimeType: "application/json" },
  async (uri) => ({
    contents: [{
      uri: uri.toString(),
      mimeType: "application/json",
      text: JSON.stringify({ theme: "dark" }),
    }],
  })
);
```

### 동적 Resource (템플릿)

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

server.registerResource(
  "user-profile",
  new ResourceTemplate("users://{userId}/profile", {
    list: async () => ({
      resources: [
        { uri: "users://1/profile", name: "User 1" },
        { uri: "users://2/profile", name: "User 2" },
      ],
    }),
  }),
  { description: "User profile data" },
  async (uri, { userId }) => ({
    contents: [{ uri: uri.toString(), text: `Profile: ${userId}` }],
  })
);
```

## Prompt 구현

```typescript
server.registerPrompt(
  "code-review",
  {
    description: "Code review prompt",
    argsSchema: {
      language: z.string().describe("Programming language"),
      code: z.string().describe("Code to review"),
    },
  },
  async ({ language, code }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Review this ${language} code:\n${code}` },
    }],
  })
);
```

## Progress Notifications

장시간 작업의 진행 상황 알림.

```typescript
server.registerTool("long-task", { ... }, async (args, extra) => {
  const progressToken = extra._meta?.progressToken;

  if (progressToken) {
    // 진행 상황 알림
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress: 30, total: 100, message: "Processing..." },
    });
  }

  // 작업 수행...

  return { content: [{ type: "text", text: "Done" }] };
});
```

## Logging

```typescript
await server.sendLoggingMessage({
  level: "info",  // debug | info | warning | error
  logger: "my-module",
  data: { action: "user_login", userId: "123" },
});
```

## Elicitation (사용자 입력 요청)

### Form 모드 (구조화된 입력)

```typescript
const result = await server.server.elicitInput({
  mode: "form",
  message: "Please provide configuration",
  requestedSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "API Key" },
      debug: { type: "boolean", default: false },
    },
    required: ["apiKey"],
  },
});

if (result.action === "accept") {
  const { apiKey, debug } = result.content;
}
```

### URL 모드 (민감 정보)

```typescript
const result = await server.server.elicitInput({
  mode: "url",
  message: "Complete authentication",
  url: "https://auth.example.com/login?session=...",
  elicitationId: "auth-123",
});
```

## Best Practices

1. **스키마에 describe() 추가**: LLM이 파라미터 용도를 이해하도록
   ```typescript
   z.string().describe("Recipient wallet address (bech32 format)")
   ```

2. **일관된 JSON 응답**: 모든 응답을 JSON으로 구조화
   ```typescript
   { status: "success", data: {...} }
   { status: "error", error: "message", suggestion: "..." }
   ```

3. **Setup Required 패턴**: 설정 필요 시 에러 대신 안내 반환
   → [references/patterns.md](references/patterns.md#2-setup-guide-response) 참조

4. **Confirmation Token 패턴**: 위험한 작업을 두 단계로 분리
   → [references/patterns.md](references/patterns.md#1-confirmation-flow) 참조

5. **Suggested Actions**: 조회 결과에 다음 단계 제안 포함
   → [references/patterns.md](references/patterns.md#3-suggested-actions) 참조

## Common Pitfalls

1. **Zod 버전**: `zod` (v3.25+) 사용, `zod/v4` import 아님
   ```typescript
   import { z } from "zod";  // 올바름
   ```

2. **저수준 API 접근**: `server.server`로 Server 클래스 접근
   ```typescript
   await server.server.notification({ method: "...", params: {...} });
   ```

3. **비동기 에러 처리**: try-catch로 감싸고 isError 반환
   ```typescript
   try { ... } catch (e) {
     return { content: [...], isError: true };
   }
   ```

## References

- [API Reference](references/api-reference.md) - McpServer 전체 API
- [Implementation Patterns](references/patterns.md) - Confirmation, Setup Guide, Progress 등
- [Transport Guide](references/transport.md) - Stdio, HTTP, WebSocket 설정
- [Authentication](references/auth.md) - OAuth 2.0 구현

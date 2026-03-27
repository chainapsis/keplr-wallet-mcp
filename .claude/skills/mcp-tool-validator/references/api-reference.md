# MCP SDK API 레퍼런스

## McpServer 클래스

### 생성자

```typescript
new McpServer(
  serverInfo: {
    name: string;
    version: string;
    title?: string;
    description?: string;
  },
  options?: {
    capabilities?: {
      tools?: {};           // Tool 기능 활성화
      resources?: {};       // Resource 기능 활성화
      prompts?: {};         // Prompt 기능 활성화
      logging?: {};         // Logging 기능 활성화
      completions?: {};     // 자동완성 활성화
    };
    instructions?: string;  // 서버 사용 지침
    jsonSchemaValidator?: (schema: JSONSchema, data: unknown) => void;
  }
)
```

### registerTool()

```typescript
server.registerTool(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, ZodType>;  // Zod 스키마
    outputSchema?: Record<string, ZodType>; // 구조화된 출력 시 사용
    annotations?: {
      readOnlyHint?: boolean;      // 읽기 전용 (기본: false)
      destructiveHint?: boolean;   // 파괴적 작업 (기본: false)
      idempotentHint?: boolean;    // 멱등성 (기본: false)
      openWorldHint?: boolean;     // 외부 영향 (기본: true)
    };
  },
  callback: (args: T, extra: RequestHandlerExtra) => Promise<CallToolResult>
)
```

### registerResource()

```typescript
// 정적 URI
server.registerResource(
  name: string,
  uri: string,
  metadata: { description?: string },
  callback: (uri: URL) => Promise<ReadResourceResult>
)

// 동적 템플릿
server.registerResource(
  name: string,
  template: ResourceTemplate,
  metadata: { description?: string },
  callback: (uri: URL, variables: Record<string, string>) => Promise<ReadResourceResult>
)
```

### registerPrompt()

```typescript
server.registerPrompt(
  name: string,
  config: {
    title?: string;
    description?: string;
    argsSchema?: Record<string, ZodType>;
  },
  callback: (args: T) => Promise<GetPromptResult>
)
```

## 타입 정의

### CallToolResult

```typescript
interface CallToolResult {
  content?: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "audio"; data: string; mimeType: string }
    | { type: "resource"; resource: ResourceContents }
  >;
  structuredContent?: Record<string, unknown>;  // outputSchema 정의 시
  isError?: boolean;
}
```

### ReadResourceResult

```typescript
interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;  // Base64
  }>;
}
```

### GetPromptResult

```typescript
interface GetPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content:
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
      | { type: "resource"; resource: ResourceContents };
  }>;
}
```

### RequestHandlerExtra

```typescript
interface RequestHandlerExtra {
  signal: AbortSignal;              // 요청 취소 신호
  authInfo?: AuthInfo;              // 인증 정보
  sessionId?: string;               // 세션 ID
  _meta?: {
    progressToken?: string | number; // Progress 알림용 토큰
  };
  sendNotification: (notification: Notification) => Promise<void>;
  sendRequest: <T>(request: Request, schema: ZodType<T>) => Promise<T>;
}
```

### ResourceTemplate

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

new ResourceTemplate(
  pattern: string,  // "scheme://path/{variable}"
  options?: {
    list?: () => Promise<Array<{ uri: string; name?: string }>>;
    complete?: Record<string, (value: string, context?: { arguments?: Record<string, string> }) => string[] | Promise<string[]>>;
  }
)
```

## Progress 알림

```typescript
await extra.sendNotification({
  method: "notifications/progress",
  params: {
    progressToken: extra._meta!.progressToken!,
    progress: number,      // 현재 진행률
    total?: number,        // 총 단계 (선택)
    message?: string,      // 상태 메시지 (선택)
  },
});
```

## Logging

```typescript
await server.sendLoggingMessage({
  level: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency",
  logger: string,          // 모듈명
  data: Record<string, unknown>,
}, sessionId?: string);
```

## Elicitation

### Form 모드

```typescript
const result = await server.elicitInput({
  mode: "form",
  message: string,
  requestedSchema: {
    type: "object",
    properties: {
      fieldName: { type: "string" | "number" | "boolean", title?: string, description?: string },
    },
    required?: string[],
  },
});

// result: { action: "accept" | "decline" | "cancel", content?: T }
```

### URL 모드

```typescript
const result = await server.elicitInput({
  mode: "url",
  message: string,
  url: string,
  elicitationId?: string,
});

// result: { action: "accept" | "decline" | "cancel" }
```

## Transport 옵션

### StdioServerTransport

로컬 CLI용:

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const transport = new StdioServerTransport();
await server.connect(transport);
```

### StreamableHTTPServerTransport

Express 등 HTTP 서버용:

```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });

app.post("/mcp", async (req, res) => {
  await transport.handleRequest(req, res);
});

await server.connect(transport);
```

### WebStandardStreamableHTTPServerTransport

Hono, Cloudflare Workers 등 Web Standard 런타임용:

```typescript
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
```

## 클라이언트 Capabilities 확인

```typescript
const capabilities = server.server.getClientCapabilities();

// Elicitation 지원 여부
if (capabilities?.elicitation) {
  // form 또는 url 모드 지원
}

// Logging 지원 여부
if (capabilities?.logging) {
  // 로깅 메시지 전송 가능
}
```

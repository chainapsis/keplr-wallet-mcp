# MCP SDK API Reference

## Table of Contents
- [McpServer Class](#mcpserver-class)
- [Tool Registration](#tool-registration)
- [Resource Registration](#resource-registration)
- [Prompt Registration](#prompt-registration)
- [RequestHandlerExtra](#requesthandlerextra)
- [Notification Methods](#notification-methods)
- [Low-level Server Class](#low-level-server-class)
- [Error Codes](#error-codes)

---

## McpServer Class

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer(
  { name: "my-server", version: "1.0.0" },
  options
);
```

### Constructor Options

```typescript
interface ServerOptions {
  capabilities?: ServerCapabilities;
  instructions?: string;
  enforceStrictCapabilities?: boolean;
  debouncedNotificationMethods?: string[];
  jsonSchemaValidator?: jsonSchemaValidator;
  taskStore?: TaskStore;
}
```

### ServerCapabilities

```typescript
interface ServerCapabilities {
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  tools?: {
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
  sampling?: {};
  elicitation?: {};
}
```

---

## Tool Registration

### registerTool

```typescript
server.registerTool<InputSchema, OutputSchema>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputSchema;
    outputSchema?: OutputSchema;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  callback: ToolCallback<InputSchema>
): RegisteredTool;
```

### ToolCallback

```typescript
type ToolCallback = (extra: RequestHandlerExtra) => CallToolResult | Promise<CallToolResult>;
type ToolCallback<Args> = (args: Args, extra: RequestHandlerExtra) => CallToolResult | Promise<CallToolResult>;
```

### ToolAnnotations

```typescript
interface ToolAnnotations {
  audience?: ("user" | "model")[];
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
}
```

### CallToolResult

```typescript
interface CallToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "audio"; data: string; mimeType: string }
    | { type: "resource"; resource: Resource }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
```

### RegisteredTool

```typescript
interface RegisteredTool {
  enabled: boolean;
  enable(): void;
  disable(): void;
  update(updates: { name?, title?, description?, paramsSchema?, annotations?, callback?, enabled? }): void;
  remove(): void;
}
```

---

## Resource Registration

### registerResource

```typescript
// Static URI
server.registerResource(
  name: string,
  uri: string,
  config: ResourceMetadata,
  callback: ReadResourceCallback
): RegisteredResource;

// Template URI
server.registerResource(
  name: string,
  template: ResourceTemplate,
  config: ResourceMetadata,
  callback: ReadResourceTemplateCallback
): RegisteredResourceTemplate;
```

### ResourceMetadata

```typescript
type ResourceMetadata = {
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: {
    audience?: ("user" | "model")[];
    priority?: number;
  };
};
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

### ResourceTemplate

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const template = new ResourceTemplate(
  "file:///{path}",
  {
    list: async () => ({
      resources: [{ uri: "file:///readme.md", name: "README" }],
    }),
    complete: {
      path: async (partial) => ["file1.txt", "file2.txt"].filter(f => f.startsWith(partial)),
    },
  }
);
```

---

## Prompt Registration

### registerPrompt

```typescript
server.registerPrompt<Args>(
  name: string,
  config: {
    title?: string;
    description?: string;
    argsSchema?: Args;
  },
  callback: PromptCallback<Args>
): RegisteredPrompt;
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
      | { type: "resource"; resource: Resource };
  }>;
}
```

---

## RequestHandlerExtra

Context object passed to all handler callbacks.

```typescript
interface RequestHandlerExtra {
  signal: AbortSignal;
  authInfo?: AuthInfo;
  sessionId?: string;
  _meta?: {
    progressToken?: string | number;
  };
  requestId: RequestId;
  sendNotification: (notification: ServerNotification) => Promise<void>;
  sendRequest: <U>(request: ServerRequest, resultSchema: U) => Promise<SchemaOutput<U>>;
  closeSSEStream?: () => void;
  taskId?: string;
  taskStore?: RequestTaskStore;
}
```

---

## Notification Methods

```typescript
// Logging
await server.sendLoggingMessage({
  level: "info" | "debug" | "warning" | "error",
  logger?: string,
  data: unknown,
});

// List change notifications
server.sendResourceListChanged();
server.sendToolListChanged();
server.sendPromptListChanged();
```

---

## Low-level Server Class

Access via `server.server` for advanced use cases.

```typescript
// Custom request handler
server.server.setRequestHandler(
  CustomRequestSchema,
  async (request, extra) => ({ result: "ok" })
);

// Custom notification handler
server.server.setNotificationHandler(
  CustomNotificationSchema,
  async (notification) => { console.log(notification); }
);

// Send notification
await server.server.notification({
  method: "notifications/progress",
  params: { progressToken: "token", progress: 50, total: 100, message: "..." },
});
```

---

## Error Codes

```typescript
enum ErrorCode {
  ConnectionClosed = -32000,
  RequestTimeout = -32001,
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  UrlElicitationRequired = -32042,
}
```

---

## AuthInfo

```typescript
interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra?: Record<string, unknown>;
}
```

# MCP Transport Reference

## Table of Contents
- [Transport Interface](#transport-interface)
- [StdioServerTransport](#stdioservertransport)
- [StreamableHTTPServerTransport](#streamablehttpservertransport)
- [WebStandardStreamableHTTPServerTransport](#webstandardstreamablehttpservertransport)
- [InMemoryTransport](#inmemorytransport)
- [EventStore (Resumability)](#eventstore-resumability)
- [Transport Selection Guide](#transport-selection-guide)

---

## Transport Interface

```typescript
interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  sessionId?: string;
}
```

---

## StdioServerTransport

For local process communication (Claude Desktop, CLI tools).

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "my-server", version: "1.0.0" });
// Register tools...

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Custom Streams

```typescript
import { Readable, Writable } from "stream";

const customStdin = new Readable({ read() {} });
const customStdout = new Writable({ write(chunk, enc, cb) { console.log(chunk.toString()); cb(); } });

const transport = new StdioServerTransport(customStdin, customStdout);
```

---

## StreamableHTTPServerTransport

For Node.js HTTP servers (Express).

```typescript
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const server = new McpServer({ name: "my-server", version: "1.0.0" });
// Register tools...

// Stateful mode (with sessions)
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

await server.connect(transport);

app.all("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
```

### Options

```typescript
interface StreamableHTTPServerTransportOptions {
  sessionIdGenerator?: () => string;  // undefined = stateless
  onsessioninitialized?: (sessionId: string) => void | Promise<void>;
  onsessionclosed?: (sessionId: string) => void | Promise<void>;
  enableJsonResponse?: boolean;  // JSON instead of SSE
  eventStore?: EventStore;  // For resumability
  retryInterval?: number;  // SSE retry interval (ms)
}
```

### Stateless vs Stateful

```typescript
// Stateful: provide sessionIdGenerator
const stateful = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// Stateless: omit sessionIdGenerator
const stateless = new StreamableHTTPServerTransport({});
```

---

## WebStandardStreamableHTTPServerTransport

For Web Standard runtimes (Hono, Cloudflare Workers, Deno, Bun).

### Hono Example

```typescript
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const app = new Hono();
const server = new McpServer({ name: "my-server", version: "1.0.0" });

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await server.connect(transport);

app.all("/mcp", (c) => transport.handleRequest(c.req.raw));

export default app;
```

### Cloudflare Workers Example

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const server = new McpServer({ name: "worker-server", version: "1.0.0" });
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});

await server.connect(transport);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return transport.handleRequest(request);
    }
    return new Response("Not Found", { status: 404 });
  },
};
```

### Handle Request Options

```typescript
const response = await transport.handleRequest(request, {
  parsedBody: await request.json(),
  authInfo: { token: "...", clientId: "...", scopes: [] },
});
```

---

## InMemoryTransport

For testing (same-process client-server communication).

```typescript
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Create linked pair
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

// Server
const server = new McpServer({ name: "test-server", version: "1.0.0" });
server.registerTool("ping", {}, async () => ({ content: [{ type: "text", text: "pong" }] }));
await server.connect(serverTransport);

// Client
const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(clientTransport);

// Test
const result = await client.callTool({ name: "ping" });
console.log(result.content[0].text); // "pong"
```

### Auth Testing

```typescript
await transport.send(message, {
  authInfo: { token: "test-token", clientId: "test-client", scopes: ["read", "write"] },
});
```

---

## EventStore (Resumability)

For reconnection support.

```typescript
interface EventStore {
  storeEvent(streamId: string, message: JSONRPCMessage): Promise<string>;
  replayEventsAfter(lastEventId: string, { send }): Promise<string>;
  getStreamIdForEventId?(eventId: string): Promise<string | undefined>;
}
```

### Simple Implementation

```typescript
class InMemoryEventStore implements EventStore {
  private events = new Map<string, { streamId: string; message: JSONRPCMessage }>();
  private counter = 0;

  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    const eventId = `${Date.now()}-${++this.counter}`;
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter(lastEventId: string, { send }): Promise<string> {
    const event = this.events.get(lastEventId);
    if (!event) throw new Error(`Event ${lastEventId} not found`);

    // Replay subsequent events...
    return event.streamId;
  }
}
```

### Usage

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  eventStore: new InMemoryEventStore(),
  retryInterval: 3000,
});
```

---

## Transport Selection Guide

| Scenario | Recommended Transport |
|----------|----------------------|
| Claude Desktop (process spawn) | `StdioServerTransport` |
| Node.js Express server | `StreamableHTTPServerTransport` |
| Hono / Cloudflare Workers | `WebStandardStreamableHTTPServerTransport` |
| Deno / Bun | `WebStandardStreamableHTTPServerTransport` |
| Unit tests | `InMemoryTransport` |

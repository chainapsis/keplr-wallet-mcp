# MCP Authentication Reference

## Table of Contents
- [Architecture](#architecture)
- [OAuthServerProvider](#oauthserverprovider)
- [mcpAuthRouter](#mcpauthrouter)
- [Bearer Token Middleware](#bearer-token-middleware)
- [Using AuthInfo in Tools](#using-authinfo-in-tools)
- [Client Credentials Flow](#client-credentials-flow)

---

## Architecture

MCP uses OAuth 2.0 for authentication.

```
Client → (1) Authorization Request → Authorization Server
Client ← (2) Access Token ← Authorization Server
Client → (3) API Request with Token → MCP Server (RS)
MCP Server → (4) Verify Token → Authorization Server
```

---

## OAuthServerProvider

Interface for implementing OAuth server.

```typescript
interface OAuthServerProvider {
  get clientsStore(): OAuthRegisteredClientsStore;

  authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void>;

  challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string>;

  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens>;

  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens>;

  verifyAccessToken(token: string): Promise<AuthInfo>;

  revokeToken?(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void>;

  skipLocalPkceValidation?: boolean;
}
```

### Types

```typescript
interface AuthorizationParams {
  state?: string;
  scopes?: string[];
  codeChallenge: string;
  redirectUri: string;
  resource?: URL;
}

interface OAuthTokens {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: URL;
  extra?: Record<string, unknown>;
}
```

---

## mcpAuthRouter

Add OAuth endpoints to Express app.

```typescript
import express from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";

const app = express();

const oauthProvider: OAuthServerProvider = {
  clientsStore: new MyClientsStore(),
  authorize: async (client, params, res) => { /* ... */ },
  challengeForAuthorizationCode: async (client, code) => { /* ... */ },
  exchangeAuthorizationCode: async (client, code, verifier) => { /* ... */ },
  exchangeRefreshToken: async (client, token, scopes) => { /* ... */ },
  verifyAccessToken: async (token) => { /* ... */ },
};

// Mount at root
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL("https://auth.example.com"),
  scopesSupported: ["read", "write", "admin"],
}));
```

### Generated Endpoints

| Endpoint | Description |
|----------|-------------|
| `/.well-known/oauth-authorization-server` | AS metadata |
| `/.well-known/oauth-protected-resource/...` | RS metadata |
| `/authorize` | Authorization request |
| `/token` | Token issuance |
| `/register` | Dynamic client registration |
| `/revoke` | Token revocation |

### Options

```typescript
interface AuthRouterOptions {
  provider: OAuthServerProvider;
  issuerUrl: URL;
  baseUrl?: URL;
  serviceDocumentationUrl?: URL;
  scopesSupported?: string[];
  resourceName?: string;
  resourceServerUrl?: URL;
}
```

---

## Bearer Token Middleware

Protect endpoints with token verification.

```typescript
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const decoded = await verifyJWT(token);
    return {
      token,
      clientId: decoded.client_id,
      scopes: decoded.scope?.split(" ") || [],
      expiresAt: decoded.exp,
    };
  },
};

app.use(
  "/mcp",
  requireBearerAuth({
    verifier,
    requiredScopes: ["mcp:read"],
  }),
  mcpHandler
);
```

### Access AuthInfo in Request

```typescript
// Extend Express Request
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthInfo;
  }
}

app.post("/mcp", (req, res) => {
  const auth = req.auth;
  if (auth) {
    console.log(`Client: ${auth.clientId}, Scopes: ${auth.scopes.join(", ")}`);
  }
});
```

---

## Using AuthInfo in Tools

```typescript
server.registerTool("admin-operation", {
  description: "Admin only operation",
  annotations: { destructiveHint: true },
}, async (args, extra) => {
  const auth = extra.authInfo;

  if (!auth) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "Authentication required" }) }],
      isError: true,
    };
  }

  if (!auth.scopes.includes("admin")) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Insufficient permissions",
          required: "admin",
          current: auth.scopes,
        }),
      }],
      isError: true,
    };
  }

  const result = await performAdminOperation();
  return { content: [{ type: "text", text: JSON.stringify({ success: true, result }) }] };
});
```

---

## Client Credentials Flow

For server-to-server authentication.

```typescript
// Client-side HTTP request
const response = await fetch("https://auth.example.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "my-client-id",
    client_secret: "my-client-secret",
    scope: "read write",
  }),
});

const { access_token } = await response.json();
```

---

## OAuthRegisteredClientsStore

```typescript
interface OAuthRegisteredClientsStore {
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  registerClient?(clientMetadata: OAuthClientMetadata): Promise<OAuthClientInformationFull>;
}
```

### In-Memory Implementation

```typescript
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  async registerClient(metadata: OAuthClientMetadata) {
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString("hex");

    const client: OAuthClientInformationFull = {
      client_id: clientId,
      client_secret: clientSecret,
      ...metadata,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    this.clients.set(clientId, client);
    return client;
  }
}
```

# Keplr Wallet MCP

> AI-powered wallet interface for Cosmos chains via Model Context Protocol (MCP)

## Quick Reference

```bash
pnpm test        # run tests
pnpm build       # build
pnpm lint:fix    # lint
```

---

## Development Rules

### Required Tools

- **pnpm** required (`npm`, `yarn` are not allowed)
- **vitest** for tests / **biome** for linting

### TDD (Test-Driven Development)

```bash
# Write tests first → implement
pnpm test packages/server/src/__tests__/tools/cosmwasm.test.ts
pnpm test:watch
```

- Test location: `packages/*/src/__tests__/`
- Test files: `*.test.ts`

### Pre-Commit Checklist

```bash
pnpm test && pnpm lint:fix && pnpm build
```

**Note:** After running `pnpm lint:fix`, review the changed files. Auto-fixes may not match your intent.

### Doc Sync

When modifying tools, update the relevant docs:

| Change | Docs to Update |
|--------|----------------|
| Add/edit/delete tool | `docs/pages/reference/tools/*.mdx` (+ optional: `plugins/meta/registry-data.ts`) |
| Prompt change | `docs/pages/reference/prompts/index.mdx` |
| Error code added | `docs/pages/reference/errors/codes.mdx` |
| Architecture change | `docs/pages/architecture/*.mdx` |
| New chain support | `docs/pages/reference/chains.mdx` |

### Code Style

- Prefer arrow functions
- Explicit type declarations
- Use `classifyError()`
- Use `suggestedActions` pattern

---

## Architecture Summary

### Packages

```
packages/
  server/           # Core MCP server + Cosmos
  protocol-osmosis/ # Osmosis DEX
```

### 3-Layer Key Abstraction

```
Layer 3: KeyProvider ──→ MnemonicKeyProvider
Layer 2: Account     ──→ EOAAccountImpl
Layer 1: Signer      ──→ Secp256k1Signer
```

### Registry Patterns (Plug-and-Play Extension)

- **KeyProviderRegistry**: Dynamically register new KeyProvider types
- **AdapterBridgeRegistry**: KeyProvider-to-Adapter integration
- **PluginRegistry**: Plugin dependency management + Lifecycle Hooks
- **BalanceEnricherRegistry**: Plugin hook for enriching balance data (e.g., resolving token metadata)

---

## Adding New Features

### New Tool

```typescript
server.registerTool("my-tool", {
  description: "Tool description",
  inputSchema: { param: z.string() },
  annotations: { readOnlyHint: true },
}, async ({ param }) => {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        result: "...",
        suggestedActions: [{ tool: "next", reason: "...", priority: 1 }]
      }, null, 2)
    }]
  };
});
```

**Optional (recommended):** After adding a tool, add an entry to `plugins/meta/registry-data.ts` for better search quality:

```typescript
{
  name: "my-tool",
  description: "Tool description",
  category: "category",  // see list below
  ecosystem: "cosmos",   // "cosmos" | "common"
  risk: "safe",          // "safe" | "destructive" | "mixed"
  keywords: ["keyword1", "keyword2", "keyword3"],
},
```

> **Note:** Without an entry, the tool is auto-discovered from `_registeredTools` (category: "uncategorized"). Plugin plug-and-play is guaranteed.

Categories: `account-management`, `authentication`, `transaction-confirm`, `cosmos-query`, `cosmos-transaction`, `cosmwasm`, `cosmos-signing`, `chain-management`, `defi-osmosis`, `keplr-rpc`, `meta`

### New Adapter

1. Create `packages/adapter-<name>/`
2. Implement `EcosystemAdapter`
3. `export default () => new MyAdapter()`
4. Add to `optionalDependencies`

### New Protocol Plugin

1. Create `packages/protocol-<name>/`
2. Implement `ProtocolPlugin` (extends `KeplrPlugin` with `protocolId`, `ecosystem`, `supportedChains`)
3. `export default () => new MyProtocol()` (factory function required by loader)
4. Add to `optionalDependencies`

```typescript
import type { ProtocolPlugin } from "@keplr-wallet/keplr-wallet-mcp/protocol-types";

const myProtocol: ProtocolPlugin = {
  name: "my-protocol",
  protocolId: "my-protocol",
  ecosystem: "cosmos",
  supportedChains: ["osmosis-1"],
  register(server, store) {
    // Register tools, balance enrichers, etc.
  },
};

export default () => myProtocol;
```

Discovery: `@keplr-wallet/protocol-*` prefix auto-detected, or set `KEPLR_PROTOCOLS` env var.

### New KeyProvider (Registry Pattern)

```typescript
import { keyProviderRegistry, adapterBridgeRegistry } from "@keplr-wallet/keplr-wallet-mcp/keys";

// 1. Register provider with registry
keyProviderRegistry.register({
  type: "my-provider",
  displayName: "My Wallet",
  configSchema: z.object({ type: z.literal("my-provider"), ... }),
  create: async (config) => new MyKeyProvider(config),
});

// 2. Register adapter bridge
adapterBridgeRegistry.register({
  providerType: "my-provider",
  ecosystem: "cosmos",
  createClient: async (provider, adapter) => adapter.createClient(...),
});
```


---

## UX Patterns

1. **Setup Guide**: Show setup options instead of errors when wallet is not configured
2. **Suggested Actions**: Suggest next steps
3. **Transaction Preview**: Preview before execution
4. **Confirmation Flow**: Two-step confirmation

### Error Handling

```typescript
import { isSetupRequiredError, createSetupRequiredResponse } from "../../errors.js";

if (isSetupRequiredError(error.message)) {
  return createSetupRequiredResponse({ attemptedAction: "tool-name" });
}
```

---

## Key Exports

```typescript
// Key Management
import { KeyProvider, Signer, Account, keyProviderRegistry } from "@keplr-wallet/keplr-wallet-mcp/keys";
import { adapterBridgeRegistry } from "@keplr-wallet/keplr-wallet-mcp/keys/adapter-bridge";

// Ecosystem
import { EcosystemAdapter } from "@keplr-wallet/keplr-wallet-mcp/ecosystem";

// Plugins
import { KeplrPlugin, pluginRegistry, createPluginContext } from "@keplr-wallet/keplr-wallet-mcp/plugin-types";
import type { ProtocolPlugin } from "@keplr-wallet/keplr-wallet-mcp/protocol-types";

// SDK & Utilities
import { balanceEnricherRegistry } from "@keplr-wallet/keplr-wallet-mcp/sdk";
import type { BalanceEnricher } from "@keplr-wallet/keplr-wallet-mcp/sdk";

// Configuration & Infrastructure
import { loadConfig } from "@keplr-wallet/keplr-wallet-mcp/config";
import { KeplrStore } from "@keplr-wallet/keplr-wallet-mcp/store";
import { getRpcResolver, RpcResolver } from "@keplr-wallet/keplr-wallet-mcp/rpc";
```

All subpath exports: `.`, `./sdk`, `./ecosystem`, `./store`, `./errors`, `./plugin-types`, `./protocol-types`, `./keys`, `./keys/providers/mnemonic`, `./keys/providers/passkey`, `./keys/signers`, `./keys/accounts`, `./keys/adapter-bridge`, `./keys/registry`, `./config`, `./rpc`, `./utils/lcd-fetch`

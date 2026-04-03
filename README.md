# Keplr Wallet MCP

> [!WARNING]
> **Beta Notice:** Keplr Wallet MCP is in beta and may contain bugs or unexpected behavior. By using this software, you acknowledge that you do so at your own risk. The developers are not liable for any loss of funds or damages arising from the use of this software.

Your AI-powered wallet for Cosmos. Send, stake, swap — just ask. Currently supporting 40+ chains via the [Model Context Protocol](https://modelcontextprotocol.io/).

For setup guides, usage examples, and full tool reference, see the [Docs](https://mcp.keplr.app/docs).

## Architecture

This is a **pnpm monorepo** with a plugin-based architecture for multi-ecosystem blockchain support.

| Package | Description |
|---------|-------------|
| `@keplr-wallet/keplr-wallet-mcp` | Core MCP server with Cosmos built-in + account/chain management |
| `@keplr-wallet/biometric-darwin` | macOS biometric authentication binary (private) |

## Prerequisites

- **Node.js** >= 22
- **pnpm** (npm and yarn are not supported)

## Quick Start

### Using the published package

```bash
# Claude Code
claude mcp add --scope user keplr -- npx @keplr-wallet/keplr-wallet-mcp

# Or install directly
npm install @keplr-wallet/keplr-wallet-mcp
```

### Development (from source)

```bash
pnpm install
pnpm build
pnpm start
```

## Tool Discovery

Use the meta-tools for efficient tool discovery:

1. `search-tools(query: "send cosmos")` → Find relevant tools
2. `describe-tools(names: ["send-tokens"])` → Get full parameters
3. Call the tool directly

Or use the `keplr-guide` prompt for a full workflow guide.

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "keplr": {
      "command": "npx",
      "args": ["@keplr-wallet/keplr-wallet-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user keplr -- npx @keplr-wallet/keplr-wallet-mcp
```

For development, copy the template and fill in your API keys:

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json with your actual API keys
```

### Advanced Configuration

For plugin registration, RPC overrides, or toolset filtering, create a `keplr-mcp.config.ts` in your working directory. See the [Environment Variables](docs/pages/reference/environment.mdx) for details.

## Getting Started

New to the wallet? Use the onboarding tools to get set up:

```
onboarding-status    # Check setup progress and get guidance
/get-started         # Guided onboarding prompt
```

The server provides intelligent guidance:
- **Setup Guide**: When wallet isn't configured, tools return setup options instead of errors
- **Suggested Actions**: Query results include logical next steps (e.g., "stake tokens", "claim rewards")
- **Progress Tracking**: Checklist-based onboarding status

## Account Management

The server supports multiple accounts stored securely in the OS Keychain:

```
create-account name="trading"              # Create new wallet
import-account name="main" mnemonic="..."  # Import existing
list-accounts                              # List all accounts
switch-account name="trading"             # Switch active account
```

Configuration is stored in `~/.keplr-mcp/`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KEPLR_MNEMONIC` | No | BIP39 mnemonic (overrides keychain) |
| `KEPLR_ADAPTERS` | No | Additional adapter packages to load (comma-separated) |
| `KEPLR_RPC_API_KEY` | No | Keplr RPC API key for premium endpoints (falls back to public RPC if unset) |
| `KEPLR_TX_TTL_MINUTES` | No | Transaction confirmation token TTL in minutes (default: 5) |
| `COINGECKO_API_KEY` | No | CoinGecko Pro API key for portfolio price data |
| `SKIP_API_KEY` | No | Skip Routes API key for IBC channel resolution |
| `SKIP_API_URL` | No | Skip Routes API endpoint override |

## Supported Chains

**Cosmos:** Cosmos Hub, Osmosis, dYdX, Celestia, Stargaze, Juno, Noble, Stride, Akash, Injective, and 40+ more.

## Tools & Prompts

67 tools and 20+ prompts across categories: Account Management, Cosmos Query & Transaction, CosmWasm, Multi-Action, DeFi (Osmosis), Authentication, Keplr Infra, and more.

For the full tool list and parameters, see the [Tool Reference](https://mcp.keplr.app/docs/reference).

## Security

- Mnemonics are encrypted with AES-256-GCM and stored in `~/.keplr-mcp/vaults/<account>.enc`. The decryption key is stored in your OS credential store (e.g. macOS Keychain)
- All transactions (send, delegate, swap, etc.) require explicit confirmation via `confirm-action`
- Confirmation tokens expire after 5 minutes
- Use dedicated wallets with limited funds for AI agent usage

### Optional: Two-Factor Authentication

For additional security, you can enable authentication for destructive actions (account deletion, mnemonic export). Authentication is handled separately from transaction confirmation — it applies at the tool layer, not via `confirm-action`. Two methods are available:

#### Biometric (Touch ID / Face ID)
```
auth-setup provider=biometric  # Enable biometric auth
```

#### TOTP (Google Authenticator)
```
auth-setup provider=totp       # Step 1: Generate secret key
# Add the key to Google Authenticator app
auth-verify-setup provider=totp code=123456  # Step 2: Verify with 6-digit code
```

When enabled, you'll need to authenticate before performing protected actions.

TOTP secrets are stored in your OS credential store (e.g. macOS Keychain), not in the config file.

**Supported authenticator apps:** Google Authenticator, Authy, Microsoft Authenticator, 1Password, and any RFC 6238 compatible app.

## License

MIT

# Keplr Wallet MCP

AI agents can interact with Cosmos ecosystem chains via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Architecture

This is a **pnpm monorepo** with a plugin-based architecture for multi-ecosystem blockchain support.

| Package | Description |
|---------|-------------|
| `@keplr-wallet/keplr-wallet-mcp` | Core MCP server with Cosmos built-in + account/chain management |
| `@keplr-wallet/protocol-osmosis` | Osmosis DEX token swaps |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run the server
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
      "command": "node",
      "args": ["/path/to/keplr-mcp-server/packages/server/dist/index.js"]
    }
  }
}
```

### Claude Code

Copy the template and fill in your API keys:

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json with your actual API keys
```

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
| `KEPLR_ADAPTERS` | No | Additional adapter packages to load |
| `KEPLR_PROTOCOLS` | No | Additional protocol plugins to load |
| `KEPLR_RPC_API_KEY` | No | Keplr RPC API key for premium endpoints (falls back to public RPC if unset) |

## Supported Chains

**Cosmos:** Cosmos Hub, Osmosis, dYdX, Celestia, Stargaze, Juno, Noble, Stride, Akash, Injective, and 40+ more.

Custom chains can be added dynamically via the `add-cosmos-chain` tool.

## Tool Summary

### Onboarding
- `onboarding-status` — Check wallet setup progress with checklist and next steps

### Account Management
- `list-accounts` — List all accounts with active account marked
- `create-account` — Create new account with generated mnemonic
- `import-account` — Import existing mnemonic as account
- `switch-account` — Switch active account
- `rename-account` — Rename an account
- `delete-account` — Delete account (requires confirmation)
- `get-account-addresses` — Get all addresses for active account

### Chain Management
- `list-cosmos-chains` — List all supported Cosmos chains
- `add-cosmos-chain` — Add custom Cosmos chain
- `remove-cosmos-chain` — Remove custom Cosmos chain

### Cosmos Operations
- `get-cosmos-address` — Get wallet address for a chain
- `get-balances` — Query token balances
- `get-staking-info` — View delegations and rewards
- `get-portfolio` — Unified portfolio across all chains with USD values
- `list-validators` — Browse validators with commission and voting power
- `list-proposals` — View governance proposals
- `send-tokens` — Send tokens
- `ibc-transfer` — Cross-chain IBC transfer
- `delegate` / `undelegate` / `redelegate` — Manage staking positions
- `claim-rewards` / `claim-all-rewards` — Claim staking rewards
- `vote-governance` — Vote on governance proposals
- `cancel-unbonding` — Cancel unbonding delegation

### CosmWasm
- `cosmwasm-query` — Query smart contract state
- `cosmwasm-execute` — Execute smart contract
- `cosmwasm-instantiate` — Instantiate a new contract
- `cosmwasm-contract-info` — Get contract metadata

### DeFi
- `osmosis-quote` / `osmosis-swap` — Osmosis DEX token swaps

### Authentication (Optional)
- `auth-status` — Check authentication configuration and available methods
- `auth-setup` — Setup authentication provider (biometric or TOTP)
- `auth-verify-setup` — Complete TOTP setup with verification code
- `auth-available-methods` — Check available auth methods for an action
- `auth-enable` / `auth-disable` — Enable/disable auth system
- `auth-provider-disable` — Disable specific auth provider

### Utilities
- `confirm-action` — Execute pending transaction
- `list-pending-actions` — View pending confirmation tokens
- `list-installed-adapters` — List loaded ecosystem adapters
- `list-installed-protocols` — List loaded DeFi protocol plugins
- `get-transaction-status` — Check on-chain transaction status

### Prompts (Slash Commands)
- `/get-started` — Guided onboarding for new users
- `/create-account` — Create new wallet
- `/check-balances` — Check token balances
- `/check-staking` — Check staking positions
- `/stake` — Guided staking flow
- `/claim-rewards` — Claim staking rewards
- `/setup-authentication` — Configure authentication for transactions
- `/setup-totp` — Setup Google Authenticator 2FA

## Security

- Mnemonics are stored in the OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- All state-changing operations require explicit confirmation via `confirm-action`
- Confirmation tokens expire after 5 minutes
- Use dedicated wallets with limited funds for AI agent usage

### Optional: Two-Factor Authentication

For additional security, you can enable authentication for destructive actions (e.g., account deletion). Two methods are available:

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

**Supported authenticator apps:** Google Authenticator, Authy, Microsoft Authenticator, 1Password, and any RFC 6238 compatible app.

## License

MIT

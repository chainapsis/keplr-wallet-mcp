# Keplr Wallet MCP

> [!WARNING]
> **Beta Notice:** Keplr Wallet MCP is in beta and may contain bugs or unexpected behavior. By using this software, you acknowledge that you do so at your own risk. The developers are not liable for any loss of funds or damages arising from the use of this software.

AI agents can interact with Cosmos ecosystem chains via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Architecture

This is a **pnpm monorepo** with a plugin-based architecture for multi-ecosystem blockchain support.

| Package | Description |
|---------|-------------|
| `@keplr-wallet/keplr-wallet-mcp` | Core MCP server with Cosmos built-in + account/chain management |
| `@keplr-wallet/protocol-osmosis` | Osmosis DEX token swaps |

## Prerequisites

- **Node.js** >= 22
- **pnpm** (npm and yarn are not supported)

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

### Advanced Configuration

For plugin registration, RPC overrides, or toolset filtering, create a `keplr-mcp.config.ts` in your working directory. See the [SDK docs](docs/pages/sdk/quick-start.mdx) for details.

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
| `KEPLR_PROTOCOLS` | No | Additional protocol plugins to load (comma-separated) |
| `KEPLR_RPC_API_KEY` | No | Keplr RPC API key for premium endpoints (falls back to public RPC if unset) |
| `KEPLR_TX_TTL_MINUTES` | No | Transaction confirmation token TTL in minutes (default: 5) |
| `COINGECKO_API_KEY` | No | CoinGecko Pro API key for portfolio price data |
| `SKIP_API_KEY` | No | Skip Routes API key for IBC channel resolution |
| `SKIP_API_URL` | No | Skip Routes API endpoint override |

## Supported Chains

**Cosmos:** Cosmos Hub, Osmosis, dYdX, Celestia, Stargaze, Juno, Noble, Stride, Akash, Injective, and 40+ more.

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
- `export-mnemonic` — Export recovery phrase for an account (requires confirmation)
- `check-vault-health` — Check vault integrity and repair if needed

### Chain Query
- `list-cosmos-chains` — List all supported Cosmos chains

### Cosmos Query
- `get-cosmos-address` — Get wallet address for a chain
- `get-balances` — Query token balances
- `get-staking-info` — View delegations and rewards
- `get-portfolio` — Unified portfolio across all chains with USD values
- `list-validators` — Browse validators with commission and voting power
- `list-proposals` — View governance proposals
- `get-proposal` — Get detailed info about a specific proposal with tally results
- `get-unbonding` — View unbonding delegations with completion times
- `list-fee-tokens` — List accepted fee tokens for a chain with balances
- `list-ibc-channels` — List IBC transfer channels for a chain

### Cosmos Transaction
- `send-tokens` — Send tokens
- `ibc-transfer` — Cross-chain IBC transfer (auto-resolves channels via Skip API)
- `delegate` / `undelegate` / `redelegate` — Manage staking positions
- `claim-rewards` / `claim-all-rewards` — Claim staking rewards
- `vote-governance` — Vote on governance proposals
- `cancel-unbonding` — Cancel unbonding delegation

### Cosmos Signing
- `cosmos-sign-arbitrary` — Sign arbitrary message using ADR-36 (proves address ownership)
- `cosmos-verify-signature` — Verify an ADR-36 signature

### CosmWasm
- `cosmwasm-query` — Query smart contract state
- `cosmwasm-execute` — Execute smart contract
- `cosmwasm-instantiate` — Instantiate a new contract
- `cosmwasm-contract-info` — Get contract metadata
- `cosmwasm-list-contracts` — List contracts deployed from a code ID

### Multi-Action
- `multi-action-create` — Start a multi-action transaction (atomic, saves gas)
- `multi-action-add` — Add an action (send, delegate, vote, cosmwasm-execute, etc.)
- `multi-action-remove` — Remove an action by index
- `multi-action-preview` — Simulate and preview gas/fee estimates
- `multi-action-execute` — Execute all actions atomically
- `multi-action-list` — List pending multi-action transactions
- `multi-action-cancel` — Cancel a multi-action transaction

### DeFi
- `osmosis-quote` / `osmosis-swap` — Osmosis DEX token swaps

### Authentication (Optional)
- `auth-status` — Check authentication configuration and available methods
- `auth-setup` — Setup authentication provider (biometric or TOTP)
- `auth-verify-setup` — Complete TOTP setup with verification code
- `auth-available-methods` — Check available auth methods for an action
- `auth-enable` / `auth-disable` — Enable/disable auth system
- `auth-provider-disable` — Disable specific auth provider

### Keplr Infra
- `keplr_api_validate_key` — Validate a Keplr Infra API key
- `keplr_api_get_payment_link` — Get a Stripe payment link to add Keplr Infra credits
- `keplr_api_get_usage_summary` — Get Keplr Infra usage summary (balance, requests, per-chain breakdown)
- `keplr_api_get_usage_history` — Get Keplr Infra usage history with date/chain/endpoint filters
- `keplr_api_list_chains` — List all chains available on Keplr Infra

### Utilities
- `confirm-action` — Execute pending transaction
- `cancel-pending-action` — Cancel a pending transaction
- `list-pending-actions` — View pending confirmation tokens
- `list-transaction-history` — View past transaction history with status
- `get-transaction-status` — Check on-chain transaction status
- `search-tools` — Search tools by keyword, category, or ecosystem
- `describe-tools` — Get full parameter details for specific tools
- `list-installed-adapters` — List loaded ecosystem adapters
- `list-installed-protocols` — List loaded DeFi protocol plugins

### Prompts (Slash Commands)

#### Onboarding & Account
- `/get-started` — Guided onboarding for new users
- `/create-account` — Create new wallet
- `/import-account` — Import existing wallet
- `/delete-account` — Delete a wallet account
- `/switch-account` — Switch active account
- `/list-accounts` — List all accounts

#### Query & Operations
- `/check-balances` — Check token balances
- `/check-staking` — Check staking positions
- `/wallet-overview` — Quick overview of wallet status and addresses
- `/analyze-portfolio` — Analyze cross-chain portfolio with recommendations
- `/send` — Send tokens (guided)
- `/stake` — Guided staking flow
- `/redelegate` — Move stake between validators (guided)
- `/claim-rewards` — Claim staking rewards
- `/governance` — Participate in governance voting (guided)
- `/ibc-transfer` — Transfer tokens between chains (guided)
- `/bridge` — Bridge tokens between Cosmos chains

#### DeFi & Smart Contracts
- `/osmosis-swap` — Swap tokens on Osmosis DEX (guided)
- `/cosmwasm-interact` — Interact with a CosmWasm smart contract (guided)

#### Security & Discovery
- `/setup-authentication` — Configure authentication for transactions
- `/setup-totp` — Setup Google Authenticator 2FA
- `/security-check` — Review wallet security settings
- `/keplr-guide` — Guide for discovering and using tools via meta-tools

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

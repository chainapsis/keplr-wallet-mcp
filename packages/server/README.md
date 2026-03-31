# @keplr-wallet/mcp-server

Core MCP server for blockchain interactions via the Model Context Protocol. Includes built-in Cosmos support and manages account/chain configuration.

## Installation

```bash
pnpm add @keplr-wallet/mcp-server
```

## MCP Tools

### Account Management

| Tool | Description |
|------|-------------|
| `list-accounts` | List all accounts with their status (active account marked) |
| `create-account` | Create a new account with a freshly generated BIP39 mnemonic |
| `import-account` | Import an existing mnemonic as a new account |
| `switch-account` | Switch to a different account as the active account |
| `rename-account` | Rename an existing account |
| `delete-account` | Delete an account and its mnemonic (requires confirmation) |
| `get-account-addresses` | Get all wallet addresses for the active account across all ecosystems |

**Parameters for `create-account`:**
- `name` (required) — Unique account name (e.g., 'trading', 'savings')
- `strength` — Number of words: '12' or '24' (default: '24')
- `description` — Optional description
- `setActive` — Whether to set as active account (default: true)

**Parameters for `import-account`:**
- `name` (required) — Unique account name
- `mnemonic` (required) — BIP39 mnemonic phrase (12/15/18/21/24 words)
- `description` — Optional description
- `setActive` — Whether to set as active account (default: true)

### Chain Query

| Tool | Description |
|------|-------------|
| `list-cosmos-chains` | List all supported Cosmos chains with chain IDs, names, and native denominations |

### Cosmos Query Tools

| Tool | Description |
|------|-------------|
| `get-cosmos-address` | Get wallet address for a specific Cosmos chain |
| `get-balances` | Query all token balances for the wallet on a specific chain |
| `get-staking-info` | Get current delegations and pending staking rewards |

### Cosmos Transaction Tools

| Tool | Description |
|------|-------------|
| `send-tokens` | Send tokens to a recipient address on a specific chain |
| `ibc-transfer` | Transfer tokens to another chain via IBC |
| `delegate` | Delegate (stake) tokens to a validator |
| `undelegate` | Undelegate (unstake) tokens from a validator |
| `claim-rewards` | Claim staking rewards from a specific validator |
| `vote-governance` | Vote on a governance proposal |

**Parameters for `send-tokens`:**
- `chain` (required) — Chain ID or name
- `recipientAddress` (required) — Bech32 recipient address
- `amount` (required) — Amount in minimal denomination (e.g., '1000000' for 1 ATOM)
- `denom` — Token denomination (defaults to chain native)

**Parameters for `delegate`:**
- `chain` (required) — Chain ID or name
- `validatorAddress` (required) — Validator operator address (e.g., 'cosmosvaloper1...')
- `amount` (required) — Amount in minimal denomination
- `denom` — Token denomination (defaults to chain native)

### Authentication Tools

| Tool | Description |
|------|-------------|
| `auth-status` | Check authentication configuration and available methods |
| `auth-setup` | Setup an authentication provider (e.g., biometric) |
| `auth-enable` | Enable the authentication system |
| `auth-disable` | Disable the authentication system |
| `auth-provider-disable` | Disable a specific authentication provider |

**Parameters for `auth-setup`:**
- `provider` (required) — Provider to setup ('biometric')
- `action` — Action to require auth for (default: 'delete_account')

### Utility Tools

| Tool | Description |
|------|-------------|
| `confirm-action` | Execute a pending transaction using the confirmation token |
| `list-installed-adapters` | List all ecosystem adapters currently loaded |

## MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `wallet-status` | `wallet://status` | Wallet configuration status and supported chains |
| `chain-portfolio` | `wallet://portfolio/{chainId}` | Portfolio for a specific chain (balances + staking) |

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `analyze-portfolio` | Analyze cross-chain Cosmos portfolio holdings and provide recommendations |
| `setup-authentication` | Guide for setting up transaction authentication |

## Supported Cosmos Chains (Built-in)

| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Cosmos Hub | cosmoshub-4 | ATOM |
| Osmosis | osmosis-1 | OSMO |
| dYdX | dydx-mainnet-1 | DYDX |
| Celestia | celestia | TIA |
| Stargaze | stargaze-1 | STARS |
| Juno | juno-1 | JUNO |
| Noble | noble-1 | USDC |
| Stride | stride-1 | STRD |
| Akash | akashnet-2 | AKT |
| Injective | injective-1 | INJ |

## Configuration Storage

Configuration files are stored in `~/.keplr-mcp/`:
- `accounts.json` — Account metadata and active account
- `auth.json` — Authentication configuration

Mnemonics are stored securely in the OS Keychain.

## Exports

```typescript
import server from "@keplr-wallet/mcp-server";
import { EcosystemAdapter, EcosystemClient } from "@keplr-wallet/mcp-server/ecosystem";
import { store, KeplrStore } from "@keplr-wallet/mcp-server/store";
import { KeplrPlugin } from "@keplr-wallet/mcp-server/plugin-types";
import { ProtocolPlugin } from "@keplr-wallet/mcp-server/protocol-types";
```

## License

MIT

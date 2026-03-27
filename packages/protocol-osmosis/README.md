# @keplr-wallet/protocol-osmosis

Osmosis DEX protocol plugin for Keplr MCP Server. Enables token swaps on the Osmosis chain.

## Installation

Add as an optional dependency to your MCP server:

```bash
pnpm add @keplr-wallet/protocol-osmosis
```

The plugin is automatically discovered by the server at startup. Uses the built-in Cosmos adapter.

## MCP Tools

### Quote Tool

| Tool | Description |
|------|-------------|
| `osmosis-quote` | Get a swap quote from Osmosis DEX |

**Parameters:**
- `tokenIn` (required) — Input token symbol (OSMO, ATOM, USDC) or IBC denom
- `tokenOut` (required) — Output token symbol or IBC denom
- `amountIn` (required) — Amount in human-readable form (e.g., '10' for 10 OSMO)
- `slippageBps` — Slippage tolerance in basis points (default: 50 = 0.5%)

**Response includes:**
- Expected output amount
- Minimum output with slippage
- Price impact
- Pool fee
- Pool ID and route information

### Swap Tool

| Tool | Description |
|------|-------------|
| `osmosis-swap` | Execute a token swap on Osmosis DEX |

**Parameters:**
- `tokenIn` (required) — Input token symbol or IBC denom
- `tokenOut` (required) — Output token symbol or IBC denom
- `amountIn` (required) — Amount in human-readable form
- `slippageBps` — Slippage tolerance in basis points (default: 50 = 0.5%)

**Note:** Returns a confirmation token. Call `confirm-action` to execute the swap.

## MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| `osmosis-tokens` | `osmosis://tokens` | List of supported tokens on Osmosis |

## Supported Tokens

The following symbols are recognized without needing IBC denoms:

| Symbol | Description |
|--------|-------------|
| `OSMO` | Osmosis native token |
| `ATOM` | Cosmos Hub ATOM (IBC) |
| `USDC` | Noble USDC (IBC) |
| `USDT` | Kava USDT (IBC) |
| `TIA` | Celestia TIA (IBC) |

For other tokens, provide the full IBC denom (e.g., `ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2`).

## Examples

**Get quote for swapping 10 OSMO to ATOM:**
```
osmosis-quote
  tokenIn="OSMO"
  tokenOut="ATOM"
  amountIn="10"
```

**Execute swap:**
```
osmosis-swap
  tokenIn="OSMO"
  tokenOut="ATOM"
  amountIn="10"
  slippageBps=100
```

Then confirm with:
```
confirm-action confirmationToken="<token>"
```

**Swap with custom slippage:**
```
osmosis-swap
  tokenIn="ATOM"
  tokenOut="USDC"
  amountIn="5"
  slippageBps=200
```

## Chain Information

- **Chain ID:** osmosis-1
- **Bech32 Prefix:** osmo
- **Native Token:** OSMO

## License

MIT

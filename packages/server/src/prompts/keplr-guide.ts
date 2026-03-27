import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the "keplr-guide" MCP prompt.
 *
 * This prompt instructs the AI to use the meta-tools (search-tools, describe-tools)
 * for efficient tool discovery before executing any action.
 */
export const registerKeplrGuidePrompt = (server: McpServer): void => {
  server.registerPrompt(
    "keplr-guide",
    {
      description:
        "Guide for discovering and using Keplr MCP tools efficiently via meta-tools",
    },
    async () => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "# Keplr MCP Server — Tool Discovery Guide",
                "",
                "This server has tools across multiple categories. Use the meta-tools to find what you need efficiently.",
                "",
                "## Recommended Workflow",
                "",
                "1. **search-tools** — Find relevant tools by keyword, category, or ecosystem",
                '   - Example: `search-tools(query: "send cosmos")` to find Cosmos transfer tools',
                '   - Example: `search-tools(category: "cosmos-query")` to list all Cosmos query tools',
                '   - Example: `search-tools(ecosystem: "cosmos")` to browse Cosmos tools',
                "",
                "2. **describe-tools** — Get full parameter details for specific tools",
                '   - Example: `describe-tools(names: ["send-tokens"])` to see all parameters',
                '   - Example: `describe-tools(names: ["delegate", "claim-rewards"])` for multiple tools',
                "",
                "3. **Execute** — Call the tool directly with the correct parameters",
                "",
                "## Available Categories",
                "",
                "| Category | Ecosystem | Description |",
                "|----------|-----------|-------------|",
                "| account-management | common | Account creation, import, switch |",
                "| authentication | common | Biometric, TOTP, session-based auth |",
                "| transaction-confirm | common | Pending tx management, portfolio |",
                "| cosmos-query | cosmos | Balances, staking, governance, IBC channels |",
                "| cosmos-transaction | cosmos | Send, delegate, IBC transfer, vote |",
                "| cosmwasm | cosmos | Smart contract query and execute |",
                "| cosmos-signing | cosmos | ADR-36 message signing and verification |",
                "| chain-management | common | Add/remove custom Cosmos chains |",
                "| defi-osmosis | cosmos | Osmosis DEX swap quote and execute |",
                "",
                "## Quick Examples",
                "",
                "**Check balances:**",
                '`search-tools(query: "balance")` → find balance tools for Cosmos chains',
                "",
                "**Send tokens:**",
                '`search-tools(query: "send")` → `describe-tools(names: ["send-tokens"])` → call send-tokens',
                "",
                "**Stake tokens:**",
                '`search-tools(query: "delegate stake")` → `describe-tools(names: ["delegate"])` → call delegate',
                "",
                "**Swap on DEX:**",
                '`search-tools(query: "swap")` → osmosis-swap → describe-tools → execute',
                "",
                "## Chain ID Resolution",
                "",
                "Do NOT guess chain IDs — they change across upgrades and are often non-obvious:",
                '- Nym → chain ID is "nyx"',
                '- Terra → chain ID is "phoenix-1"',
                '- Terra Classic → chain ID is "columbus-5"',
                "",
                "Always call list-cosmos-chains first to look up the correct chain ID.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
};

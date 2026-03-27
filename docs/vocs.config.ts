import { defineConfig } from "vocs";

export default defineConfig({
  title: "Keplr Wallet MCP",
  description:
    "AI-powered wallet interface for Cosmos chains via Model Context Protocol",
  logoUrl: "/logo.svg",
  iconUrl: "/favicon.ico",
  rootDir: ".",
  basePath: process.env.BASE_PATH || "/",
  topNav: [
    { text: "Guides", link: "/guides/wallet/account-types" },
    { text: "SDK", link: "/sdk" },
    { text: "Reference", link: "/reference" },
    {
      text: "GitHub",
      link: "https://github.com/chainapsis/keplr-wallet-mcp",
    },
  ],

  sidebar: [
    {
      text: "Getting Started",
      items: [
        { text: "Introduction", link: "/" },
        { text: "Installation", link: "/getting-started/installation" },
        { text: "First Wallet", link: "/getting-started/first-wallet" },
        { text: "AI Integration", link: "/getting-started/ai-integration" },
      ],
    },
    {
      text: "Guides",
      collapsed: false,
      items: [
        {
          text: "Wallet Management",
          collapsed: true,
          items: [
            { text: "Account Types", link: "/guides/wallet/account-types" },
            { text: "Create Wallet", link: "/guides/wallet/create-wallet" },
            { text: "Import Wallet", link: "/guides/wallet/import-wallet" },
          ],
        },
        {
          text: "Cosmos",
          collapsed: true,
          items: [
            { text: "Overview", link: "/guides/cosmos/basics" },
            { text: "Check Balances", link: "/guides/cosmos/balances" },
            { text: "Send Tokens", link: "/guides/cosmos/send" },
            { text: "Staking", link: "/guides/cosmos/staking" },
            { text: "Governance", link: "/guides/cosmos/governance" },
            { text: "IBC Transfer", link: "/guides/cosmos/ibc" },
            { text: "CosmWasm", link: "/guides/cosmos/cosmwasm" },
          ],
        },
        {
          text: "DeFi",
          collapsed: true,
          items: [
            { text: "Overview", link: "/guides/defi/overview" },
            { text: "Osmosis Swap", link: "/guides/defi/osmosis" },
          ],
        },
        {
          text: "Security",
          collapsed: true,
          items: [
            { text: "Overview", link: "/guides/security/overview" },
            { text: "Biometric Auth", link: "/guides/security/biometric" },
            { text: "Best Practices", link: "/guides/security/best-practices" },
          ],
        },
      ],
    },
    {
      text: "SDK",
      collapsed: false,
      items: [
        { text: "Overview", link: "/sdk" },
        { text: "Quick Start", link: "/sdk/quick-start" },
        {
          text: "Development Guides",
          collapsed: true,
          items: [
            { text: "Custom Adapter", link: "/sdk/guides/custom-adapter" },
            { text: "Custom Protocol", link: "/sdk/guides/custom-protocol" },
            { text: "Custom KeyProvider", link: "/sdk/guides/custom-provider" },
            { text: "Tool Development", link: "/sdk/guides/tool-development" },
          ],
        },
        {
          text: "API Reference",
          collapsed: true,
          items: [
            { text: "EcosystemAdapter", link: "/sdk/api/ecosystem-adapter" },
            { text: "KeyProvider", link: "/sdk/api/key-provider" },
            { text: "Signer", link: "/sdk/api/signer" },
            { text: "Account", link: "/sdk/api/account" },
            { text: "Plugin Types", link: "/sdk/api/plugin-types" },
          ],
        },
      ],
    },
    {
      text: "Architecture",
      collapsed: true,
      items: [
        { text: "Overview", link: "/architecture" },
        { text: "Key Management", link: "/architecture/key-management" },
        { text: "Plugin System", link: "/architecture/plugin-system" },
        { text: "Confirmation Flow", link: "/architecture/confirmation-flow" },
        { text: "State Management", link: "/architecture/state-management" },
      ],
    },
    {
      text: "Reference",
      collapsed: false,
      items: [
        { text: "Overview", link: "/reference" },
        {
          text: "Tools",
          collapsed: true,
          items: [
            { text: "Account Management", link: "/reference/tools/accounts" },
            { text: "Authentication", link: "/reference/tools/authentication" },
            { text: "Cosmos Query", link: "/reference/tools/cosmos-query" },
            { text: "Cosmos Transaction", link: "/reference/tools/cosmos-tx" },
            { text: "CosmWasm", link: "/reference/tools/cosmwasm" },
            { text: "Cosmos Signing", link: "/reference/tools/cosmos-signing" },
            { text: "Osmosis", link: "/reference/tools/osmosis" },
          ],
        },
        { text: "Prompts", link: "/reference/prompts" },
        {
          text: "Errors",
          collapsed: true,
          items: [
            { text: "Error Codes", link: "/reference/errors/codes" },
            {
              text: "Troubleshooting",
              link: "/reference/errors/troubleshooting",
            },
          ],
        },
        { text: "Supported Chains", link: "/reference/chains" },
        { text: "Environment Variables", link: "/reference/environment" },
        { text: "Glossary", link: "/reference/glossary" },
      ],
    },
    {
      text: "Tutorials",
      collapsed: true,
      items: [
        { text: "First Staking", link: "/tutorials/first-stake" },
        { text: "Cross-Chain Transfer", link: "/tutorials/cross-chain" },
        { text: "DeFi Basics", link: "/tutorials/defi-basics" },
      ],
    },
  ],

  socials: [
    {
      icon: "github",
      link: "https://github.com/chainapsis/keplr-wallet-mcp",
    },
  ],
});

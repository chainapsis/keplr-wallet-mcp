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
    { text: "Tutorials", link: "/guides/cosmos/balances" },
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
        {
          text: "Create Your First Wallet",
          link: "/getting-started/create-your-first-wallet",
        },
        {
          text: "Talking to Your Wallet",
          link: "/getting-started/talking-to-your-wallet",
        },
        {
          text: "Set Up Security",
          link: "/getting-started/set-up-security",
        },
      ],
    },
    {
      text: "Tutorials",
      collapsed: false,
      items: [
        {
          text: "Cosmos",
          collapsed: true,
          items: [
{ text: "Check Balances", link: "/guides/cosmos/balances" },
            { text: "Send Tokens", link: "/guides/cosmos/send" },
            { text: "Staking", link: "/guides/cosmos/staking" },
            { text: "Governance", link: "/guides/cosmos/governance" },
            { text: "CosmWasm", link: "/guides/cosmos/cosmwasm" },
            { text: "Osmosis Swap", link: "/guides/cosmos/osmosis-swap" },
          ],
        },
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
            {
              text: "Authentication",
              link: "/reference/tools/authentication",
            },
            { text: "Cosmos Query", link: "/reference/tools/cosmos-query" },
            {
              text: "Cosmos Transaction",
              link: "/reference/tools/cosmos-tx",
            },
            { text: "CosmWasm", link: "/reference/tools/cosmwasm" },
            {
              text: "Cosmos Signing",
              link: "/reference/tools/cosmos-signing",
            },
            { text: "Osmosis", link: "/reference/tools/osmosis" },
            {
              text: "Keplr Endpoints API",
              link: "/reference/tools/keplr-rpc",
            },
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

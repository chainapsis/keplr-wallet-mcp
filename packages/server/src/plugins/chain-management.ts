import { StargateClient } from "@cosmjs/stargate";
import { z } from "zod";
import {
  addCustomChainToCache,
  convertStoredToChainInfo,
  isBuiltinChain,
  removeCustomChainFromCache,
} from "../chains/cosmos.js";
import {
  addCosmosChain,
  removeCosmosChain,
  type StoredChainConfig,
} from "../chains/storage.js";
import type { KeplrPlugin } from "./types.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function validateRpcUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol === "http:") {
    // Strip brackets from IPv6 addresses (URL parser includes them in hostname)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (!LOCAL_HOSTS.has(hostname)) {
      throw new Error(
        `HTTP RPC is not allowed for remote endpoints. ` +
          `Use HTTPS, or for local chains use localhost (e.g. http://localhost:26657).`,
      );
    }
  }
}

const chainManagementPlugin: KeplrPlugin = {
  name: "chain-management",
  register(server, _store) {
    server.registerTool(
      "add-cosmos-chain",
      {
        description: "Add a custom Cosmos chain to the registry",
        inputSchema: {
          chainId: z
            .string()
            .describe("Unique chain identifier (e.g., 'mychain-1')"),
          chainName: z.string().describe("Human-readable chain name"),
          rpc: z.string().url().describe("RPC endpoint URL"),
          rest: z.string().url().describe("REST/LCD endpoint URL"),
          bech32Prefix: z.string().describe("Address prefix (e.g., 'cosmos')"),
          denom: z.string().describe("Display denomination (e.g., 'ATOM')"),
          minimalDenom: z
            .string()
            .describe("Minimal denomination (e.g., 'uatom')"),
          decimals: z
            .number()
            .int()
            .min(0)
            .max(18)
            .default(6)
            .describe("Token decimals (default: 6)"),
          gasPrice: z
            .string()
            .describe("Gas price with denom (e.g., '0.025uatom')"),
          coinGeckoId: z
            .string()
            .optional()
            .describe("CoinGecko ID for price lookup"),
          testConnection: z
            .boolean()
            .default(false)
            .describe("Test RPC connection before adding (default: false)"),
        },
      },
      async ({
        chainId,
        chainName,
        rpc,
        rest,
        bech32Prefix,
        denom,
        minimalDenom,
        decimals,
        gasPrice,
        coinGeckoId,
        testConnection,
      }) => {
        // Check if trying to override a built-in chain
        if (isBuiltinChain(chainId)) {
          return {
            content: [
              {
                type: "text",
                text: `Cannot override built-in chain "${chainId}". Built-in chains cannot be modified.`,
              },
            ],
            isError: true,
          };
        }

        // Validate RPC and REST URLs
        try {
          validateRpcUrl(rpc);
          validateRpcUrl(rest);
        } catch (err) {
          return {
            content: [{ type: "text", text: (err as Error).message }],
            isError: true,
          };
        }

        // Test connection if requested
        if (testConnection) {
          try {
            const client = await StargateClient.connect(rpc);
            const height = await client.getHeight();
            client.disconnect();
            console.error(
              `[keplr] RPC connection test passed for ${chainId} (height: ${height})`,
            );
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `RPC connection test failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Create stored config for persistence
        const storedConfig: StoredChainConfig = {
          chainId,
          chainName,
          rpc,
          rest,
          bech32Prefix,
          denom,
          minimalDenom,
          decimals,
          gasPrice,
          coinGeckoId,
        };

        // Save to storage
        await addCosmosChain(storedConfig);

        // Create runtime config with full type support
        const runtimeConfig = convertStoredToChainInfo(storedConfig);

        // Update runtime cache
        addCustomChainToCache(runtimeConfig);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Custom Cosmos chain "${chainName}" added successfully.`,
                  chain: {
                    chainId,
                    chainName,
                    rpc,
                    rest,
                    bech32Prefix,
                    denom,
                    minimalDenom,
                    decimals,
                    gasPrice,
                    coinGeckoId,
                    isBuiltin: false,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "remove-cosmos-chain",
      {
        description:
          "Remove a custom Cosmos chain from the registry. Built-in chains cannot be removed.",
        inputSchema: {
          chainId: z
            .string()
            .describe("Chain ID of the custom chain to remove"),
        },
      },
      async ({ chainId }) => {
        // Check if it's a built-in chain
        if (isBuiltinChain(chainId)) {
          return {
            content: [
              {
                type: "text",
                text: `Cannot remove built-in chain "${chainId}". Only custom chains can be removed.`,
              },
            ],
            isError: true,
          };
        }

        // Remove from storage
        const removed = await removeCosmosChain(chainId);
        if (!removed) {
          return {
            content: [
              {
                type: "text",
                text: `Custom chain "${chainId}" not found. Use list-cosmos-chains to see available chains.`,
              },
            ],
            isError: true,
          };
        }

        // Update runtime cache
        removeCustomChainFromCache(chainId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Custom chain "${chainId}" removed successfully.`,
                  chainId,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  },
};

export default chainManagementPlugin;

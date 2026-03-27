import type { ProtocolPlugin } from "@keplr-wallet/keplr-wallet-mcp/protocol-types";
import { balanceEnricherRegistry } from "@keplr-wallet/keplr-wallet-mcp/sdk";
import type { KeplrStore } from "@keplr-wallet/keplr-wallet-mcp/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { enrichOsmosisBalances } from "./balance-enricher.js";
import { OSMOSIS_CHAIN_ID } from "./constants.js";
import { registerQuoteTool } from "./tools/quote.js";
import { registerSwapTool } from "./tools/swap.js";

const osmosisPlugin: ProtocolPlugin = {
  name: "osmosis-swap",
  protocolId: "osmosis-swap",
  ecosystem: "cosmos",
  supportedChains: [OSMOSIS_CHAIN_ID],

  register(server: McpServer, store: KeplrStore): void {
    registerQuoteTool(server, store);
    registerSwapTool(server, store);

    const alreadyRegistered = balanceEnricherRegistry
      .getEnrichers()
      .some((e) => e.id === "osmosis-skip");
    if (!alreadyRegistered) {
      balanceEnricherRegistry.register({
        id: "osmosis-skip",
        chainIds: [OSMOSIS_CHAIN_ID],
        enrich: enrichOsmosisBalances,
      });
    }
  },
};

/**
 * Factory function for protocol discovery.
 * The server's protocol-loader calls this default export to get the plugin instance.
 */
export default function createOsmosisPlugin(): ProtocolPlugin {
  return osmosisPlugin;
}

// Named exports for direct usage
export { osmosisPlugin };
export {
  getOsmosisClient,
  OsmosisClient,
  type QuoteParams,
  type QuoteResult,
  type SwapParams,
} from "./client.js";
export { OSMOSIS_CHAIN_ID } from "./constants.js";
export { getSkipMsgsDirect, getSkipRoute } from "./skip-api.js";
export { resolveOsmosisDenom } from "./skip-assets.js";

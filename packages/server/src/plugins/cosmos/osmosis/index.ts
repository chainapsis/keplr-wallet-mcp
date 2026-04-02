import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { balanceEnricherRegistry } from "../../../sdk.js";
import type { KeplrStore } from "../../../store.js";
import type { KeplrPlugin } from "../../types.js";
import { enrichOsmosisBalances } from "./balance-enricher.js";
import { OSMOSIS_CHAIN_ID } from "./constants.js";
import { registerQuoteTool } from "./tools/quote.js";
import { registerSwapTool } from "./tools/swap.js";

const osmosisPlugin: KeplrPlugin = {
  name: "osmosis-swap",

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

export default osmosisPlugin;

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

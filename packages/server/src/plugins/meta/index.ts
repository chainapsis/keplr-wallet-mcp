import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeplrStore } from "../../store.js";
import type { KeplrPlugin } from "../types.js";
import { registerDescribeTools } from "./describe-tools.js";
import { registerSearchTools } from "./search-tools.js";

const metaToolsPlugin: KeplrPlugin = {
  name: "meta-tools",
  async register(server: McpServer, _store: KeplrStore): Promise<void> {
    registerSearchTools(server);
    registerDescribeTools(server);
  },
};

export default metaToolsPlugin;

import type { KeplrPlugin } from "./types.js";

const adapterInfoPlugin: KeplrPlugin = {
  name: "adapter-info",
  register(server, store) {
    server.registerTool(
      "list-installed-adapters",
      {
        description:
          "List all ecosystem adapters currently loaded in this server",
      },
      async () => {
        const adapters = store.getAdapters();
        const entries = [...adapters.values()].map((a) => ({
          type: a.type,
          displayName: a.displayName,
          pluginCount: a.getPlugins().length,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { adapters: entries, count: entries.length },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerTool(
      "list-installed-protocols",
      {
        description:
          "List all DeFi protocol plugins currently loaded in this server",
      },
      async () => {
        const protocols = store.getProtocols();
        const entries = [...protocols.values()].map((p) => ({
          protocolId: p.protocolId,
          name: p.name,
          ecosystem: p.ecosystem,
          supportedChains: p.supportedChains,
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { protocols: entries, count: entries.length },
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

export default adapterInfoPlugin;

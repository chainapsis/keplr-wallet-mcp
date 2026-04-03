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
  },
};

export default adapterInfoPlugin;

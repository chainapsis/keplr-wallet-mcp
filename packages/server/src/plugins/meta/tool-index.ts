export type RiskLevel = "safe" | "destructive" | "mixed";
export type Ecosystem = "cosmos" | "common";

export interface ToolEntry {
  name: string;
  description: string;
  category: string;
  ecosystem: Ecosystem;
  risk: RiskLevel;
  keywords: string[];
}

export interface ToolCategory {
  name: string;
  ecosystem: Ecosystem;
  count: number;
}

export interface SearchQuery {
  query?: string;
  category?: string;
  ecosystem?: string;
}

export interface SearchResult {
  name: string;
  description: string;
  category: string;
  risk: RiskLevel;
}

/**
 * Build a ToolIndex that merges static registry-data with live registered tools.
 * Tools in _registeredTools but NOT in TOOL_REGISTRY get auto-indexed as "uncategorized".
 * This preserves plug-and-play: new plugins are discoverable without updating registry-data.
 */
export function buildLiveIndex(
  server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
  staticRegistry: ToolEntry[],
): ToolIndex {
  const registeredTools =
    (
      server as unknown as {
        _registeredTools: Record<string, { description?: string }>;
      }
    )._registeredTools ?? {};

  const registryMap = new Map(staticRegistry.map((t) => [t.name, t]));
  const combined: ToolEntry[] = [...staticRegistry];

  for (const [name, tool] of Object.entries(registeredTools)) {
    // Don't skip meta-tools — they should be discoverable too
    if (!registryMap.has(name)) {
      combined.push({
        name,
        description:
          (tool as { description?: string }).description ?? `Tool: ${name}`,
        category: "uncategorized",
        ecosystem: "common",
        risk: "mixed",
        keywords: name.split("-"),
      });
    }
  }

  return new ToolIndex(combined);
}

export class ToolIndex {
  private entries: ToolEntry[];
  private byName: Map<string, ToolEntry>;

  constructor(entries: ToolEntry[]) {
    this.entries = entries;
    this.byName = new Map(entries.map((e) => [e.name, e]));
  }

  search(query: SearchQuery): SearchResult[] {
    let results = this.entries;

    if (query.ecosystem && query.ecosystem !== "all") {
      results = results.filter(
        (e) => e.ecosystem === query.ecosystem || e.ecosystem === "common",
      );
    }

    if (query.category) {
      results = results.filter((e) => e.category === query.category);
    }

    if (query.query) {
      const terms = query.query.toLowerCase().split(/\s+/);
      // OR matching: include if ANY term matches, sort by match count (most matches first)
      const scored = results
        .map((entry) => {
          const searchable = [
            entry.name,
            entry.description.toLowerCase(),
            ...entry.keywords,
          ]
            .join(" ")
            .toLowerCase();
          const matchCount = terms.filter((term) =>
            searchable.includes(term),
          ).length;
          return { entry, matchCount };
        })
        .filter(({ matchCount }) => matchCount > 0);
      scored.sort((a, b) => b.matchCount - a.matchCount);
      results = scored.map(({ entry }) => entry);
    }

    return results.map(({ name, description, category, risk }) => ({
      name,
      description,
      category,
      risk,
    }));
  }

  getCategories(): ToolCategory[] {
    const map = new Map<string, { ecosystem: Ecosystem; count: number }>();
    for (const entry of this.entries) {
      const existing = map.get(entry.category);
      if (existing) {
        existing.count++;
      } else {
        map.set(entry.category, { ecosystem: entry.ecosystem, count: 1 });
      }
    }
    return Array.from(map.entries()).map(([name, { ecosystem, count }]) => ({
      name,
      ecosystem,
      count,
    }));
  }

  getByName(name: string): ToolEntry | undefined {
    return this.byName.get(name);
  }
}

import type { KeplrPlugin } from "./types.js";

/**
 * ProtocolPlugin extends KeplrPlugin with protocol-specific metadata.
 * Used for DeFi protocols like Uniswap, Aave, etc. that operate on top of ecosystem adapters.
 */
export interface ProtocolPlugin extends KeplrPlugin {
  /** Unique protocol identifier (e.g., "uniswap-v3") */
  readonly protocolId: string;
  /** Target ecosystem type (e.g., "evm", "cosmos") */
  readonly ecosystem: string;
  /** Chain IDs where this protocol is supported (number for EVM, string for Cosmos) */
  readonly supportedChains: (number | string)[];
  /** SDK version this protocol was built against (for compatibility checking) */
  readonly sdkVersion?: string;
}

/**
 * Type guard to check if a plugin is a ProtocolPlugin
 */
export function isProtocolPlugin(plugin: unknown): plugin is ProtocolPlugin {
  if (typeof plugin !== "object" || plugin === null) return false;
  const p = plugin as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.register === "function" &&
    typeof p.protocolId === "string" &&
    typeof p.ecosystem === "string" &&
    Array.isArray(p.supportedChains)
  );
}

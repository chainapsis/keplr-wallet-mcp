/**
 * MCP Logging
 *
 * Provides utilities for sending structured log messages to the MCP client.
 * Uses RFC 5424 syslog severity levels.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Log levels (RFC 5424 syslog severity)
 */
export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/**
 * Logger for a specific component/module
 */
export interface McpLogger {
  debug(message: string, data?: Record<string, unknown>): Promise<void>;
  info(message: string, data?: Record<string, unknown>): Promise<void>;
  notice(message: string, data?: Record<string, unknown>): Promise<void>;
  warning(message: string, data?: Record<string, unknown>): Promise<void>;
  error(message: string, data?: Record<string, unknown>): Promise<void>;
  critical(message: string, data?: Record<string, unknown>): Promise<void>;
}

/**
 * Create a logger for a specific component
 */
export function createLogger(server: McpServer, loggerName: string): McpLogger {
  const log = async (
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: loggerName,
        data: {
          message,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Fallback to console if client doesn't support logging
      console.error(`[${loggerName}] ${level}: ${message}`, data || "");
    }
  };

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    notice: (msg, data) => log("notice", msg, data),
    warning: (msg, data) => log("warning", msg, data),
    error: (msg, data) => log("error", msg, data),
    critical: (msg, data) => log("critical", msg, data),
  };
}

/**
 * Pre-defined loggers for common components
 */
export const LOGGER_NAMES = {
  TRANSACTION: "transaction",
  COSMOS: "cosmos",
  SESSION: "session",
  ACCOUNT: "account",
} as const;

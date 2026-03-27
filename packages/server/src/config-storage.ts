import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR_NAME = ".keplr-mcp";

/**
 * Get the path to the configuration directory (~/.keplr-mcp/).
 */
export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

/**
 * Ensure the configuration directory exists.
 */
export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
}

/**
 * Read a JSON configuration file from the config directory.
 * Returns null if the file does not exist.
 */
export async function readJsonConfig<T>(filename: string): Promise<T | null> {
  const filePath = join(getConfigDir(), filename);
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write a JSON configuration file to the config directory.
 * Creates the directory if it doesn't exist.
 */
export async function writeJsonConfig<T>(
  filename: string,
  data: T,
): Promise<void> {
  await ensureConfigDir();
  const filePath = join(getConfigDir(), filename);
  const content = JSON.stringify(data, null, 2);
  await writeFile(filePath, content, "utf-8");
}

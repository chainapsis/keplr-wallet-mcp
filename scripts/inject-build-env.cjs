/**
 * Post-build script: inlines SKIP_API_KEY into compiled JS files.
 * Equivalent to webpack EnvironmentPlugin in keplr-wallet.
 *
 * - If SKIP_API_KEY env var is set → replaces process.env.SKIP_API_KEY with the literal value
 * - If not set → leaves runtime reference intact (local dev)
 *
 * Run from package dir: node ../../scripts/inject-build-env.cjs
 */

const fs = require("fs");
const path = require("path");

const ENV_VARS = {
  SKIP_API_KEY: process.env.SKIP_API_KEY,
};

const entries = Object.entries(ENV_VARS).filter(([, v]) => v != null);
if (entries.length === 0) {
  process.exit(0);
}

const distDir = path.join(process.cwd(), "dist");
if (!fs.existsSync(distDir)) {
  process.exit(0);
}

const walk = (dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (entry.name.endsWith(".js")) {
      results.push(full);
    }
  }
  return results;
};

let replacedFiles = 0;
for (const file of walk(distDir)) {
  let content = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const [key, value] of entries) {
    const pattern = new RegExp(`process\\.env\\.${key}`, "g");
    const replaced = content.replace(pattern, JSON.stringify(value));
    if (replaced !== content) {
      content = replaced;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, content);
    replacedFiles++;
  }
}

if (replacedFiles > 0) {
  console.error(
    `[inject-build-env] Inlined ${entries.map(([k]) => k).join(", ")} in ${replacedFiles} file(s)`,
  );
}

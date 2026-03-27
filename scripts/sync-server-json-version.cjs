#!/usr/bin/env node
/**
 * Sync server.json version fields with packages/server/package.json.
 * Runs automatically as part of the `pnpm version` hook (called by changesets).
 */

const fs = require("node:fs");
const path = require("node:path");

const pkgPath = path.join(
  __dirname,
  "..",
  "packages",
  "server",
  "package.json",
);
const serverJsonPath = path.join(__dirname, "..", "server.json");

let pkg;
let server;

try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch (err) {
  console.error(`Failed to read ${pkgPath}: ${err.message}`);
  process.exit(1);
}

try {
  server = JSON.parse(fs.readFileSync(serverJsonPath, "utf-8"));
} catch (err) {
  console.error(`Failed to read ${serverJsonPath}: ${err.message}`);
  process.exit(1);
}

const version = pkg.version;
if (!version || typeof version !== "string") {
  console.error(`Invalid version in package.json: ${JSON.stringify(version)}`);
  process.exit(1);
}

let changed = false;

if (server.version !== version) {
  server.version = version;
  changed = true;
}

if (!server.packages?.[0]) {
  console.error("server.json: packages[0] not found");
  process.exit(1);
}

if (server.packages[0].version !== version) {
  server.packages[0].version = version;
  changed = true;
}

if (changed) {
  fs.writeFileSync(
    serverJsonPath,
    JSON.stringify(server, null, 2) + "\n",
    "utf-8",
  );
  console.log(`Synced server.json to version ${version}`);
} else {
  console.log(`server.json already at version ${version}`);
}

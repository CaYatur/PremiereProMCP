// Per-install relay auth token (Node-only helpers; the UXP plugin reads the
// mirrored copy in its own folder, see plugin/src/relayConnection.js).
//
// Zero-config: whoever needs the token first (bridge or MCP server) creates
// it, everyone else reads the same file. Existing installs pick it up
// automatically after updating — no copy/paste.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const PLUGIN_TOKEN_FILENAME = "relay-token.txt";
export const PLUGIN_ID = "com.ppmcp.plugin";

function appDataDir(): string {
  return process.env.APPDATA ?? (process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Roaming")
    : path.join(os.homedir(), ".config"));
}

/** %APPDATA%\PPMCP\relay-token (override with PPMCP_TOKEN_FILE). */
export function relayTokenPath(): string {
  return process.env.PPMCP_TOKEN_FILE ?? path.join(appDataDir(), "PPMCP", "relay-token");
}

/** Installed UXP plugin folder (where Setup copies/links the plugin). */
export function pluginInstallDir(): string {
  return process.env.PPMCP_PLUGIN_DIR ?? path.join(appDataDir(), "Adobe", "UXP", "Plugins", "External", PLUGIN_ID);
}

function readToken(p: string): string | null {
  try {
    const t = fs.readFileSync(p, "utf8").trim();
    return /^[A-Za-z0-9_-]{32,}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Read the token, creating it (0600) if it does not exist yet. */
export function loadOrCreateRelayToken(): string {
  if (process.env.PPMCP_RELAY_TOKEN) return process.env.PPMCP_RELAY_TOKEN;
  const p = relayTokenPath();
  const existing = readToken(p);
  if (existing) return existing;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const token = randomBytes(32).toString("base64url");
  try {
    // wx: if another process won the race, use its token instead.
    fs.writeFileSync(p, token + "\n", { flag: "wx", mode: 0o600 });
    return token;
  } catch {
    const raced = readToken(p);
    if (raced) return raced;
    fs.writeFileSync(p, token + "\n", { mode: 0o600 });
    return token;
  }
}

/** Copy the token into the installed UXP plugin folder so the panel can read
 * it via getPluginFolder() without broad file-system access. Best effort. */
export function mirrorTokenToPlugin(token: string): string | null {
  const dir = pluginInstallDir();
  if (!fs.existsSync(path.join(dir, "manifest.json"))) return null;
  const target = path.join(dir, PLUGIN_TOKEN_FILENAME);
  try {
    if (readToken(target) === token) return target;
    fs.writeFileSync(target, token + "\n", { mode: 0o600 });
    return target;
  } catch {
    return null;
  }
}

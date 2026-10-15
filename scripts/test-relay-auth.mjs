// Relay auth regression test: no-Origin client with token accepted, browser
// origin rejected, bad token rejected without dropping the live panel,
// token auto-created + mirrored to plugin folder, reconnect after bridge restart.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ppmcp-auth-"));
const tokenFile = path.join(tmp, "PPMCP", "relay-token");
const pluginDir = path.join(tmp, "plugin");
fs.mkdirSync(pluginDir, { recursive: true });
fs.writeFileSync(path.join(pluginDir, "manifest.json"), "{}");
const port = 18000 + Math.floor(Math.random() * 2000);
const url = `ws://127.0.0.1:${port}`;
const env = { ...process.env, PPMCP_BRIDGE_PORT: String(port), PPMCP_TOKEN_FILE: tokenFile, PPMCP_PLUGIN_DIR: pluginDir };
delete env.PPMCP_RELAY_TOKEN;

let failed = 0;
const ok = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBridge() {
  const p = spawn(process.execPath, [path.join(root, "bridge/dist/index.js")], { env, stdio: "ignore" });
  return p;
}
async function waitPort() {
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((r) => { const w = new WebSocket(url); w.on("open", () => { w.close(); r(true); }); w.on("error", () => r(false)); });
    if (up) return;
    await sleep(100);
  }
  throw new Error("bridge did not start");
}
function open(opts = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, opts);
    ws.on("open", () => resolve({ ws, ok: true }));
    ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on("error", () => resolve({ ok: false }));
  });
}
function rpc(ws, msg, type) {
  return new Promise((resolve) => {
    const h = (raw) => { const m = JSON.parse(raw.toString()); if (m.type === type) { ws.off("message", h); resolve(m); } };
    ws.on("message", h);
    ws.send(JSON.stringify(msg));
    setTimeout(() => resolve(null), 2000);
  });
}
const closed = (ws) => new Promise((r) => { ws.on("close", (code) => r(code)); setTimeout(() => r(null), 2000); });

let bridge = startBridge();
try {
  await waitPort();
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  ok(token.length >= 32, "token auto-created on first bridge start");
  ok(fs.readFileSync(path.join(pluginDir, "relay-token.txt"), "utf8").trim() === token, "token mirrored into plugin folder");

  const plugin = await open();
  plugin.ws.send(JSON.stringify({ type: "hello", role: "plugin", token }));
  plugin.ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.type === "call") plugin.ws.send(JSON.stringify({ type: "result", id: m.id, ok: true, data: { echo: m.method } })); });

  const mcp = await open();
  ok(mcp.ok, "no-Origin client connects");
  mcp.ws.send(JSON.stringify({ type: "hello", role: "mcp-server", token }));
  const res = await rpc(mcp.ws, { type: "call", id: "1", method: "x.ping", params: {} }, "result");
  ok(res?.ok && res.data.echo === "x.ping", "no-Origin client with token can call through to plugin");

  const uxp = await open({ origin: "uxp://com.ppmcp.plugin" });
  ok(uxp.ok, "UXP-style origin accepted"); uxp.ws?.close();
  const nul = await open({ origin: "null" });
  ok(nul.ok, "Origin: null accepted"); nul.ws?.close();

  for (const o of ["https://evil.example", "http://localhost:3000"]) {
    const b = await open({ origin: o });
    ok(!b.ok && b.status === 403, `browser origin ${o} rejected (403)`);
  }

  const bad = await open();
  const badClose = closed(bad.ws);
  const err = await rpc(bad.ws, { type: "hello", role: "plugin", token: "wrong" }, "authError");
  ok(!!err && /token/.test(err.message), "bad token gets clear authError message");
  ok((await badClose) === 4401, "bad token closed with 4401");
  const st = await rpc(mcp.ws, { type: "status", id: "s" }, "statusResult");
  ok(st?.pluginConnected === true, "existing panel not dropped by unauthenticated 'plugin' hello");

  const noTok = await open();
  const ntClose = closed(noTok.ws);
  noTok.ws.send(JSON.stringify({ type: "hello", role: "mcp-server" }));
  ok((await ntClose) === 4401, "hello without token rejected");

  const t0 = Date.now();
  bridge.kill();
  await sleep(300);
  bridge = startBridge();
  await waitPort();
  ok(fs.readFileSync(tokenFile, "utf8").trim() === token, "token stable across bridge restart");
  const again = await open();
  again.ws.send(JSON.stringify({ type: "hello", role: "mcp-server", token }));
  const st2 = await rpc(again.ws, { type: "status", id: "s2" }, "statusResult");
  ok(!!st2, `client reconnects after bridge restart (${Date.now() - t0}ms)`);
  again.ws.close();

  // Real MCP RelayClient auto-reconnect against restarted bridge.
  process.env.PPMCP_BRIDGE_PORT = String(port);
  process.env.PPMCP_TOKEN_FILE = tokenFile;
  process.env.PPMCP_NO_AUTOSPAWN = "1";
  const { RelayClient } = await import(path.join(root, "server/dist/relayClient.js"));
  const rc = new RelayClient(port);
  rc.connect();
  const s1 = await rc.getStatus();
  ok(s1.id !== "n/a", "RelayClient connects with auto-read token");
  bridge.kill();
  await sleep(300);
  bridge = startBridge();
  await waitPort();
  await sleep(2500);
  const s2 = await rc.getStatus();
  ok(s2.id !== "n/a", "RelayClient auto-reconnects after bridge restart");
} finally {
  bridge.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `relay-auth: ${failed} FAILED` : "relay-auth OK — all checks passed.");
process.exit(failed ? 1 : 0);

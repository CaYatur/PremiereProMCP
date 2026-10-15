const { DEFAULT_RELAY_PORT } = require("./protocol.js");
const handlers = require("./handlers/index.js");
const ppro = require("premierepro");

const RECONNECT_DELAY_MS = 1500;
const TOKEN_FILENAME = "relay-token.txt";

// The bridge creates a per-install token and copies it into this plugin's
// folder automatically. Re-read on every (re)connect so a bridge restart or a
// freshly created token is picked up without reloading the panel.
async function readRelayToken() {
  const lfs = require("uxp").storage.localFileSystem;
  try {
    const folder = await lfs.getPluginFolder();
    const entry = await folder.getEntry(TOKEN_FILENAME);
    const t = String(await entry.read()).trim();
    if (t) return t;
  } catch {
    /* fall through to %APPDATA%\PPMCP\relay-token */
  }
  try {
    const os = require("os");
    const home = os.homedir();
    const url = "file:" + (home + "\\AppData\\Roaming\\PPMCP\\relay-token").replace(/\\/g, "/");
    const entry = await lfs.getEntryWithUrl(url);
    const t = String(await entry.read()).trim();
    if (t) return t;
  } catch {
    /* no token available */
  }
  return undefined;
}

class RelayConnection {
  constructor(onStatusChange) {
    this.ws = null;
    this.onStatusChange = onStatusChange || (() => {});
    this.connected = false;
  }

  start() {
    this._connect();
  }

  _connect() {
    const url = `ws://127.0.0.1:${DEFAULT_RELAY_PORT}`;
    console.log(`[PPMCP] connecting to ${url} ; typeof WebSocket = ${typeof WebSocket}`);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.log(`[PPMCP] new WebSocket() threw: ${err && err.stack ? err.stack : err}`);
      this.onStatusChange(false, `WebSocket constructor failed: ${err && err.message ? err.message : err}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", async () => {
      console.log("[PPMCP] WebSocket open");
      this.connected = true;
      this.onStatusChange(true);
      let info = {};
      try {
        info = { premiereVersion: await ppro.Application.version, pluginVersion: "0.1.0" };
      } catch {
        info = { pluginVersion: "0.1.0" };
      }
      const token = await readRelayToken();
      if (!token) console.log("[PPMCP] relay token not found yet (bridge creates it on start)");
      ws.send(JSON.stringify({ type: "hello", role: "plugin", info, token }));
    });

    ws.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "authError") {
        console.log(`[PPMCP] ${msg.message}`);
        this.authError = msg.message;
        return;
      }
      if (msg.type === "call") {
        await this._handleCall(msg);
      }
    });

    ws.addEventListener("close", (event) => {
      console.log(`[PPMCP] WebSocket close: code=${event && event.code} reason=${event && event.reason}`);
      this.connected = false;
      if (event && event.code === 4401) {
        this.onStatusChange(false, "relay token rejected — retrying (restart the PPMCP bridge if this persists)");
      } else {
        this.onStatusChange(false, `closed (code ${event && event.code})`);
      }
      this._scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      console.log(`[PPMCP] WebSocket error: ${event && (event.message || JSON.stringify(event))}`);
      this.onStatusChange(false, "socket error — see console log");
      // "close" fires right after in the browser-like WS implementation;
      // reconnect is scheduled there.
    });
  }

  _scheduleReconnect() {
    setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
  }

  async _handleCall(msg) {
    const handler = handlers[msg.method];
    let result;
    if (!handler) {
      result = {
        type: "result",
        id: msg.id,
        ok: false,
        error: { code: "INTERNAL_ERROR", message: `No handler registered for method "${msg.method}".` },
      };
    } else {
      try {
        const data = await handler(msg.params || {});
        result = { type: "result", id: msg.id, ok: true, data };
      } catch (err) {
        result = {
          type: "result",
          id: msg.id,
          ok: false,
          error: { code: err.code || "INTERNAL_ERROR", message: (err && err.message) || String(err) },
        };
      }
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(result));
    }
  }
}

module.exports = { RelayConnection };

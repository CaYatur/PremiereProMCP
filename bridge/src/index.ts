#!/usr/bin/env node
// Bridge/Relay service — the one long-lived process that hosts a listening
// socket. Everything else (MCP server, UXP plugin, legacy ExtendScript
// bridge) connects out to this as a WS client. See docs/ARCHITECTURE.md §2.1.
//
// Pure message router + correlation-id tracker. No Premiere editing logic
// lives here — that is a hard boundary (ARCHITECTURE.md §2.3).

import { WebSocketServer, WebSocket } from "ws";
import {
  ClientRole,
  RelayMessage,
  CallMessage,
  ResultMessage,
  StatusQueryMessage,
  DEFAULT_RELAY_PORT,
  DEFAULT_CALL_TIMEOUT_MS,
  routesToLegacyBridge,
} from "@ppmcp/shared";

const PORT = Number(process.env.PPMCP_BRIDGE_PORT ?? DEFAULT_RELAY_PORT);

interface PendingCall {
  originSocket: WebSocket;
  timeout: ReturnType<typeof setTimeout>;
  targetRole: "plugin" | "legacy-bridge";
}

class Relay {
  private wss: WebSocketServer;
  private mcpServers = new Set<WebSocket>();
  private plugin: WebSocket | null = null;
  private pluginInfo: Record<string, unknown> | undefined;
  private legacyBridge: WebSocket | null = null;
  private pending = new Map<string, PendingCall>();

  constructor(port: number) {
    // Loopback-only — never bind a non-local interface.
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (socket) => this.onConnection(socket));
    this.wss.on("listening", () => {
      log(`listening on ws://127.0.0.1:${port}`);
    });
    this.wss.on("error", (err) => {
      log(`server error: ${String(err)}`);
    });
  }

  private onConnection(socket: WebSocket) {
    let role: ClientRole | null = null;

    socket.on("message", (raw) => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(raw.toString()) as RelayMessage;
      } catch {
        log("dropped unparseable message");
        return;
      }

      if (msg.type === "hello") {
        role = msg.role;
        this.registerClient(role, socket, msg.info);
        return;
      }

      if (!role) {
        log(`message before hello, dropping: ${msg.type}`);
        return;
      }

      switch (msg.type) {
        case "call":
          this.handleCall(role, socket, msg);
          break;
        case "result":
          this.handleResult(msg);
          break;
        case "status":
          this.handleStatus(socket, msg);
          break;
        default:
          log(`unhandled message type from ${role}: ${(msg as { type: string }).type}`);
      }
    });

    socket.on("close", () => this.unregisterClient(role, socket));
    socket.on("error", (err) => log(`socket error (${role ?? "unidentified"}): ${String(err)}`));
  }

  private registerClient(role: ClientRole, socket: WebSocket, info?: Record<string, unknown>) {
    if (role === "mcp-server") {
      this.mcpServers.add(socket);
      log("mcp-server connected");
      return;
    }
    if (role === "plugin") {
      if (this.plugin && this.plugin !== socket) {
        log("replacing existing plugin connection (likely Premiere restart)");
        this.failAllPendingFor("plugin", "PLUGIN_NOT_CONNECTED", "superseded by a new plugin connection");
        try {
          this.plugin.close();
        } catch {
          /* already gone */
        }
      }
      this.plugin = socket;
      this.pluginInfo = info;
      log(`plugin connected${info ? " " + JSON.stringify(info) : ""}`);
      return;
    }
    if (role === "legacy-bridge") {
      if (this.legacyBridge && this.legacyBridge !== socket) {
        this.failAllPendingFor("legacy-bridge", "LEGACY_BRIDGE_NOT_CONNECTED", "superseded by a new legacy-bridge connection");
        try {
          this.legacyBridge.close();
        } catch {
          /* already gone */
        }
      }
      this.legacyBridge = socket;
      log("legacy-bridge connected");
    }
  }

  private unregisterClient(role: ClientRole | null, socket: WebSocket) {
    if (role === "mcp-server") {
      this.mcpServers.delete(socket);
      log("mcp-server disconnected");
      return;
    }
    if (role === "plugin" && this.plugin === socket) {
      this.plugin = null;
      this.pluginInfo = undefined;
      log("plugin disconnected");
      this.failAllPendingFor("plugin", "PLUGIN_NOT_CONNECTED", "plugin disconnected");
      return;
    }
    if (role === "legacy-bridge" && this.legacyBridge === socket) {
      this.legacyBridge = null;
      log("legacy-bridge disconnected");
      this.failAllPendingFor("legacy-bridge", "LEGACY_BRIDGE_NOT_CONNECTED", "legacy-bridge disconnected");
    }
  }

  private handleCall(fromRole: ClientRole, fromSocket: WebSocket, msg: CallMessage) {
    if (fromRole !== "mcp-server") {
      log(`ignoring call from non-mcp-server role: ${fromRole}`);
      return;
    }

    const toLegacy = routesToLegacyBridge(msg.method);
    const target = toLegacy ? this.legacyBridge : this.plugin;
    const targetRole: "plugin" | "legacy-bridge" = toLegacy ? "legacy-bridge" : "plugin";

    if (!target || target.readyState !== WebSocket.OPEN) {
      this.sendResult(fromSocket, {
        type: "result",
        id: msg.id,
        ok: false,
        error: {
          code: toLegacy ? "LEGACY_BRIDGE_NOT_CONNECTED" : "PLUGIN_NOT_CONNECTED",
          message: toLegacy
            ? "The legacy ExtendScript bridge is not connected. It must be running alongside Premiere Pro for MOGRT text/graphic property edits."
            : "The Premiere Pro UXP plugin is not connected. Is Premiere Pro running with the plugin loaded?",
        },
      });
      return;
    }

    const timeout = setTimeout(() => {
      this.pending.delete(msg.id);
      this.sendResult(fromSocket, {
        type: "result",
        id: msg.id,
        ok: false,
        error: { code: "TIMEOUT", message: `No response for method "${msg.method}" within ${msg.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS}ms.` },
      });
    }, msg.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);

    this.pending.set(msg.id, { originSocket: fromSocket, timeout, targetRole });
    target.send(JSON.stringify(msg));
  }

  private handleResult(msg: ResultMessage) {
    const entry = this.pending.get(msg.id);
    if (!entry) {
      log(`result for unknown/expired call id ${msg.id}`);
      return;
    }
    clearTimeout(entry.timeout);
    this.pending.delete(msg.id);
    this.sendResult(entry.originSocket, msg);
  }

  private handleStatus(socket: WebSocket, msg: StatusQueryMessage) {
    socket.send(
      JSON.stringify({
        type: "statusResult",
        id: msg.id,
        pluginConnected: this.plugin !== null && this.plugin.readyState === WebSocket.OPEN,
        legacyBridgeConnected: this.legacyBridge !== null && this.legacyBridge.readyState === WebSocket.OPEN,
        pluginInfo: this.pluginInfo,
      }),
    );
  }

  private failAllPendingFor(targetRole: "plugin" | "legacy-bridge", code: "PLUGIN_NOT_CONNECTED" | "LEGACY_BRIDGE_NOT_CONNECTED", message: string) {
    for (const [id, entry] of this.pending) {
      if (entry.targetRole !== targetRole) continue;
      clearTimeout(entry.timeout);
      this.pending.delete(id);
      this.sendResult(entry.originSocket, { type: "result", id, ok: false, error: { code, message } });
    }
  }

  private sendResult(socket: WebSocket, msg: ResultMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }
}

function log(line: string) {
  console.log(`[ppmcp-bridge] ${new Date().toISOString()} ${line}`);
}

new Relay(PORT);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

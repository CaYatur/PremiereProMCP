// MCP server's WebSocket client connection to the bridge/relay. Never hosts
// a socket itself — see docs/ARCHITECTURE.md §2.3.

import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CallMessage,
  ResultMessage,
  HelloMessage,
  StatusQueryMessage,
  StatusResultMessage,
  RelayMessage,
  RelayError,
  ErrorCode,
  DEFAULT_RELAY_PORT,
  DEFAULT_CALL_TIMEOUT_MS,
} from "@ppmcp/shared";
import { beforeRelayCall, endRelayCall } from "./rateLimit.js";

export class RelayCallError extends Error {
  code: ErrorCode;
  detail?: unknown;
  constructor(err: RelayError) {
    super(err.message);
    this.name = "RelayCallError";
    this.code = err.code;
    this.detail = err.detail;
  }
}

interface Waiter {
  resolve: (data: unknown) => void;
  reject: (err: RelayCallError) => void;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private waiters = new Map<string, Waiter>();
  private statusWaiters = new Map<string, (r: StatusResultMessage) => void>();
  private connecting = false;
  private attemptedSpawn = false;
  private connectedResolve: (() => void) | null = null;
  private connectedPromise: Promise<void> | null = null;

  constructor(port = Number(process.env.PPMCP_BRIDGE_PORT ?? DEFAULT_RELAY_PORT)) {
    this.url = `ws://127.0.0.1:${port}`;
  }

  connect(): void {
    if (this.connecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    this.connecting = true;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.connecting = false;
      this.attemptedSpawn = false;
      const hello: HelloMessage = { type: "hello", role: "mcp-server" };
      ws.send(JSON.stringify(hello));
      console.error(`[ppmcp-server] connected to relay at ${this.url}`);
      const resolve = this.connectedResolve;
      this.connectedResolve = null;
      this.connectedPromise = null;
      resolve?.();
    });

    ws.on("message", (raw) => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(raw.toString()) as RelayMessage;
      } catch {
        return;
      }
      if (msg.type === "result") this.handleResult(msg);
      else if (msg.type === "statusResult") this.handleStatusResult(msg);
    });

    ws.on("close", () => {
      this.connecting = false;
      this.ws = null;
      this.failAllWaiters("TIMEOUT", "Lost connection to the bridge/relay process.");
      setTimeout(() => this.connect(), 1500);
    });

    ws.on("error", () => {
      if (!this.attemptedSpawn) {
        this.attemptedSpawn = true;
        void this.trySpawnBridge();
      }
    });
  }

  waitUntilConnected(timeoutMs = 5000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!this.connectedPromise) {
      this.connectedPromise = new Promise((resolve) => {
        this.connectedResolve = resolve;
      });
    }
    return Promise.race([
      this.connectedPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async trySpawnBridge(): Promise<void> {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bridgeEntry = path.resolve(here, "../../bridge/dist/index.js");
      const child = spawn(process.execPath, [bridgeEntry], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.error(`[ppmcp-server] auto-spawned bridge process (pid ${child.pid ?? "?"})`);
    } catch (err) {
      console.error(
        `[ppmcp-server] could not auto-spawn bridge (${String(err)}) — start it manually with "npm run start --workspace=bridge".`,
      );
    }
  }

  async call(method: string, params: Record<string, unknown>, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<unknown> {
    await beforeRelayCall(method);
    try {
      await this.waitUntilConnected();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new RelayCallError({
          code: "PLUGIN_NOT_CONNECTED",
          message: "Not connected to the bridge/relay process. Is it running?",
        });
      }
      const id = randomUUID();
      const msg: CallMessage = { type: "call", id, method, params, timeoutMs };
      return await new Promise<unknown>((resolve, reject) => {
        this.waiters.set(id, { resolve, reject });
        this.ws!.send(JSON.stringify(msg));
      });
    } finally {
      endRelayCall();
    }
  }

  async getStatus(): Promise<StatusResultMessage> {
    await this.waitUntilConnected();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { type: "statusResult", id: "n/a", pluginConnected: false, legacyBridgeConnected: false };
    }
    const id = randomUUID();
    const msg: StatusQueryMessage = { type: "status", id };
    return new Promise((resolve) => {
      this.statusWaiters.set(id, resolve);
      this.ws!.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.statusWaiters.has(id)) {
          this.statusWaiters.delete(id);
          resolve({ type: "statusResult", id, pluginConnected: false, legacyBridgeConnected: false });
        }
      }, 3000);
    });
  }

  private handleResult(msg: ResultMessage) {
    const w = this.waiters.get(msg.id);
    if (!w) return;
    this.waiters.delete(msg.id);
    if (msg.ok) w.resolve(msg.data);
    else w.reject(new RelayCallError(msg.error ?? { code: "INTERNAL_ERROR", message: "Unknown error." }));
  }

  private handleStatusResult(msg: StatusResultMessage) {
    const w = this.statusWaiters.get(msg.id);
    if (!w) return;
    this.statusWaiters.delete(msg.id);
    w(msg);
  }

  private failAllWaiters(code: ErrorCode, message: string) {
    for (const [id, w] of this.waiters) {
      this.waiters.delete(id);
      w.reject(new RelayCallError({ code, message }));
    }
  }
}

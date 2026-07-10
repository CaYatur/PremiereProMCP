// Wire protocol shared by the bridge/relay, the MCP server, the UXP plugin,
// and the legacy ExtendScript bridge. See docs/ARCHITECTURE.md §3.
//
// The plugin runs inside UXP's restricted JS runtime and does not consume
// this package directly (no npm workspace linking into a UXP plugin bundle)
// — plugin/src/protocol.js is a hand-kept, minimal duplicate of the wire
// shapes below. If you change an envelope shape here, mirror it there.

export type ClientRole = "mcp-server" | "plugin" | "legacy-bridge";

/** Stable, machine-readable error codes. See ARCHITECTURE.md §3 — these are
 * what let a calling model recover instead of retrying blindly. */
export type ErrorCode =
  | "NO_ACTIVE_PROJECT"
  | "NO_ACTIVE_SEQUENCE"
  | "NOT_FOUND"
  | "INVALID_PARAMS"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PLUGIN_NOT_CONNECTED"
  | "LEGACY_BRIDGE_NOT_CONNECTED"
  | "TIMEOUT"
  | "PREMIERE_API_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface RelayError {
  code: ErrorCode;
  message: string;
  /** Optional extra structured detail (e.g. valid track indices). */
  detail?: unknown;
}

/** Sent by any client immediately after connecting, before any calls. */
export interface HelloMessage {
  type: "hello";
  role: ClientRole;
  /** e.g. plugin version, Premiere version — useful for diagnostics. */
  info?: Record<string, unknown>;
}

/** MCP server -> relay -> plugin | legacy-bridge */
export interface CallMessage {
  type: "call";
  id: string;
  /** Dot-namespaced method, e.g. "sequence.create", "clip.rippleDelete",
   *  "legacy.mogrt.setText". Namespace prefix "legacy." routes to the
   *  legacy-bridge connection instead of the plugin connection — see
   *  ARCHITECTURE.md §2.4. */
  method: string;
  params: Record<string, unknown>;
  /** Milliseconds before the relay synthesizes a TIMEOUT result. */
  timeoutMs?: number;
}

/** plugin | legacy-bridge -> relay -> MCP server */
export interface ResultMessage {
  type: "result";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: RelayError;
}

/** MCP server -> relay: cheap synchronous status query, does not round-trip
 * to the plugin. Backs the app_get_connection_status tool. */
export interface StatusQueryMessage {
  type: "status";
  id: string;
}

export interface StatusResultMessage {
  type: "statusResult";
  id: string;
  pluginConnected: boolean;
  legacyBridgeConnected: boolean;
  pluginInfo?: Record<string, unknown>;
}

export type RelayMessage =
  | HelloMessage
  | CallMessage
  | ResultMessage
  | StatusQueryMessage
  | StatusResultMessage;

export function isCallMessage(m: RelayMessage): m is CallMessage {
  return m.type === "call";
}

export function isResultMessage(m: RelayMessage): m is ResultMessage {
  return m.type === "result";
}

export const LEGACY_METHOD_PREFIX = "legacy.";

export function routesToLegacyBridge(method: string): boolean {
  return method.startsWith(LEGACY_METHOD_PREFIX);
}

export const DEFAULT_RELAY_PORT = 8265;
export const DEFAULT_CALL_TIMEOUT_MS = 15000;

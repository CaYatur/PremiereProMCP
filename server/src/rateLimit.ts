/**
 * Premiere-safe rate limits.
 *
 * Fast sequential UXP calls crash Premiere. Two layers:
 * 1) Soft: min gap between relay (plugin) calls — auto-waits + serializes.
 * 2) Hard: MCP tool burst / min tool gap — returns RATE_LIMITED (INVALID).
 *
 * Env (optional):
 *   PPMCP_MIN_RELAY_MS      default 100
 *   PPMCP_MIN_TOOL_MS       default 220  (gap between tools — main crash guard)
 *   PPMCP_MAX_TOOLS_PER_MIN default 400  (very high; gap is the real limit)
 *   PPMCP_MAX_HEAVY_PER_MIN default 300
 *   PPMCP_RATE_LIMIT=0      disable hard rejects (soft throttle remains)
 */

export class RateLimitError extends Error {
  code = "RATE_LIMITED" as const;
  retryAfterMs: number;
  detail?: Record<string, unknown>;
  constructor(message: string, retryAfterMs: number, detail?: Record<string, unknown>) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

const HARD_ENABLED = process.env.PPMCP_RATE_LIMIT !== "0";

// Gap between tools is the main Premiere crash guard (~4–5 tools/s max if 220ms).
// Per-minute caps are intentionally high so long edits (music cuts, many SFX) don't stall.
export const MIN_RELAY_MS = envInt("PPMCP_MIN_RELAY_MS", 100);
export const MIN_TOOL_MS = envInt("PPMCP_MIN_TOOL_MS", 220);
export const MAX_TOOLS_PER_MIN = envInt("PPMCP_MAX_TOOLS_PER_MIN", 400);
export const MAX_HEAVY_PER_MIN = envInt("PPMCP_MAX_HEAVY_PER_MIN", 300);

const LIGHT_TOOLS = new Set([
  "app_get_connection_status",
  "edit_bootstrap",
  "edit_help",
  "edit_verify",
  "text_system_status",
  "text_design_guide",
  "checkpoint_list",
  "sequence_list",
  "sequence_get_active",
  "sequence_get_settings",
  "clip_list",
  "clip_get_properties",
  "track_list",
  "project_list_items",
  "project_get_active",
  "marker_list",
  "effect_list_applied",
  "effect_list_available",
  "audio_get_gain",
  "playhead_get_position",
]);

const HEAVY_TOOLS = new Set([
  "clip_overwrite",
  "clip_insert",
  "clip_trim",
  "sequence_create_from_media",
  "sequence_from_media",
  "edit_run",
  "edit_once",
  "edit_playbook_run",
  "edit_auto",
  "edit_quality_pass",
  "quality_pass",
  "project_import_media",
  "export_sequence",
  "sequence_screenshot",
  "text_write",
  "sfx",
  "music_bed",
]);

const HEAVY_RELAY =
  /^(clip\.(overwrite|insert|trim|remove|move)|sequence\.(create|createFromMedia)|project\.(importMedia|save)|export\.|color\.apply|transition\.|audio\.(setGain|normalize))/i;

let lastRelayEnd = 0;
let lastToolEnd = 0;
const toolTimes: number[] = [];
const heavyTimes: number[] = [];

/** Serialize plugin calls; release only after endRelayCall. */
let relaySlot: Promise<void> = Promise.resolve();
let releaseRelaySlot: (() => void) | null = null;

function prune(arr: number[], windowMs: number, now: number) {
  while (arr.length && now - arr[0]! > windowMs) arr.shift();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Soft throttle: acquire exclusive relay slot + wait min gap since last call end.
 * Pair with endRelayCall() in finally.
 */
export async function beforeRelayCall(method: string): Promise<void> {
  const prev = relaySlot;
  let release!: () => void;
  relaySlot = new Promise<void>((r) => {
    release = r;
  });
  releaseRelaySlot = release;
  await prev;

  const gap = HEAVY_RELAY.test(method) ? Math.max(MIN_RELAY_MS, 140) : MIN_RELAY_MS;
  const wait = Math.max(0, lastRelayEnd + gap - Date.now());
  if (wait > 0) await sleep(wait);
}

export function endRelayCall(): void {
  lastRelayEnd = Date.now();
  const r = releaseRelaySlot;
  releaseRelaySlot = null;
  r?.();
}

/**
 * Hard check at MCP tool entry.
 * Throws RateLimitError → tool returns isError (invalid / rate limited).
 */
export function checkToolRateLimit(toolName: string): void {
  if (!HARD_ENABLED) return;
  if (LIGHT_TOOLS.has(toolName)) return;

  const now = Date.now();
  prune(toolTimes, 60_000, now);
  prune(heavyTimes, 60_000, now);

  if (toolTimes.length >= MAX_TOOLS_PER_MIN) {
    const oldest = toolTimes[0] ?? now;
    const retryAfterMs = Math.max(500, 60_000 - (now - oldest) + 50);
    throw new RateLimitError(
      `RATE_LIMITED: max ${MAX_TOOLS_PER_MIN} tools/min exceeded (${toolTimes.length} in last 60s). Premiere crashes if flooded. Wait ~${Math.ceil(retryAfterMs / 1000)}s, then continue with fewer/slower calls. Prefer edit_run batches with pauses.`,
      retryAfterMs,
      {
        reason: "max_tools_per_min",
        max: MAX_TOOLS_PER_MIN,
        count: toolTimes.length,
        tool: toolName,
        retryAfterMs,
      },
    );
  }

  if (HEAVY_TOOLS.has(toolName) && heavyTimes.length >= MAX_HEAVY_PER_MIN) {
    const oldest = heavyTimes[0] ?? now;
    const retryAfterMs = Math.max(800, 60_000 - (now - oldest) + 50);
    throw new RateLimitError(
      `RATE_LIMITED: max ${MAX_HEAVY_PER_MIN} heavy edits/min exceeded. Slow down. Use edit_run (one call, many ops) instead of dozens of atomics. Wait ~${Math.ceil(retryAfterMs / 1000)}s.`,
      retryAfterMs,
      {
        reason: "max_heavy_per_min",
        max: MAX_HEAVY_PER_MIN,
        count: heavyTimes.length,
        tool: toolName,
        retryAfterMs,
      },
    );
  }

  const since = now - lastToolEnd;
  if (lastToolEnd > 0 && since < MIN_TOOL_MS) {
    const retryAfterMs = MIN_TOOL_MS - since + 20;
    throw new RateLimitError(
      `RATE_LIMITED: tools must be ≥${MIN_TOOL_MS}ms apart (last was ${since}ms ago). Wait ${retryAfterMs}ms. Fast spam crashes Premiere. Prefer edit_run plan over rapid atomics.`,
      retryAfterMs,
      {
        reason: "min_tool_gap",
        minToolMs: MIN_TOOL_MS,
        sinceMs: since,
        tool: toolName,
        retryAfterMs,
      },
    );
  }
}

export function markToolComplete(toolName: string): void {
  const now = Date.now();
  lastToolEnd = now;
  if (LIGHT_TOOLS.has(toolName)) return;
  toolTimes.push(now);
  if (HEAVY_TOOLS.has(toolName)) heavyTimes.push(now);
  prune(toolTimes, 60_000, now);
  prune(heavyTimes, 60_000, now);
}

export function rateLimitInfo() {
  const now = Date.now();
  prune(toolTimes, 60_000, now);
  prune(heavyTimes, 60_000, now);
  return {
    hardEnabled: HARD_ENABLED,
    minRelayMs: MIN_RELAY_MS,
    minToolMs: MIN_TOOL_MS,
    maxToolsPerMin: MAX_TOOLS_PER_MIN,
    maxHeavyPerMin: MAX_HEAVY_PER_MIN,
    toolsLast60s: toolTimes.length,
    heavyLast60s: heavyTimes.length,
    note: "RATE_LIMITED = invalid, wait retryAfterMs. Soft relay gap always applied.",
  };
}

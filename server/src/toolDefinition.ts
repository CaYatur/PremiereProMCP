import { z, ZodRawShape } from "zod";
import { RelayClient, RelayCallError } from "./relayClient.js";
import { RateLimitError } from "./rateLimit.js";

export interface ToolContext {
  relay: RelayClient;
}

export interface ToolImage {
  /** Raw image bytes as base64 (no data: URL prefix). */
  data: string;
  mimeType: string;
}

export interface ToolOutcome {
  /** Human/model-readable summary of what happened. Keep it concrete —
   * include the ids/values a model would need for a follow-up call. */
  text: string;
  /** Optional structured payload, surfaced as pretty-printed JSON alongside
   * the text summary so a model can parse exact values it needs. */
  data?: unknown;
  /** Optional images for multimodal clients (Claude vision) — e.g. timeline stills. */
  images?: ToolImage[];
}

export interface ToolDef<Shape extends ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler: (params: z.objectOutputType<Shape, z.ZodTypeAny>, ctx: ToolContext) => Promise<ToolOutcome>;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

/** Thin, uniform wrapper: calls a single relay method and shapes the result
 * into a ToolOutcome. Most atomic tools are exactly this. */
export function relayCallOutcome(summary: (data: unknown) => string) {
  return async (data: unknown): Promise<ToolOutcome> => ({ text: summary(data), data });
}

export function formatRelayError(err: unknown): string {
  if (err instanceof RateLimitError) {
    return `[RATE_LIMITED] ${err.message} → Wait ${err.retryAfterMs}ms then continue slowly. Do NOT spam retry. Prefer edit_run batches.`;
  }
  if (err instanceof RelayCallError) {
    const recovery = recoveryHint(err.code, err.message);
    return recovery ? `[${err.code}] ${err.message} → ${recovery}` : `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Short recovery for models — stops blind retry loops */
function recoveryHint(code: string, message: string): string | undefined {
  if (code === "PLUGIN_NOT_CONNECTED") return "Start Premiere, load UXP plugin, ensure bridge :8265";
  if (code === "LEGACY_BRIDGE_NOT_CONNECTED") return "Open Window > PPMCP Text Bridge or use PNG text";
  if (code === "NO_ACTIVE_PROJECT") return "Open or create a project first";
  if (code === "NO_ACTIVE_SEQUENCE") return "sequence_create / set_active before edit";
  if (code === "TIMEOUT") return "Retry once; check Premiere UI not modal-blocked";
  if (code === "RATE_LIMITED") return "Wait retryAfterMs; slow down; use edit_run not tool spam";
  if (/Illegal Parameter type/i.test(message)) return "String text via UXP fails — use Text Bridge or PNG";
  if (/not found|NOT_FOUND/i.test(code + message)) return "List resources then retry with valid id/index";
  return undefined;
}

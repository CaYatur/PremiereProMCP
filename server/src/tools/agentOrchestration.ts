/**
 * Agent-first orchestration: few tools, outcome-oriented, failure-resistant.
 * Research basis (2025–2026 agent/MCP design):
 * - Prefer 5–15 outcome tools over 200 atomic mirrors (Block, Copilot, DEV articles)
 * - Move multi-step choreography into the server (deterministic)
 * - Compact responses + recovery hints stop retry thrash
 * - Progressive disclosure: playbooks + edit_run vs full catalog
 * Competitors (hetpatel): high-level assemble_* / clipPlan — same idea
 *
 * Competitive edge: automatic systems (edit_auto, polish, youtube/social/trailer
 * playbooks) beat raw tool-count catalogs on delivery quality + token cost.
 */
import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import {
  ALL_OPS,
  PLAYBOOKS,
  resolveIntent,
  runOp,
  type EditOp,
  type OpResult,
} from "../agent/ops.js";

const PLAYBOOK_IDS = [
  "assemble",
  "title_card",
  "sfx_hits",
  "polish_export",
  "animation_pack",
  "full_cut",
  "youtube",
  "social",
  "trailer",
  "music_video",
  "podcast",
  "delivery",
  "qa_pass",
  "chapters",
] as const;

/** Strip heavy payloads for low-token mode */
function compactData(data: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    if (data.length > 12) {
      return [...data.slice(0, 8).map((x) => compactData(x, depth + 1)), `…+${data.length - 8} more`];
    }
    return data.map((x) => compactData(x, depth + 1));
  }
  const o = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "afterSnippet" || k === "templatePath" || k === "pngPath") continue;
    if (typeof v === "string" && v.length > 200) out[k] = v.slice(0, 120) + "…";
    else out[k] = compactData(v, depth + 1);
  }
  return out;
}

function summarizeResults(results: OpResult[]): string {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  const lines = [`Plan: ${ok}/${results.length} ok.`];
  for (const r of results) {
    if (r.ok) lines.push(`✓ ${r.op}`);
    else lines.push(`✗ ${r.op}: ${r.error}${r.recovery ? ` → ${r.recovery}` : ""}`);
  }
  if (fail.length) {
    lines.push("Do NOT retry failed ops blindly. Fix recovery hint once, or skip and continue.");
  }
  return lines.join("\n");
}

export const agentOrchestrationTools = [
  defineTool({
    name: "edit_bootstrap",
    title: "Bootstrap edit session (low token)",
    description:
      "FIRST call every session. Compact connection + active sequence + next-step hints. Prefer this over many list tools. Returns enough for weak models to continue without thrashing.",
    inputSchema: {
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const r = await runOp(ctx, { op: "bootstrap" });
      const status = await ctx.relay.getStatus();
      const tips: string[] = [];
      if (!status.pluginConnected) tips.push("Load UXP plugin in Premiere + start bridge :8265");
      else tips.push("Plugin OK");
      if (!status.legacyBridgeConnected) {
        tips.push("Optional: Window > PPMCP Text Bridge for editable text (else PNG)");
      } else tips.push("Text Bridge OK — use editable titles");
      tips.push("Prefer edit_run / edit_playbook over 20 atomic tools");
      tips.push("On error: read recovery field once; never infinite retry");
      const payload =
        r.data && typeof r.data === "object"
          ? { ...(r.data as Record<string, unknown>), tips }
          : { result: r.data, tips };
      const data = p.compact ? compactData(payload) : payload;
      return {
        text: r.ok
          ? `Ready. ${tips.slice(0, 3).join(" · ")}`
          : `Not ready: ${r.error}. ${r.recovery || ""}`,
        data,
      };
    },
  }),

  defineTool({
    name: "edit_playbook_list",
    title: "List edit playbooks",
    description:
      "Named multi-step recipes including automatic packs: full_cut, youtube, social, trailer, music_video, podcast, delivery, animation_pack, assemble, title_card, sfx_hits, polish_export, qa_pass, chapters. Use edit_playbook_run or edit_auto.",
    inputSchema: {},
    handler: async () => {
      const list = Object.entries(PLAYBOOKS).map(([id, pb]) => ({
        id,
        title: pb.title,
        description: pb.description,
        quality: pb.quality,
      }));
      return {
        text: `Playbooks (${list.length}): ${list.map((p) => p.id).join(", ")}`,
        data: { playbooks: list },
      };
    },
  }),

  defineTool({
    name: "edit_playbook_run",
    title: "Run a named edit playbook",
    description:
      "Execute a multi-step edit recipe server-side. Prefer youtube/social/trailer/full_cut for automatic high-quality packs. stopOnError:false continues after failures. Do not retry whole playbook in a loop.",
    inputSchema: {
      playbook: z
        .enum(PLAYBOOK_IDS)
        .describe("Recipe id. Prefer full_cut (general), youtube, social, trailer for automatic systems."),
      args: z
        .record(z.unknown())
        .optional()
        .describe(
          "Common: {paths[]|videoPath, title?, sfxHits:[{path,atSeconds}], musicPath?, look?, outputPath?, lowerThird?, endCard?, kenBurns?}. See edit_help for per-playbook args.",
        ),
      stopOnError: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, halt on first failure. Default false — continue and report."),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const pb = PLAYBOOKS[p.playbook];
      if (!pb) {
        return { text: `Unknown playbook ${p.playbook}`, data: { ok: false } };
      }
      const plan = pb.build(p.args || {});
      const results: OpResult[] = [];
      for (const step of plan) {
        const r = await runOp(ctx, step);
        results.push(r);
        if (!r.ok && p.stopOnError) break;
      }
      const data = p.compact
        ? { playbook: p.playbook, results: compactData(results) }
        : { playbook: p.playbook, results };
      return { text: summarizeResults(results), data };
    },
  }),

  defineTool({
    name: "edit_auto",
    title: "Auto edit from intent (smart router)",
    description:
      "ONE-CALL automatic system: maps natural intent (e.g. 'youtube vlog', 'tiktok', 'trailer', 'podcast') to the best playbook and runs it with args. Weak models should prefer this over picking tools. Beats competitors who force 20+ atomic calls.",
    inputSchema: {
      intent: z
        .string()
        .min(1)
        .describe(
          "What you want: youtube, social/shorts, trailer, podcast, music video, full cut, polish/delivery, title, assemble, qa…",
        ),
      args: z
        .record(z.unknown())
        .optional()
        .describe("Same as edit_playbook_run args: paths/videoPath, title, sfxHits, musicPath, look, outputPath, etc."),
      stopOnError: z.boolean().optional().default(false),
      compact: z.boolean().optional().default(true),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, only return which playbook would run (no edits)."),
    },
    handler: async (p, ctx) => {
      const resolved = resolveIntent(p.intent);
      const pb = PLAYBOOKS[resolved.playbook];
      if (!pb) {
        return {
          text: `No playbook for intent → ${resolved.playbook}`,
          data: { ok: false, resolved },
        };
      }
      if (p.dryRun) {
        return {
          text: `Would run playbook "${resolved.playbook}" (${resolved.notes}).`,
          data: { dryRun: true, resolved, title: pb.title, description: pb.description },
        };
      }
      const plan = pb.build(p.args || {});
      const results: OpResult[] = [];
      for (const step of plan) {
        const r = await runOp(ctx, step);
        results.push(r);
        if (!r.ok && p.stopOnError) break;
      }
      return {
        text: `Auto → ${resolved.playbook}: ${summarizeResults(results)}`,
        data: p.compact
          ? { intent: p.intent, resolved, results: compactData(results) }
          : { intent: p.intent, resolved, results },
      };
    },
  }),

  defineTool({
    name: "edit_pipeline",
    title: "Chain multiple playbooks",
    description:
      "Run several playbooks in order (e.g. assemble → delivery → qa_pass). Server-side orchestration; one call for multi-stage pipelines.",
    inputSchema: {
      stages: z
        .array(
          z.object({
            playbook: z.enum(PLAYBOOK_IDS),
            args: z.record(z.unknown()).optional(),
          }),
        )
        .min(1)
        .max(8)
        .describe("Ordered stages. Example: [{playbook:'assemble',args:{paths:[…]}},{playbook:'delivery'}]"),
      stopOnError: z.boolean().optional().default(false),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const allResults: Array<{ playbook: string; results: OpResult[] }> = [];
      const lines: string[] = [];
      for (const stage of p.stages) {
        const pb = PLAYBOOKS[stage.playbook];
        if (!pb) {
          lines.push(`✗ unknown ${stage.playbook}`);
          if (p.stopOnError) break;
          continue;
        }
        const plan = pb.build(stage.args || {});
        const results: OpResult[] = [];
        for (const step of plan) {
          const r = await runOp(ctx, step);
          results.push(r);
          if (!r.ok && p.stopOnError) break;
        }
        allResults.push({ playbook: stage.playbook, results });
        lines.push(`── ${stage.playbook} ──`);
        lines.push(summarizeResults(results));
        if (p.stopOnError && results.some((r) => !r.ok)) break;
      }
      return {
        text: lines.join("\n"),
        data: p.compact
          ? { stages: allResults.map((s) => ({ playbook: s.playbook, results: compactData(s.results) })) }
          : { stages: allResults },
      };
    },
  }),

  defineTool({
    name: "edit_verify",
    title: "QA / quality gate",
    description:
      "Automatic verify: connection + video presence + optional screenshot. Run before export. Does not thrash retries.",
    inputSchema: {
      sequenceId: z.string().optional(),
      capture: z.boolean().optional().default(true),
      atSeconds: z.number().optional(),
      frame: z.number().int().optional(),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const r = await runOp(ctx, {
        op: "verify",
        sequenceId: p.sequenceId,
        capture: p.capture,
        atSeconds: p.atSeconds,
        frame: p.frame,
      });
      return {
        text: r.ok
          ? `QA PASS — ${(r.data as { tip?: string })?.tip || "ready"}`
          : `QA FAIL — ${r.error || (r.data as { tip?: string })?.tip || "fix checks"}`,
        data: p.compact ? compactData(r) : r,
      };
    },
  }),

  defineTool({
    name: "edit_run",
    title: "Run a custom edit plan (batch ops)",
    description:
      "Execute an ordered list of ops in one call. Ops include automatic systems: text, lower_third, end_card, titles, sfx, music_bed, duck, chapter_markers, quality_pass, polish, ken_burns, film_look, normalize_audio, verify, export, save. Each step returns ok/error/recovery.",
    inputSchema: {
      plan: z
        .array(
          z
            .object({
              op: z.string(),
            })
            .passthrough(),
        )
        .min(1)
        .max(30)
        .describe("Array of {op, ...params}. Max 30 ops/call (Premiere-safe). Prefer playbooks."),
      stopOnError: z.boolean().optional().default(false),
      compact: z.boolean().optional().default(true),
      /** Pause between ops (ms). Default 120 — faster thrash crashes Premiere. */
      throttleMs: z.number().int().min(0).max(2000).optional().default(120),
    },
    handler: async (p, ctx) => {
      const results: OpResult[] = [];
      const throttle = typeof p.throttleMs === "number" ? p.throttleMs : 120;
      for (let i = 0; i < (p.plan as EditOp[]).length; i++) {
        const step = (p.plan as EditOp[])[i]!;
        const r = await runOp(ctx, step);
        results.push(r);
        if (!r.ok && p.stopOnError) break;
        if (throttle > 0 && i < (p.plan as EditOp[]).length - 1) {
          await new Promise((res) => setTimeout(res, throttle));
        }
      }
      return {
        text: summarizeResults(results),
        data: p.compact ? { results: compactData(results) } : { results },
      };
    },
  }),

  defineTool({
    name: "edit_once",
    title: "Run a single resilient op",
    description:
      "One op with structured recovery (never bare throw thrash). Prefer edit_run for multi-step. Same op names as edit_run.",
    inputSchema: {
      op: z.string(),
      params: z.record(z.unknown()).optional(),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const r = await runOp(ctx, { op: p.op, ...(p.params || {}) });
      return {
        text: r.ok ? `✓ ${r.op}` : `✗ ${r.op}: ${r.error}${r.recovery ? ` → ${r.recovery}` : ""}`,
        data: p.compact ? compactData(r) : r,
      };
    },
  }),

  defineTool({
    name: "edit_help",
    title: "Short agent help (token-cheap)",
    description:
      "Compact cheatsheet: automatic systems, playbooks, ops, failure rules. Call when stuck instead of listing 200 tools.",
    inputSchema: {},
    handler: async () => {
      const text = [
        "READ docs/AGENT_USAGE.md before tools.",
        "AUTO: edit_auto(intent) for weak models; strong: playbooks then atomics.",
        "SESSION: bootstrap → NEW sequence (exact name) → text/shape/sfx (frame-aware) → verify → save",
        "TEXT: text_write = text+dark plate ONE composite. colorHex for text color. trackIndex≥2.",
        "SHAPE: shape_add → set color/size/pos. Square≈dot. REC: red shape + effect_set_opacity atTicks blink.",
        "  Do NOT invent special rec tools — use generic shape+opacity keyframes.",
        "COLORS: match video (REC=red; titles white/cool for backrooms; brand accents intentional).",
        "AUDIO: match filename+scene. DEFAULT 0 dB if gainDb omitted (never leave unset). Scope gain.",
        "CHECKPOINT: checkpoint_create before risky mass edits; checkpoint_restore to roll back bad cuts/deletes.",
        "RATE LIMIT: tools ≥~220ms apart (main). Per-min caps very high (~400 tools / ~300 heavy). Too fast → RATE_LIMITED. Prefer edit_run. Spam still crashes Premiere.",
        "FRAME: sequence_screenshot full Premiere window. Never quality_pass on 40+ clips.",
        "FAIL: recovery once; never thrash — restore checkpoint if timeline is ruined",
        `PLAYBOOKS: ${Object.keys(PLAYBOOKS).join(", ")}`,
      ].join("\n");
      return {
        text,
        data: {
          usageDoc: "docs/AGENT_USAGE.md",
          playbooks: Object.keys(PLAYBOOKS),
          ops: [...ALL_OPS],
          autoTools: ["edit_auto", "edit_pipeline", "edit_verify", "edit_playbook_run", "edit_quality_pass"],
          textDesign: {
            oneCall: "text_write — composite text+plate",
            title: "top_left",
            lower_third: "bottom_left",
            caption: "bottom_center",
            separateShape: "only for REC dots / UI chrome — not for text plate",
            never: ["hand-align shape+text as plate", "960,480", "mass audio faders"],
          },
          shapeGraphics: {
            add: "shape_add fillColor width height x y",
            color: "shape_set_fill_color r g b a",
            size: "shape_set_size",
            position: "shape_set_position or effect_set_transform 0-1",
            opacityKeyframe: "effect_set_opacity opacity atTicks",
            recDotRecipe:
              "shape_add red 36x36 near title → effect_set_opacity 100/10 every ~0.45s",
          },
          frameCapture: {
            preferred: "sequence_screenshot (full Premiere window)",
            fallback: "desktop",
            avoid: ["full AME still for QA"],
          },
          audioRules: {
            defaultGainDb: 0,
            matchScene: true,
            matchFilename: true,
            whooshOnCuts: true,
            neverMassEdit: true,
            onlyOwnedClips: true,
          },
          qualityPass: {
            maxGradeDefault: 24,
            maxGradePerCall: 60,
            clipFrom: "batch offset — large projects loop until hasMore=false",
            note: "Never grades entire 200-clip track in one call; use clipFrom batches",
          },
          audioPlace: {
            alwaysSetLevelDb: 0,
            preventsSilentMinusInfinity: true,
          },
        },
      };
    },
  }),

  defineTool({
    name: "edit_quality_pass",
    title: "Delivery quality pass (batchable for large projects)",
    description:
      "Lumetri + capped dissolves on a WINDOW of V clips. Default maxGrade=24 per call. LARGE projects: loop with clipFrom=nextClipFrom until hasMore=false. Never grades 200 clips in one shot (Premiere crash).",
    inputSchema: {
      trackIndex: z.number().int().optional().default(0),
      look: z.enum(["neutral", "warm", "cool"]).optional().default("neutral"),
      maxGrade: z
        .number()
        .int()
        .optional()
        .default(24)
        .describe("Clips to grade in THIS batch (default 24, max 60)."),
      maxTransitions: z.number().int().optional().default(16),
      clipFrom: z
        .number()
        .int()
        .optional()
        .default(0)
        .describe("Start index into track clip list (0-based). For batch 2 use previous nextClipFrom."),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const r = await runOp(ctx, {
        op: "quality_pass",
        trackIndex: p.trackIndex,
        look: p.look,
        maxGrade: p.maxGrade ?? 24,
        maxTransitions: p.maxTransitions ?? 16,
        clipFrom: p.clipFrom ?? 0,
        throttleMs: 60,
      });
      const d = r.data as {
        hasMore?: boolean;
        nextClipFrom?: number | null;
        graded?: number;
        clipCount?: number;
        steps?: string[];
      };
      const more =
        d?.hasMore && d.nextClipFrom != null
          ? ` More remaining → call again with clipFrom:${d.nextClipFrom}.`
          : "";
      return {
        text: r.ok
          ? `Quality batch (${p.look}): graded ${d?.graded ?? "?"} / ${d?.clipCount ?? "?"} clips.${more}`
          : `Quality pass failed: ${r.error}`,
        data: p.compact ? compactData(r) : r,
      };
    },
  }),

  defineTool({
    name: "edit_delivery",
    title: "Max delivery polish (auto)",
    description:
      "Automatic delivery system on active sequence: quality_pass + audio normalize + optional film look / Ken Burns. Higher than raw quality_pass. Use before final export.",
    inputSchema: {
      look: z.enum(["neutral", "warm", "cool"]).optional().default("neutral"),
      filmLook: z.boolean().optional().default(false),
      kenBurns: z.boolean().optional().default(false),
      vignette: z.boolean().optional().default(false),
      normalizeAudio: z
        .boolean()
        .optional()
        .default(false)
        .describe("Opt-in only. Blind normalize can ruin levels — prefer audio_fix_levels(mode:boost)."),
      fixAudio: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, boost all audio (default +6 dB). Default false — does not touch faders."),
      verify: z.boolean().optional().default(false),
      outputPath: z.string().optional(),
      compact: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const pb = PLAYBOOKS["delivery"];
      if (!pb) {
        return { text: "delivery playbook missing", data: { ok: false } };
      }
      const plan = pb.build({
        look: p.look,
        filmLook: p.filmLook,
        kenBurns: p.kenBurns,
        vignette: p.vignette,
        normalizeAudio: p.normalizeAudio,
        fixAudio: p.fixAudio,
        verify: p.verify,
        outputPath: p.outputPath,
      });
      const results: OpResult[] = [];
      for (const step of plan) {
        results.push(await runOp(ctx, step));
      }
      return {
        text: summarizeResults(results),
        data: p.compact ? { results: compactData(results) } : { results },
      };
    },
  }),
];

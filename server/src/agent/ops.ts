/**
 * Server-side edit ops — quality-first, failure-resistant, low-token.
 * Weak models: edit_playbook_run. Strong models: same playbooks + atomic polish.
 */
import fs from "node:fs";
import type { ToolContext } from "../toolDefinition.js";
import { formatRelayError } from "../toolDefinition.js";
// text paths go through textEngine (UXP → hybrid → CEP → PNG)

const TICKS_PER_SECOND = 254016000000n;

export type OpResult = {
  op: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  recovery?: string;
  retried?: boolean;
};

export type EditOp = {
  op: string;
  [key: string]: unknown;
};

function errResult(op: string, e: unknown, recovery: string): OpResult {
  return { op, ok: false, error: formatRelayError(e), recovery };
}

function toTicks(step: EditOp, key = "atTicks"): string {
  if (step[key] !== undefined && step[key] !== null && step[key] !== "") {
    return String(step[key]);
  }
  const secKey = key === "atTicks" ? "atSeconds" : key.replace("Ticks", "Seconds");
  if (typeof step[secKey] === "number") {
    return String(BigInt(Math.floor(Number(step[secKey]) * Number(TICKS_PER_SECOND))));
  }
  return "0";
}

/** Audio Level dB. Explicit gainDb/decibels only if finite number; else DEFAULT 0 (unity). Max +15 (rubber-band). */
function resolveGainDb(step: EditOp, fallback = 0): number {
  const raw =
    typeof step.gainDb === "number"
      ? step.gainDb
      : typeof step.decibels === "number"
        ? step.decibels
        : typeof step.targetDb === "number"
          ? step.targetDb
          : fallback;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-48, Math.min(15, Number(raw)));
}

function validatePaths(paths: string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) ok.push(p);
      else missing.push(p);
    } catch {
      missing.push(p);
    }
  }
  return { ok, missing };
}

async function ensureActive(
  ctx: ToolContext,
  sequenceId?: string,
): Promise<{ sequenceId?: string }> {
  if (sequenceId) {
    await ctx.relay.call("sequence.setActive", { sequenceId });
    return { sequenceId };
  }
  try {
    const a = (await ctx.relay.call("sequence.getActive", {})) as { sequenceId?: string };
    return { sequenceId: a?.sequenceId };
  } catch {
    return {};
  }
}

/**
 * Resolve sequence by name safely.
 * Prefer exact match → longest name match → last match (timestamped names are newest last).
 * NEVER first-includes only (crashed workflows by editing an old bloated sequence).
 */
function pickSequenceByQuery(
  list: Array<{ sequenceId: string; name: string }>,
  query: string,
): { sequenceId: string; name: string } | null {
  if (!list?.length || !query) return null;
  const q = query.toLowerCase().trim();
  const exact = list.find((s) => (s.name || "").toLowerCase() === q);
  if (exact) return exact;
  const matches = list.filter((s) => (s.name || "").toLowerCase().includes(q));
  if (!matches.length) return null;
  // Prefer longest name (more specific / full timestamp title)
  matches.sort((a, b) => (b.name || "").length - (a.name || "").length);
  // Among same-length-ish, prefer the last listed (often newest create)
  const bestLen = (matches[0]!.name || "").length;
  const top = matches.filter((m) => (m.name || "").length >= bestLen - 2);
  return top[top.length - 1] || matches[matches.length - 1] || null;
}

/** Quality grade for one video clip (Lumetri + tasteful defaults). */
async function gradeClip(
  ctx: ToolContext,
  sequenceId: string | undefined,
  trackIndex: number,
  clipIndex: number,
  look: "neutral" | "warm" | "cool" = "neutral",
): Promise<void> {
  await ctx.relay.call("color.applyLumetri", {
    sequenceId,
    trackType: "video",
    trackIndex,
    clipIndex,
  });
  const looks: Record<string, Record<string, number>> = {
    neutral: { Contrast: 14, Shadows: -10, Highlights: -4, Saturation: 90, Temperature: 0 },
    warm: { Contrast: 12, Shadows: -8, Saturation: 95, Temperature: 12, Tint: 3 },
    cool: { Contrast: 12, Shadows: -8, Saturation: 85, Temperature: -10, Tint: -3 },
  };
  for (const [paramName, value] of Object.entries(looks[look] || looks.neutral!)) {
    try {
      await ctx.relay.call("color.setParam", {
        sequenceId,
        trackType: "video",
        trackIndex,
        clipIndex,
        paramName,
        value,
      });
    } catch {
      /* param name may differ */
    }
  }
}

async function runOpInner(ctx: ToolContext, step: EditOp): Promise<OpResult> {
  const op = String(step.op || "").toLowerCase().trim();
  switch (op) {
    case "status":
    case "bootstrap": {
      const status = await ctx.relay.getStatus();
      const sequences = (await ctx.relay.call("sequence.list", {}).catch(() => [])) as unknown[];
      let active = null;
      try {
        active = await ctx.relay.call("sequence.getActive", {});
      } catch {
        active = null;
      }
      const quality = {
        plugin: !!status.pluginConnected,
        textBridge: !!status.legacyBridgeConnected,
        editableTextReady: !!status.legacyBridgeConnected,
        sequenceCount: Array.isArray(sequences) ? sequences.length : 0,
      };
      return {
        op,
        ok: quality.plugin,
        data: { ...quality, active, qualityBar: "prefer playbooks; grade+transitions before export" },
        recovery: quality.plugin
          ? undefined
          : "Start Premiere + load UXP plugin + bridge :8265",
      };
    }

    case "import":
    case "import_media": {
      const paths = step.paths as string[] | undefined;
      if (!paths?.length) {
        return { op, ok: false, error: "paths[] required", recovery: "Pass absolute media paths" };
      }
      const { ok, missing } = validatePaths(paths);
      if (!ok.length) {
        return {
          op,
          ok: false,
          error: `No files exist: ${missing.slice(0, 3).join("; ")}`,
          recovery: "Fix paths; use absolute Windows paths",
        };
      }
      const data = await ctx.relay.call("project.importMedia", { paths: ok }, 120000);
      return {
        op,
        ok: true,
        data: { imported: ok.length, missing: missing.length ? missing : undefined, data },
      };
    }

    case "sequence_from_media":
    case "create_sequence_from_media": {
      const paths = step.paths as string[] | undefined;
      const name = (step.name as string) || `Edit ${Date.now()}`;
      let projectItemIds = step.projectItemIds as string[] | undefined;
      if (!projectItemIds?.length && paths?.length) {
        const { ok } = validatePaths(paths);
        const pathList = ok.length ? ok : paths;
        if (ok.length) {
          await ctx.relay.call("project.importMedia", { paths: ok }, 120000);
          await new Promise((r) => setTimeout(r, 600));
        }
        const items = (await ctx.relay.call("project.listItems", { recursive: true }, 30000)) as Array<{
          id: string;
          name: string;
          isBin?: boolean;
        }>;
        // ONE project item per path, in path order.
        // BUG FIX: previously collected ALL items matching any basename → after
        // repeated imports the sequence ballooned (e.g. 8× same clips → 6 min timeline).
        const byBase = new Map<string, string[]>();
        for (const i of items) {
          if (i.isBin) continue;
          const b = (i.name || "").toLowerCase();
          if (!byBase.has(b)) byBase.set(b, []);
          byBase.get(b)!.push(i.id);
        }
        projectItemIds = [];
        for (const p of pathList) {
          const base = p.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
          const ids = byBase.get(base) || [];
          // Prefer most recent import of that file (last in listItems order)
          const pick = ids.length ? ids[ids.length - 1]! : undefined;
          if (pick) projectItemIds.push(pick);
        }
        if (!projectItemIds.length) {
          const media = items.filter((i) => !i.isBin);
          projectItemIds = media.slice(-(pathList.length)).map((i) => i.id);
        }
      }
      if (!projectItemIds?.length) {
        return {
          op,
          ok: false,
          error: "No projectItemIds after import",
          recovery: "Import media first; verify files exist",
        };
      }
      const data = await ctx.relay.call(
        "sequence.createFromMedia",
        { name, projectItemIds },
        60000,
      );
      // Activate new sequence
      const sid = (data as { sequenceId?: string })?.sequenceId;
      if (sid) {
        try {
          await ctx.relay.call("sequence.setActive", { sequenceId: sid });
        } catch {
          /* ignore */
        }
      }
      return {
        op,
        ok: true,
        data: {
          ...(typeof data === "object" && data ? data : { raw: data }),
          projectItemCount: projectItemIds.length,
          note: "One project item per path (no duplicate basename flood).",
        },
      };
    }

    case "set_active":
    case "sequence_set_active": {
      const sequenceId = step.sequenceId as string | undefined;
      const query = step.query as string | undefined;
      if (sequenceId) {
        await ctx.relay.call("sequence.setActive", { sequenceId });
        return { op, ok: true, data: { sequenceId } };
      }
      if (query) {
        const list = (await ctx.relay.call("sequence.list", {})) as Array<{
          sequenceId: string;
          name: string;
        }>;
        const hit = pickSequenceByQuery(list, query);
        if (!hit) {
          return {
            op,
            ok: false,
            error: `No sequence matching "${query}"`,
            recovery: "Use summarize / set_active with exact sequenceId",
          };
        }
        await ctx.relay.call("sequence.setActive", { sequenceId: hit.sequenceId });
        return { op, ok: true, data: hit };
      }
      return { op, ok: false, error: "sequenceId or query required", recovery: "Pass sequenceId or query" };
    }

    case "summarize":
    case "timeline": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const tracks = (await ctx.relay.call("track.list", sequenceId ? { sequenceId } : {})) as Array<{
        trackType: string;
        trackIndex: number;
        clipCount?: number;
      }>;
      const markers = await ctx.relay
        .call("marker.list", sequenceId ? { sequenceId } : {})
        .catch(() => []);
      // Compact clip counts for quality gate
      let videoClips = 0;
      let audioClips = 0;
      for (const t of tracks) {
        if (t.trackType === "video") videoClips += t.clipCount || 0;
        if (t.trackType === "audio") audioClips += t.clipCount || 0;
      }
      return {
        op,
        ok: true,
        data: {
          sequenceId,
          videoClips,
          audioClips,
          trackCount: tracks.length,
          markerCount: Array.isArray(markers) ? markers.length : 0,
          tracks,
          markers,
        },
      };
    }

    case "text":
    case "title": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 1);
      const atTicks = toTicks(step);
      const text = String(step.text ?? "");
      if (!text) {
        return { op, ok: false, error: "text required", recovery: "Pass text string" };
      }
      const { placeText } = await import("../textEngine.js");
      const r = await placeText(ctx, {
        sequenceId,
        trackIndex,
        atTicks,
        text,
        subtitle: step.subtitle as string | undefined,
        style: (step.style as "title" | "lower_third" | "caption" | "title_center" | "end_card") || "title",
        anchor: step.anchor as
          | "auto"
          | "top_left"
          | "top_right"
          | "bottom_left"
          | "bottom_right"
          | "lower_third"
          | "caption"
          | "center"
          | undefined,
        appearance: ((step.appearance as string) || "plain") as "plain" | "template",
        mogrtPath: step.mogrtPath as string | undefined,
        preferPng: !!step.preferPng,
        verify: step.verify !== false,
        withBackground: step.withBackground !== false,
        soften: step.soften !== false,
        applyLayout: true,
      });
      return {
        op,
        ok: r.ok,
        data: {
          ...r.data,
          editable: r.editable,
          quality: r.quality,
          via: r.via,
          pathAttempts: r.pathAttempts,
        },
        error: r.ok ? undefined : r.userMessage,
        recovery: r.recovery,
      };
    }

    case "sfx":
    case "place_audio": {
      const path = (step.path || step.filePath) as string | undefined;
      const atTicks = toTicks(step);
      const trackIndex = Number(step.trackIndex ?? 1);
      if (!path) {
        return { op, ok: false, error: "path required", recovery: "Pass absolute audio path" };
      }
      if (!fs.existsSync(path)) {
        return { op, ok: false, error: `File missing: ${path}`, recovery: "Fix path" };
      }
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      await ctx.relay.call("project.importMedia", { paths: [path] }, 60000);
      await new Promise((r) => setTimeout(r, 500));
      const items = (await ctx.relay.call("project.listItems", { recursive: true }, 30000)) as Array<{
        id: string;
        name: string;
        isBin?: boolean;
      }>;
      const base = path.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
      const media =
        items.find((i) => !i.isBin && (i.name || "").toLowerCase() === base) ||
        items.find((i) => !i.isBin && (i.name || "").toLowerCase().includes(base.replace(/\.[^.]+$/, ""))) ||
        [...items].reverse().find((i) => !i.isBin);
      if (!media?.id) {
        return {
          op,
          ok: false,
          error: "Imported audio not found in project",
          recovery: "Check path; wait and re-import",
        };
      }
      const data = await ctx.relay.call("clip.overwrite", {
        sequenceId,
        trackType: "audio",
        trackIndex,
        projectItemId: media.id,
        atTicks,
      });
      // Resolve the clip we just placed (last on track at/near atTicks) — NOT always index 0
      let clipIndex = 0;
      try {
        const clips = (await ctx.relay.call("clip.list", {
          sequenceId,
          trackType: "audio",
          trackIndex,
        })) as Array<{ clipIndex: number; startTicks?: string }>;
        if (clips.length) {
          const target = BigInt(atTicks || "0");
          let best = clips[clips.length - 1]!;
          let bestDist = 1n << 60n;
          for (const c of clips) {
            if (c.startTicks === undefined) continue;
            const d = BigInt(c.startTicks) > target ? BigInt(c.startTicks) - target : target - BigInt(c.startTicks);
            if (d < bestDist) {
              bestDist = d;
              best = c;
            }
          }
          clipIndex = best.clipIndex;
        }
      } catch {
        clipIndex = 0;
      }
      // ALWAYS set Level after place — default 0 dB unless model passes explicit gainDb.
      const gainDb = resolveGainDb(step, 0);
      let gainOk = false;
      let gainError: string | undefined;
      try {
        await ctx.relay.call("audio.setGain", {
          sequenceId,
          trackIndex,
          clipIndex,
          decibels: gainDb,
        });
        gainOk = true;
      } catch (e) {
        gainError = formatRelayError(e);
        // Retry once after short settle (clip not fully ready)
        try {
          await new Promise((r) => setTimeout(r, 200));
          await ctx.relay.call("audio.setGain", {
            sequenceId,
            trackIndex,
            clipIndex,
            decibels: gainDb,
          });
          gainOk = true;
          gainError = undefined;
        } catch (e2) {
          gainError = formatRelayError(e2);
        }
      }
      // Ensure not muted (clip + track best-effort)
      try {
        await ctx.relay.call("audio.setMute", {
          sequenceId,
          trackIndex,
          clipIndex,
          muted: false,
        });
      } catch {
        /* optional */
      }
      try {
        await ctx.relay.call("track.setMute", {
          sequenceId,
          trackType: "audio",
          trackIndex,
          muted: false,
        });
      } catch {
        /* optional */
      }

      // Trim out-point so full-length files (e.g. 10s tv_on) do not leave
      // ghost fragments when later overwrites split the track.
      // durationSeconds / maxDurationSeconds / durationTicks optional; default 1.8s hits.
      let trimmed: unknown;
      let trimError: string | undefined;
      try {
        let durTicks: bigint | undefined;
        if (step.durationTicks !== undefined && step.durationTicks !== null && step.durationTicks !== "") {
          durTicks = BigInt(String(step.durationTicks));
        } else if (typeof step.durationSeconds === "number") {
          durTicks = BigInt(Math.round(Number(step.durationSeconds) * Number(TICKS_PER_SECOND)));
        } else if (typeof step.maxDurationSeconds === "number") {
          durTicks = BigInt(Math.round(Number(step.maxDurationSeconds) * Number(TICKS_PER_SECOND)));
        } else {
          // Heuristic: beds/ambience longer; short SFX default ~1.8s
          const n = base.toLowerCase();
          const isBed =
            /walk|run|amb|fluo|music|bed|loop|buzz_12|hum/i.test(n) || gainDb <= -4;
          durTicks = BigInt(Math.round((isBed ? 12 : 1.8) * Number(TICKS_PER_SECOND)));
        }
        const endTicks = String(BigInt(atTicks || "0") + durTicks);
        trimmed = await ctx.relay.call("clip.trim", {
          sequenceId,
          trackType: "audio",
          trackIndex,
          clipIndex,
          edge: "out",
          newTicks: endTicks,
        });
      } catch (e) {
        trimError = formatRelayError(e);
      }

      // Surface gain failure — silent -∞ was previously still ok:true
      return {
        op,
        ok: gainOk,
        error: gainOk ? undefined : gainError || "audio.setGain failed after place",
        recovery: gainOk
          ? undefined
          : "Re-call audio_set_gain { trackIndex, clipIndex, decibels: 0 } on this clip",
        data: {
          mediaId: media.id,
          place: data,
          atTicks,
          trackIndex,
          clipIndex,
          gainDb,
          gainOk,
          gainError,
          trimmed,
          trimError,
          note: `Level forced to ${gainDb} dB (0=unity). Out trimmed to avoid ghost SFX fragments.`,
        },
      };
    }

    case "marker":
    case "markers": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const markers = (step.markers as Array<{ atTicks?: string; atSeconds?: number; name?: string; comments?: string }>) || [];
      if (step.atTicks || step.atSeconds !== undefined) {
        markers.push({
          atTicks: step.atTicks ? String(step.atTicks) : undefined,
          atSeconds: step.atSeconds as number | undefined,
          name: step.name as string | undefined,
          comments: step.comments as string | undefined,
        });
      }
      if (!markers.length) {
        return { op, ok: false, error: "markers[] or atTicks required", recovery: "Pass times" };
      }
      const results = [];
      for (const m of markers) {
        const at =
          m.atTicks ||
          (typeof m.atSeconds === "number"
            ? String(BigInt(Math.floor(m.atSeconds * Number(TICKS_PER_SECOND))))
            : "0");
        try {
          const data = await ctx.relay.call("marker.add", {
            sequenceId,
            atTicks: at,
            name: m.name,
            comments: m.comments,
          });
          results.push({ ok: true, data });
        } catch (e) {
          results.push({ ok: false, error: formatRelayError(e) });
        }
      }
      return { op, ok: results.some((r) => r.ok), data: { results } };
    }

    case "transition_all":
    case "transitions": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const matchName = String(step.matchName || "AE.ADBE Cross Dissolve New");
      const durationTicks = String(step.durationTicks || "508032000000");
      const maxT = Math.max(0, Math.min(24, Number(step.maxTransitions ?? 12)));
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number }>;
      const results = [];
      for (let i = 0; i < clips.length - 1 && results.filter((r) => r.ok).length < maxT; i++) {
        try {
          await ctx.relay.call("transition.apply", {
            sequenceId,
            trackType: "video",
            trackIndex,
            clipIndex: clips[i]!.clipIndex,
            matchName,
            edge: "tail",
            durationTicks,
          });
          results.push({ clipIndex: clips[i]!.clipIndex, ok: true });
          await new Promise((r) => setTimeout(r, 50));
        } catch (e) {
          results.push({ clipIndex: clips[i]!.clipIndex, ok: false, error: formatRelayError(e) });
        }
      }
      return {
        op,
        ok: true,
        data: { applied: results.filter((r) => r.ok).length, maxT, results },
      };
    }

    case "fade_video": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const { workflowTools } = await import("../tools/workflow.js");
      const tool = workflowTools.find((t) => t.name === "workflow_fade_clip");
      if (!tool) return { op, ok: false, error: "workflow_fade_clip missing" };
      const outcome = await tool.handler(
        {
          sequenceId,
          trackIndex: Number(step.trackIndex ?? 0),
          clipIndex: Number(step.clipIndex ?? 0),
          doFadeIn: step.doFadeIn !== false,
          doFadeOut: step.doFadeOut !== false,
        } as never,
        ctx,
      );
      return { op, ok: true, data: outcome.data };
    }

    case "grade":
    case "cinematic": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const clipIndex = Number(step.clipIndex ?? 0);
      const look = (step.look as "neutral" | "warm" | "cool") || "neutral";
      await gradeClip(ctx, sequenceId, trackIndex, clipIndex, look);
      return { op, ok: true, data: { graded: true, trackIndex, clipIndex, look } };
    }

    case "grade_all": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const look = (step.look as "neutral" | "warm" | "cool") || "neutral";
      const maxGrade = Math.max(1, Math.min(48, Number(step.maxGrade ?? 24)));
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number }>;
      const results = [];
      for (const c of clips.slice(0, maxGrade)) {
        try {
          await gradeClip(ctx, sequenceId, trackIndex, c.clipIndex, look);
          results.push({ clipIndex: c.clipIndex, ok: true });
          await new Promise((r) => setTimeout(r, 80));
        } catch (e) {
          results.push({ clipIndex: c.clipIndex, ok: false, error: formatRelayError(e) });
        }
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: {
          graded: results.filter((r) => r.ok).length,
          total: clips.length,
          maxGrade,
          look,
        },
      };
    }

    case "quality_pass": {
      // Large-project safe: grade a WINDOW of clips (clipFrom + maxGrade), throttle.
      // Big timelines: call multiple times with clipFrom: nextClipFrom until done.
      // Never try to Lumetri 200 clips in one call — that crashes Premiere.
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const look = (step.look as "neutral" | "warm" | "cool") || "neutral";
      // Per-batch size: default 24, hard max 60 per call (use batches for bigger)
      const maxGrade = Math.max(1, Math.min(60, Number(step.maxGrade ?? step.maxClips ?? 24)));
      const maxTransitions = Math.max(0, Math.min(40, Number(step.maxTransitions ?? 16)));
      // Default higher than old 60ms — rapid Lumetri/transition loops crash Premiere
      const throttleMs = Math.max(0, Math.min(2000, Number(step.throttleMs ?? 120)));
      const clipFrom = Math.max(0, Number(step.clipFrom ?? step.fromClipIndex ?? 0));
      const steps: string[] = [];
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number; name?: string }>;

      // Soft warning only — still process a batch (do not hard-refuse big projects)
      if (clips.length > 100 && step.force !== true && clipFrom === 0) {
        steps.push(`large_project:${clips.length}_clips_use_clipFrom_batches`);
      }

      // Window [clipFrom, clipFrom+maxGrade)
      const window = clips.slice(clipFrom, clipFrom + maxGrade);
      const nextClipFrom = clipFrom + window.length;
      const hasMore = nextClipFrom < clips.length;

      for (const c of window) {
        try {
          await gradeClip(ctx, sequenceId, trackIndex, c.clipIndex, look);
          steps.push(`grade:${c.clipIndex}`);
          if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs));
        } catch {
          /* continue */
        }
      }

      // Transitions only on this window's internal edges (not whole 200-clip track)
      try {
        const matchName = String(step.matchName || "AE.ADBE Cross Dissolve New");
        const durationTicks = String(step.durationTicks || "508032000000");
        let applied = 0;
        for (let i = 0; i < window.length - 1 && applied < maxTransitions; i++) {
          try {
            await ctx.relay.call("transition.apply", {
              sequenceId,
              trackType: "video",
              trackIndex,
              clipIndex: window[i]!.clipIndex,
              matchName,
              edge: "tail",
              durationTicks,
            });
            applied++;
            if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs));
          } catch {
            /* skip bad edges */
          }
        }
        if (applied) steps.push(`transitions:${applied}`);
      } catch {
        /* ignore */
      }

      // Fade: only on first clip of full sequence (clipFrom=0) and last clip of full sequence
      if (clips.length && (step.fadeEdges !== false)) {
        try {
          const { workflowTools } = await import("../tools/workflow.js");
          const fade = workflowTools.find((t) => t.name === "workflow_fade_clip");
          if (fade) {
            if (clipFrom === 0) {
              await fade.handler(
                {
                  sequenceId,
                  trackIndex,
                  clipIndex: clips[0]!.clipIndex,
                  doFadeIn: true,
                  doFadeOut: clips.length === 1,
                } as never,
                ctx,
              );
              steps.push("fade-in-first");
            }
            if (!hasMore && clips.length > 1) {
              await fade.handler(
                {
                  sequenceId,
                  trackIndex,
                  clipIndex: clips[clips.length - 1]!.clipIndex,
                  doFadeIn: false,
                  doFadeOut: true,
                } as never,
                ctx,
              );
              steps.push("fade-out-last");
            }
          }
        } catch {
          /* ignore */
        }
      }

      return {
        op,
        ok: steps.length > 0 || window.length === 0,
        data: {
          steps,
          clipCount: clips.length,
          graded: window.length,
          clipFrom,
          nextClipFrom: hasMore ? nextClipFrom : null,
          hasMore,
          maxGrade,
          look,
          quality: "delivery-oriented-batched",
          note: hasMore
            ? `Batch done. Call quality_pass again with clipFrom:${nextClipFrom} maxGrade:${maxGrade} until hasMore=false.`
            : "All batches complete (or single batch covered the track).",
          largeProjectHint:
            clips.length > maxGrade
              ? `Large track (${clips.length} clips). Loop: quality_pass { clipFrom, maxGrade: ${maxGrade} } until nextClipFrom is null.`
              : undefined,
        },
      };
    }

    case "export": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const outputPath = step.outputPath as string | undefined;
      if (!outputPath) {
        return { op, ok: false, error: "outputPath required", recovery: "Pass absolute export path" };
      }
      const data = await ctx.relay.call("export.sequence", {
        sequenceId,
        outputPath,
        presetPath: step.presetPath,
        exportType: step.exportType || "immediately",
      });
      return { op, ok: true, data };
    }

    case "save": {
      const data = await ctx.relay.call("project.save", {});
      return { op, ok: true, data };
    }

    case "checkpoint":
    case "checkpoint_create": {
      const { createCheckpointFiles, checkpointRoot } = await import("../checkpointStore.js");
      try {
        await ctx.relay.call("project.save", {}, 60000);
      } catch (e) {
        return {
          op,
          ok: false,
          error: `save failed: ${formatRelayError(e)}`,
          recovery: "Save project once in Premiere, then checkpoint again",
        };
      }
      const proj = (await ctx.relay.call("project.getActive", {})) as { path?: string; name?: string };
      if (!proj?.path) {
        return {
          op,
          ok: false,
          error: "Project has no disk path",
          recovery: "File > Save As .prproj first",
        };
      }
      let sequenceName: string | undefined;
      let sequenceId: string | undefined;
      try {
        const seq = (await ctx.relay.call("sequence.getActive", {})) as {
          name?: string;
          sequenceId?: string;
        };
        sequenceName = seq?.name;
        sequenceId = seq?.sequenceId;
      } catch {
        /* optional */
      }
      try {
        const meta = createCheckpointFiles({
          sourceProjectPath: proj.path,
          label: (step.label as string) || (step.name as string),
          note: step.note as string | undefined,
          sequenceName,
          sequenceId,
        });
        return {
          op,
          ok: true,
          data: { ...meta, root: checkpointRoot() },
        };
      } catch (e) {
        return { op, ok: false, error: formatRelayError(e), recovery: "Ensure project is saved to disk" };
      }
    }

    case "checkpoint_list": {
      const { listCheckpoints, checkpointRoot } = await import("../checkpointStore.js");
      const list = listCheckpoints();
      return { op, ok: true, data: { checkpoints: list, root: checkpointRoot() } };
    }

    case "checkpoint_restore":
    case "restore_checkpoint": {
      // Heavy: closes project and opens checkpoint copy. Prefer dedicated tool.
      const { getCheckpoint } = await import("../checkpointStore.js");
      const id = String(step.id || step.label || "");
      if (!id) {
        return { op, ok: false, error: "id required", recovery: "Pass checkpoint id from checkpoint_list" };
      }
      const meta = getCheckpoint(id);
      if (!meta) {
        return { op, ok: false, error: `No checkpoint ${id}`, recovery: "checkpoint_list" };
      }
      try {
        if (step.saveCurrentFirst === true) {
          try {
            await ctx.relay.call("project.save", {});
          } catch {
            /* */
          }
        }
        try {
          await ctx.relay.call("project.close", { save: step.saveCurrentFirst === true });
        } catch {
          /* */
        }
        const openPath = meta.checkpointProjectPath;
        const opened = await ctx.relay.call("project.open", { path: openPath });
        return { op, ok: true, data: { opened, meta, openPath } };
      } catch (e) {
        return {
          op,
          ok: false,
          error: formatRelayError(e),
          recovery: `Manually open ${meta.checkpointProjectPath}`,
        };
      }
    }

    case "detect_silence":
    case "silence": {
      const mediaPath = step.mediaPath as string | undefined;
      if (!mediaPath) return { op, ok: false, error: "mediaPath required", recovery: "Pass absolute media path" };
      const { detectSilenceInFile, findFfmpeg } = await import("../mediaAnalysis.js");
      if (!findFfmpeg()) return { op, ok: false, error: "ffmpeg missing", recovery: "Install ffmpeg" };
      const det = detectSilenceInFile(mediaPath, {
        noiseDb: Number(step.noiseDb ?? -30),
        minDuration: Number(step.minDuration ?? 0.35),
      });
      if (step.addMarkers) {
        for (const r of det.regions.slice(0, 40)) {
          try {
            await ctx.relay.call("marker.add", {
              sequenceId: step.sequenceId,
              atTicks: r.startTicks,
              name: `Silence ${r.startSeconds.toFixed(1)}s`,
            });
          } catch {
            /* continue */
          }
        }
      }
      return { op, ok: true, data: det };
    }

    case "detect_onsets":
    case "beats": {
      const mediaPath = step.mediaPath as string | undefined;
      if (!mediaPath) return { op, ok: false, error: "mediaPath required" };
      const { detectOnsetsInFile, findFfmpeg } = await import("../mediaAnalysis.js");
      if (!findFfmpeg()) return { op, ok: false, error: "ffmpeg missing" };
      const det = detectOnsetsInFile(mediaPath, {
        maxEvents: Number(step.maxEvents ?? 60),
        sensitivity: Number(step.sensitivity ?? 0.35),
      });
      if (step.addMarkers) {
        for (const e of det.events.slice(0, 40)) {
          try {
            await ctx.relay.call("marker.add", {
              sequenceId: step.sequenceId,
              atTicks: e.ticks,
              name: e.kind,
            });
          } catch {
            /* continue */
          }
        }
      }
      return { op, ok: true, data: det };
    }

    case "captions":
    case "auto_captions": {
      const mediaPath = step.mediaPath as string | undefined;
      if (!mediaPath) return { op, ok: false, error: "mediaPath required" };
      const { transcribeMedia, findFfmpeg } = await import("../mediaAnalysis.js");
      if (!findFfmpeg()) return { op, ok: false, error: "ffmpeg missing" };
      try {
        const tr = transcribeMedia(mediaPath, {
          language: step.language as string | undefined,
          engine: (step.engine as "auto" | "whisper" | "windows") || "auto",
        });
        const { placeText } = await import("../textEngine.js");
        const placed = [];
        for (const seg of tr.segments.slice(0, Number(step.maxSegments ?? 30))) {
          try {
            await ctx.relay.call("marker.add", {
              sequenceId: step.sequenceId,
              atTicks: seg.startTicks,
              name: seg.text.slice(0, 36),
            });
          } catch {
            /* ignore */
          }
          if (step.placeText !== false) {
            const r = await placeText(ctx, {
              sequenceId: step.sequenceId as string | undefined,
              trackIndex: Number(step.trackIndex ?? 1),
              atTicks: seg.startTicks,
              text: seg.text,
              style: "caption",
              verify: false,
            });
            placed.push({ text: seg.text, ok: r.ok, via: r.via });
          }
        }
        return { op, ok: true, data: { engine: tr.engine, srtPath: tr.srtPath, placed } };
      } catch (e) {
        return {
          op,
          ok: false,
          error: formatRelayError(e),
          recovery: "pip install openai-whisper or caption_import_srt",
        };
      }
    }

    // ── Automatic / high-value systems ──────────────────────────────

    case "lower_third": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const text = String(step.text ?? step.name ?? "");
      if (!text) {
        return { op, ok: false, error: "text required", recovery: "Pass name/title string" };
      }
      const { placeText } = await import("../textEngine.js");
      const r = await placeText(ctx, {
        sequenceId,
        trackIndex: Number(step.trackIndex ?? 1),
        atTicks: toTicks(step),
        text,
        subtitle: step.subtitle as string | undefined,
        style: "lower_third",
        appearance: "template",
        verify: true,
      });
      return {
        op,
        ok: r.ok,
        data: { ...r.data, editable: r.editable, quality: r.quality, via: r.via },
        error: r.ok ? undefined : r.userMessage,
        recovery: r.recovery,
      };
    }

    case "end_card": {
      // Place title near end of sequence (duration-based)
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const text = String(step.text ?? "Thanks for watching");
      let atTicks = step.atTicks ? String(step.atTicks) : undefined;
      if (!atTicks && typeof step.atSeconds === "number") {
        atTicks = toTicks(step);
      }
      if (!atTicks) {
        try {
          const dur = (await ctx.relay.call("sequence.getDuration", sequenceId ? { sequenceId } : {})) as {
            ticks?: string;
            durationTicks?: string;
          };
          const total = BigInt(dur.ticks || dur.durationTicks || "0");
          const lead = BigInt(Math.floor(Number(step.leadSeconds ?? 3) * Number(TICKS_PER_SECOND)));
          atTicks = String(total > lead ? total - lead : 0n);
        } catch {
          atTicks = "0";
        }
      }
      return runOpInner(ctx, {
        op: "text",
        sequenceId,
        text,
        trackIndex: Number(step.trackIndex ?? 2),
        atTicks,
        appearance: step.appearance || "plain",
        style: "end_card",
        anchor: "center",
        withBackground: true,
        soften: true,
      });
    }

    case "titles":
    case "titles_batch": {
      const cards =
        (step.titles as Array<{
          text: string;
          atSeconds?: number;
          atTicks?: string;
          trackIndex?: number;
          style?: string;
        }>) || [];
      if (!cards.length) {
        return { op, ok: false, error: "titles[] required", recovery: "Pass [{text, atSeconds}]" };
      }
      const results: OpResult[] = [];
      for (const c of cards) {
        const r = await runOpInner(ctx, {
          op: c.style === "lower_third" ? "lower_third" : "text",
          text: c.text,
          atSeconds: c.atSeconds,
          atTicks: c.atTicks,
          trackIndex: c.trackIndex ?? 1,
          sequenceId: step.sequenceId,
        });
        results.push(r);
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: { placed: results.filter((r) => r.ok).length, total: results.length, results },
      };
    }

    case "chapter_markers":
    case "markers_at_cuts": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number; startTicks?: string; name?: string }>;
      const results = [];
      for (const c of clips) {
        if (!c.startTicks) continue;
        try {
          const data = await ctx.relay.call("marker.add", {
            sequenceId,
            atTicks: c.startTicks,
            name: (step.prefix as string) || `Chapter ${c.clipIndex + 1}`,
            comments: c.name || `Clip ${c.clipIndex}`,
          });
          results.push({ ok: true, clipIndex: c.clipIndex, data });
        } catch (e) {
          results.push({ ok: false, clipIndex: c.clipIndex, error: formatRelayError(e) });
        }
      }
      return {
        op,
        ok: results.some((r) => (r as { ok: boolean }).ok),
        data: { markers: results.filter((r) => (r as { ok: boolean }).ok).length, results },
      };
    }

    case "music_bed":
    case "music": {
      // Place music bed — default audible (0 dB). Soft bed uses mild negative gain only if asked.
      // Fades OFF by default: auto -60dB edge keyframes were silencing short beds.
      const path = (step.path || step.filePath) as string | undefined;
      if (!path) return { op, ok: false, error: "path required", recovery: "Pass music file path" };
      const trackIndex = Number(step.trackIndex ?? 2);
      // Default 0 dB always. soft:true is the ONLY auto-quiet path (explicit model intent).
      const gainDb =
        typeof step.gainDb === "number" && Number.isFinite(step.gainDb)
          ? resolveGainDb(step, 0)
          : step.soft === true
            ? -6
            : 0;
      const place = await runOpInner(ctx, {
        op: "sfx",
        path,
        atTicks: step.atTicks || "0",
        atSeconds: step.atSeconds,
        trackIndex,
        sequenceId: step.sequenceId,
        // Always pass gainDb so sfx path forces Level (never -∞)
        gainDb,
        // Beds must keep full length — default sfx trim is ~1.8s for non-matching names
        durationSeconds:
          typeof step.durationSeconds === "number"
            ? step.durationSeconds
            : typeof step.maxDurationSeconds === "number"
              ? step.maxDurationSeconds
              : 600,
        durationTicks: step.durationTicks,
      });
      if (!place.ok) return place;
      const clipIndex =
        (place.data as { clipIndex?: number } | undefined)?.clipIndex ?? 0;
      // Optional fades only when explicitly requested
      let faded = false;
      if (step.fadeIn === true || step.fadeOut === true) {
        try {
          const { workflowTools } = await import("../tools/workflow.js");
          const fade = workflowTools.find((t) => t.name === "workflow_audio_fade");
          if (fade) {
            await fade.handler(
              {
                sequenceId: step.sequenceId,
                trackIndex,
                clipIndex,
                doFadeIn: step.fadeIn === true,
                doFadeOut: step.fadeOut === true,
                peakDb: gainDb > -20 ? gainDb : 0,
                silentDb: -48,
                fadeInTicks: step.fadeInTicks || "254016000000",
                fadeOutTicks: step.fadeOutTicks || "254016000000",
              } as never,
              ctx,
            );
            faded = true;
          }
        } catch {
          /* non-fatal */
        }
      }
      return {
        op,
        ok: true,
        data: { place: place.data, trackIndex, clipIndex, gainDb, faded },
      };
    }

    case "audio_fix":
    case "fix_audio":
    case "unmute_all": {
      // Scoped Level write. NEVER mass-edit all faders by default — that blows
      // user corrections and stacks +6/+15 on every bed/SFX.
      //
      // mode: unity (default, 0 dB) | boost (+6 max)
      // Scope REQUIRED unless allClips:true (discouraged):
      //   trackIndex + clipIndex  OR  clips:[{trackIndex,clipIndex},...]
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const mode = String(step.mode || "unity");
      let targetDb =
        typeof step.targetDb === "number" ? step.targetDb : mode === "boost" ? 6 : 0;
      // Unity default 0 dB; model may boost up to rubber-band max +15
      targetDb = Math.max(-48, Math.min(15, targetDb));

      type ClipRef = { trackIndex: number; clipIndex: number };
      const targets: ClipRef[] = [];

      if (Array.isArray(step.clips) && step.clips.length) {
        for (const c of step.clips as ClipRef[]) {
          if (typeof c?.trackIndex === "number" && typeof c?.clipIndex === "number") {
            targets.push({ trackIndex: c.trackIndex, clipIndex: c.clipIndex });
          }
        }
      } else if (typeof step.trackIndex === "number" && typeof step.clipIndex === "number") {
        targets.push({ trackIndex: Number(step.trackIndex), clipIndex: Number(step.clipIndex) });
      } else if (typeof step.trackIndex === "number") {
        // Whole track — still scoped (better than all tracks)
        const clips = (await ctx.relay.call("clip.list", {
          sequenceId,
          trackType: "audio",
          trackIndex: Number(step.trackIndex),
        })) as Array<{ clipIndex: number }>;
        for (const c of clips) targets.push({ trackIndex: Number(step.trackIndex), clipIndex: c.clipIndex });
      } else if (step.allClips === true) {
        // Explicit mass edit only — models must opt in
        let audioTrackIndexes: number[] = [];
        try {
          const tracks = (await ctx.relay.call("track.list", sequenceId ? { sequenceId } : {})) as Array<{
            trackType: string;
            trackIndex: number;
          }>;
          audioTrackIndexes = tracks.filter((x) => x.trackType === "audio").map((t) => t.trackIndex);
        } catch {
          /* fall through */
        }
        // Fallback: probe A0–A7 (track.list can be empty/wrong shape on some builds)
        if (!audioTrackIndexes.length) {
          audioTrackIndexes = [0, 1, 2, 3, 4, 5, 6, 7];
        }
        for (const ti of audioTrackIndexes) {
          try {
            const clips = (await ctx.relay.call("clip.list", {
              sequenceId,
              trackType: "audio",
              trackIndex: ti,
            })) as Array<{ clipIndex: number }>;
            for (const c of clips) targets.push({ trackIndex: ti, clipIndex: c.clipIndex });
          } catch {
            /* empty track */
          }
        }
      } else {
        return {
          op,
          ok: false,
          error:
            "audio_fix requires scope: trackIndex+clipIndex, or clips:[{trackIndex,clipIndex}], or allClips:true. Refusing mass fader overwrite to protect user mix.",
          recovery:
            "Pass the clip you placed (trackIndex/clipIndex from sfx/music_bed). Default 0 dB. Do not touch other clips.",
        };
      }

      const results: Array<Record<string, unknown>> = [];
      for (const t of targets) {
        try {
          await ctx.relay.call("audio.setMute", {
            sequenceId,
            trackIndex: t.trackIndex,
            clipIndex: t.clipIndex,
            muted: false,
          });
        } catch {
          /* optional */
        }
        try {
          await ctx.relay.call("audio.setGain", {
            sequenceId,
            trackIndex: t.trackIndex,
            clipIndex: t.clipIndex,
            decibels: targetDb,
          });
          results.push({ trackIndex: t.trackIndex, clipIndex: t.clipIndex, ok: true, db: targetDb });
        } catch (e) {
          results.push({
            trackIndex: t.trackIndex,
            clipIndex: t.clipIndex,
            ok: false,
            error: formatRelayError(e),
          });
        }
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: {
          fixed: results.filter((r) => r.ok).length,
          total: results.length,
          targetDb,
          mode,
          results,
          note: `Scoped Levels → ${targetDb} dB (${mode}). Only listed clips. User mix elsewhere untouched.`,
        },
      };
    }

    case "duck":
    case "duck_music": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const { workflowTools } = await import("../tools/workflow.js");
      const tool = workflowTools.find((t) => t.name === "workflow_duck_audio_under_markers");
      if (!tool) return { op, ok: false, error: "duck workflow missing" };
      const outcome = await tool.handler(
        {
          sequenceId,
          musicTrackIndex: Number(step.trackIndex ?? step.musicTrackIndex ?? 2),
          musicClipIndex: Number(step.clipIndex ?? 0),
          duckDb: Number(step.duckDb ?? -12),
          normalDb: Number(step.normalDb ?? (typeof step.gainDb === "number" ? step.gainDb : -8)),
        } as never,
        ctx,
      );
      return { op, ok: true, data: outcome.data };
    }

    case "ken_burns":
    case "zoom":
    case "zoom_all": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const { workflowTools } = await import("../tools/workflow.js");
      const kb = workflowTools.find((t) => t.name === "workflow_ken_burns");
      const zoom = workflowTools.find((t) => t.name === "workflow_animate_zoom");
      const tool = step.pan === false ? zoom : kb || zoom;
      if (!tool) return { op, ok: false, error: "ken burns tool missing" };
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number }>;
      const only = step.clipIndex !== undefined ? [Number(step.clipIndex)] : clips.map((c) => c.clipIndex);
      const results = [];
      for (const clipIndex of only) {
        try {
          const outcome = await tool.handler(
            {
              sequenceId,
              trackIndex,
              clipIndex,
              startScale: Number(step.startScale ?? 100),
              endScale: Number(step.endScale ?? 118),
              startX: Number(step.startX ?? 0.5),
              startY: Number(step.startY ?? 0.5),
              endX: Number(step.endX ?? 0.52),
              endY: Number(step.endY ?? 0.48),
            } as never,
            ctx,
          );
          results.push({ clipIndex, ok: true, data: outcome.data });
        } catch (e) {
          results.push({ clipIndex, ok: false, error: formatRelayError(e) });
        }
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: { animated: results.filter((r) => r.ok).length, results },
      };
    }

    case "film_look":
    case "film": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const { workflowTools } = await import("../tools/workflow.js");
      const film = workflowTools.find((t) => t.name === "workflow_film_look");
      if (!film) return { op, ok: false, error: "film_look missing" };
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "video",
        trackIndex,
      })) as Array<{ clipIndex: number }>;
      const only = step.clipIndex !== undefined ? [Number(step.clipIndex)] : clips.map((c) => c.clipIndex);
      const results = [];
      for (const clipIndex of only) {
        try {
          const outcome = await film.handler(
            {
              sequenceId,
              trackIndex,
              clipIndex,
              look: (step.look as string) || "neutral_cinematic",
              grain: step.grain !== false,
              vignette: step.vignette !== false,
              filmDissolve: !!step.filmDissolve,
            } as never,
            ctx,
          );
          results.push({ clipIndex, ok: true, data: outcome.data });
        } catch (e) {
          results.push({ clipIndex, ok: false, error: formatRelayError(e) });
        }
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: { styled: results.filter((r) => r.ok).length, results },
      };
    }

    case "normalize_audio":
    case "audio_normalize_all": {
      // Scoped unity reset. Requires clips scope unless allClips:true.
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const targetDb = Math.max(-48, Math.min(15, Number(step.targetDb ?? 0)));
      type ClipRef = { trackIndex: number; clipIndex: number };
      const targets: ClipRef[] = [];

      if (Array.isArray(step.clips) && step.clips.length) {
        for (const c of step.clips as ClipRef[]) {
          if (typeof c?.trackIndex === "number" && typeof c?.clipIndex === "number") {
            targets.push({ trackIndex: c.trackIndex, clipIndex: c.clipIndex });
          }
        }
      } else if (typeof step.trackIndex === "number" && typeof step.clipIndex === "number") {
        targets.push({ trackIndex: Number(step.trackIndex), clipIndex: Number(step.clipIndex) });
      } else if (typeof step.trackIndex === "number") {
        const clips = (await ctx.relay.call("clip.list", {
          sequenceId,
          trackType: "audio",
          trackIndex: Number(step.trackIndex),
        })) as Array<{ clipIndex: number }>;
        for (const c of clips) targets.push({ trackIndex: Number(step.trackIndex), clipIndex: c.clipIndex });
      } else if (step.allClips === true) {
        const tracks = (await ctx.relay.call("track.list", sequenceId ? { sequenceId } : {})) as Array<{
          trackType: string;
          trackIndex: number;
        }>;
        for (const t of tracks.filter((x) => x.trackType === "audio")) {
          const clips = (await ctx.relay.call("clip.list", {
            sequenceId,
            trackType: "audio",
            trackIndex: t.trackIndex,
          })) as Array<{ clipIndex: number }>;
          for (const c of clips) targets.push({ trackIndex: t.trackIndex, clipIndex: c.clipIndex });
        }
      } else {
        return {
          op,
          ok: false,
          error: "normalize_audio requires trackIndex+clipIndex, clips:[], or allClips:true",
          recovery: "Only normalize clips you placed — do not overwrite user faders.",
        };
      }

      const results = [];
      for (const t of targets) {
        try {
          await ctx.relay.call("audio.normalize", {
            sequenceId,
            trackIndex: t.trackIndex,
            clipIndex: t.clipIndex,
            targetDb,
          });
          results.push({ trackIndex: t.trackIndex, clipIndex: t.clipIndex, ok: true });
        } catch (e) {
          results.push({
            trackIndex: t.trackIndex,
            clipIndex: t.clipIndex,
            ok: false,
            error: formatRelayError(e),
          });
        }
      }
      return {
        op,
        ok: results.some((r) => r.ok),
        data: { normalized: results.filter((r) => r.ok).length, results, targetDb },
      };
    }

    case "audio_fade_all": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const trackIndex = Number(step.trackIndex ?? 0);
      const { workflowTools } = await import("../tools/workflow.js");
      const fade = workflowTools.find((t) => t.name === "workflow_audio_fade");
      if (!fade) return { op, ok: false, error: "audio fade missing" };
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId,
        trackType: "audio",
        trackIndex,
      })) as Array<{ clipIndex: number }>;
      const results = [];
      for (const c of clips) {
        try {
          await fade.handler(
            {
              sequenceId,
              trackIndex,
              clipIndex: c.clipIndex,
              doFadeIn: step.doFadeIn !== false,
              doFadeOut: step.doFadeOut !== false,
            } as never,
            ctx,
          );
          results.push({ clipIndex: c.clipIndex, ok: true });
        } catch (e) {
          results.push({ clipIndex: c.clipIndex, ok: false, error: formatRelayError(e) });
        }
      }
      return { op, ok: results.some((r) => r.ok), data: { faded: results.filter((r) => r.ok).length, results } };
    }

    case "verify":
    case "qa": {
      // Structural + optional visual QA gate
      const sum = await runOpInner(ctx, { op: "summarize", sequenceId: step.sequenceId });
      const status = await ctx.relay.getStatus();
      const data = (sum.data || {}) as {
        videoClips?: number;
        audioClips?: number;
        markerCount?: number;
        sequenceId?: string;
      };
      const checks: Array<{ id: string; ok: boolean; note: string }> = [
        { id: "plugin", ok: !!status.pluginConnected, note: status.pluginConnected ? "connected" : "load UXP" },
        {
          id: "has_video",
          ok: (data.videoClips || 0) > 0,
          note: `${data.videoClips || 0} video clip(s)`,
        },
        {
          id: "text_bridge",
          ok: !!status.legacyBridgeConnected,
          note: status.legacyBridgeConnected ? "editable text ready" : "PNG fallback only",
        },
      ];
      let frame: unknown = null;
      if (step.capture !== false) {
        try {
          const { visionTools } = await import("../tools/vision.js");
          const shot = visionTools.find((t) => t.name === "sequence_screenshot");
          if (shot) {
            const fr = await shot.handler(
              {
                sequenceId: step.sequenceId as string | undefined,
                atTicks: step.atTicks as string | undefined,
                frame: step.frame as number | undefined,
              } as never,
              ctx,
            );
            frame = { text: fr.text, path: (fr.data as { path?: string })?.path };
            checks.push({ id: "frame", ok: true, note: "screenshot captured" });
          }
        } catch (e) {
          checks.push({ id: "frame", ok: false, note: formatRelayError(e) });
        }
      }
      const allOk = checks.filter((c) => c.id === "plugin" || c.id === "has_video").every((c) => c.ok);
      return {
        op,
        ok: allOk,
        data: {
          checks,
          summary: data,
          frame,
          qualityGate: allOk ? "pass" : "fail",
          tip: allOk
            ? "Ready for quality_pass / export"
            : "Fix failing checks before export",
        },
        recovery: allOk ? undefined : "Ensure plugin + media; re-run verify",
      };
    }

    case "polish":
    case "delivery": {
      // Super quality: quality_pass + optional film accents.
      // normalizeAudio OFF by default — blind Level writes were muting beds/SFX.
      const look = (step.look as "neutral" | "warm" | "cool") || "neutral";
      const steps: string[] = [];
      const qp = await runOpInner(ctx, {
        op: "quality_pass",
        look,
        trackIndex: step.trackIndex ?? 0,
        sequenceId: step.sequenceId,
        maxGrade: step.maxGrade ?? 24,
        maxTransitions: step.maxTransitions ?? 16,
        throttleMs: 60,
      });
      if (qp.ok) steps.push("quality_pass");
      // Explicit opt-in only
      // Opt-in mass ops only — default 0 dB, never silent +15 stack
      if (step.normalizeAudio === true) {
        const na = await runOpInner(ctx, {
          op: "normalize_audio",
          sequenceId: step.sequenceId,
          targetDb: step.targetDb ?? 0,
          allClips: true,
        });
        if (na.ok) steps.push("normalize_audio");
      }
      if (step.fixAudio === true) {
        try {
          const fix = await runOpInner(ctx, {
            op: "audio_fix",
            sequenceId: step.sequenceId,
            targetDb: typeof step.targetDb === "number" ? step.targetDb : 0,
            mode: "unity",
            allClips: true,
          });
          if (fix.ok) steps.push("audio_fix");
        } catch {
          /* non-fatal */
        }
      }
      if (step.filmLook) {
        const fl = await runOpInner(ctx, {
          op: "film_look",
          look: step.filmLook === true ? "neutral_cinematic" : step.filmLook,
          sequenceId: step.sequenceId,
          trackIndex: step.trackIndex ?? 0,
          grain: step.grain !== false,
          vignette: !!step.vignette,
        });
        if (fl.ok) steps.push("film_look");
      }
      if (step.kenBurns) {
        const kb = await runOpInner(ctx, {
          op: "ken_burns",
          sequenceId: step.sequenceId,
          trackIndex: step.trackIndex ?? 0,
        });
        if (kb.ok) steps.push("ken_burns");
      }
      return {
        op,
        ok: steps.length > 0,
        data: { steps, quality: "delivery-max", look },
      };
    }

    case "pip":
    case "picture_in_picture": {
      const { sequenceId } = await ensureActive(ctx, step.sequenceId as string | undefined);
      const { workflowTools } = await import("../tools/workflow.js");
      const tool = workflowTools.find((t) => t.name === "workflow_create_picture_in_picture");
      if (!tool) return { op, ok: false, error: "pip tool missing" };
      const outcome = await tool.handler(
        {
          sequenceId,
          trackIndex: Number(step.trackIndex ?? 1),
          clipIndex: Number(step.clipIndex ?? 0),
          scalePercent: Number(step.scalePercent ?? 35),
          x: Number(step.x ?? 1400),
          y: Number(step.y ?? 180),
        } as never,
        ctx,
      );
      return { op, ok: true, data: outcome.data };
    }

    default:
      return {
        op,
        ok: false,
        error: `Unknown op "${op}"`,
        recovery:
          "Ops: bootstrap, import, sequence_from_media, set_active, summarize, text, lower_third, end_card, titles, sfx, music_bed, duck, marker, chapter_markers, transition_all, fade_video, grade, grade_all, quality_pass, polish, ken_burns, film_look, normalize_audio, verify, export, save, pip",
      };
  }
}

/** Never throws. Retries once on TIMEOUT only. */
export async function runOp(ctx: ToolContext, step: EditOp): Promise<OpResult> {
  const op = String(step.op || "").toLowerCase().trim();
  try {
    return await runOpInner(ctx, step);
  } catch (e) {
    const msg = formatRelayError(e);
    if (/TIMEOUT/i.test(msg)) {
      try {
        await new Promise((r) => setTimeout(r, 400));
        const second = await runOpInner(ctx, step);
        return { ...second, retried: true };
      } catch (e2) {
        return errResult(op, e2, "Timeout twice — check Premiere UI not blocked; skip this op");
      }
    }
    return errResult(op, e, "Check connection; retry once max; then skip");
  }
}

export const PLAYBOOKS: Record<
  string,
  { title: string; description: string; quality: "solid" | "high"; build: (args: Record<string, unknown>) => EditOp[] }
> = {
  assemble: {
    title: "Assemble rough cut from files",
    description: "Import → sequence_from_media → summarize (quality foundation)",
    quality: "solid",
    build: (a) => {
      const paths = (a.paths as string[]) || [];
      const ops: EditOp[] = [
        { op: "bootstrap" },
        { op: "import", paths },
        { op: "sequence_from_media", paths, name: a.name || `Rough Cut ${Date.now()}` },
        { op: "summarize" },
      ];
      if (a.qualityPass) ops.push({ op: "quality_pass", look: a.look || "neutral" });
      if (a.save !== false) ops.push({ op: "save" });
      return ops;
    },
  },
  title_card: {
    title: "Add editable title",
    description: "Editable Basic Text (or PNG fallback). No auto scale hacks.",
    quality: "high",
    build: (a) => [
      { op: "bootstrap" },
      {
        op: "text",
        text: a.text || "Title",
        subtitle: a.subtitle,
        trackIndex: a.trackIndex ?? 2,
        atTicks: a.atTicks || "0",
        atSeconds: a.atSeconds,
        appearance: a.appearance || "plain",
        style: a.style || "title",
        anchor: a.anchor || "auto",
        withBackground: a.withBackground !== false,
        soften: a.soften !== false,
      },
    ],
  },
  sfx_hits: {
    title: "Place SFX at times",
    description: "Import audio and place at each time (ticks or seconds)",
    quality: "solid",
    build: (a) => {
      const path = a.path as string;
      const times = (a.atTicksList as string[]) || [];
      const seconds = (a.atSecondsList as number[]) || [];
      const ops: EditOp[] = [{ op: "bootstrap" }];
      for (const t of times) {
        ops.push({ op: "sfx", path, atTicks: t, trackIndex: a.trackIndex ?? 1, gainDb: a.gainDb });
      }
      for (const s of seconds) {
        ops.push({ op: "sfx", path, atSeconds: s, trackIndex: a.trackIndex ?? 1, gainDb: a.gainDb });
      }
      if (a.atTicks && !times.length) {
        ops.push({
          op: "sfx",
          path,
          atTicks: a.atTicks,
          trackIndex: a.trackIndex ?? 1,
          gainDb: a.gainDb,
        });
      }
      return ops;
    },
  },
  polish_export: {
    title: "Quality polish + optional export",
    description: "grade_all + transitions + fades (delivery quality)",
    quality: "high",
    build: (a) => {
      const ops: EditOp[] = [
        { op: "bootstrap" },
        { op: "quality_pass", look: a.look || "neutral", trackIndex: a.trackIndex ?? 0 },
      ];
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath, presetPath: a.presetPath });
      ops.push({ op: "save" });
      return ops;
    },
  },
  animation_pack: {
    title: "Animation cut + SFX + title (high quality)",
    description: "Video assemble, editable title, SFX hits, quality_pass, optional export",
    quality: "high",
    build: (a) => {
      const videoPaths = (a.videoPaths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        {
          op: "import",
          paths: [
            ...videoPaths,
            ...((a.sfxPaths as string[]) || []),
            ...((a.sfxHits as Array<{ path: string }> | undefined)?.map((h) => h.path) || []),
          ].filter(Boolean),
        },
        { op: "sequence_from_media", paths: videoPaths, name: a.name || `Anim ${Date.now()}` },
      ];
      if (a.title) {
        ops.push({
          op: "text",
          text: String(a.title),
          subtitle: a.subtitle,
          trackIndex: a.titleTrackIndex ?? 1,
          atTicks: a.titleAtTicks || "0",
        });
      }
      const hits = (a.sfxHits as Array<{ path: string; atTicks?: string; atSeconds?: number; trackIndex?: number }>) || [];
      for (const h of hits) {
        ops.push({
          op: "sfx",
          path: h.path,
          atTicks: h.atTicks,
          atSeconds: h.atSeconds,
          trackIndex: h.trackIndex ?? 1,
          gainDb: a.sfxGainDb ?? 0,
        });
      }
      ops.push({ op: "quality_pass", look: a.look || "warm" });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },
  full_cut: {
    title: "Full quality cut (end-to-end)",
    description:
      "Import → sequence → title → SFX → quality_pass (grade+transitions+fades) → save. Best default for weak+strong models.",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        { op: "import", paths: [...paths, ...((a.sfxPaths as string[]) || [])].filter(Boolean) },
        { op: "sequence_from_media", paths, name: a.name || `Full Cut ${Date.now()}` },
      ];
      if (a.title !== false) {
        ops.push({
          op: "text",
          text: (a.title as string) || "Title",
          trackIndex: 2,
          atTicks: "0",
          style: "title",
          anchor: "top_left",
        });
      }
      const hits = (a.sfxHits as Array<{ path: string; atTicks?: string; atSeconds?: number }>) || [];
      for (const h of hits) {
        ops.push({ op: "sfx", path: h.path, atTicks: h.atTicks, atSeconds: h.atSeconds, trackIndex: 1 });
      }
      ops.push({ op: "quality_pass", look: a.look || "neutral" });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  // ── Automatic systems that beat tool-count competitors ────────────

  youtube: {
    title: "YouTube-ready cut (auto)",
    description:
      "Import → sequence → title + lower-third → optional music bed → chapter markers → delivery polish (quality+normalize) → save/export",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        {
          op: "import",
          paths: [...paths, a.musicPath, ...((a.sfxPaths as string[]) || [])].filter(Boolean) as string[],
        },
        { op: "sequence_from_media", paths, name: a.name || `YouTube ${Date.now()}` },
        {
          op: "text",
          text: (a.title as string) || "Episode Title",
          trackIndex: 2,
          atTicks: "0",
          style: "title",
          anchor: "top_left",
        },
      ];
      if (a.lowerThird || a.guest || a.subtitle) {
        ops.push({
          op: "lower_third",
          text: String(a.lowerThird || a.guest || a.subtitle),
          subtitle: a.lowerThirdSub,
          trackIndex: Number(a.lowerThirdTrack ?? 2),
          atSeconds: Number(a.lowerThirdAtSeconds ?? 2),
        });
      }
      if (a.musicPath) {
        ops.push({
          op: "music_bed",
          path: a.musicPath,
          trackIndex: Number(a.musicTrackIndex ?? 2),
          gainDb: a.musicGainDb ?? 0,
        });
      }
      const hits = (a.sfxHits as Array<{ path: string; atSeconds?: number; atTicks?: string }>) || [];
      for (const h of hits) {
        ops.push({ op: "sfx", path: h.path, atSeconds: h.atSeconds, atTicks: h.atTicks, trackIndex: 1 });
      }
      if (a.chapters !== false) ops.push({ op: "chapter_markers" });
      ops.push({ op: "polish", look: a.look || "warm", normalizeAudio: false, fixAudio: false });
      if (a.musicPath && a.duck) ops.push({ op: "duck", trackIndex: a.musicTrackIndex ?? 2 });
      if (a.endCard !== false) {
        ops.push({
          op: "end_card",
          text: (a.endCard as string) || "Thanks for watching — Subscribe",
          leadSeconds: a.endCardLeadSeconds ?? 3,
        });
      }
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  social: {
    title: "Short-form / social cut (auto)",
    description:
      "Fast punchy edit: import → sequence → bold title → SFX hits → warm grade + transitions + fades. Optimized for Reels/TikTok/Shorts pace.",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        { op: "import", paths: [...paths, ...((a.sfxPaths as string[]) || [])].filter(Boolean) },
        { op: "sequence_from_media", paths, name: a.name || `Social ${Date.now()}` },
        {
          op: "text",
          text: (a.title as string) || "WATCH THIS",
          trackIndex: 2,
          atTicks: "0",
          style: "title",
          anchor: "top_left",
        },
      ];
      const hits = (a.sfxHits as Array<{ path: string; atSeconds?: number; atTicks?: string }>) || [];
      for (const h of hits) {
        ops.push({
          op: "sfx",
          path: h.path,
          atSeconds: h.atSeconds,
          atTicks: h.atTicks,
          trackIndex: 1,
          gainDb: a.sfxGainDb ?? 0,
        });
      }
      if (a.kenBurns !== false) ops.push({ op: "ken_burns", endScale: a.zoomEnd ?? 115 });
      ops.push({ op: "quality_pass", look: a.look || "warm" });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  trailer: {
    title: "Trailer / film pack (auto)",
    description:
      "Cinematic: import → sequence → title → end card → film look + quality polish → save",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        {
          op: "import",
          paths: [...paths, a.musicPath, ...((a.sfxPaths as string[]) || [])].filter(Boolean) as string[],
        },
        { op: "sequence_from_media", paths, name: a.name || `Trailer ${Date.now()}` },
        {
          op: "text",
          text: (a.title as string) || "COMING SOON",
          trackIndex: 2,
          atTicks: "0",
          style: "title_center",
          anchor: "center",
        },
      ];
      if (a.musicPath) {
        ops.push({ op: "music_bed", path: a.musicPath, trackIndex: 2, gainDb: a.musicGainDb ?? 0 });
      }
      const hits = (a.sfxHits as Array<{ path: string; atSeconds?: number; atTicks?: string }>) || [];
      for (const h of hits) {
        ops.push({ op: "sfx", path: h.path, atSeconds: h.atSeconds, atTicks: h.atTicks, trackIndex: 1 });
      }
      ops.push({
        op: "polish",
        look: a.look || "cool",
        filmLook: a.filmLook !== false,
        kenBurns: !!a.kenBurns,
        vignette: a.vignette !== false,
        normalizeAudio: false,
        fixAudio: false,
      });
      ops.push({
        op: "end_card",
        text: (a.endCard as string) || (a.title as string) || "COMING SOON",
        leadSeconds: a.endCardLeadSeconds ?? 4,
      });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  music_video: {
    title: "Music-driven cut (auto)",
    description: "Video + music bed + SFX hits + quality_pass + audio fades. Markers optional for ducking.",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        {
          op: "import",
          paths: [...paths, a.musicPath, ...((a.sfxPaths as string[]) || [])].filter(Boolean) as string[],
        },
        { op: "sequence_from_media", paths, name: a.name || `Music Video ${Date.now()}` },
      ];
      if (a.title) {
        ops.push({
          op: "text",
          text: String(a.title),
          trackIndex: 2,
          atTicks: "0",
          style: "title",
          anchor: "top_left",
        });
      }
      if (a.musicPath) {
        ops.push({
          op: "music_bed",
          path: a.musicPath,
          trackIndex: Number(a.musicTrackIndex ?? 1),
          gainDb: a.musicGainDb ?? 0,
        });
      }
      const hits = (a.sfxHits as Array<{ path: string; atSeconds?: number; atTicks?: string }>) || [];
      for (const h of hits) {
        ops.push({ op: "sfx", path: h.path, atSeconds: h.atSeconds, atTicks: h.atTicks, trackIndex: 2 });
      }
      if (a.markers) {
        ops.push({ op: "marker", markers: a.markers });
      }
      ops.push({ op: "quality_pass", look: a.look || "warm" });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  podcast: {
    title: "Talking-head / podcast polish (auto)",
    description:
      "Import → sequence → lower-thirds → chapter markers → normalize audio → gentle grade → save",
    quality: "high",
    build: (a) => {
      const paths = (a.paths as string[]) || (a.videoPath ? [String(a.videoPath)] : []);
      const ops: EditOp[] = [
        { op: "bootstrap" },
        { op: "import", paths },
        { op: "sequence_from_media", paths, name: a.name || `Podcast ${Date.now()}` },
      ];
      if (a.title) {
        ops.push({
          op: "text",
          text: String(a.title),
          trackIndex: 2,
          atTicks: "0",
          style: "title",
          anchor: "top_left",
        });
      }
      const guests =
        (a.guests as Array<{ name: string; atSeconds?: number; subtitle?: string }>) ||
        (a.lowerThird
          ? [{ name: String(a.lowerThird), atSeconds: 2, subtitle: a.subtitle as string | undefined }]
          : []);
      for (const g of guests) {
        ops.push({
          op: "lower_third",
          text: g.name,
          subtitle: g.subtitle,
          atSeconds: g.atSeconds ?? 2,
          trackIndex: 1,
        });
      }
      if (a.chapters !== false) ops.push({ op: "chapter_markers" });
      ops.push({ op: "normalize_audio" });
      ops.push({ op: "quality_pass", look: a.look || "neutral" });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  delivery: {
    title: "Max delivery polish (auto)",
    description:
      "On active sequence: quality_pass + audio normalize + optional film/ken burns. No import — polish what exists.",
    quality: "high",
    build: (a) => {
      const ops: EditOp[] = [
        { op: "bootstrap" },
        {
          op: "polish",
          look: a.look || "neutral",
          filmLook: a.filmLook,
          kenBurns: a.kenBurns,
          vignette: a.vignette,
          normalizeAudio: a.normalizeAudio === true,
          fixAudio: a.fixAudio === true,
        },
      ];
      if (a.verify !== false) ops.push({ op: "verify", capture: !!a.capture });
      if (a.outputPath) ops.push({ op: "export", outputPath: a.outputPath });
      ops.push({ op: "save" });
      return ops;
    },
  },

  qa_pass: {
    title: "QA / verify before export",
    description: "Summarize timeline + connection checks + optional screenshot. Does not modify the cut.",
    quality: "solid",
    build: (a) => [
      { op: "bootstrap" },
      { op: "verify", capture: a.capture !== false, atSeconds: a.atSeconds, frame: a.frame },
    ],
  },

  chapters: {
    title: "Auto chapter markers at cuts",
    description: "Place a marker at the start of every V0 clip (YouTube chapters scaffold).",
    quality: "solid",
    build: (a) => [
      { op: "bootstrap" },
      { op: "chapter_markers", trackIndex: a.trackIndex ?? 0, prefix: a.prefix },
      { op: "save" },
    ],
  },
};

/** Map free-text / intent labels → playbook id (for edit_auto). */
export function resolveIntent(intent: string): { playbook: string; notes: string } {
  const s = intent.toLowerCase().trim();
  const rules: Array<{ re: RegExp; playbook: string; notes: string }> = [
    { re: /youtube|yt\b|vlog|episode/, playbook: "youtube", notes: "YouTube end-to-end pack" },
    { re: /short|reel|tiktok|social|vertical|instagram/, playbook: "social", notes: "Short-form pack" },
    { re: /trailer|cinematic|film|movie|teaser/, playbook: "trailer", notes: "Trailer/film pack" },
    { re: /music.?video|mv\b|lyric/, playbook: "music_video", notes: "Music-driven cut" },
    { re: /podcast|talking.?head|interview|guest/, playbook: "podcast", notes: "Talk/podcast polish" },
    { re: /animat|sfx|whoosh|motion/, playbook: "animation_pack", notes: "Animation + SFX pack" },
    { re: /deliver|polish|finish|master|export.?ready/, playbook: "delivery", notes: "Delivery polish only" },
    { re: /qa|verify|check|preview/, playbook: "qa_pass", notes: "QA without editing" },
    { re: /chapter|marker/, playbook: "chapters", notes: "Chapter markers" },
    { re: /title|lower.?third|text|caption/, playbook: "title_card", notes: "Title only" },
    { re: /assembl|rough|import|cut from/, playbook: "assemble", notes: "Rough assemble" },
    { re: /full|complete|everything|default/, playbook: "full_cut", notes: "Full quality default" },
  ];
  for (const r of rules) {
    if (r.re.test(s)) return { playbook: r.playbook, notes: r.notes };
  }
  return { playbook: "full_cut", notes: "Default full_cut (best general quality)" };
}

export const ALL_OPS = [
  "bootstrap",
  "import",
  "sequence_from_media",
  "set_active",
  "summarize",
  "text",
  "lower_third",
  "end_card",
  "titles",
  "sfx",
  "music_bed",
  "duck",
  "marker",
  "chapter_markers",
  "transition_all",
  "fade_video",
  "grade",
  "grade_all",
  "quality_pass",
  "polish",
  "ken_burns",
  "film_look",
  "normalize_audio",
  "audio_fade_all",
  "detect_silence",
  "detect_onsets",
  "captions",
  "audio_fix",
  "verify",
  "pip",
  "export",
  "save",
  "checkpoint",
  "checkpoint_create",
  "checkpoint_list",
  "checkpoint_restore",
  "restore_checkpoint",
] as const;

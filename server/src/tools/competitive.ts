/**
 * High-value tools for agent UX / parity with larger CEP MCP catalogs.
 * Pure server orchestration of existing relay primitives where possible.
 */
import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import { frameToTicks, goToFrame, resolveTimebase, ticksToSeconds } from "../timebase.js";

const TICKS_PER_SECOND = 254016000000n;

export const competitiveTools = [
  defineTool({
    name: "sequence_find_by_name",
    title: "Find sequences by name",
    description: "List sequences whose name contains the query (case-insensitive).",
    inputSchema: { query: z.string().min(1) },
    handler: async (p, ctx) => {
      const list = (await ctx.relay.call("sequence.list", {})) as Array<{
        sequenceId: string;
        name: string;
      }>;
      const q = p.query.toLowerCase();
      const matches = list.filter((s) => (s.name || "").toLowerCase().includes(q));
      return { text: `Found ${matches.length} sequence(s) matching "${p.query}".`, data: matches };
    },
  }),

  defineTool({
    name: "sequence_set_active_by_name",
    title: "Activate sequence by name",
    description:
      "Activate sequence by name. Prefers exact match, then longest/most specific match (newest timestamped titles). Never blindly picks the first partial match (that caused editing wrong bloated sequences).",
    inputSchema: { query: z.string().min(1) },
    handler: async (p, ctx) => {
      const list = (await ctx.relay.call("sequence.list", {})) as Array<{
        sequenceId: string;
        name: string;
      }>;
      const q = p.query.toLowerCase().trim();
      const exact = list.find((s) => (s.name || "").toLowerCase() === q);
      let hit = exact;
      if (!hit) {
        const matches = list.filter((s) => (s.name || "").toLowerCase().includes(q));
        if (matches.length) {
          matches.sort((a, b) => (b.name || "").length - (a.name || "").length);
          const bestLen = (matches[0]!.name || "").length;
          const top = matches.filter((m) => (m.name || "").length >= bestLen - 2);
          hit = top[top.length - 1] || matches[matches.length - 1];
        }
      }
      if (!hit) return { text: `No sequence matching "${p.query}".`, data: { found: false } };
      await ctx.relay.call("sequence.setActive", { sequenceId: hit.sequenceId });
      return { text: `Active sequence: ${hit.name}.`, data: { ...hit, active: true } };
    },
  }),

  defineTool({
    name: "playhead_go_to_seconds",
    title: "Go to time in seconds",
    description: "Move playhead to an absolute time in seconds (converted to ticks).",
    inputSchema: {
      sequenceId: z.string().optional(),
      seconds: z.number().min(0),
    },
    handler: async (p, ctx) => {
      const atTicks = String(BigInt(Math.floor(p.seconds * Number(TICKS_PER_SECOND))));
      const data = await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks });
      return { text: `Playhead at ${p.seconds}s (${atTicks} ticks).`, data: { atTicks, seconds: p.seconds, ...(data as object) } };
    },
  }),

  defineTool({
    name: "playhead_go_to_timecode",
    title: "Go to frame or seconds",
    description: "Move playhead using either frame (0-based) or seconds — convenience wrapper.",
    inputSchema: {
      sequenceId: z.string().optional(),
      frame: z.number().int().optional(),
      seconds: z.number().optional(),
    },
    handler: async (p, ctx) => {
      if (p.frame !== undefined) {
        const data = await goToFrame(ctx.relay, { sequenceId: p.sequenceId, frame: p.frame });
        return { text: `Playhead at frame ${data.frame}.`, data };
      }
      if (p.seconds !== undefined) {
        const atTicks = String(BigInt(Math.floor(p.seconds * Number(TICKS_PER_SECOND))));
        await ctx.relay.call("playhead.set", { sequenceId: p.sequenceId, atTicks });
        return { text: `Playhead at ${p.seconds}s.`, data: { atTicks, seconds: p.seconds } };
      }
      return { text: "Provide frame or seconds.", data: { ok: false } };
    },
  }),

  defineTool({
    name: "markers_add_many",
    title: "Add multiple markers",
    description: "Batch-create sequence markers from a list of {atTicks, name?, comments?}.",
    inputSchema: {
      sequenceId: z.string().optional(),
      markers: z
        .array(
          z.object({
            atTicks: z.string(),
            name: z.string().optional(),
            comments: z.string().optional(),
          }),
        )
        .min(1),
    },
    handler: async (p, ctx) => {
      const results = [];
      for (const m of p.markers) {
        try {
          const data = await ctx.relay.call("marker.add", {
            sequenceId: p.sequenceId,
            atTicks: m.atTicks,
            name: m.name,
            comments: m.comments,
          });
          results.push({ ...m, ok: true, data });
        } catch (e) {
          results.push({ ...m, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Added ${ok}/${results.length} marker(s).`, data: { results } };
    },
  }),

  defineTool({
    name: "edit_get_report",
    title: "Edit / project report for agents",
    description:
      "One-shot agent orientation: connection status, active sequence, full sequence list, timeline summary, duration, playhead. Prefer this at session start over many small calls.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const status = await ctx.relay.getStatus();
      const sequences = await ctx.relay.call("sequence.list", {}).catch(() => []);
      let active = null;
      try {
        active = await ctx.relay.call("sequence.getActive", {});
      } catch {
        active = null;
      }
      if (p.sequenceId) {
        try {
          await ctx.relay.call("sequence.setActive", { sequenceId: p.sequenceId });
          active = await ctx.relay.call("sequence.getActive", {});
        } catch {
          /* ignore */
        }
      }
      const tracks = await ctx.relay
        .call("track.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})
        .catch(() => []);
      const markers = await ctx.relay
        .call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {})
        .catch(() => []);
      let playhead = null;
      try {
        playhead = await ctx.relay.call("playhead.get", p.sequenceId ? { sequenceId: p.sequenceId } : {});
      } catch {
        playhead = null;
      }
      let duration = null;
      try {
        duration = await ctx.relay.call("sequence.getDuration", p.sequenceId ? { sequenceId: p.sequenceId } : {});
      } catch {
        duration = null;
      }
      const data = {
        status,
        sequences,
        active,
        tracks,
        markers,
        playhead,
        duration,
        tips: [
          "Use sequence_set_active / sequence_set_active_by_name before editing.",
          "text_write_plain for clean titles; appearance:template only for branded lower-thirds.",
          "workflow_cleanup_test_sequences to remove smoke sequences.",
        ],
      };
      return {
        text: `Edit report: plugin=${status.pluginConnected} legacyText=${status.legacyBridgeConnected} sequences=${Array.isArray(sequences) ? sequences.length : "?"} active=${(active as { name?: string })?.name ?? "none"}.`,
        data,
      };
    },
  }),

  defineTool({
    name: "clip_count_on_track",
    title: "Count clips on a track",
    description: "Quick clip count for a video/audio track.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.enum(["video", "audio"]).default("video"),
      trackIndex: z.number().int(),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", p)) as unknown[];
      return { text: `${clips.length} clip(s) on ${p.trackType} ${p.trackIndex}.`, data: { count: clips.length } };
    },
  }),

  defineTool({
    name: "time_seconds_to_ticks",
    title: "Convert seconds to ticks",
    description: "Utility: Adobe ticks = seconds * 254016000000.",
    inputSchema: { seconds: z.number() },
    handler: async (p) => {
      const ticks = String(BigInt(Math.floor(p.seconds * Number(TICKS_PER_SECOND))));
      return { text: `${p.seconds}s = ${ticks} ticks.`, data: { seconds: p.seconds, ticks } };
    },
  }),

  defineTool({
    name: "time_ticks_to_seconds",
    title: "Convert ticks to seconds",
    description: "Utility: seconds = ticks / 254016000000.",
    inputSchema: { ticks: z.string() },
    handler: async (p) => {
      const seconds = ticksToSeconds(p.ticks);
      return { text: `${p.ticks} ticks = ${seconds}s.`, data: { ticks: p.ticks, seconds } };
    },
  }),

  defineTool({
    name: "time_frame_to_ticks",
    title: "Convert frame number to ticks",
    description: "Uses active sequence timebase when possible.",
    inputSchema: { sequenceId: z.string().optional(), frame: z.number().int() },
    handler: async (p, ctx) => {
      const tb = await resolveTimebase(ctx.relay, p.sequenceId);
      const ticks = frameToTicks(p.frame, tb.ticksPerFrame);
      return {
        text: `Frame ${p.frame} @ ${tb.fps}fps = ${ticks} ticks.`,
        data: { frame: p.frame, ticks, fps: tb.fps, ticksPerFrame: String(tb.ticksPerFrame) },
      };
    },
  }),

  defineTool({
    name: "project_quick_save",
    title: "Save project",
    description: "Alias of project_save — quick agent checkpoint.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("project.save", {});
      return { text: "Project saved.", data };
    },
  }),
];

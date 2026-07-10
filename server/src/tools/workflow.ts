import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import { detectSilenceInFile, findFfmpeg, transcribeMedia } from "../mediaAnalysis.js";
import { placeText } from "../textEngine.js";

// High-level composites. Silence clean + captions use real ffmpeg/STT
// (server/src/mediaAnalysis.ts). Multicam auto-sync still omitted (no API).

export const workflowTools = [
  defineTool({
    name: "workflow_summarize_timeline",
    title: "Summarize the current timeline",
    description:
      "Get a compact, model-readable summary of a sequence: every track's clips (name, position, duration) and every marker. Use this to orient before making edits, instead of several separate track_list/clip_list/marker_list calls.",
    inputSchema: { sequenceId: z.string().optional() },
    handler: async (p, ctx) => {
      const seq = await ctx.relay.call("sequence.getActive", p.sequenceId ? { sequenceId: p.sequenceId } : {});
      const tracks = (await ctx.relay.call("track.list", p)) as Array<{ trackType: string; trackIndex: number; name: string; clipCount: number }>;
      const perTrackClips = await Promise.all(
        tracks.map((t) => ctx.relay.call("clip.list", { sequenceId: p.sequenceId, trackType: t.trackType, trackIndex: t.trackIndex })),
      );
      const markers = await ctx.relay.call("marker.list", p.sequenceId ? { sequenceId: p.sequenceId } : {}).catch(() => []);
      const data = { sequence: seq, tracks: tracks.map((t, i) => ({ ...t, clips: perTrackClips[i] })), markers };
      return { text: `Timeline summary for "${(seq as { name?: string }).name ?? "active sequence"}".`, data };
    },
  }),

  defineTool({
    name: "assembly_rough_cut_from_bin",
    title: "Assemble a rough cut from a bin",
    description:
      "Build a rough cut from bin media. Prefer createSequenceFromMedia (live-confirmed) when createNewSequence is true or sequenceId is omitted; otherwise attempt clip_insert (may fail on some Premiere builds — known platform gap).",
    inputSchema: {
      sequenceId: z.string().optional(),
      binPath: z
        .array(z.string())
        .optional()
        .describe('Bin path from project root, e.g. ["Footage", "Selects"]. Omit or [] for project root.'),
      trackIndex: z.number().int().optional().default(0),
      startAtTicks: z.string().optional().default("0"),
      createNewSequence: z
        .boolean()
        .optional()
        .default(true)
        .describe("If true (default), create a new sequence from the media via createSequenceFromMedia (reliable). If false, insert into sequenceId."),
      sequenceName: z.string().optional().describe("Name for the new sequence when createNewSequence is true."),
    },
    handler: async (p, ctx) => {
      const items = (await ctx.relay.call("project.listItems", {
        binPath: p.binPath?.length ? p.binPath : undefined,
      })) as Array<{ id: string; name: string; isBin: boolean }>;
      const media = items.filter((i) => !i.isBin);
      if (!media.length) {
        return { text: "No media items in that bin.", data: { inserted: 0 } };
      }
      if (p.createNewSequence || !p.sequenceId) {
        const data = await ctx.relay.call("sequence.createFromMedia", {
          name: p.sequenceName || `Rough Cut ${Date.now()}`,
          projectItemIds: media.map((m) => m.id),
          targetBinPath: p.binPath,
        });
        return {
          text: `Created sequence from ${media.length} item(s) in bin [${(p.binPath || ["(root)"]).join(" / ")}].`,
          data: { inserted: media.length, sequence: data, via: "createSequenceFromMedia" },
        };
      }
      let cursor = p.startAtTicks;
      let inserted = 0;
      const errors: string[] = [];
      for (const item of media) {
        try {
          await ctx.relay.call("clip.insert", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: p.trackIndex,
            projectItemId: item.id,
            atTicks: cursor,
          });
          inserted++;
          const clips = (await ctx.relay.call("clip.list", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: p.trackIndex,
          })) as Array<{ endTicks?: string }>;
          const last = clips[clips.length - 1];
          if (last?.endTicks) cursor = last.endTicks;
        } catch (err) {
          errors.push(`${item.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return {
        text: `Assembled ${inserted}/${media.length} clip(s) via clip_insert.${errors.length ? " Prefer createNewSequence:true if inserts fail." : ""}`,
        data: { inserted, errors, via: "clip.insert" },
      };
    },
  }),

  defineTool({
    name: "workflow_add_lower_third",
    title: "Add a lower-third text graphic",
    description:
      "Insert a lower-third name/title caption near the bottom of the frame. Uses text_add with lower_third PNG style (bar + bottom layout) because UXP MOGRT text write usually fails.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      atTicks: z.string(),
      durationTicks: z.string().optional(),
      text: z.string(),
      x: z.number().optional().default(140),
      y: z.number().optional().default(880).describe("Only applies if MOGRT text write succeeds."),
      colorHex: z.string().optional().describe("PNG fallback text color hex without #."),
    },
    handler: async (p, ctx) => {
      const { titleTools } = await import("./title.js");
      const textAdd = titleTools.find((t: { name: string }) => t.name === "text_add");
      if (textAdd) {
        const result = await textAdd.handler(
          {
            sequenceId: p.sequenceId,
            trackIndex: p.trackIndex,
            atTicks: p.atTicks,
            durationTicks: p.durationTicks,
            text: p.text,
            style: "lower_third",
            fontSize: 40,
            colorHex: p.colorHex || "FFFFFF",
          } as never,
          ctx,
        );
        // Best-effort MOGRT position if shell-only path
        try {
          const d = result.data as { trackIndex?: number; clipIndex?: number; mogrt?: { trackIndex: number; clipIndex: number } };
          const ti = d?.mogrt?.trackIndex ?? d?.trackIndex ?? p.trackIndex;
          const ci = d?.mogrt?.clipIndex ?? d?.clipIndex;
          if (ci !== undefined) {
            await ctx.relay.call("title.setPosition", {
              sequenceId: p.sequenceId,
              trackIndex: ti,
              clipIndex: ci,
              x: p.x,
              y: p.y,
            });
          }
        } catch {
          /* PNG path has position baked in */
        }
        return { text: `Added lower-third "${p.text}".`, data: result.data };
      }
      return { text: "text_add tool missing.", data: { ok: false } };
    },
  }),

  defineTool({
    name: "workflow_apply_chroma_key",
    title: "Apply a chroma key (green/blue screen)",
    description:
      'Apply Ultra Key to a clip for green/blue-screen keying. Parameter names beyond applying the effect are best-effort (e.g. "Key Color") — use effect_list_applied/effect_set_param directly if fine control is needed.',
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.enum(["video"]).default("video"),
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      keyColor: z.object({ r: z.number(), g: z.number(), b: z.number() }).optional().describe("Defaults to Ultra Key's own default (usually green)."),
    },
    handler: async (p, ctx) => {
      await ctx.relay.call("effect.add", { sequenceId: p.sequenceId, trackType: "video", trackIndex: p.trackIndex, clipIndex: p.clipIndex, matchName: "Ultra Key" });
      if (p.keyColor) {
        const applied = (await ctx.relay.call("effect.listApplied", {
          sequenceId: p.sequenceId,
          trackType: "video",
          trackIndex: p.trackIndex,
          clipIndex: p.clipIndex,
        })) as Array<{ effectIndex: number; displayName: string }>;
        const ultraKey = applied.find((e) => e.displayName === "Ultra Key");
        if (ultraKey) {
          await ctx.relay
            .call("effect.setParam", {
              sequenceId: p.sequenceId,
              trackType: "video",
              trackIndex: p.trackIndex,
              clipIndex: p.clipIndex,
              effectIndex: ultraKey.effectIndex,
              paramName: "Key Color",
              value: p.keyColor,
            })
            .catch(() => undefined);
        }
      }
      return { text: "Applied Ultra Key chroma key.", data: { applied: true } };
    },
  }),

  defineTool({
    name: "workflow_create_picture_in_picture",
    title: "Create a picture-in-picture / split-screen",
    description: "Scale and reposition a clip on an upper track so it appears as a picture-in-picture over whatever is on the track(s) below it.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.enum(["video"]).default("video"),
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      scalePercent: z.number().positive().optional().default(35),
      x: z.number().optional().default(1400).describe("Position of the PIP's center, in pixels."),
      y: z.number().optional().default(180),
    },
    handler: async (p, ctx) => {
      const applied = (await ctx.relay.call("effect.listApplied", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      })) as Array<{ effectIndex: number; displayName: string }>;
      const motion = applied.find((e) => e.displayName === "Motion");
      if (!motion) {
        return { text: "Could not find the Motion component on this clip — every clip should have one; this indicates a deeper problem.", data: { applied } };
      }
      await ctx.relay.call("effect.setParam", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
        effectIndex: motion.effectIndex,
        paramName: "Scale",
        value: p.scalePercent,
      });
      await ctx.relay.call("effect.setParam", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
        effectIndex: motion.effectIndex,
        paramName: "Position",
        value: { x: p.x, y: p.y },
      });
      return { text: `Set up picture-in-picture at ${p.scalePercent}% scale, position (${p.x}, ${p.y}).`, data: { scalePercent: p.scalePercent, x: p.x, y: p.y } };
    },
  }),

  defineTool({
    name: "workflow_prep_for_export",
    title: "Normalize audio and export in one step",
    description: "Normalize loudness on a set of audio clips, then export the sequence with a preset. A convenience composite of audio_normalize + export_sequence.",
    inputSchema: {
      sequenceId: z.string().optional(),
      audioClips: z
        .array(z.object({ trackIndex: z.number().int(), clipIndex: z.number().int() }))
        .optional()
        .describe("Audio clips to normalize before export. Omit to skip normalization."),
      targetDb: z.number().optional().default(0).describe("0 dB unity. Only listed audioClips."),
      outputPath: z.string(),
      presetPath: z.string().optional(),
    },
    handler: async (p, ctx) => {
      for (const clip of p.audioClips ?? []) {
        await ctx.relay.call("audio.normalize", { sequenceId: p.sequenceId, trackType: "audio", trackIndex: clip.trackIndex, clipIndex: clip.clipIndex, targetDb: p.targetDb ?? 0 });
      }
      const data = await ctx.relay.call("export.sequence", { sequenceId: p.sequenceId, outputPath: p.outputPath, presetPath: p.presetPath });
      return { text: `Normalized ${p.audioClips?.length ?? 0} clip(s) and started export to ${p.outputPath}.`, data };
    },
  }),

  defineTool({
    name: "workflow_trim_to_length",
    title: "Trim a track to a target duration",
    description: "Trim the last clip on a track so the track's total duration matches a target length (ripple not applied — only the last clip's out-point moves).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackType: z.enum(["video", "audio"]),
      trackIndex: z.number().int(),
      targetDurationTicks: z.string(),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", { sequenceId: p.sequenceId, trackType: p.trackType, trackIndex: p.trackIndex })) as Array<{
        clipIndex: number;
        startTicks?: string;
      }>;
      if (clips.length === 0) {
        const err = new Error("No clips on this track to trim.");
        (err as { code?: string }).code = "INVALID_PARAMS";
        throw err;
      }
      const last = clips[clips.length - 1]!;
      const data = await ctx.relay.call("clip.trim", {
        sequenceId: p.sequenceId,
        trackType: p.trackType,
        trackIndex: p.trackIndex,
        clipIndex: last.clipIndex,
        edge: "out",
        newTicks: p.targetDurationTicks,
      });
      return { text: `Trimmed last clip's out-point to reach target duration ${p.targetDurationTicks} ticks.`, data };
    },
  }),

  defineTool({
    name: "workflow_apply_color_look",
    title: "Apply color look to clips",
    description:
      "Apply Lumetri (+ optional LUT path and basic-correction params) to each target video clip. Composite of color_apply_lumetri / color_apply_lut / color_set_param.",
    inputSchema: {
      sequenceId: z.string().optional(),
      clips: z
        .array(z.object({ trackIndex: z.number().int(), clipIndex: z.number().int() }))
        .min(1)
        .describe("Video clips to grade."),
      lutPath: z.string().optional(),
      params: z.record(z.number()).optional(),
    },
    handler: async (p, ctx) => {
      const results = [];
      for (const clip of p.clips) {
        try {
          await ctx.relay.call("color.applyLumetri", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: clip.trackIndex,
            clipIndex: clip.clipIndex,
          });
          if (p.lutPath) {
            await ctx.relay.call("color.applyLut", {
              sequenceId: p.sequenceId,
              trackType: "video",
              trackIndex: clip.trackIndex,
              clipIndex: clip.clipIndex,
              lutPath: p.lutPath,
            });
          }
          if (p.params) {
            for (const [paramName, value] of Object.entries(p.params)) {
              await ctx.relay.call("color.setParam", {
                sequenceId: p.sequenceId,
                trackType: "video",
                trackIndex: clip.trackIndex,
                clipIndex: clip.clipIndex,
                paramName,
                value,
              });
            }
          }
          results.push({ ...clip, ok: true });
        } catch (err) {
          results.push({
            ...clip,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Applied color look to ${ok}/${results.length} clip(s).`, data: { results } };
    },
  }),

  defineTool({
    name: "workflow_apply_glitch",
    title: "Apply a glitch-style effect pack",
    description:
      "Apply a curated glitch look: RGB Split + Noise (and optional VR Digital Glitch if installed). Uses Effects-panel filters by display name. Great for stylized / music-video edits.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      intensity: z.enum(["subtle", "medium", "heavy"]).optional().default("medium"),
      includeVrGlitch: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const ref = {
        sequenceId: p.sequenceId,
        trackType: "video" as const,
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      };
      const applied: string[] = [];
      const errors: string[] = [];
      for (const name of ["RGB Split", "Noise"]) {
        try {
          await ctx.relay.call("effect.add", { ...ref, matchName: name });
          applied.push(name);
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (p.includeVrGlitch) {
        try {
          await ctx.relay.call("effect.add", { ...ref, matchName: "VR Digital Glitch" });
          applied.push("VR Digital Glitch");
        } catch (e) {
          errors.push(`VR Digital Glitch: ${e instanceof Error ? e.message : e}`);
        }
      }
      // Intensity via opacity of whole clip is a crude lever when param names vary
      if (p.intensity === "subtle") {
        try {
          await ctx.relay.call("effect.setOpacity", { ...ref, opacity: 100 });
        } catch {
          /* ignore */
        }
      }
      return {
        text: `Glitch pack: applied [${applied.join(", ")}]${errors.length ? `; errors: ${errors.join("; ")}` : ""}.`,
        data: { applied, errors, intensity: p.intensity },
      };
    },
  }),

  defineTool({
    name: "workflow_cinematic_grade",
    title: "Apply a cinematic Lumetri grade",
    description:
      "One-call cinematic look: Lumetri + slightly crushed blacks, lifted contrast, desaturated/teal-ish warmth via Temperature/Tint/Saturation/Contrast/Shadows presets. Tweak further with color_set_param.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      look: z.enum(["neutral_cinematic", "warm", "cool", "bleach"]).optional().default("neutral_cinematic"),
    },
    handler: async (p, ctx) => {
      const ref = { sequenceId: p.sequenceId, trackType: "video", trackIndex: p.trackIndex, clipIndex: p.clipIndex };
      await ctx.relay.call("color.applyLumetri", ref);
      const looks: Record<string, Record<string, number>> = {
        neutral_cinematic: { Contrast: 15, Shadows: -10, Highlights: -5, Saturation: 90, Temperature: 0 },
        warm: { Contrast: 12, Shadows: -8, Saturation: 95, Temperature: 15, Tint: 5 },
        cool: { Contrast: 12, Shadows: -8, Saturation: 85, Temperature: -12, Tint: -5 },
        bleach: { Contrast: 25, Shadows: -15, Highlights: 10, Saturation: 55, Temperature: 5 },
      };
      const params = looks[p.look] ?? looks.neutral_cinematic!;
      const set: string[] = [];
      for (const [paramName, value] of Object.entries(params)) {
        try {
          await ctx.relay.call("color.setParam", { ...ref, paramName, value });
          set.push(`${paramName}=${value}`);
        } catch {
          /* param name may differ by Lumetri version */
        }
      }
      return { text: `Cinematic grade "${p.look}" applied (${set.join(", ")}).`, data: { look: p.look, set } };
    },
  }),

  defineTool({
    name: "workflow_add_title_card",
    title: "Add an on-screen title card",
    description:
      "Place a title at a time. Uses MOGRT text when UXP can write it; otherwise renders a Premiere-compatible PNG title and overwrites onto the track (SVG is NOT used — Premiere rejects SVG).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().optional().default(0),
      atTicks: z.string(),
      text: z.string(),
      durationTicks: z.string().optional(),
    },
    handler: async (p, ctx) => {
      // Same composition as text_add (avoid circular import of allTools).
      // PNG title path lives in titleTools — call the shared insert+set path via relay.
      const { titleTools } = await import("./title.js");
      const textAdd = titleTools.find((t: { name: string }) => t.name === "text_add");
      if (textAdd) {
        return textAdd.handler(
          {
            sequenceId: p.sequenceId,
            trackIndex: p.trackIndex ?? 0,
            atTicks: p.atTicks,
            durationTicks: p.durationTicks,
            text: p.text,
          } as never,
          ctx,
        );
      }
      const insertData = (await ctx.relay.call("title.insertMogrt", {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        durationTicks: p.durationTicks,
        template: "basic-text",
      })) as { trackIndex: number; clipIndex: number };
      return { text: `Title shell placed at clip ${insertData.clipIndex}.`, data: insertData };
    },
  }),

  defineTool({
    name: "workflow_duck_audio_under_markers",
    title: "Duck music under markers",
    description:
      "Simple music ducking: at each sequence marker, set volume keyframes on an audio track (down then up). Not true sidechain — uses marker times as dialogue beats. 254016000000 ticks ≈ 1 second.",
    inputSchema: {
      sequenceId: z.string().optional(),
      musicTrackIndex: z.number().int().describe("Audio track index of the music bed."),
      musicClipIndex: z.number().int().optional().default(0),
      duckDb: z.number().optional().default(-12).describe("Gain during duck (e.g. -12)."),
      normalDb: z.number().optional().default(0),
      duckRadiusTicks: z
        .string()
        .optional()
        .default("508032000000")
        .describe("Half-width of duck around each marker (~2s default)."),
    },
    handler: async (p, ctx) => {
      const markers = (await ctx.relay.call(
        "marker.list",
        p.sequenceId ? { sequenceId: p.sequenceId } : {},
      )) as Array<{ startTicks: string }>;
      if (!markers.length) {
        return { text: "No markers — add markers at dialogue/beat points first.", data: { ducked: 0 } };
      }
      const radius = BigInt(p.duckRadiusTicks);
      let count = 0;
      for (const m of markers) {
        const t = BigInt(m.startTicks);
        const t0 = t > radius ? t - radius : 0n;
        const t1 = t;
        const t2 = t + radius;
        for (const [at, db] of [
          [String(t0), p.normalDb],
          [String(t1), p.duckDb],
          [String(t2), p.normalDb],
        ] as const) {
          try {
            await ctx.relay.call("audio.addVolumeKeyframe", {
              sequenceId: p.sequenceId,
              trackIndex: p.musicTrackIndex,
              clipIndex: p.musicClipIndex,
              atTicks: at,
              decibels: db,
            });
            count++;
          } catch {
            /* continue */
          }
        }
      }
      return {
        text: `Ducked music on A${p.musicTrackIndex} around ${markers.length} marker(s) (${count} keyframes attempted).`,
        data: { markers: markers.length, keyframes: count },
      };
    },
  }),

  defineTool({
    name: "workflow_finish_cut",
    title: "Finish-cut polish pass",
    description:
      "End-of-edit polish on a video clip: optional cinematic grade, optional vignette, optional cross-dissolve, optional audio normalize. Chain of proven tools for a delivery-ready feel.",
    inputSchema: {
      sequenceId: z.string().optional(),
      videoTrackIndex: z.number().int().default(0),
      videoClipIndex: z.number().int().default(0),
      audioTrackIndex: z.number().int().optional(),
      audioClipIndex: z.number().int().optional().default(0),
      grade: z.boolean().optional().default(true),
      vignette: z.boolean().optional().default(false),
      addDissolve: z.boolean().optional().default(false),
      normalizeAudio: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const ref = {
        sequenceId: p.sequenceId,
        trackType: "video" as const,
        trackIndex: p.videoTrackIndex,
        clipIndex: p.videoClipIndex,
      };
      const steps: string[] = [];
      if (p.grade) {
        await ctx.relay.call("color.applyLumetri", ref);
        for (const [paramName, value] of Object.entries({ Contrast: 12, Shadows: -8, Saturation: 92 })) {
          try {
            await ctx.relay.call("color.setParam", { ...ref, paramName, value });
          } catch {
            /* ignore */
          }
        }
        steps.push("cinematic grade");
      }
      if (p.vignette) {
        try {
          await ctx.relay.call("effect.add", { ...ref, matchName: "Vignette" });
          steps.push("vignette");
        } catch (e) {
          steps.push(`vignette failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (p.addDissolve) {
        try {
          await ctx.relay.call("transition.apply", {
            ...ref,
            matchName: "AE.ADBE Cross Dissolve New",
            edge: "tail",
            durationTicks: "508032000000",
          });
          steps.push("cross dissolve");
        } catch (e) {
          steps.push(`dissolve failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (p.normalizeAudio && p.audioTrackIndex !== undefined) {
        try {
          await ctx.relay.call("audio.normalize", {
            sequenceId: p.sequenceId,
            trackIndex: p.audioTrackIndex,
            clipIndex: p.audioClipIndex,
            targetDb: 0,
          });
          steps.push("audio normalize");
        } catch (e) {
          steps.push(`audio failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      return { text: `Finish-cut polish: ${steps.join(", ") || "nothing applied"}.`, data: { steps } };
    },
  }),

  defineTool({
    name: "workflow_film_look",
    title: "Apply a film / cinematic animation look",
    description:
      "Film-style pack: Lumetri cinematic grade + optional Film Dissolve transition + optional Noise grain + optional Vignette. Good for narrative, trailer, or stylized animation cuts.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().default(0),
      clipIndex: z.number().int().default(0),
      look: z.enum(["neutral_cinematic", "warm", "cool", "bleach"]).optional().default("neutral_cinematic"),
      grain: z.boolean().optional().default(true),
      vignette: z.boolean().optional().default(true),
      filmDissolve: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const ref = {
        sequenceId: p.sequenceId,
        trackType: "video" as const,
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      };
      const steps: string[] = [];
      const errors: string[] = [];

      await ctx.relay.call("color.applyLumetri", ref);
      const looks: Record<string, Record<string, number>> = {
        neutral_cinematic: { Contrast: 18, Shadows: -12, Highlights: -6, Saturation: 88, Temperature: 2 },
        warm: { Contrast: 14, Shadows: -10, Saturation: 95, Temperature: 18, Tint: 4 },
        cool: { Contrast: 14, Shadows: -10, Saturation: 82, Temperature: -14, Tint: -4 },
        bleach: { Contrast: 28, Shadows: -18, Highlights: 12, Saturation: 50, Temperature: 6 },
      };
      for (const [paramName, value] of Object.entries(looks[p.look] ?? looks.neutral_cinematic!)) {
        try {
          await ctx.relay.call("color.setParam", { ...ref, paramName, value });
        } catch {
          /* ignore */
        }
      }
      steps.push(`grade:${p.look}`);

      if (p.grain) {
        try {
          await ctx.relay.call("effect.add", { ...ref, matchName: "Noise" });
          steps.push("grain");
        } catch (e) {
          errors.push(`Noise: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (p.vignette) {
        try {
          await ctx.relay.call("effect.add", { ...ref, matchName: "Vignette" });
          steps.push("vignette");
        } catch (e) {
          errors.push(`Vignette: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (p.filmDissolve) {
        try {
          await ctx.relay.call("transition.apply", {
            ...ref,
            matchName: "ADBE Film Dissolve",
            edge: "tail",
            durationTicks: "508032000000",
          });
          steps.push("film dissolve");
        } catch (e) {
          errors.push(`Film Dissolve: ${e instanceof Error ? e.message : e}`);
        }
      }
      return {
        text: `Film look applied: ${steps.join(", ")}${errors.length ? ` (errors: ${errors.join("; ")})` : ""}.`,
        data: { steps, errors, look: p.look },
      };
    },
  }),

  defineTool({
    name: "workflow_cleanup_test_sequences",
    title: "Delete test/smoke sequences",
    description:
      "Delete sequences whose names match PPMCP test prefixes (Smoke, Temp, LegacyText, Dual, FromMedia, TextShape, Rough Cut, etc.). Does not delete sequences that fail the pattern. dryRun lists what would be deleted.",
    inputSchema: {
      dryRun: z.boolean().optional().default(true),
      nameIncludes: z
        .array(z.string())
        .optional()
        .describe('Extra name fragments to match (case-insensitive). Defaults to PPMCP test patterns.'),
      keepActive: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const patterns = (p.nameIncludes?.length
        ? p.nameIncludes
        : [
            "PPMCP Smoke",
            "PPMCP Temp",
            "PPMCP LegacyText",
            "PPMCP Dual",
            "PPMCP FromMedia",
            "PPMCP TextShape",
            "PPMCP LT ",
            "Rough Cut ",
            "Text ",
          ]
      ).map((s) => s.toLowerCase());
      const list = (await ctx.relay.call("sequence.list", {})) as Array<{ sequenceId: string; name: string }>;
      let activeId: string | undefined;
      try {
        const act = (await ctx.relay.call("sequence.getActive", {})) as { sequenceId?: string };
        activeId = act?.sequenceId;
      } catch {
        /* ignore */
      }
      const victims = list.filter((s) => {
        const n = (s.name || "").toLowerCase();
        if (p.keepActive && s.sequenceId === activeId) return false;
        return patterns.some((pat) => n.includes(pat.toLowerCase()));
      });
      if (p.dryRun) {
        return {
          text: `Dry-run: would delete ${victims.length} sequence(s): ${victims.map((v) => v.name).join(", ") || "(none)"}. Call again with dryRun:false to delete.`,
          data: { dryRun: true, victims },
        };
      }
      const results = [];
      for (const v of victims) {
        try {
          await ctx.relay.call("sequence.delete", { sequenceId: v.sequenceId });
          results.push({ ...v, ok: true });
        } catch (e) {
          results.push({ ...v, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Deleted ${ok}/${results.length} test sequence(s).`, data: { results } };
    },
  }),

  defineTool({
    name: "workflow_animate_zoom",
    title: "Animate zoom (Ken Burns style scale)",
    description:
      "Keyframe Motion Scale from startScale to endScale over the clip (or from/to ticks). Simple zoom in/out animation using effect_set_param keyframes.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().default(0),
      clipIndex: z.number().int().default(0),
      startScale: z.number().optional().default(100),
      endScale: z.number().optional().default(120),
      fromTicks: z.string().optional().describe("Defaults to clip start."),
      toTicks: z.string().optional().describe("Defaults to clip end."),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number; startTicks?: string; endTicks?: string }>;
      const clip = clips.find((c) => c.clipIndex === p.clipIndex) ?? clips[p.clipIndex];
      if (!clip) return { text: "Clip not found.", data: { ok: false } };
      const from = p.fromTicks ?? clip.startTicks ?? "0";
      const to = p.toTicks ?? clip.endTicks ?? from;
      const applied = (await ctx.relay.call("effect.listApplied", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      })) as Array<{ effectIndex: number; displayName: string }>;
      const motion = applied.find((e) => e.displayName === "Motion");
      if (!motion) return { text: "No Motion component on clip.", data: { applied } };
      const ref = {
        sequenceId: p.sequenceId,
        trackType: "video" as const,
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
        effectIndex: motion.effectIndex,
        paramName: "Scale",
      };
      await ctx.relay.call("effect.setParam", { ...ref, value: p.startScale, atTicks: from });
      await ctx.relay.call("effect.setParam", { ...ref, value: p.endScale, atTicks: to });
      return {
        text: `Zoom animation Scale ${p.startScale}→${p.endScale} from ${from} to ${to} ticks.`,
        data: { from, to, startScale: p.startScale, endScale: p.endScale },
      };
    },
  }),

  defineTool({
    name: "workflow_fade_clip",
    title: "Fade clip opacity in/out",
    description:
      "Opacity keyframes at clip edges: fade in from 0→100 over fadeInTicks at start, and/or fade out 100→0 at end.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().default(0),
      clipIndex: z.number().int().default(0),
      fadeInTicks: z.string().optional().default("508032000000").describe("~2s default."),
      fadeOutTicks: z.string().optional().default("508032000000"),
      doFadeIn: z.boolean().optional().default(true),
      doFadeOut: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number; startTicks?: string; endTicks?: string }>;
      const clip = clips.find((c) => c.clipIndex === p.clipIndex) ?? clips[p.clipIndex];
      if (!clip?.startTicks || !clip?.endTicks) return { text: "Clip missing time bounds.", data: { ok: false } };
      const applied = (await ctx.relay.call("effect.listApplied", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      })) as Array<{ effectIndex: number; displayName: string }>;
      const opacity = applied.find((e) => e.displayName === "Opacity");
      if (!opacity) return { text: "No Opacity component.", data: { applied } };
      const start = BigInt(clip.startTicks);
      const end = BigInt(clip.endTicks);
      const steps: string[] = [];
      const setOp = (at: string, value: number) =>
        ctx.relay.call("effect.setParam", {
          sequenceId: p.sequenceId,
          trackType: "video",
          trackIndex: p.trackIndex,
          clipIndex: p.clipIndex,
          effectIndex: opacity.effectIndex,
          paramName: "Opacity",
          value,
          atTicks: at,
        });
      if (p.doFadeIn) {
        const mid = start + BigInt(p.fadeInTicks);
        await setOp(String(start), 0);
        await setOp(String(mid < end ? mid : end), 100);
        steps.push("fade-in");
      }
      if (p.doFadeOut) {
        const mid = end - BigInt(p.fadeOutTicks);
        await setOp(String(mid > start ? mid : start), 100);
        await setOp(String(end), 0);
        steps.push("fade-out");
      }
      return { text: `Opacity fades: ${steps.join(", ")}.`, data: { steps } };
    },
  }),

  defineTool({
    name: "workflow_ken_burns",
    title: "Ken Burns pan+zoom",
    description:
      "Animate Motion Scale and Position over a clip (slow zoom + pan). Good for stills and B-roll.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().default(0),
      clipIndex: z.number().int().default(0),
      startScale: z.number().optional().default(100),
      endScale: z.number().optional().default(125),
      startX: z.number().optional().default(0.5),
      startY: z.number().optional().default(0.5),
      endX: z.number().optional().default(0.55),
      endY: z.number().optional().default(0.45),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number; startTicks?: string; endTicks?: string }>;
      const clip = clips.find((c) => c.clipIndex === p.clipIndex) ?? clips[p.clipIndex];
      if (!clip?.startTicks || !clip?.endTicks) return { text: "Clip not found.", data: { ok: false } };
      const applied = (await ctx.relay.call("effect.listApplied", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
      })) as Array<{ effectIndex: number; displayName: string }>;
      const motion = applied.find((e) => e.displayName === "Motion");
      if (!motion) return { text: "No Motion component.", data: { applied } };
      const base = {
        sequenceId: p.sequenceId,
        trackType: "video" as const,
        trackIndex: p.trackIndex,
        clipIndex: p.clipIndex,
        effectIndex: motion.effectIndex,
      };
      const from = clip.startTicks;
      const to = clip.endTicks;
      // Position may be pixel or normalized depending on build — use PointF via {x,y}
      for (const [at, scale, x, y] of [
        [from, p.startScale, p.startX, p.startY],
        [to, p.endScale, p.endX, p.endY],
      ] as const) {
        await ctx.relay.call("effect.setParam", { ...base, paramName: "Scale", value: scale, atTicks: at });
        await ctx.relay
          .call("effect.setParam", {
            ...base,
            paramName: "Position",
            value: { x, y },
            atTicks: at,
          })
          .catch(async () => {
            // Some builds use pixel coords — try 1920-space
            await ctx.relay.call("effect.setParam", {
              ...base,
              paramName: "Position",
              value: { x: Number(x) * 1920, y: Number(y) * 1080 },
              atTicks: at,
            });
          });
      }
      return {
        text: `Ken Burns: scale ${p.startScale}→${p.endScale}, position animated over clip.`,
        data: { from, to },
      };
    },
  }),

  defineTool({
    name: "workflow_add_transitions_between_clips",
    title: "Add transitions between all cuts on a track",
    description:
      "Apply the same video transition (default Cross Dissolve) at the tail of every clip except the last on a track.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().default(0),
      matchName: z.string().optional().default("AE.ADBE Cross Dissolve New"),
      durationTicks: z.string().optional().default("508032000000"),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "video",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number }>;
      const results = [];
      for (let i = 0; i < clips.length - 1; i++) {
        const c = clips[i]!;
        try {
          await ctx.relay.call("transition.apply", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: p.trackIndex,
            clipIndex: c.clipIndex,
            matchName: p.matchName,
            edge: "tail",
            durationTicks: p.durationTicks,
          });
          results.push({ clipIndex: c.clipIndex, ok: true });
        } catch (e) {
          results.push({
            clipIndex: c.clipIndex,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      return { text: `Transitions applied on ${ok}/${results.length} cut(s).`, data: { results } };
    },
  }),

  defineTool({
    name: "workflow_audio_fade",
    title: "Audio fade in/out on a clip",
    description: "Add volume keyframes for fade-in and/or fade-out on an audio clip.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      clipIndex: z.number().int().default(0),
      fadeInTicks: z.string().optional().default("508032000000"),
      fadeOutTicks: z.string().optional().default("508032000000"),
      doFadeIn: z.boolean().optional().default(true),
      doFadeOut: z.boolean().optional().default(true),
      peakDb: z.number().optional().default(0),
      silentDb: z.number().optional().default(-60),
    },
    handler: async (p, ctx) => {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: p.sequenceId,
        trackType: "audio",
        trackIndex: p.trackIndex,
      })) as Array<{ clipIndex: number; startTicks?: string; endTicks?: string }>;
      const clip = clips.find((c) => c.clipIndex === p.clipIndex) ?? clips[p.clipIndex];
      if (!clip?.startTicks || !clip?.endTicks) return { text: "Audio clip not found.", data: { ok: false } };
      const start = BigInt(clip.startTicks);
      const end = BigInt(clip.endTicks);
      const steps: string[] = [];
      const kf = (at: string, db: number) =>
        ctx.relay.call("audio.addVolumeKeyframe", {
          sequenceId: p.sequenceId,
          trackIndex: p.trackIndex,
          clipIndex: p.clipIndex,
          atTicks: at,
          decibels: db,
        });
      if (p.doFadeIn) {
        await kf(String(start), p.silentDb);
        await kf(String(start + BigInt(p.fadeInTicks)), p.peakDb);
        steps.push("fade-in");
      }
      if (p.doFadeOut) {
        await kf(String(end - BigInt(p.fadeOutTicks)), p.peakDb);
        await kf(String(end), p.silentDb);
        steps.push("fade-out");
      }
      return { text: `Audio ${steps.join(" + ")} on A${p.trackIndex}.`, data: { steps } };
    },
  }),

  defineTool({
    name: "workflow_clean_silence",
    title: "Mark silence regions for cleanup",
    description:
      "Real ffmpeg silence detect on a media file, then add markers (and optional report) for silence regions. Does NOT auto-ripple-delete by default (destructive) — set applyCuts only after review. Safer than blind auto-cut.",
    inputSchema: {
      mediaPath: z.string(),
      sequenceId: z.string().optional(),
      noiseDb: z.number().optional().default(-30),
      minDuration: z.number().optional().default(0.4),
      addMarkers: z.boolean().optional().default(true),
      maxMarkers: z.number().int().optional().default(40),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg required for silence clean.", data: { ok: false, needFfmpeg: true } };
      }
      const det = detectSilenceInFile(p.mediaPath, {
        noiseDb: p.noiseDb,
        minDuration: p.minDuration,
      });
      const markers = [];
      if (p.addMarkers) {
        for (const r of det.regions.slice(0, p.maxMarkers)) {
          try {
            const data = await ctx.relay.call("marker.add", {
              sequenceId: p.sequenceId,
              atTicks: r.startTicks,
              name: `SILENCE ${r.durationSeconds.toFixed(1)}s`,
              comments: `end ${r.endSeconds.toFixed(2)}s — review before cut`,
            });
            markers.push({ ok: true, data, region: r });
          } catch (e) {
            markers.push({ ok: false, error: e instanceof Error ? e.message : String(e), region: r });
          }
        }
      }
      return {
        text: `Silence clean: ${det.regions.length} region(s), ${markers.filter((m) => m.ok).length} marker(s). Review markers before cutting.`,
        data: {
          regions: det.regions,
          markers,
          engine: det.engine,
          tip: "Use clip_ripple_delete / manual cuts at markers. Auto-delete omitted for safety.",
        },
      };
    },
  }),

  defineTool({
    name: "workflow_add_captions_from_audio",
    title: "Captions from audio (STT pipeline)",
    description:
      "Transcribe a media file (whisper or Windows Speech) and place captions as text + markers. Alias of caption_generate_auto.",
    inputSchema: {
      mediaPath: z.string(),
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().optional().default(1),
      language: z.string().optional(),
      maxSegments: z.number().int().optional().default(30),
      engine: z.enum(["auto", "whisper", "windows"]).optional().default("auto"),
    },
    handler: async (p, ctx) => {
      if (!findFfmpeg()) {
        return { text: "ffmpeg required.", data: { ok: false, needFfmpeg: true } };
      }
      let transcript;
      try {
        transcript = transcribeMedia(p.mediaPath, {
          language: p.language,
          engine: p.engine,
        });
      } catch (e) {
        return {
          text: e instanceof Error ? e.message : String(e),
          data: { ok: false, recovery: "pip install openai-whisper or use caption_import_srt" },
        };
      }
      const results = [];
      for (const seg of transcript.segments.slice(0, p.maxSegments)) {
        const row: Record<string, unknown> = { text: seg.text };
        try {
          row.marker = await ctx.relay.call("marker.add", {
            sequenceId: p.sequenceId,
            atTicks: seg.startTicks,
            name: seg.text.slice(0, 36),
            comments: "caption",
          });
        } catch (e) {
          row.markerError = e instanceof Error ? e.message : String(e);
        }
        try {
          const r = await placeText(ctx, {
            sequenceId: p.sequenceId,
            trackIndex: p.trackIndex ?? 1,
            atTicks: seg.startTicks,
            text: seg.text,
            style: "caption",
            verify: false,
          });
          row.place = { ok: r.ok, via: r.via, quality: r.quality };
        } catch (e) {
          row.placeError = e instanceof Error ? e.message : String(e);
        }
        results.push(row);
      }
      return {
        text: `Captions from audio: ${results.length} segment(s) via ${transcript.engine}.`,
        data: { engine: transcript.engine, srtPath: transcript.srtPath, results },
      };
    },
  }),
];

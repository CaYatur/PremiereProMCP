import { z } from "zod";
import { defineTool } from "../toolDefinition.js";
import {
  placeText,
  textSystemHealth,
  autoAlignTextDesign,
  resolveTextLayout,
  type PngTitleStyle,
} from "../textEngine.js";

export type { PngTitleStyle };

/**
 * Text tools — multi-path resilient engine (see server/src/textEngine.ts + docs/TEXT_SYSTEM.md).
 * Priority: UXP → hybrid UXP+CEP → CEP full → PNG safety net.
 * Type Tool quality = AE Basic Text via CEP when bridge is open; UXP cannot write string params yet.
 */

// See docs/TEXT_SYSTEM.md — multi-path engine, not single UXP path.

const clipRef = {
  sequenceId: z.string().optional(),
  trackType: z.literal("video").default("video"),
  trackIndex: z.number().int(),
  clipIndex: z.number().int(),
};

const ticks = z.string().describe("Time in ticks as a string (254016000000 ticks = 1 second).");

/** PNG place helper for text_add / text_write_png (engine path D). */
async function placePngTitle(
  ctx: Parameters<typeof placeText>[0],
  opts: {
    sequenceId?: string;
    trackIndex: number;
    atTicks: string;
    text: string;
    styleKey: "title" | "lower_third" | "caption";
    fontSize?: number;
    colorHex?: string;
  },
) {
  const r = await placeText(ctx, {
    sequenceId: opts.sequenceId,
    trackIndex: opts.trackIndex,
    atTicks: opts.atTicks,
    text: opts.text,
    style: opts.styleKey,
    preferPng: true,
    fontSize: opts.fontSize,
    colorHex: opts.colorHex,
  });
  if (!r.ok) throw new Error(r.userMessage);
  return r.data;
}

/** Optional post-place only when caller asks — no auto scale/position (caused hidden text). */
async function optionalPostPlace(
  ctx: { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } },
  opts: {
    sequenceId?: string;
    trackIndex: number;
    clipIndex: number;
    scale?: number;
    x?: number;
    y?: number;
    durationTicks?: string;
    atTicks?: string;
  },
): Promise<Record<string, unknown> | undefined> {
  const out: Record<string, unknown> = {};
  let did = false;
  if (opts.scale !== undefined || (opts.x !== undefined && opts.y !== undefined)) {
    try {
      const transform: Record<string, unknown> = {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.trackIndex,
        clipIndex: opts.clipIndex,
      };
      if (opts.scale !== undefined) transform.scale = opts.scale;
      if (opts.x !== undefined && opts.y !== undefined) {
        transform.x = opts.x;
        transform.y = opts.y;
      }
      out.transform = await ctx.relay.call("effect.setTransform", transform);
      did = true;
    } catch (e) {
      out.transformError = e instanceof Error ? e.message : String(e);
    }
  }
  if (opts.durationTicks && opts.atTicks !== undefined) {
    try {
      const end = String(BigInt(opts.atTicks) + BigInt(opts.durationTicks));
      out.trim = await ctx.relay.call("clip.trim", {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.trackIndex,
        clipIndex: opts.clipIndex,
        edge: "out",
        newTicks: end,
      });
      did = true;
    } catch (e) {
      out.trimError = e instanceof Error ? e.message : String(e);
    }
  }
  return did ? out : undefined;
}

export const titleTools = [
  defineTool({
    name: "text_system_status",
    title: "Text system health",
    description:
      "Report which text paths are available (UXP / CEP bridge / Basic Text.mogrt / PNG). Call before serious title work if unsure.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const h = await textSystemHealth(ctx);
      return {
        text: `Text: plugin=${h.plugin} bridge=${h.textBridge} quality=${h.qualityAvailable} → ${h.recommendedPath}`,
        data: {
          ...h,
          typeToolNote:
            "Adobe exposes no pure UXP Type Tool API. Type Tool–like quality = AE Basic Text via CEP when bridge is open; else PNG safety net.",
          bridgeInstall: "legacy-bridge/install-dev.ps1 then Window > PPMCP Text Bridge (leave open)",
        },
      };
    },
  }),

  defineTool({
    name: "text_design_guide",
    title: "Text design coordinates for models",
    description:
      "Returns the automatic design system: anchors, Motion coords (0–1), plate rules, when to use center. Call before inventing positions.",
    inputSchema: {},
    handler: async () => {
      const styles = (["title", "lower_third", "caption", "title_center", "end_card"] as const).map((style) => {
        const L = resolveTextLayout(style);
        return {
          style,
          anchor: L.anchor,
          motion: { x: L.x, y: L.y, scale: L.scale },
          label: L.label,
        };
      });
      return {
        text: "Design: title→top_left, lower_third→bottom_left, caption→bottom_center. Composite card = text+bar one image (centered). Never invent 960,480. Frames: sequence_export_still (pure), not window screenshot.",
        data: {
          styles,
          rules: [
            "ONE call: text_write(style) — composite card auto-centers text on bar",
            "Do NOT separately place shape + text then hand-align",
            "Do NOT pass x/y/scale unless overriding (omit for defaults)",
            "Do NOT call text_auto_design after every write unless fixing old clips",
            "trackIndex ≥ 2 preferred",
            "Center only style=title_center|end_card",
            "Frames: sequence_export_still / sequence_screenshot (pureFrame default)",
          ],
          antiPatterns: [
            "shape_add + text_write separately",
            "effect_set_transform random coords",
            "preferWindowCapture for QA (UI chrome)",
            "pixel Position 960,480",
          ],
        },
      };
    },
  }),

  defineTool({
    name: "text_auto_design",
    title: "Auto-align text + background plate",
    description:
      "Automatic design pass: apply corner/safe Motion layout to a text clip, optional plate re-align (opacity/color if shape), soft fade. Use after text_write or to fix bad layouts. Prefer calling with style+anchor.",
    inputSchema: {
      sequenceId: z.string().optional(),
      textTrackIndex: z.number().int(),
      textClipIndex: z.number().int(),
      plateTrackIndex: z.number().int().optional(),
      plateClipIndex: z.number().int().optional(),
      style: z
        .enum(["title", "lower_third", "caption", "title_center", "end_card"])
        .optional()
        .default("title"),
      anchor: z
        .enum([
          "auto",
          "top_left",
          "top_right",
          "bottom_left",
          "bottom_right",
          "lower_third",
          "caption",
          "center",
        ])
        .optional()
        .default("auto"),
      text: z.string().optional().describe("For plate size estimation if re-placing plate."),
      soften: z.boolean().optional().default(true),
      replacePlate: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, place a fresh aligned PNG plate under the text."),
    },
    handler: async (p, ctx) => {
      const { placeTextBackground } = await import("../textEngine.js");
      let plateInfo: unknown;
      if (p.replacePlate) {
        const plateTrack =
          p.plateTrackIndex !== undefined ? p.plateTrackIndex : Math.max(0, p.textTrackIndex - 1);
        // Need atTicks — use clip start if possible
        let atTicks = "0";
        try {
          const clips = (await ctx.relay.call("clip.list", {
            sequenceId: p.sequenceId,
            trackType: "video",
            trackIndex: p.textTrackIndex,
          })) as Array<{ clipIndex: number; startTicks?: string }>;
          const c = clips.find((x) => x.clipIndex === p.textClipIndex);
          if (c?.startTicks) atTicks = c.startTicks;
        } catch {
          /* */
        }
        plateInfo = await placeTextBackground(ctx, {
          sequenceId: p.sequenceId,
          plateTrackIndex: plateTrack,
          atTicks,
          text: p.text || "Title",
          style: p.style,
          anchor: p.anchor,
          soften: p.soften,
        });
      }
      const align = await autoAlignTextDesign(ctx, {
        sequenceId: p.sequenceId,
        textTrackIndex: p.textTrackIndex,
        textClipIndex: p.textClipIndex,
        plateTrackIndex: p.plateTrackIndex,
        plateClipIndex: p.plateClipIndex,
        style: p.style,
        anchor: p.anchor,
        text: p.text,
        soften: p.soften,
      });
      const L = resolveTextLayout(p.style, p.anchor);
      return {
        text: `Auto-design: text @ ${L.label} (${L.x}, ${L.y}) scale ${L.scale}${p.replacePlate ? " + new plate" : ""}.`,
        data: { align, plateInfo, layout: L },
      };
    },
  }),

  defineTool({
    name: "text_bridge_ensure",
    title: "Ensure / diagnose Text Bridge",
    description:
      "Check CEP Text Bridge connectivity for editable Type Tool–like text. Cannot auto-open Premiere panels from UXP — returns install steps + current status + recommended path (CEP vs PNG).",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const h = await textSystemHealth(ctx);
      const steps: string[] = [];
      if (!h.plugin) steps.push("1. Load UXP plugin + start bridge :8265");
      if (!h.textBridge) {
        steps.push("2. Run: powershell -ExecutionPolicy Bypass -File legacy-bridge/install-dev.ps1");
        steps.push("3. Restart Premiere Pro");
        steps.push("4. Window → PPMCP Text Bridge — leave panel open until Connected");
      }
      if (!h.plainMogrt) steps.push("5. Ensure plugin/templates/Basic Text.mogrt exists (AE Capsule)");
      if (h.textBridge && h.plainMogrt) {
        steps.push("Ready: text_write will prefer editable CEP path");
      } else {
        steps.push("Until bridge is open, text_write still places PNG (usable, not editable)");
      }
      // Soft ping if connected
      let ping: unknown = null;
      if (h.textBridge) {
        try {
          ping = await ctx.relay.call("legacy.ping", {});
        } catch (e) {
          ping = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      return {
        text: h.textBridge
          ? "Text Bridge connected — editable AE text available."
          : "Text Bridge NOT connected — PNG fallback only until panel is open.",
        data: {
          ...h,
          steps,
          ping,
          pureUxpTypeTool: false,
          reason: "No Adobe UXP Type Tool / create-text-layer API",
        },
      };
    },
  }),

  defineTool({
    name: "text_write",
    title: "Write on-screen text (resilient multi-path)",
    description:
      "Place designed on-screen text. Defaults: corner anchors (title=top_left, NOT center), large scale, fitted dark rounded PNG plate under text (same position), soft fade-in. Paths UXP→CEP→PNG. trackIndex≥2. Use text_design_guide for coords. Never invent 960,480. Center only style=title_center|end_card.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int().describe("Video track (use V1+ above footage)."),
      atTicks: ticks,
      text: z.string().describe("Text content (editable in Properties when MOGRT path succeeds)."),
      subtitle: z.string().optional().describe("Second line for dual-field lower-thirds."),
      style: z
        .enum(["title", "lower_third", "caption", "title_center", "end_card"])
        .optional()
        .default("title")
        .describe(
          "title=top-left (default, NOT center); lower_third=bottom-left; caption=bottom-center; title_center/end_card=center only when intentional.",
        ),
      anchor: z
        .enum([
          "auto",
          "top_left",
          "top_right",
          "bottom_left",
          "bottom_right",
          "lower_third",
          "caption",
          "center",
        ])
        .optional()
        .default("auto")
        .describe("Override placement. Prefer corners. center only for cards."),
      appearance: z
        .enum(["plain", "template"])
        .optional()
        .describe("plain (default): AE Basic Text. template: branded lower-third."),
      scale: z.number().optional().describe("Motion scale %. Default large; floor ~110."),
      x: z.number().optional().describe("Normalized 0–1 Motion X. Prefer omit (anchor handles it)."),
      y: z.number().optional().describe("Normalized 0–1 Motion Y. Prefer omit."),
      durationTicks: z.string().optional().describe("Optional out-trim length in ticks."),
      fontSize: z.number().int().optional().describe("Text size (PNG path). Default ~54 title."),
      colorHex: z
        .string()
        .optional()
        .describe('Text color #RRGGBB e.g. "FFFFFF", "FFCC00". Match to video grade.'),
      barColorHex: z
        .string()
        .optional()
        .describe('Plate/bar fill #RRGGBB e.g. "000000", "1A1A2E", "8B0000". Default black.'),
      barAlpha: z
        .number()
        .int()
        .min(0)
        .max(255)
        .optional()
        .describe("Plate opacity 0–255 (0=invisible, 255=solid). Default ~180."),
      bar: z.boolean().optional().describe("false = no plate even if withBackground (prefer withBackground:false)."),
      preferPng: z
        .boolean()
        .optional()
        .default(false)
        .describe("Force non-editable PNG still (best color control for text+bar)."),
      mogrtPath: z.string().optional().describe("Override .mogrt absolute path."),
      verify: z
        .boolean()
        .optional()
        .default(true)
        .describe("Read-back verify after CEP write (reduces silent wrong text)."),
      applyLayout: z
        .boolean()
        .optional()
        .default(true)
        .describe("Apply corner/safe Motion layout + soft fade."),
      withBackground: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "true (default): dark plate under text. false: PLAIN text only — no bar/plate behind. Use false for clean Type-Tool-like titles.",
        ),
      soften: z
        .boolean()
        .optional()
        .default(true)
        .describe("Opacity fade-in ~0.5s on text and plate."),
      recBlink: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, place a red blinking REC dot to the right of the title (recording UI)."),
      recDotNx: z.number().optional().describe("Normalized X for REC dot (default right of title)."),
      recDotNy: z.number().optional().describe("Normalized Y for REC dot."),
    },
    handler: async (p, ctx) => {
      const r = await placeText(ctx, {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        text: p.text,
        subtitle: p.subtitle,
        style: p.style || "title",
        anchor: p.anchor,
        appearance: p.appearance,
        mogrtPath: p.mogrtPath,
        preferPng: p.preferPng,
        fontSize: p.fontSize,
        colorHex: p.colorHex,
        barColorHex: p.barColorHex,
        barAlpha: p.barAlpha,
        bar: p.bar !== false,
        verify: p.verify,
        applyLayout: p.applyLayout,
        withBackground: p.withBackground,
        soften: p.soften,
        x: p.x,
        y: p.y,
        scale: p.scale,
      });

      const trackIndex =
        (r.data.trackIndex as number | undefined) ??
        (r.data as { insert?: { trackIndex?: number } }).insert?.trackIndex ??
        p.trackIndex;
      const clipIndex =
        (r.data.clipIndex as number | undefined) ??
        (r.data as { insert?: { clipIndex?: number } }).insert?.clipIndex ??
        0;

      let post: Record<string, unknown> | undefined;
      // Duration must apply for PNG as well as editable — previously only editable
      // got durationTicks, so PNG titles always sat at default ~5s.
      if (
        r.ok &&
        (p.durationTicks ||
          (r.editable && (p.scale !== undefined || p.x !== undefined)))
      ) {
        post = await optionalPostPlace(ctx, {
          sequenceId: p.sequenceId,
          trackIndex,
          clipIndex,
          scale: r.editable ? p.scale : undefined,
          x: r.editable ? p.x : undefined,
          y: r.editable ? p.y : undefined,
          durationTicks: p.durationTicks,
          atTicks: p.atTicks,
        });
      }

      let recBlink: Record<string, unknown> | undefined;
      if (r.ok && p.recBlink) {
        try {
          const { placeRecBlink } = await import("../textEngine.js");
          // Prefer free track below title (plate track often free of rec). Cap to track 2 on 3-track seqs.
          const dotTrack = Math.min(2, Math.max(1, trackIndex));
          recBlink = await placeRecBlink(ctx, {
            sequenceId: p.sequenceId,
            trackIndex: dotTrack,
            atTicks: p.atTicks,
            durationTicks: p.durationTicks || "1143072000000",
            nx: p.recDotNx ?? 0.5,
            ny: p.recDotNy ?? 0.155,
            periodSec: 0.85,
          });
        } catch (e) {
          recBlink = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }

      return {
        text: r.userMessage + (recBlink && (recBlink as { recBlink?: boolean }).recBlink ? " + red REC blink" : ""),
        data: {
          ...r.data,
          editable: r.editable,
          quality: r.quality,
          via: r.via,
          pathAttempts: r.pathAttempts,
          recovery: r.recovery,
          post,
          recBlink,
        },
      };
    },
  }),

  defineTool({
    name: "text_write_editable",
    title: "Write editable Type Tool–like text",
    description:
      "Prefer editable paths only (no silent PNG). Fails clearly if Text Bridge / Basic Text missing. Uses resilient engine with verify.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      atTicks: ticks,
      text: z.string(),
      subtitle: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const health = await textSystemHealth(ctx);
      if (!health.textBridge) {
        return {
          text: "Text Bridge not connected. Window > PPMCP Text Bridge must be open for editable text.",
          data: { ok: false, editable: false, needBridge: true, health },
        };
      }
      if (!health.plainMogrt) {
        return {
          text: "Basic Text.mogrt not found under plugin/templates.",
          data: { ok: false, health },
        };
      }
      const r = await placeText(ctx, {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        text: p.text,
        subtitle: p.subtitle,
        appearance: "plain",
        verify: true,
        requireEditable: true,
      });
      if (!r.ok || !r.editable) {
        return {
          text: `Editable text failed. ${r.recovery || r.userMessage}`,
          data: {
            ok: false,
            editable: false,
            pathAttempts: r.pathAttempts,
            recovery: r.recovery,
            health,
          },
        };
      }
      return {
        text: r.userMessage,
        data: { ...r.data, editable: true, quality: r.quality, via: r.via, pathAttempts: r.pathAttempts },
      };
    },
  }),

  defineTool({
    name: "text_write_png",
    title: "Write text as PNG image (not editable)",
    description:
      "Places a transparent PNG of the text (raster — not Type Tool). Safety net when Text Bridge is unavailable.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      atTicks: ticks,
      text: z.string(),
      subtitle: z.string().optional(),
      style: z.enum(["title", "lower_third", "caption"]).optional().default("title"),
      fontSize: z.number().int().optional(),
      colorHex: z.string().optional(),
      bar: z.boolean().optional(),
    },
    handler: async (p, ctx) => {
      const pngText = p.subtitle ? `${p.text}\n${p.subtitle}` : p.text;
      const r = await placeText(ctx, {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        text: p.text,
        subtitle: p.subtitle,
        style: p.style || "title",
        preferPng: true,
        fontSize: p.fontSize,
        colorHex: p.colorHex,
        bar: p.bar,
      });
      return {
        text: r.userMessage || `PNG text "${pngText.replace(/\n/g, " / ")}" (raster — not editable).`,
        data: { ...r.data, via: "png", editable: false },
      };
    },
  }),

  defineTool({
    name: "text_set_content_legacy",
    title: "Set MOGRT text via ExtendScript bridge",
    description:
      "Write text on an existing timeline graphic using the optional CEP ExtendScript bridge (legacy.mogrt.setText). Requires Window > PPMCP Text Bridge connected. Prefer AE-authored MOGRTs. Optional subtitle for second capsule field; or use text with a newline.",
    inputSchema: {
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
      text: z.string(),
      subtitle: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const status = await ctx.relay.getStatus();
      if (!status.legacyBridgeConnected) {
        return {
          text: "Legacy text bridge not connected. Install with legacy-bridge/install-dev.ps1, restart Premiere, open Window > PPMCP Text Bridge.",
          data: { ok: false, legacyBridgeConnected: false },
        };
      }
      const data = await ctx.relay.call("legacy.mogrt.setText", p);
      return { text: `Set text via ExtendScript on V${p.trackIndex} clip ${p.clipIndex}.`, data };
    },
  }),

  defineTool({
    name: "text_get_content_legacy",
    title: "Read MOGRT text via ExtendScript bridge",
    description:
      "Read text from an existing AE/MOGRT graphic via the optional CEP bridge. Requires PPMCP Text Bridge panel connected.",
    inputSchema: {
      trackIndex: z.number().int(),
      clipIndex: z.number().int(),
    },
    handler: async (p, ctx) => {
      const status = await ctx.relay.getStatus();
      if (!status.legacyBridgeConnected) {
        return {
          text: "Legacy text bridge not connected.",
          data: { ok: false, legacyBridgeConnected: false },
        };
      }
      const data = await ctx.relay.call("legacy.mogrt.getText", p);
      return { text: `Read text via ExtendScript: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "text_add",
    title: "Add text on screen",
    description:
      "Alias of resilient text_write multi-path engine (UXP → hybrid → CEP → PNG). Prefer text_write for explicit options.",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      atTicks: ticks,
      durationTicks: ticks.optional().describe("Optional out-trim when editable path succeeds."),
      text: z.string(),
      style: z
        .enum(["title", "lower_third", "caption"])
        .optional()
        .default("title"),
      fontSize: z.number().int().optional(),
      colorHex: z.string().optional(),
    },
    handler: async (p, ctx) => {
      const r = await placeText(ctx, {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        text: p.text,
        style: p.style || "title",
        fontSize: p.fontSize,
        colorHex: p.colorHex,
        verify: true,
      });
      if (r.ok && r.editable && p.durationTicks) {
        const trackIndex = (r.data.trackIndex as number) ?? p.trackIndex;
        const clipIndex = (r.data.clipIndex as number) ?? 0;
        await optionalPostPlace(ctx, {
          sequenceId: p.sequenceId,
          trackIndex,
          clipIndex,
          durationTicks: p.durationTicks,
          atTicks: p.atTicks,
        });
      }
      return {
        text: r.userMessage,
        data: {
          ...r.data,
          editable: r.editable,
          quality: r.quality,
          via: r.via,
          pathAttempts: r.pathAttempts,
          recovery: r.recovery,
        },
      };
    },
  }),

  defineTool({
    name: "text_set_content",
    title: "Edit text content",
    description:
      "Change text on an existing graphic. Tries CEP (editable AE Capsule) first, then UXP. Prefer AE MOGRTs.",
    inputSchema: { ...clipRef, text: z.string(), subtitle: z.string().optional() },
    handler: async (p, ctx) => {
      const attempts: string[] = [];
      const status = await ctx.relay.getStatus();
      if (status.legacyBridgeConnected) {
        try {
          const data = await ctx.relay.call("legacy.mogrt.setText", {
            trackIndex: p.trackIndex,
            clipIndex: p.clipIndex,
            text: p.text,
            subtitle: p.subtitle,
          });
          return {
            text: `Text updated to "${p.text}" via CEP.`,
            data: { data, via: "cep", editable: true },
          };
        } catch (e) {
          attempts.push(`CEP: ${e instanceof Error ? e.message : e}`);
        }
      } else {
        attempts.push("CEP: bridge not connected");
      }
      try {
        const data = await ctx.relay.call("title.setText", p);
        return { text: `Text updated to "${p.text}" via UXP.`, data: { data, via: "uxp" } };
      } catch (e) {
        attempts.push(`UXP: ${e instanceof Error ? e.message : e}`);
        return {
          text: `Could not set text. ${attempts.join(" | ")}`,
          data: {
            ok: false,
            attempts,
            recovery: "Use AE Basic Text MOGRT + Text Bridge; PNG cannot be re-edited as text.",
          },
        };
      }
    },
  }),

  defineTool({
    name: "text_get_content",
    title: "Read text content",
    description: "Read text from a graphic. Prefers CEP read (reliable for AE Capsule), then UXP.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const status = await ctx.relay.getStatus();
      if (status.legacyBridgeConnected) {
        try {
          const data = await ctx.relay.call("legacy.mogrt.getText", {
            trackIndex: p.trackIndex,
            clipIndex: p.clipIndex,
          });
          return { text: `Text (CEP): ${JSON.stringify(data)}`, data: { data, via: "cep" } };
        } catch {
          /* fall through */
        }
      }
      const data = await ctx.relay.call("title.getText", p);
      return { text: `Text content: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "text_set_position",
    title: "Move text on screen",
    description: "Set the (x, y) screen position of a text graphic, in pixels from the top-left of the frame.",
    inputSchema: { ...clipRef, x: z.number(), y: z.number() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("title.setPosition", p);
      return { text: `Text position set to (${p.x}, ${p.y}).`, data };
    },
  }),

  defineTool({
    name: "shape_add",
    title: "Add a shape graphic",
    description:
      "Add a filled shape MOGRT (rectangle template). For a REC dot: fillColor red, width≈height (square reads as blob/dot), small size, position next to title, then effect_set_opacity with atTicks for blink. Colors should match the video palette (e.g. danger red for REC, brand accent for lower-thirds plates when not using composite text).",
    inputSchema: {
      sequenceId: z.string().optional(),
      trackIndex: z.number().int(),
      atTicks: ticks,
      durationTicks: ticks.optional().describe("Defaults to 5 seconds if omitted."),
      fillColor: z
        .object({
          r: z.number().min(0).max(255),
          g: z.number().min(0).max(255),
          b: z.number().min(0).max(255),
          a: z.number().min(0).max(255).optional().default(255),
        })
        .optional()
        .describe("RGBA 0–255. REC blink → r:220 g:20 b:20."),
      width: z.number().positive().optional().describe("Optional immediate size (px). Square for round-ish dot."),
      height: z.number().positive().optional(),
      x: z.number().optional().describe("Optional Motion X 0–1 after insert."),
      y: z.number().optional().describe("Optional Motion Y 0–1 after insert."),
    },
    handler: async (p, ctx) => {
      const insertData = (await ctx.relay.call("title.insertMogrt", {
        sequenceId: p.sequenceId,
        trackIndex: p.trackIndex,
        atTicks: p.atTicks,
        durationTicks: p.durationTicks,
        template: "basic-shape",
      })) as { trackIndex: number; clipIndex: number };
      const ref = {
        sequenceId: p.sequenceId,
        trackIndex: insertData.trackIndex,
        clipIndex: insertData.clipIndex,
      };
      if (p.fillColor) {
        await ctx.relay.call("shape.setFillColor", { ...ref, ...p.fillColor });
      }
      if (p.width && p.height) {
        try {
          await ctx.relay.call("shape.setSize", { ...ref, width: p.width, height: p.height });
        } catch {
          const scale = ((p.width / 400 + p.height / 200) / 2) * 100;
          await ctx.relay.call("effect.setTransform", {
            ...ref,
            trackType: "video",
            scale,
          });
        }
      }
      if (p.x !== undefined || p.y !== undefined) {
        try {
          await ctx.relay.call("shape.setPosition", {
            ...ref,
            x: p.x ?? 0.5,
            y: p.y ?? 0.5,
          });
        } catch {
          await ctx.relay.call("effect.setTransform", {
            ...ref,
            trackType: "video",
            x: p.x,
            y: p.y,
          });
        }
      }
      return {
        text: `Added shape V${insertData.trackIndex} clip ${insertData.clipIndex}${p.fillColor ? ` rgba(${p.fillColor.r},${p.fillColor.g},${p.fillColor.b})` : ""}.`,
        data: insertData,
      };
    },
  }),

  defineTool({
    name: "shape_set_position",
    title: "Move a shape",
    description: "Set the (x, y) screen position of a shape graphic, in pixels from the top-left of the frame.",
    inputSchema: { ...clipRef, x: z.number(), y: z.number() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("shape.setPosition", p);
      return { text: `Shape position set to (${p.x}, ${p.y}).`, data };
    },
  }),

  defineTool({
    name: "shape_set_size",
    title: "Resize a shape",
    description:
      "Set the width/height of a shape graphic in pixels. Prefers a Size master property; if missing, approximates via Motion Scale (% of design size 400x200).",
    inputSchema: { ...clipRef, width: z.number().positive(), height: z.number().positive() },
    handler: async (p, ctx) => {
      try {
        const data = await ctx.relay.call("shape.setSize", p);
        return { text: `Shape size set to ${p.width}x${p.height}.`, data };
      } catch (err) {
        // Fallback: Motion Scale (works on MOGRTs that expose Opacity/Motion/Vector Motion).
        const designW = 400;
        const designH = 200;
        const scale = ((p.width / designW + p.height / designH) / 2) * 100;
        const data = await ctx.relay.call("effect.setTransform", {
          sequenceId: p.sequenceId,
          trackType: "video",
          trackIndex: p.trackIndex,
          clipIndex: p.clipIndex,
          scale,
        });
        return {
          text: `Shape size approximated via Scale=${scale.toFixed(1)}% (Size master property unavailable: ${err instanceof Error ? err.message : err}).`,
          data: { width: p.width, height: p.height, scalePercent: scale, via: "effect.setTransform", shapeError: String(err) },
        };
      }
    },
  }),

  defineTool({
    name: "shape_set_fill_color",
    title: "Set shape fill color",
    description: "Set a shape graphic's fill color (0-255 RGBA).",
    inputSchema: {
      ...clipRef,
      r: z.number().min(0).max(255),
      g: z.number().min(0).max(255),
      b: z.number().min(0).max(255),
      a: z.number().min(0).max(255).optional().default(255),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("shape.setFillColor", p);
      return { text: `Shape fill color set to rgba(${p.r}, ${p.g}, ${p.b}, ${p.a}).`, data };
    },
  }),

  defineTool({
    name: "title_list_params",
    title: "List graphic clip parameters",
    description:
      "List component/master properties on a timeline graphic (text or shape) clip. Use to see which MOGRT params are actually exposed.",
    inputSchema: clipRef,
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("title.listParams", p);
      return { text: `Graphic params: ${JSON.stringify(data)}`, data };
    },
  }),
];

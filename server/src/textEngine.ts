/**
 * Resilient multi-path text engine — Type Tool–like quality with minimal fragility.
 *
 * Research (live + Adobe/docs, 2026):
 * ──────────────────────────────────
 * 1. NO UXP "Type Tool" API — Premiere does not expose create-text-layer /
 *    Essential Graphics Type Tool via @adobe/premierepro UXP.
 * 2. UXP ComponentParam.createKeyframe(string) throws "Illegal Parameter type"
 *    even though types list `string`. Same gap for SimpleText Content.
 *    Position/Color on the same Graphic Parameters component work fine.
 * 3. AE-authored MOGRTs (AE.ADBE Capsule) are writable via ExtendScript:
 *    getValue() → JSON.parse → textEditValue + fontTextRunLength → setValue(json, true).
 *    Adobe bundled Basic Title (AE.ADBE Text) is NOT reliable for ES write.
 * 4. CEP panel + evalScript is the practical "editable text" path until Adobe
 *    fixes UXP string ComponentParams. CEP itself is on a deprecation runway —
 *    keep PNG as permanent safety net.
 * 5. PNG always works (import + overwrite) but is raster, not Type Tool quality.
 *
 * Path priority (quality → reliability):
 *   A) UXP setText after UXP insert     — editable, zero CEP (rare success)
 *   B) Hybrid: UXP insert + CEP setText — editable, less fragile than full ES insert
 *   C) CEP insertAndSetText (importMGT) — editable Type Tool–like (primary today)
 *   D) PNG raster fallback              — always-on safety net
 *
 * Fragility reduction:
 *   - Preflight: mogrt on disk, bridge status, sequence active
 *   - Retries with backoff (insert race, evalScript flakiness)
 *   - Optional read-back verify (CEP getText)
 *   - Structured pathAttempts log (no silent thrash for agents)
 *   - PNG never abandoned — last resort always available
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  resolveExistingAeTextMogrt,
  resolveLowerThirdMogrt,
  resolvePlainTextMogrt,
} from "./aeMogrtPaths.js";
import type { ToolContext } from "./toolDefinition.js";
import { formatRelayError } from "./toolDefinition.js";

export type TextStyleKey = "title" | "lower_third" | "caption" | "title_center" | "end_card";
/** Where to put graphics — corners by default, center only when intentional. */
export type TextAnchor =
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "lower_third"
  | "caption"
  | "center"
  | "auto";
export type TextAppearance = "plain" | "template";

export type TextQuality = "editable-uxp" | "editable-cep" | "raster-png" | "failed";

export type TextLayoutPreset = {
  x: number;
  y: number;
  scale: number;
  plateScale: number;
  label: string;
  /** PNG fallback region */
  pngPosition: "center" | "lower_third" | "top" | "bottom";
};

/**
 * Broadcast-style safe anchors (Motion 0–1).
 * Title ≠ dead-center by default (that looks amateur on gameplay/B-roll).
 * Center only via style title_center / end_card / anchor:center.
 */
export const ANCHOR_LAYOUTS: Record<Exclude<TextAnchor, "auto">, TextLayoutPreset> = {
  top_left: {
    x: 0.22,
    y: 0.16,
    scale: 170,
    plateScale: 95,
    label: "top-left safe",
    pngPosition: "top",
  },
  top_right: {
    x: 0.78,
    y: 0.16,
    scale: 170,
    plateScale: 95,
    label: "top-right safe",
    pngPosition: "top",
  },
  bottom_left: {
    x: 0.24,
    y: 0.82,
    scale: 150,
    plateScale: 90,
    label: "bottom-left / name tag",
    pngPosition: "lower_third",
  },
  bottom_right: {
    x: 0.76,
    y: 0.82,
    scale: 150,
    plateScale: 90,
    label: "bottom-right",
    pngPosition: "lower_third",
  },
  lower_third: {
    x: 0.28,
    y: 0.8,
    scale: 155,
    plateScale: 100,
    label: "classic lower-third left",
    pngPosition: "lower_third",
  },
  caption: {
    x: 0.5,
    y: 0.9,
    scale: 125,
    plateScale: 110,
    label: "caption bottom-center safe",
    pngPosition: "bottom",
  },
  center: {
    x: 0.5,
    y: 0.48,
    scale: 200,
    plateScale: 140,
    label: "center title card only",
    pngPosition: "center",
  },
};

/** Map style → default anchor (auto). */
export function resolveTextLayout(
  style: TextStyleKey | undefined,
  anchor?: TextAnchor,
): TextLayoutPreset & { anchor: string; style: TextStyleKey } {
  const s: TextStyleKey = style || "title";
  let a: Exclude<TextAnchor, "auto">;
  if (anchor && anchor !== "auto") {
    a = anchor;
  } else {
    switch (s) {
      case "title_center":
      case "end_card":
        a = "center";
        break;
      case "lower_third":
        a = "lower_third";
        break;
      case "caption":
        a = "caption";
        break;
      case "title":
      default:
        // Main titles sit top-left — not middle of frame
        a = "top_left";
        break;
    }
  }
  const layout = ANCHOR_LAYOUTS[a];
  return { ...layout, anchor: a, style: s };
}

/** @deprecated use resolveTextLayout — kept for imports */
export const TEXT_LAYOUTS = {
  title: ANCHOR_LAYOUTS.top_left,
  lower_third: ANCHOR_LAYOUTS.lower_third,
  caption: ANCHOR_LAYOUTS.caption,
  title_center: ANCHOR_LAYOUTS.center,
  end_card: ANCHOR_LAYOUTS.center,
};

export type PlaceTextOptions = {
  sequenceId?: string;
  trackIndex: number;
  atTicks: string;
  text: string;
  subtitle?: string;
  style?: TextStyleKey;
  /** Corner/safe placement. auto = derived from style. Prefer corners. */
  anchor?: TextAnchor;
  appearance?: TextAppearance;
  mogrtPath?: string;
  preferPng?: boolean;
  skipCep?: boolean;
  skipUxp?: boolean;
  verify?: boolean;
  fontSize?: number;
  colorHex?: string;
  /** Plate fill #RRGGBB (PNG composite). Default black. */
  barColorHex?: string;
  /** Plate opacity 0–255 (PNG). Default ~180–185. */
  barAlpha?: number;
  bar?: boolean;
  retries?: number;
  requireEditable?: boolean;
  applyLayout?: boolean;
  /** Dark plate under text, same anchor (default true) */
  withBackground?: boolean;
  /** Soft opacity fade-in (~0.5s). Default true. */
  soften?: boolean;
  x?: number;
  y?: number;
  scale?: number;
  /** Bake red REC circle into title PNG (right of text). */
  recDot?: boolean;
  /** Also place a separate blinking red REC layer (opacity keyframes). */
  recBlink?: boolean;
};

export type PlaceTextResult = {
  ok: boolean;
  editable: boolean;
  quality: TextQuality;
  via: string;
  text: string;
  data: Record<string, unknown>;
  pathAttempts: Array<{ path: string; ok: boolean; error?: string; ms?: number }>;
  recovery?: string;
  userMessage: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const SOFT_FADE_IN_TICKS = "127008000000"; // ~0.5s

/** Soft opacity fade-in on a video clip (readable, not abrupt). */
export async function softenGraphic(
  ctx: ToolContext,
  opts: {
    sequenceId?: string;
    trackIndex: number;
    clipIndex: number;
    fadeInTicks?: string;
  },
): Promise<Record<string, unknown>> {
  try {
    const { workflowTools } = await import("./tools/workflow.js");
    const fade = workflowTools.find((t) => t.name === "workflow_fade_clip");
    if (!fade) return { ok: false, error: "fade tool missing" };
    await fade.handler(
      {
        sequenceId: opts.sequenceId,
        trackIndex: opts.trackIndex,
        clipIndex: opts.clipIndex,
        doFadeIn: true,
        doFadeOut: false,
        fadeInTicks: opts.fadeInTicks || SOFT_FADE_IN_TICKS,
      } as never,
      ctx,
    );
    return { ok: true, fadeIn: opts.fadeInTicks || SOFT_FADE_IN_TICKS };
  } catch (e) {
    return { ok: false, error: formatRelayError(e) };
  }
}

/**
 * Motion layout for text — corners/safe zones by default.
 * Never Graphic Parameters pixel space.
 */
export async function applyTextLayout(
  ctx: ToolContext,
  opts: {
    sequenceId?: string;
    trackIndex: number;
    clipIndex: number;
    style?: TextStyleKey;
    anchor?: TextAnchor;
    x?: number;
    y?: number;
    scale?: number;
    soften?: boolean;
  },
): Promise<Record<string, unknown>> {
  const layout = resolveTextLayout(opts.style, opts.anchor);
  const x = opts.x !== undefined ? opts.x : layout.x;
  const y = opts.y !== undefined ? opts.y : layout.y;
  const rawScale = opts.scale !== undefined ? opts.scale : layout.scale;
  const scale = Math.max(110, Number(rawScale) || layout.scale);
  try {
    const data = await ctx.relay.call("effect.setTransform", {
      sequenceId: opts.sequenceId,
      trackType: "video",
      trackIndex: opts.trackIndex,
      clipIndex: opts.clipIndex,
      x,
      y,
      scale,
    });
    let soft: Record<string, unknown> | undefined;
    if (opts.soften !== false) {
      soft = await softenGraphic(ctx, {
        sequenceId: opts.sequenceId,
        trackIndex: opts.trackIndex,
        clipIndex: opts.clipIndex,
      });
    }
    return { ok: true, x, y, scale, layout: layout.label, anchor: layout.anchor, soft, data };
  } catch (e) {
    try {
      const data = await ctx.relay.call("title.setPosition", {
        sequenceId: opts.sequenceId,
        trackIndex: opts.trackIndex,
        clipIndex: opts.clipIndex,
        x,
        y,
      });
      try {
        await ctx.relay.call("effect.setTransform", {
          sequenceId: opts.sequenceId,
          trackType: "video",
          trackIndex: opts.trackIndex,
          clipIndex: opts.clipIndex,
          scale,
        });
      } catch {
        /* optional */
      }
      return { ok: true, x, y, scale, via: "title.setPosition", anchor: layout.anchor, data };
    } catch (e2) {
      return {
        ok: false,
        error: formatRelayError(e2),
        firstError: formatRelayError(e),
      };
    }
  }
}

/**
 * Estimate plate size in 1920×1080 px from text + scale so the bar fits the words.
 */
export function estimatePlatePixels(
  text: string,
  layout: TextLayoutPreset,
): { w: number; h: number; cx: number; cy: number } {
  const lines = String(text || " ").split(/\n/).filter(Boolean);
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  // Approx glyph width scales with Motion scale (template baseline ~48px @100%)
  const glyph = (layout.scale / 100) * 28;
  const padX = 48;
  const padY = 28;
  const w = Math.min(1700, Math.max(220, Math.round(longest * glyph + padX * 2)));
  const h = Math.min(360, Math.max(56, Math.round(lines.length * glyph * 1.25 + padY * 2)));
  const cx = Math.round(layout.x * 1920);
  const cy = Math.round(layout.y * 1080);
  return { w, h, cx, cy };
}

/** Full-frame transparent PNG with a rounded dark plate centered on anchor. Guaranteed visible. */
export function writeAlignedPlatePng(
  text: string,
  layout: TextLayoutPreset,
  alpha = 170,
): string {
  const { w, h, cx, cy } = estimatePlatePixels(text, layout);
  const file = path.join(os.tmpdir(), `ppmcp-plate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
  const left = Math.max(0, cx - Math.floor(w / 2));
  const top = Math.max(0, cy - Math.floor(h / 2));
  const radius = Math.min(18, Math.floor(h / 3));
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(${alpha}, 0, 0, 0))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = ${radius}
$x = ${left}; $y = ${top}; $w = ${w}; $h = ${h}
$path.AddArc($x, $y, $r*2, $r*2, 180, 90)
$path.AddArc($x+$w-$r*2, $y, $r*2, $r*2, 270, 90)
$path.AddArc($x+$w-$r*2, $y+$h-$r*2, $r*2, $r*2, 0, 90)
$path.AddArc($x, $y+$h-$r*2, $r*2, $r*2, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)
$bmp.Save('${file.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $path.Dispose()
`;
  const scriptPath = path.join(os.tmpdir(), `ppmcp-plate-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, ps, "utf8");
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { timeout: 15000, windowsHide: true },
    );
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* */
    }
  }
  if (!fs.existsSync(file)) throw new Error("Plate PNG render failed");
  return file;
}

/**
 * Dark plate behind text — PNG plate (reliable color/size/opacity) aligned to
 * the same anchor as the text. Shape MOGRT is too unreliable for fill/size.
 */
export async function placeTextBackground(
  ctx: ToolContext,
  opts: {
    sequenceId?: string;
    plateTrackIndex: number;
    atTicks: string;
    text?: string;
    style?: TextStyleKey;
    anchor?: TextAnchor;
    x?: number;
    y?: number;
    soften?: boolean;
  },
): Promise<Record<string, unknown>> {
  const layout = resolveTextLayout(opts.style, opts.anchor);
  const x = opts.x !== undefined ? opts.x : layout.x;
  const y = opts.y !== undefined ? opts.y : layout.y;
  const layoutForSize = { ...layout, x, y };
  try {
    const pngPath = writeAlignedPlatePng(opts.text || "Title", layoutForSize, 175);
    const place = await importAndOverwritePng(ctx, {
      sequenceId: opts.sequenceId,
      trackIndex: opts.plateTrackIndex,
      atTicks: opts.atTicks,
      pngPath,
    });
    // Full-frame PNG already has plate at correct pixels — keep Motion identity
    try {
      await ctx.relay.call("effect.setTransform", {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.plateTrackIndex,
        clipIndex: 0, // may be wrong if multiple — fix below
        x: 0.5,
        y: 0.5,
        scale: 100,
      });
    } catch {
      /* non-fatal */
    }
    // Resolve last clip on plate track
    let clipIndex = 0;
    try {
      const clips = (await ctx.relay.call("clip.list", {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.plateTrackIndex,
      })) as Array<{ clipIndex: number }>;
      if (clips.length) clipIndex = clips[clips.length - 1]!.clipIndex;
      await ctx.relay.call("effect.setTransform", {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.plateTrackIndex,
        clipIndex,
        x: 0.5,
        y: 0.5,
        scale: 100,
      });
    } catch {
      /* */
    }

    let soft: Record<string, unknown> | undefined;
    if (opts.soften !== false) {
      soft = await softenGraphic(ctx, {
        sequenceId: opts.sequenceId,
        trackIndex: opts.plateTrackIndex,
        clipIndex,
      });
    }

    const px = estimatePlatePixels(opts.text || "Title", layoutForSize);
    return {
      ok: true,
      via: "png-plate-aligned",
      place,
      clipIndex,
      x,
      y,
      platePixels: px,
      anchor: layout.anchor,
      layout: layout.label,
      soft,
      note: "Plate is full-frame PNG with rounded bar baked at text anchor — color/opacity/size guaranteed.",
    };
  } catch (e) {
    return { ok: false, error: formatRelayError(e) };
  }
}

/**
 * Auto-align: force text + plate to share the same anchor / scale design.
 * Call after placeText, or on existing clip pairs.
 */
export async function autoAlignTextDesign(
  ctx: ToolContext,
  opts: {
    sequenceId?: string;
    textTrackIndex: number;
    textClipIndex: number;
    plateTrackIndex?: number;
    plateClipIndex?: number;
    style?: TextStyleKey;
    anchor?: TextAnchor;
    text?: string;
    soften?: boolean;
  },
): Promise<Record<string, unknown>> {
  const layout = resolveTextLayout(opts.style, opts.anchor);
  const textLayout = await applyTextLayout(ctx, {
    sequenceId: opts.sequenceId,
    trackIndex: opts.textTrackIndex,
    clipIndex: opts.textClipIndex,
    style: opts.style,
    anchor: opts.anchor,
    soften: opts.soften,
  });

  let plate: Record<string, unknown> | undefined;
  if (opts.plateTrackIndex !== undefined && opts.plateClipIndex !== undefined) {
    // Existing plate: if PNG full-frame keep scale 100 at center; if shape, match x,y
    try {
      await ctx.relay.call("effect.setTransform", {
        sequenceId: opts.sequenceId,
        trackType: "video",
        trackIndex: opts.plateTrackIndex,
        clipIndex: opts.plateClipIndex,
        x: 0.5,
        y: 0.5,
        scale: 100,
      });
      try {
        await ctx.relay.call("shape.setFillColor", {
          sequenceId: opts.sequenceId,
          trackIndex: opts.plateTrackIndex,
          clipIndex: opts.plateClipIndex,
          r: 0,
          g: 0,
          b: 0,
          a: 200,
        });
      } catch {
        /* may be PNG plate */
      }
      try {
        await ctx.relay.call("effect.setOpacity", {
          sequenceId: opts.sequenceId,
          trackType: "video",
          trackIndex: opts.plateTrackIndex,
          clipIndex: opts.plateClipIndex,
          opacity: 75,
        });
      } catch {
        /* */
      }
      if (opts.soften !== false) {
        await softenGraphic(ctx, {
          sequenceId: opts.sequenceId,
          trackIndex: opts.plateTrackIndex,
          clipIndex: opts.plateClipIndex,
        });
      }
      plate = { ok: true, mode: "existing" };
    } catch (e) {
      plate = { ok: false, error: formatRelayError(e) };
    }
  }

  return {
    ok: !!textLayout.ok,
    text: textLayout,
    plate,
    design: layout,
    coordinates: {
      textMotion: { x: layout.x, y: layout.y, scale: layout.scale },
      plate: "full-frame PNG bar baked at same px center as text",
      note: "Models: use style/anchor enums, never invent pixel coords like 960,480",
    },
  };
}

function resolveMogrt(
  appearance: TextAppearance,
  override?: string,
): { path: string | null; source: string; tried: string[] } {
  if (override) {
    if (fs.existsSync(override)) return { path: override, source: "override", tried: [override] };
    return { path: null, source: "override-missing", tried: [override] };
  }
  if (appearance === "template") {
    const r = resolveLowerThirdMogrt();
    if (r.path) return { path: r.path, source: "lower-third", tried: r.tried };
  }
  const plain = resolvePlainTextMogrt();
  if (plain.path) return { path: plain.path, source: "basic-text", tried: plain.tried };
  const any = resolveExistingAeTextMogrt();
  return { path: any.path, source: any.path ? "any-ae" : "none", tried: [...plain.tried, ...any.tried] };
}

// ── PNG (safety net) ────────────────────────────────────────────────

export type PngTitleStyle = {
  fontSize?: number;
  position?: "center" | "lower_third" | "top" | "bottom";
  /** Normalized 0–1 center of the text block (overrides position) */
  nx?: number;
  ny?: number;
  /** Text fill color #RRGGBB */
  colorHex?: string;
  bar?: boolean;
  fontName?: string;
  /** Bar / plate alpha 0–255 (default ~185) */
  barAlpha?: number;
  /** Bar / plate fill #RRGGBB (default black 000000) */
  barColorHex?: string;
  /** Draw a solid red REC indicator to the right of the text (recording UI). */
  recDot?: boolean;
};

/**
 * Design card: text + rounded plate as ONE bitmap so bar and type share the
 * same center (no MOGRT/shape drift). Used for automatic readable titles.
 */
export function writeTextPng(text: string, style: PngTitleStyle = {}): string {
  const file = path.join(os.tmpdir(), `ppmcp-text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`);
  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/'/g, "''"));
  const fontSize = Math.max(18, Math.min(120, style.fontSize ?? 56));
  const fontName = (style.fontName || "Arial").replace(/'/g, "");
  const hex = (style.colorHex || "FFFFFF").replace(/^#/, "").padStart(6, "0").slice(0, 6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const tr = Number.isFinite(r) ? r : 255;
  const tg = Number.isFinite(g) ? g : 255;
  const tb = Number.isFinite(b) ? b : 255;
  const barHex = (style.barColorHex || "000000").replace(/^#/, "").padStart(6, "0").slice(0, 6);
  const br = parseInt(barHex.slice(0, 2), 16);
  const bg = parseInt(barHex.slice(2, 4), 16);
  const bb = parseInt(barHex.slice(4, 6), 16);
  const barR = Number.isFinite(br) ? br : 0;
  const barG = Number.isFinite(bg) ? bg : 0;
  const barB = Number.isFinite(bb) ? bb : 0;
  const pos = style.position || "center";
  const yMap: Record<string, number> = {
    center: 0.48,
    lower_third: 0.8,
    top: 0.16,
    bottom: 0.9,
  };
  const nx = style.nx !== undefined ? style.nx : pos === "center" || pos === "bottom" ? 0.5 : 0.24;
  const ny = style.ny !== undefined ? style.ny : yMap[pos] ?? 0.48;
  const cx = Math.round(nx * 1920);
  const cy = Math.round(ny * 1080);
  const useBar = style.bar !== false;
  const barAlpha = Math.max(0, Math.min(255, style.barAlpha ?? 185));
  // Measure string widths in PowerShell so plate always fits full text
  const linesPs = lines.map((l) => l.replace(/"/g, '`"')).join("`,`");
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$font = New-Object System.Drawing.Font '${fontName}', ${fontSize}, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, ${tr}, ${tg}, ${tb}))
$shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, 0, 0, 0))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$lines = @("${linesPs}")
$maxW = 0
$lineH = [Math]::Ceiling($font.GetHeight($g) * 1.15)
foreach ($line in $lines) {
  $sz = $g.MeasureString($line, $font)
  if ($sz.Width -gt $maxW) { $maxW = $sz.Width }
}
$padX = [Math]::Max(36, ${fontSize} * 0.85)
$padY = [Math]::Max(20, ${fontSize} * 0.5)
$barW = [Math]::Min(1700, [Math]::Max(180, [Math]::Ceiling($maxW + $padX * 2)))
$barH = [Math]::Max(48, [Math]::Ceiling($lineH * $lines.Count + $padY * 2))
$cx = ${cx}; $cy = ${cy}
$barX = [Math]::Max(12, [Math]::Min(1920 - $barW - 12, $cx - [Math]::Floor($barW / 2)))
$barY = [Math]::Max(12, [Math]::Min(1080 - $barH - 12, $cy - [Math]::Floor($barH / 2)))
${
  useBar
    ? `
$barBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(${barAlpha}, ${barR}, ${barG}, ${barB}))
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$rad = [Math]::Min(18, [Math]::Floor($barH / 3))
$gp.AddArc($barX, $barY, $rad*2, $rad*2, 180, 90)
$gp.AddArc($barX+$barW-$rad*2, $barY, $rad*2, $rad*2, 270, 90)
$gp.AddArc($barX+$barW-$rad*2, $barY+$barH-$rad*2, $rad*2, $rad*2, 0, 90)
$gp.AddArc($barX, $barY+$barH-$rad*2, $rad*2, $rad*2, 90, 90)
$gp.CloseFigure()
$g.FillPath($barBrush, $gp)
$barBrush.Dispose(); $gp.Dispose()
`
    : ""
}
$i = 0
$textTop = $barY + [Math]::Floor(($barH - $lineH * $lines.Count) / 2)
foreach ($line in $lines) {
  $ly = $textTop + $i * $lineH
  $rect = New-Object System.Drawing.RectangleF $barX, $ly, $barW, ($lineH + 2)
  $g.DrawString($line, $font, $shadow, (New-Object System.Drawing.RectangleF ($barX+2), ($ly+2), $barW, ($lineH+2)), $sf)
  $g.DrawString($line, $font, $brush, $rect, $sf)
  $i++
}
${
  style.recDot
    ? `
# Red REC recording dot — right side of the title plate
$dotR = [Math]::Max(10, [Math]::Floor($barH * 0.22))
$dotCx = $barX + $barW - $padX - $dotR
$dotCy = $barY + [Math]::Floor($barH / 2)
$glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(100, 255, 40, 40))
$g.FillEllipse($glow, $dotCx-$dotR-5, $dotCy-$dotR-5, ($dotR+5)*2, ($dotR+5)*2)
$red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 230, 25, 25))
$g.FillEllipse($red, $dotCx-$dotR, $dotCy-$dotR, $dotR*2, $dotR*2)
$core = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 90, 90))
$g.FillEllipse($core, $dotCx-[int]($dotR*0.4), $dotCy-[int]($dotR*0.4), [int]($dotR*0.8), [int]($dotR*0.8))
$glow.Dispose(); $red.Dispose(); $core.Dispose()
`
    : ""
}
$bmp.Save('${file.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose(); $shadow.Dispose()
`;
  const scriptPath = path.join(os.tmpdir(), `ppmcp-render-text-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, ps, "utf8");
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { timeout: 15000, windowsHide: true },
    );
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
  if (!fs.existsSync(file)) {
    throw new Error("PNG text render failed — PowerShell System.Drawing did not write the file.");
  }
  return file;
}

type Item = { id: string; name: string; isBin?: boolean; children?: Item[] };

/**
 * Full-frame transparent PNG with a solid red REC indicator circle at (nx,ny).
 * Placed as its own clip so opacity can blink independently of the title card.
 */
export function writeRecDotPng(nx = 0.48, ny = 0.16, radiusPx = 16): string {
  const file = path.join(os.tmpdir(), `ppmcp-recdot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
  const cx = Math.round(Math.max(0, Math.min(1, nx)) * 1920);
  const cy = Math.round(Math.max(0, Math.min(1, ny)) * 1080);
  const r = Math.max(8, Math.min(40, radiusPx));
  const out = file.replace(/\\/g, "\\\\").replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
# soft outer glow
$glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 255, 40, 40))
$g.FillEllipse($glow, ${cx}-${r}-6, ${cy}-${r}-6, (${r}+6)*2, (${r}+6)*2)
# main red REC dot
$red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 220, 20, 20))
$g.FillEllipse($red, ${cx}-${r}, ${cy}-${r}, ${r}*2, ${r}*2)
# bright core
$core = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 80, 80))
$g.FillEllipse($core, ${cx}-[int](${r}*0.45), ${cy}-[int](${r}*0.45), [int](${r}*0.9), [int](${r}*0.9))
$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $glow.Dispose(); $red.Dispose(); $core.Dispose()
`;
  const scriptPath = path.join(os.tmpdir(), `ppmcp-recdot-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, ps, "utf8");
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { timeout: 15000, windowsHide: true },
    );
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* */
    }
  }
  if (!fs.existsSync(file)) throw new Error("REC dot PNG render failed");
  return file;
}

/**
 * Place red REC blinker to the right of a title (default top-left title row).
 * Opacity keyframes: bright → dim every ~periodSec for durationTicks.
 */
export async function placeRecBlink(
  ctx: ToolContext,
  opts: {
    sequenceId?: string;
    trackIndex: number;
    atTicks: string;
    durationTicks?: string;
    /** Normalized 0–1. Default right of top-left BACKROOMS REC card. */
    nx?: number;
    ny?: number;
    radiusPx?: number;
    /** Full blink cycle seconds (on+off). Default 0.9 */
    periodSec?: number;
  },
): Promise<Record<string, unknown>> {
  const nx = opts.nx ?? 0.5;
  const ny = opts.ny ?? 0.16;
  const pngPath = writeRecDotPng(nx, ny, opts.radiusPx ?? 15);
  const place = await importAndOverwritePng(ctx, {
    sequenceId: opts.sequenceId,
    trackIndex: opts.trackIndex,
    atTicks: opts.atTicks,
    pngPath,
  });

  // Resolve clip we just placed
  let clipIndex = 0;
  try {
    const clips = (await ctx.relay.call("clip.list", {
      sequenceId: opts.sequenceId,
      trackType: "video",
      trackIndex: opts.trackIndex,
    })) as Array<{ clipIndex: number; startTicks?: string }>;
    if (clips.length) {
      const target = BigInt(opts.atTicks || "0");
      let best = clips[clips.length - 1]!;
      let bestDist = 1n << 60n;
      for (const c of clips) {
        if (c.startTicks === undefined) continue;
        const d =
          BigInt(c.startTicks) > target
            ? BigInt(c.startTicks) - target
            : target - BigInt(c.startTicks);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      clipIndex = best.clipIndex;
    }
  } catch {
    /* 0 */
  }

  // Trim duration if requested
  const durationTicks = opts.durationTicks || "1143072000000"; // ~4.5s
  try {
    const start = BigInt(opts.atTicks || "0");
    const end = start + BigInt(durationTicks);
    await ctx.relay.call("clip.trim", {
      sequenceId: opts.sequenceId,
      trackType: "video",
      trackIndex: opts.trackIndex,
      clipIndex,
      endTicks: String(end),
    });
  } catch {
    /* optional */
  }

  // Blink opacity keyframes
  const periodSec = Math.max(0.3, opts.periodSec ?? 0.9);
  const halfTicks = BigInt(Math.round((periodSec / 2) * 254016000000));
  const start = BigInt(opts.atTicks || "0");
  const end = start + BigInt(durationTicks);
  let applied: Array<{ effectIndex: number; displayName: string }> = [];
  try {
    applied = (await ctx.relay.call("effect.listApplied", {
      sequenceId: opts.sequenceId,
      trackType: "video",
      trackIndex: opts.trackIndex,
      clipIndex,
    })) as Array<{ effectIndex: number; displayName: string }>;
  } catch {
    applied = [];
  }
  let opacityFx = applied.find((e) => /opacity/i.test(e.displayName || ""));
  if (!opacityFx) {
    // Opacity is usually built-in on graphics — try index 0 Param
    opacityFx = applied[0];
  }
  const keyframes: Array<{ at: string; value: number }> = [];
  if (opacityFx) {
    let t = start;
    let on = true;
    let guard = 0;
    while (t <= end && guard < 40) {
      keyframes.push({ at: String(t), value: on ? 100 : 8 });
      t += halfTicks;
      on = !on;
      guard++;
    }
    // ensure ends visible
    keyframes.push({ at: String(end), value: 100 });
    for (const kf of keyframes) {
      try {
        await ctx.relay.call("effect.setParam", {
          sequenceId: opts.sequenceId,
          trackType: "video",
          trackIndex: opts.trackIndex,
          clipIndex,
          effectIndex: opacityFx.effectIndex,
          paramName: "Opacity",
          value: kf.value,
          atTicks: kf.at,
        });
      } catch {
        try {
          await ctx.relay.call("effect.setOpacity", {
            sequenceId: opts.sequenceId,
            trackType: "video",
            trackIndex: opts.trackIndex,
            clipIndex,
            opacity: kf.value,
            atTicks: kf.at,
          });
        } catch {
          /* next */
        }
      }
    }
  }

  return {
    ...place,
    clipIndex,
    trackIndex: opts.trackIndex,
    recBlink: true,
    keyframes: keyframes.length,
    nx,
    ny,
    via: "rec-blink-dot",
  };
}

async function importAndOverwritePng(
  ctx: ToolContext,
  opts: { sequenceId?: string; trackIndex: number; atTicks: string; pngPath: string },
): Promise<Record<string, unknown>> {
  await ctx.relay.call("project.importMedia", { paths: [opts.pngPath] }, 60000);
  await sleep(450);
  const items = (await ctx.relay.call("project.listItems", { recursive: true }, 30000)) as Item[];
  const stem = path.basename(opts.pngPath).replace(/\.png$/i, "");
  const flat: Item[] = [];
  const walk = (arr: Item[] | undefined) => {
    for (const it of arr || []) {
      if (it.isBin) walk(it.children);
      else flat.push(it);
    }
  };
  walk(items);
  const media =
    flat.find((i) => i.name && i.name.includes(stem)) ||
    [...flat].reverse().find((i) => i.name && /\.png$/i.test(i.name));
  if (!media?.id) throw new Error("Imported PNG item not found in project.");
  const place = await ctx.relay.call("clip.overwrite", {
    sequenceId: opts.sequenceId,
    trackType: "video",
    trackIndex: opts.trackIndex,
    projectItemId: media.id,
    atTicks: opts.atTicks,
  });
  return { pngPath: opts.pngPath, mediaId: media.id, place, via: "png-overwrite" };
}

// ── Core pipeline ───────────────────────────────────────────────────

async function withRetries<T>(
  label: string,
  attempts: number,
  delaysMs: number[],
  fn: (attempt: number) => Promise<T>,
): Promise<{ ok: true; value: T; attempt: number } | { ok: false; error: string }> {
  let last = "unknown";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delaysMs[Math.min(i - 1, delaysMs.length - 1)] ?? 400);
    try {
      const value = await fn(i);
      return { ok: true, value, attempt: i + 1 };
    } catch (e) {
      last = formatRelayError(e);
    }
  }
  return { ok: false, error: `${label}: ${last}` };
}

/**
 * Place text with multi-path resilience.
 * Prefer editable (UXP → hybrid → CEP); always keep PNG as safety net.
 */
export async function placeText(ctx: ToolContext, opts: PlaceTextOptions): Promise<PlaceTextResult> {
  const pathAttempts: PlaceTextResult["pathAttempts"] = [];
  const styleKey = opts.style || "title";
  const layoutPlan = resolveTextLayout(styleKey, opts.anchor);
  const appearance: TextAppearance =
    opts.appearance ?? (styleKey === "lower_third" ? "template" : "plain");
  const pngText = opts.subtitle ? `${opts.text}\n${opts.subtitle}` : opts.text;
  const retries = Math.max(1, Math.min(4, opts.retries ?? 2));
  const delays = [350, 700, 1200];
  // withBackground:false → plain text only (no dark plate, no composite bar)
  const wantBg = opts.withBackground === true || (opts.withBackground !== false && opts.preferPng !== true);
  // Explicit false always wins
  const plainTextOnly = opts.withBackground === false;
  const useBg = plainTextOnly ? false : wantBg;
  const wantSoft = opts.soften !== false;

  // Plate under text: lower track. V0 request → plate V0, text V1.
  let textTrack = opts.trackIndex;
  let plateTrack = Math.max(0, opts.trackIndex - 1);
  if (useBg && opts.trackIndex <= 0) {
    plateTrack = 0;
    textTrack = 1;
  } else if (useBg) {
    plateTrack = opts.trackIndex - 1;
    textTrack = opts.trackIndex;
  }

  const fail = (userMessage: string, recovery?: string): PlaceTextResult => ({
    ok: false,
    editable: false,
    quality: "failed",
    via: "failed",
    text: opts.text,
    data: { pathAttempts },
    pathAttempts,
    recovery,
    userMessage,
  });

  // Preflight sequence
  if (opts.sequenceId) {
    try {
      await ctx.relay.call("sequence.setActive", { sequenceId: opts.sequenceId });
    } catch {
      /* non-fatal */
    }
  }

  // ── PNG path: composite card OR plain text (no bar) ──────────────
  // withBackground:false → plain glyphs only (no dark plate).
  // preferPng forces PNG; otherwise composite when background wanted.
  const preferEditable = opts.requireEditable === true || (opts as { preferEditable?: boolean }).preferEditable === true;
  if (opts.preferPng || (useBg && !preferEditable) || plainTextOnly) {
    return placePngPath(
      ctx,
      {
        ...opts,
        trackIndex: textTrack,
        withBackground: useBg,
        bar: useBg && opts.bar !== false,
        fontSize:
          opts.fontSize ??
          (layoutPlan.anchor === "center" ? 72 : layoutPlan.anchor === "caption" ? 42 : 54),
      },
      pngText,
      styleKey,
      pathAttempts,
      plainTextOnly
        ? "plain-text-no-plate"
        : useBg && !opts.preferPng
          ? "designed-composite-card"
          : "preferPng:true",
      layoutPlan,
    );
  }

  // Editable path only (no composite): optional separate plate under MOGRT
  let background: Record<string, unknown> | undefined;
  if (useBg) {
    background = await placeTextBackground(ctx, {
      sequenceId: opts.sequenceId,
      plateTrackIndex: plateTrack,
      atTicks: opts.atTicks,
      text: pngText,
      style: styleKey,
      anchor: opts.anchor,
      x: opts.x,
      y: opts.y,
      soften: wantSoft,
    });
    pathAttempts.push({
      path: "bg:plate-under-editable",
      ok: !!background.ok,
      error: background.ok ? undefined : String(background.error || ""),
    });
  }

  let status: { pluginConnected?: boolean; legacyBridgeConnected?: boolean } = {};
  try {
    status = await ctx.relay.getStatus();
  } catch {
    status = {};
  }

  const mogrt = resolveMogrt(appearance, opts.mogrtPath);

  // ── Path A: UXP insert + UXP setText (Type Tool ideal — currently usually fails) ──
  if (!opts.skipUxp && status.pluginConnected && mogrt.path) {
    const t0 = Date.now();
    const uxp = await withRetries("uxp-full", retries, delays, async () => {
      const insert = (await ctx.relay.call(
        "title.insertMogrt",
        {
          sequenceId: opts.sequenceId,
          trackIndex: textTrack,
          atTicks: opts.atTicks,
          template: "basic-text",
        },
        60000,
      )) as { trackIndex: number; clipIndex: number };
      await sleep(300);
      const set = await ctx.relay.call(
        "title.setText",
        {
          sequenceId: opts.sequenceId,
          trackIndex: insert.trackIndex,
          clipIndex: insert.clipIndex,
          text: opts.text,
        },
        30000,
      );
      return { insert, set };
    });
    pathAttempts.push({
      path: "A:uxp-insert+setText",
      ok: uxp.ok,
      error: uxp.ok ? undefined : uxp.error,
      ms: Date.now() - t0,
    });
    if (uxp.ok) {
      const ins = uxp.value.insert;
      let layout: Record<string, unknown> | undefined;
      if (opts.applyLayout !== false) {
        layout = await applyTextLayout(ctx, {
          sequenceId: opts.sequenceId,
          trackIndex: ins.trackIndex,
          clipIndex: ins.clipIndex,
          style: styleKey,
          anchor: opts.anchor,
          x: opts.x,
          y: opts.y,
          scale: opts.scale,
          soften: wantSoft,
        });
      }
      return {
        ok: true,
        editable: true,
        quality: "editable-uxp",
        via: "uxp-mogrt",
        text: opts.text,
        data: {
          ...ins,
          set: uxp.value.set,
          mogrtPath: mogrt.path,
          appearance,
          layout,
          background,
          textTrack,
          plateTrack: wantBg ? plateTrack : undefined,
          design: layoutPlan,
          pathAttempts,
        },
        pathAttempts,
        userMessage: `Text "${opts.text}" @ ${layoutPlan.label}${wantBg ? " + plate" : ""}${wantSoft ? " + soft" : ""}.`,
      };
    }
  } else if (!status.pluginConnected) {
    pathAttempts.push({ path: "A:uxp-insert+setText", ok: false, error: "plugin not connected" });
  }

  // ── Path B: Hybrid UXP insert + CEP setText ──
  if (
    !opts.skipUxp &&
    !opts.skipCep &&
    status.pluginConnected &&
    status.legacyBridgeConnected &&
    mogrt.path
  ) {
    const t0 = Date.now();
    const hybrid = await withRetries("hybrid", retries, delays, async () => {
      const insert = (await ctx.relay.call(
        "title.insertMogrt",
        {
          sequenceId: opts.sequenceId,
          trackIndex: textTrack,
          atTicks: opts.atTicks,
          template: "basic-text",
        },
        60000,
      )) as { trackIndex: number; clipIndex: number };
      await sleep(400);
      const set = await ctx.relay.call(
        "legacy.mogrt.setText",
        {
          trackIndex: insert.trackIndex,
          clipIndex: insert.clipIndex,
          text: opts.text,
          subtitle: opts.subtitle,
        },
        30000,
      );
      return { insert, set };
    });
    pathAttempts.push({
      path: "B:uxp-insert+cep-setText",
      ok: hybrid.ok,
      error: hybrid.ok ? undefined : hybrid.error,
      ms: Date.now() - t0,
    });
    if (hybrid.ok) {
      let verified: unknown = null;
      if (opts.verify !== false) {
        try {
          verified = await ctx.relay.call(
            "legacy.mogrt.getText",
            {
              trackIndex: hybrid.value.insert.trackIndex,
              clipIndex: hybrid.value.insert.clipIndex,
            },
            15000,
          );
        } catch {
          /* verify soft */
        }
      }
      let layout: Record<string, unknown> | undefined;
      if (opts.applyLayout !== false) {
        layout = await applyTextLayout(ctx, {
          sequenceId: opts.sequenceId,
          trackIndex: hybrid.value.insert.trackIndex,
          clipIndex: hybrid.value.insert.clipIndex,
          style: styleKey,
          anchor: opts.anchor,
          x: opts.x,
          y: opts.y,
          scale: opts.scale,
          soften: wantSoft,
        });
      }
      return {
        ok: true,
        editable: true,
        quality: "editable-cep",
        via: "hybrid-uxp-insert-cep-write",
        text: opts.text,
        data: {
          ...hybrid.value.insert,
          set: hybrid.value.set,
          verified,
          appearance,
          layout,
          background,
          textTrack,
          plateTrack: wantBg ? plateTrack : undefined,
          design: layoutPlan,
          pathAttempts,
        },
        pathAttempts,
        userMessage: `Text "${opts.text}" @ ${layoutPlan.label}${wantBg ? " + plate" : ""}${wantSoft ? " + soft" : ""} (hybrid).`,
      };
    }
  }

  // ── Path C: Full CEP importMGT + setText (primary editable path today) ──
  if (!opts.skipCep && status.legacyBridgeConnected && mogrt.path) {
    const t0 = Date.now();
    const cep = await withRetries("cep-full", retries + 1, [400, 800, 1500], async () => {
      const data = await ctx.relay.call(
        "legacy.mogrt.insertAndSetText",
        {
          mogrtPath: mogrt.path,
          trackIndex: textTrack,
          atTicks: opts.atTicks,
          text: opts.text,
          subtitle: opts.subtitle,
          audioTrackIndex: 0,
        },
        90000,
      );
      return data as {
        trackIndex?: number;
        clipIndex?: number;
        write?: unknown;
      };
    });
    pathAttempts.push({
      path: "C:cep-importMGT+setText",
      ok: cep.ok,
      error: cep.ok ? undefined : cep.error,
      ms: Date.now() - t0,
    });
    if (cep.ok) {
      let verified: unknown = null;
      let verifyOk = true;
      if (opts.verify !== false && cep.value.trackIndex !== undefined && cep.value.clipIndex !== undefined) {
        try {
          await sleep(200);
          verified = await ctx.relay.call(
            "legacy.mogrt.getText",
            {
              trackIndex: cep.value.trackIndex,
              clipIndex: cep.value.clipIndex,
            },
            15000,
          );
          const vt = (verified as { text?: string })?.text;
          if (vt !== undefined && vt !== null && String(vt) !== opts.text && !String(vt).includes(opts.text.slice(0, 20))) {
            // Soft mismatch — re-write once
            try {
              await ctx.relay.call(
                "legacy.mogrt.setText",
                {
                  trackIndex: cep.value.trackIndex,
                  clipIndex: cep.value.clipIndex,
                  text: opts.text,
                  subtitle: opts.subtitle,
                },
                30000,
              );
              verified = await ctx.relay.call(
                "legacy.mogrt.getText",
                {
                  trackIndex: cep.value.trackIndex,
                  clipIndex: cep.value.clipIndex,
                },
                15000,
              );
            } catch {
              verifyOk = false;
            }
          }
        } catch {
          /* verify soft — insert succeeded */
        }
      }
      const isPlain = /basic\s*text/i.test(mogrt.path || "") || appearance === "plain";
      let layout: Record<string, unknown> | undefined;
      if (
        opts.applyLayout !== false &&
        cep.value.trackIndex !== undefined &&
        cep.value.clipIndex !== undefined
      ) {
        layout = await applyTextLayout(ctx, {
          sequenceId: opts.sequenceId,
          trackIndex: cep.value.trackIndex,
          clipIndex: cep.value.clipIndex,
          style: styleKey,
          anchor: opts.anchor,
          x: opts.x,
          y: opts.y,
          scale: opts.scale,
          soften: wantSoft,
        });
      }
      return {
        ok: true,
        editable: true,
        quality: "editable-cep",
        via: "extendscript-editable-mogrt",
        text: opts.text,
        data: {
          ...cep.value,
          mogrtPath: mogrt.path,
          mogrtSource: mogrt.source,
          appearance,
          verified,
          verifyOk,
          layout,
          background,
          textTrack,
          plateTrack: wantBg ? plateTrack : undefined,
          design: layoutPlan,
          pathAttempts,
          note: `Design: ${layoutPlan.label}; plate aligned; soft fade. Center only for title_center/end_card.`,
        },
        pathAttempts,
        userMessage: `Text "${opts.text}" @ ${layoutPlan.label}${wantBg ? " + plate" : ""}${wantSoft ? " + soft" : ""}.`,
      };
    }
  } else if (!status.legacyBridgeConnected) {
    pathAttempts.push({
      path: "C:cep-importMGT+setText",
      ok: false,
      error: "Text Bridge not connected (Window > PPMCP Text Bridge)",
    });
  } else if (!mogrt.path) {
    pathAttempts.push({
      path: "C:cep-importMGT+setText",
      ok: false,
      error: `No AE Basic Text.mogrt (tried: ${mogrt.tried.slice(0, 3).join("; ")})`,
    });
  }

  // ── Path D: PNG safety net (unless requireEditable) ──
  if (opts.requireEditable) {
    return fail(
      "Editable text failed on all paths (UXP/hybrid/CEP). PNG suppressed (requireEditable).",
      !status.legacyBridgeConnected
        ? "Open Window > PPMCP Text Bridge + ensure Basic Text.mogrt exists."
        : "Check Basic Text.mogrt (AE Capsule); retry; see pathAttempts.",
    );
  }
  return placePngPath(
    ctx,
    opts,
    pngText,
    styleKey,
    pathAttempts,
    !status.legacyBridgeConnected
      ? "Open Window > PPMCP Text Bridge for editable Type Tool–like text. PNG used as safety net."
      : "Editable paths failed; PNG safety net applied.",
  );
}

async function placePngPath(
  ctx: ToolContext,
  opts: PlaceTextOptions,
  pngText: string,
  styleKey: TextStyleKey,
  pathAttempts: PlaceTextResult["pathAttempts"],
  why: string,
  layoutPlan?: ReturnType<typeof resolveTextLayout>,
): Promise<PlaceTextResult> {
  const t0 = Date.now();
  const plan = layoutPlan || resolveTextLayout(styleKey, opts.anchor);
  try {
    const wantsRec =
      !!opts.recBlink ||
      !!opts.recDot ||
      (/\bREC\b/i.test(opts.text || "") && opts.withBackground !== false);
    // bar only when background plate requested (withBackground !== false)
    const wantBar = opts.withBackground !== false && opts.bar !== false;
    const pngPath = writeTextPng(pngText, {
      position: plan.pngPosition,
      nx: plan.x,
      ny: plan.y,
      fontSize: opts.fontSize ?? (plan.anchor === "center" ? 72 : plan.anchor === "caption" ? 42 : 54),
      colorHex: opts.colorHex || "FFFFFF",
      bar: wantBar,
      barAlpha: opts.barAlpha ?? 180,
      barColorHex: opts.barColorHex || "000000",
      recDot: wantsRec && wantBar,
    });
    const data = await importAndOverwritePng(ctx, {
      sequenceId: opts.sequenceId,
      trackIndex: opts.trackIndex,
      atTicks: opts.atTicks,
      pngPath,
    });
    pathAttempts.push({ path: "D:png-raster", ok: true, ms: Date.now() - t0 });
    return {
      ok: true,
      editable: false,
      quality: "raster-png",
      via: "png-fallback",
      text: opts.text,
      data: { ...data, why, pathAttempts, editable: false },
      pathAttempts,
      recovery:
        "For editable text: load UXP plugin + open Window > PPMCP Text Bridge + ensure plugin/templates/Basic Text.mogrt exists.",
      userMessage: `PNG still "${pngText.replace(/\n/g, " / ")}" (not editable). ${why}`,
    };
  } catch (e) {
    pathAttempts.push({
      path: "D:png-raster",
      ok: false,
      error: formatRelayError(e),
      ms: Date.now() - t0,
    });
    return {
      ok: false,
      editable: false,
      quality: "failed",
      via: "failed",
      text: opts.text,
      data: { pathAttempts },
      pathAttempts,
      recovery:
        "Check plugin connected, sequence active, track free, PowerShell available for PNG. Open Text Bridge for editable path.",
      userMessage: `All text paths failed. ${formatRelayError(e)}`,
    };
  }
}

/** Health report for agents — what text quality is available right now. */
export async function textSystemHealth(ctx: ToolContext): Promise<{
  plugin: boolean;
  textBridge: boolean;
  plainMogrt: string | null;
  lowerThirdMogrt: string | null;
  recommendedPath: string;
  qualityAvailable: TextQuality;
  tips: string[];
}> {
  let plugin = false;
  let textBridge = false;
  try {
    const s = await ctx.relay.getStatus();
    plugin = !!s.pluginConnected;
    textBridge = !!s.legacyBridgeConnected;
  } catch {
    /* offline */
  }
  const plain = resolvePlainTextMogrt().path;
  const lt = resolveLowerThirdMogrt().path;
  const tips: string[] = [];
  if (!plugin) tips.push("Load UXP plugin + start bridge :8265");
  if (!textBridge) tips.push("Open Window > PPMCP Text Bridge for editable AE text");
  if (!plain) tips.push("Bundle plugin/templates/Basic Text.mogrt (AE-authored Capsule)");
  let recommendedPath = "D:png";
  let qualityAvailable: TextQuality = "raster-png";
  if (textBridge && plain) {
    recommendedPath = "C:cep-importMGT (editable)";
    qualityAvailable = "editable-cep";
  } else if (plugin && plain) {
    recommendedPath = "A:uxp (usually blocked by string keyframe gap) → D:png";
    qualityAvailable = "raster-png";
    tips.push("UXP alone cannot write MOGRT string Text on current Premiere builds");
  }
  if (textBridge && plugin && plain) {
    recommendedPath = "B/C hybrid or CEP full (editable Type Tool–like)";
    qualityAvailable = "editable-cep";
  }
  return {
    plugin,
    textBridge,
    plainMogrt: plain,
    lowerThirdMogrt: lt,
    recommendedPath,
    qualityAvailable,
    tips,
  };
}

#!/usr/bin/env node
/**
 * Empty sequence + ad-style text (scale pulse) + floating random shapes.
 * Uses effect_set_transform atTicks keyframes (plugin must be reloaded for Motion kf).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const TPS = 254016000000n;
const sec = (s) => String(BigInt(Math.round(Number(s) * Number(TPS))));
const TOOL_GAP_MS = 240;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ad-motion", version: "1.0.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function call(name, args = {}, timeout = 180000) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    const t = textOf(r);
    if (r.isError && /RATE_LIMITED/i.test(t)) {
      const m = t.match(/retryAfterMs["\s:]+(\d+)/i) || t.match(/Wait (\d+)ms/i);
      await sleep(m ? Number(m[1]) + 50 : TOOL_GAP_MS * 2);
      continue;
    }
    console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 150).replace(/\s+/g, " ")}`);
    await sleep(TOOL_GAP_MS);
    return { ok: !r.isError, text: t, data: t };
  }
  return { ok: false, text: "rate limited" };
}

function parseJson(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) {
    try {
      return JSON.parse(f[1]);
    } catch {
      /* */
    }
  }
  return null;
}

const seqName = `Ad Motion ${Date.now()}`;
const DURATION = 12; // seconds of empty motion card
console.log("\n=== AD MOTION SEQUENCE ===\n", seqName);

await call("edit_bootstrap", { compact: true });
try {
  await call("checkpoint_create", { label: `pre-${seqName.slice(0, 16)}`, note: "ad motion" });
} catch {
  /* */
}

// Empty sequence (no media)
await call("sequence_create", {
  name: seqName,
  width: 1920,
  height: 1080,
  frameRate: 30,
});
await call("sequence_set_active_by_name", { query: seqName });

// Black-ish plate via large dark shape full frame as background (optional)
// Or solid color shape full screen
const bg = await call("shape_add", {
  trackIndex: 0,
  atTicks: sec(0),
  durationTicks: sec(DURATION),
  fillColor: { r: 12, g: 10, b: 28, a: 255 },
  width: 1920,
  height: 1080,
  x: 0.5,
  y: 0.5,
});
const bgData = parseJson(bg.text) || {};
console.log("bg", bgData);

// Ad-style titles with long duration for animation
const titles = [
  { text: "SALE", color: "FFE66D", at: 0.3, dur: 4.5, x: 0.5, y: 0.35 },
  { text: "NOW 50% OFF", color: "FFFFFF", at: 2.5, dur: 5.0, x: 0.5, y: 0.55 },
  { text: "SHOP TODAY", color: "7CE7FF", at: 5.5, dur: 5.5, x: 0.5, y: 0.72 },
];

const titleClips = [];
for (const t of titles) {
  const r = await call("text_write", {
    trackIndex: 2,
    atTicks: sec(t.at),
    text: t.text,
    style: "title_center",
    withBackground: false,
    colorHex: t.color,
    fontSize: 64,
    soften: false,
    preferPng: true,
    durationTicks: sec(t.dur),
  });
  const d = parseJson(r.text);
  // place returns track/clip in various shapes
  const trackIndex = d?.place?.trackIndex ?? d?.trackIndex ?? 2;
  const clipIndex = d?.place?.clipIndex ?? d?.clipIndex ?? titleClips.length;
  titleClips.push({ ...t, trackIndex, clipIndex, startSec: t.at });
  // force duration trim
  await call("clip_trim", {
    trackType: "video",
    trackIndex,
    clipIndex,
    edge: "out",
    newTicks: sec(t.at + t.dur),
  });
}

// List V2 to resolve real clip indices after all places
const v2 = parseJson((await call("clip_list", { trackType: "video", trackIndex: 2 })).text) || [];
console.log(
  "V2 clips",
  Array.isArray(v2) ? v2.map((c) => `${c.clipIndex}:${c.name?.slice(0, 30)}`) : v2,
);

// Animate each text: scale pulse (ad zoom)
async function scalePulse(trackIndex, clipIndex, startSec, dur) {
  // keyframes every 0.4s: 80 → 140 → 90 → 160 → 100
  const pattern = [70, 130, 85, 155, 95, 145, 100];
  const steps = pattern.length;
  for (let i = 0; i < steps; i++) {
    const t = startSec + (dur * i) / (steps - 1);
    await call("effect_set_transform", {
      trackType: "video",
      trackIndex,
      clipIndex,
      scale: pattern[i],
      x: 0.5,
      y: 0.5,
      atTicks: sec(t),
    });
  }
}

// Map title times to clip indices by start
const textClips = (Array.isArray(v2) ? v2 : []).filter((c) => /ppmcp-text|text/i.test(c.name || "") || true);
// Prefer all clips on V2 that aren't pure shape if we put shapes elsewhere
// We put texts on track 2 - list all
const allV2 = Array.isArray(v2) ? v2 : [];
for (let i = 0; i < Math.min(titles.length, allV2.length); i++) {
  const c = allV2[i];
  const startSec = Number(c.startTicks) / Number(TPS);
  const dur = Number(c.durationTicks) / Number(TPS);
  console.log(`Scale pulse text clip ${c.clipIndex} @${startSec.toFixed(1)}s`);
  await scalePulse(2, c.clipIndex, startSec, Math.min(dur, 4.5));
}

// Floating shapes on track 1 — random colors, wander + rotate + opacity pulse
const COLORS = [
  { r: 255, g: 80, b: 80 },
  { r: 80, g: 200, b: 255 },
  { r: 255, g: 200, b: 60 },
  { r: 160, g: 100, b: 255 },
  { r: 80, g: 255, b: 160 },
  { r: 255, g: 120, b: 200 },
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

const shapeSpecs = [];
for (let i = 0; i < 8; i++) {
  const col = COLORS[i % COLORS.length];
  const size = Math.round(rand(40, 140));
  const at = rand(0.1, 1.5);
  const dur = DURATION - at - 0.2;
  const r = await call("shape_add", {
    trackIndex: 1,
    atTicks: sec(at),
    durationTicks: sec(dur),
    fillColor: { ...col, a: 220 },
    width: size,
    height: size,
    x: rand(0.15, 0.85),
    y: rand(0.15, 0.85),
  });
  const d = parseJson(r.text);
  shapeSpecs.push({
    trackIndex: d?.trackIndex ?? 1,
    clipIndex: d?.clipIndex ?? i,
    at,
    dur,
    size,
  });
}

// Resolve shape clip indices from V1 list
const v1 = parseJson((await call("clip_list", { trackType: "video", trackIndex: 1 })).text) || [];
console.log("V1 shapes", Array.isArray(v1) ? v1.length : 0);

async function floatShape(trackIndex, clipIndex, startSec, dur) {
  // Wander path + rotation + scale wobble
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = startSec + (dur * i) / (n - 1);
    const x = 0.15 + 0.7 * (0.5 + 0.5 * Math.sin(i * 1.3 + clipIndex));
    const y = 0.15 + 0.7 * (0.5 + 0.5 * Math.cos(i * 0.9 + clipIndex * 0.7));
    const scale = 60 + 50 * Math.abs(Math.sin(i * 0.8 + clipIndex));
    const rot = (i * 25 + clipIndex * 17) % 360;
    await call("effect_set_transform", {
      trackType: "video",
      trackIndex,
      clipIndex,
      x,
      y,
      scale,
      rotation: rot,
      atTicks: sec(t),
    });
    // opacity pulse
    await call("effect_set_opacity", {
      trackType: "video",
      trackIndex,
      clipIndex,
      opacity: 40 + 55 * Math.abs(Math.sin(i * 0.7)),
      atTicks: sec(t),
    });
  }
}

const shapes = Array.isArray(v1) ? v1 : [];
for (const c of shapes) {
  const startSec = Number(c.startTicks) / Number(TPS);
  const dur = Number(c.durationTicks) / Number(TPS);
  console.log(`Float shape clip ${c.clipIndex}`);
  await floatShape(1, c.clipIndex, startSec, Math.max(2, dur - 0.2));
}

await call("edit_run", {
  stopOnError: false,
  compact: true,
  throttleMs: 100,
  plan: [
    { op: "marker", atSeconds: 0, name: "AD OPEN" },
    { op: "marker", atSeconds: 2.5, name: "OFFER" },
    { op: "marker", atSeconds: 5.5, name: "CTA" },
  ],
});

await call("edit_verify", { compact: true });
const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(1.5), outputPath: path.join(desk, "ppmcp-ad-open.png") });
await call("sequence_screenshot", { atTicks: sec(4), outputPath: path.join(desk, "ppmcp-ad-mid.png") });
await call("sequence_screenshot", { atTicks: sec(7), outputPath: path.join(desk, "ppmcp-ad-cta.png") });
await call("project_save", {});
try {
  await call("checkpoint_create", { label: `done-${seqName.slice(0, 14)}`, note: "ad motion done" });
} catch {
  /* */
}

console.log(`
=== AD MOTION DONE ===
Sequence: ${seqName}
Duration: ~${DURATION}s empty card
Text: SALE / NOW 50% OFF / SHOP TODAY — scale pulse keyframes
Shapes: ${shapes.length} floating on V1 (position/scale/rotation/opacity kf)
Desktop: ppmcp-ad-open / mid / cta.png

NOTE: Reload UXP plugin if Motion keyframes fail (effect.setTransform atTicks is new).
`);
await client.close();
process.exit(0);

#!/usr/bin/env node
/**
 * Backrooms rebuild — agent-correct patterns (see docs/AGENT_USAGE.md):
 * - NEW sequence, exact name
 * - text_write composite for titles
 * - REC = generic shape (red square≈dot) + opacity keyframes (not magic rec tool)
 * - SFX matched to scene + filename + scene-cuts
 * - quality_pass capped / skipped if unsafe
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const SRC = "C:\\Users\\cagan\\Desktop\\editsource\\_extracted";
const AUDIO = "C:\\Users\\cagan\\Desktop\\editsource\\audio";
const TPS = 254016000000;
const sec = (s) => String(BigInt(Math.round(Number(s) * TPS)));

const media = {
  blue: path.join(SRC, "intro_blue_3s.mp4"),
  static: path.join(SRC, "intro_static_2s.mp4"),
  tv001: path.join(SRC, "tv_f001.mp4"),
  tv010: path.join(SRC, "tv_f010.mp4"),
  tv015: path.join(SRC, "tv_f015.mp4"),
  vBack: path.join(SRC, "clip_backrooms_12s.mp4"),
  vPt2: path.join(SRC, "clip_pt2_10s.mp4"),
  vCaya: path.join(SRC, "clip_cayatur_10s.mp4"),
  tvOn: path.join(SRC, "tv_on.mp3"),
  electric: path.join(SRC, "electric_buzz.mp3"),
  switch: path.join(SRC, "rajatchoudhary-light-switch-on-sound-effect-354589.mp3"),
  whoosh1: path.join(SRC, "whoosh_01.wav"),
  whoosh2: path.join(SRC, "whoosh_03.wav"),
  whoosh3: path.join(SRC, "whoosh_05.wav"),
  whoosh4: path.join(SRC, "whoosh_07.wav"),
  impact: path.join(SRC, "recordx_media-impact-sound-effect-335395.mp3"),
  boom: path.join(SRC, "bom.wav"),
  bulb: path.join(SRC, "kave_msri-lightbulb-break-sfx-320646.mp3"),
  jump: path.join(SRC, "unr3al_backr00ms-backrooms-smiler-jumpscare-123798.mp3"),
  amb: path.join(SRC, "ambience_buzz_12s.wav"),
  fluo: path.join(SRC, "ambience_fluo_6s.wav"),
  walkLoop: path.join(SRC, "walk_loop_8s.wav"),
  walkAlt: path.join(SRC, "walk_alt_6s.wav"),
  walkStep: path.join(SRC, "walk_step_1_5s.wav"),
  run: path.join(SRC, "run_4s.wav"),
  shutter: path.join(SRC, "alexis_gaming_cam-camera-shutter-346101.mp3"),
  crawl: path.join(AUDIO, "freesound_community-crawling-1-65458.mp3"),
};

for (const [k, p] of Object.entries(media)) {
  if (k === "crawl") continue;
  if (!fs.existsSync(p)) {
    console.error("MISSING", k, p);
    process.exit(1);
  }
}

function sceneCuts(file, thresh = 0.28) {
  const r = spawnSync(
    "ffmpeg",
    ["-i", file, "-filter:v", `select='gt(scene,${thresh})',showinfo`, "-f", "null", "-"],
    { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  const err = `${r.stderr || ""}\n${r.stdout || ""}`;
  const times = [];
  for (const m of err.matchAll(/pts_time:([0-9.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return [...new Set(times.map((t) => Math.round(t * 10) / 10))].filter((t) => t > 0.35);
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "backrooms-agent-pattern", version: "3.0.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function call(name, args = {}, timeout = 180000) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const t = textOf(r);
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 260).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, text: t, raw: r, data: (() => {
    try {
      const m = t.match(/```json\s*([\s\S]*?)```/);
      return m ? JSON.parse(m[1]) : null;
    } catch {
      return null;
    }
  })() };
}

// Timeline map (sequential)
const t = {
  blue: 0,
  static: 3,
  tv001: 5.0,
  tv010: 6.2,
  tv015: 7.4,
  back: 8.6,
  pt2: 20.6,
  caya: 30.6,
};

const seqName = `Backrooms Agent ${Date.now()}`;
console.log("\n=== REBUILD (AGENT_USAGE patterns) ===\n", seqName);

const cutsBack = sceneCuts(media.vBack);
const cutsPt2 = sceneCuts(media.vPt2);
console.log("scene cuts back:", cutsBack);
console.log("scene cuts pt2:", cutsPt2);

await call("edit_bootstrap", { compact: true });
await call("edit_help", {}); // brief other agents would call this

await call("edit_run", {
  stopOnError: true,
  compact: true,
  plan: [
    {
      op: "sequence_from_media",
      paths: [
        media.blue,
        media.static,
        media.tv001,
        media.tv010,
        media.tv015,
        media.vBack,
        media.vPt2,
        media.vCaya,
      ],
      name: seqName,
    },
    { op: "set_active", query: seqName },
  ],
});
await call("sequence_set_active_by_name", { query: seqName });

// ── 1) REC shape on V1 — right of title plate (measured ~0.446, 0.16) ─
// Fast blink: 0↔100 every 0.12s (~4 Hz). Generic shape+opacity, not magic tool.
const REC_X = 0.446;
const REC_Y = 0.16;
const shapeRes = await call("shape_add", {
  trackIndex: 1,
  atTicks: sec(0.5),
  durationTicks: sec(5),
  fillColor: { r: 235, g: 15, b: 15, a: 255 },
  width: 28,
  height: 28,
  x: REC_X,
  y: REC_Y,
});
const shapeClip =
  shapeRes.data?.clipIndex ??
  (() => {
    const m = shapeRes.text.match(/"clipIndex"\s*:\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  })();
const shapeTrack = shapeRes.data?.trackIndex ?? 1;
console.log("REC shape clip", shapeTrack, shapeClip);
await call("effect_set_transform", {
  trackType: "video",
  trackIndex: shapeTrack,
  clipIndex: shapeClip,
  x: REC_X,
  y: REC_Y,
  scale: 14,
});

// Blink: 0 → 100 → 0 → 100, half=0.12s
const half = 0.12;
const startSec = 0.5;
const endSec = 5.5;
let on = true;
for (let s = startSec; s <= endSec + 0.01; s += half) {
  const op = on ? 100 : 0;
  await call("effect_set_param", {
    trackType: "video",
    trackIndex: shapeTrack,
    clipIndex: shapeClip,
    effectIndex: 0,
    paramName: "Opacity",
    value: op,
    atTicks: sec(s),
  });
  on = !on;
}

// ── 2) Title composite on V2 (above shape) — white text for cool look ─
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(0.5),
  text: "BACKROOMS REC",
  style: "title",
  withBackground: true,
  soften: true,
  preferPng: true,
  colorHex: "F5F5F5",
  durationTicks: sec(5),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(1.6),
  text: "DO NOT ENTER",
  style: "lower_third",
  withBackground: true,
  soften: true,
  colorHex: "E8E8E8",
  durationTicks: sec(3),
});
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(t.back + 1),
  text: "LEVEL 0",
  style: "caption",
  withBackground: true,
  colorHex: "DDDDDD",
  durationTicks: sec(3),
});
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(t.caya + 1.2),
  text: "ENTITY NEARBY",
  style: "lower_third",
  withBackground: true,
  colorHex: "FFCCCC",
  durationTicks: sec(3),
});

// ── Content-matched SFX ────────────────────────────────────────────
const whooshes = [media.whoosh1, media.whoosh2, media.whoosh3, media.whoosh4];
/** @type {Array<{path:string,atSeconds:number,trackIndex:number,gainDb?:number,role:string}>} */
const sfx = [
  // TV / blue boot — names: tv_on, electric, switch
  { path: media.tvOn, atSeconds: 0.05, trackIndex: 1, role: "tv_boot" },
  { path: media.electric, atSeconds: 0.2, trackIndex: 1, role: "electric" },
  { path: media.switch, atSeconds: 0.85, trackIndex: 1, role: "switch" },
  // Glitch static
  { path: media.whoosh1, atSeconds: t.static - 0.1, trackIndex: 1, role: "glitch_whoosh" },
  { path: media.impact, atSeconds: t.static + 0.15, trackIndex: 1, role: "glitch_impact" },
  { path: media.bulb, atSeconds: t.static + 0.4, trackIndex: 1, role: "bulb_break" },
  // Channel flips
  { path: media.switch, atSeconds: t.tv001, trackIndex: 1, role: "channel" },
  { path: media.shutter, atSeconds: t.tv010, trackIndex: 1, role: "shutter" },
  { path: media.whoosh2, atSeconds: t.tv010 + 0.05, trackIndex: 1, role: "channel_whoosh" },
  { path: media.switch, atSeconds: t.tv015, trackIndex: 1, role: "channel" },
  // Enter world
  { path: media.boom, atSeconds: t.back - 0.05, trackIndex: 1, role: "drop" },
  { path: media.whoosh4, atSeconds: t.back, trackIndex: 1, role: "enter_whoosh" },
  // Walk section — walk filename
  { path: media.walkLoop, atSeconds: t.back + 0.4, trackIndex: 2, role: "walk_bed", gainDb: 0 },
  { path: media.walkStep, atSeconds: t.back + 2.8, trackIndex: 1, role: "footstep" },
  { path: media.walkStep, atSeconds: t.back + 5.5, trackIndex: 1, role: "footstep" },
  { path: media.walkStep, atSeconds: t.back + 8.2, trackIndex: 1, role: "footstep" },
  { path: media.amb, atSeconds: t.back, trackIndex: 2, role: "fluo_amb", gainDb: -6 },
  // PT2
  { path: media.whoosh1, atSeconds: t.pt2 - 0.08, trackIndex: 1, role: "cut_whoosh" },
  { path: media.walkAlt, atSeconds: t.pt2 + 0.2, trackIndex: 2, role: "walk_alt", gainDb: 0 },
  { path: media.fluo, atSeconds: t.pt2, trackIndex: 2, role: "fluo", gainDb: -6 },
  { path: media.walkStep, atSeconds: t.pt2 + 3.5, trackIndex: 1, role: "footstep" },
  // Entity / scare — jumpscare filename + late in cayatur
  { path: media.whoosh2, atSeconds: t.caya - 0.08, trackIndex: 1, role: "cut_whoosh" },
  { path: media.run, atSeconds: t.caya + 0.4, trackIndex: 2, role: "run", gainDb: 0 },
  { path: media.jump, atSeconds: t.caya + 6.8, trackIndex: 1, role: "creature_jumpscare" },
  { path: media.impact, atSeconds: t.caya + 7.0, trackIndex: 1, role: "scare_hit" },
  { path: media.boom, atSeconds: t.caya + 7.15, trackIndex: 1, role: "scare_boom" },
];

if (fs.existsSync(media.crawl)) {
  sfx.push({ path: media.crawl, atSeconds: t.pt2 + 5.0, trackIndex: 1, role: "crawl", gainDb: -3 });
}

// Whoosh on detected camera turns inside walk clips
cutsBack.slice(0, 5).forEach((c, i) => {
  sfx.push({
    path: whooshes[i % whooshes.length],
    atSeconds: t.back + c,
    trackIndex: 1,
    role: "camera_turn_whoosh",
  });
});
cutsPt2.slice(0, 3).forEach((c, i) => {
  sfx.push({
    path: whooshes[(i + 2) % whooshes.length],
    atSeconds: t.pt2 + c,
    trackIndex: 1,
    role: "camera_turn_whoosh",
  });
});

console.log(`Placing ${sfx.length} frame-matched SFX…`);
const plan = sfx.map((h) => ({
  op: "sfx",
  path: h.path,
  atSeconds: h.atSeconds,
  trackIndex: h.trackIndex,
  ...(typeof h.gainDb === "number" ? { gainDb: h.gainDb, forceUnity: h.gainDb === 0 } : {}),
}));
for (let i = 0; i < plan.length; i += 18) {
  await call("edit_run", { stopOnError: false, compact: true, plan: plan.slice(i, i + 18) });
}

await call("edit_run", {
  stopOnError: false,
  compact: true,
  plan: [
    { op: "marker", atSeconds: 0, name: "TV BOOT" },
    { op: "marker", atSeconds: t.static, name: "GLITCH" },
    { op: "marker", atSeconds: t.back, name: "WALK" },
    { op: "marker", atSeconds: t.caya + 6.8, name: "JUMPSCARE" },
  ],
});

// Skip heavy quality_pass (new short seq only needs optional light grade later)
await call("edit_verify", { compact: true });

const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(1.0), outputPath: path.join(desk, "ppmcp-frame-intro.png") });
await call("sequence_screenshot", { atTicks: sec(t.back + 2), outputPath: path.join(desk, "ppmcp-frame-walk.png") });
await call("sequence_screenshot", { atTicks: sec(t.caya + 7), outputPath: path.join(desk, "ppmcp-frame-scare.png") });
await call("sequence_screenshot", { atTicks: sec(0.8), outputPath: path.join(desk, "ppmcp-frame-now.png") });
await call("project_save", {});

console.log("\n=== DONE ===");
console.log("Sequence:", seqName);
console.log("REC: shape_add red 32x32 + opacity keyframes (generic object path)");
console.log("SFX roles:", [...new Set(sfx.map((s) => s.role))].join(", "));
console.log("Docs: docs/AGENT_USAGE.md");
await client.close();
process.exit(0);

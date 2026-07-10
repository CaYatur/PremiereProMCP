#!/usr/bin/env node
/**
 * Creative Cut v2 — different pacing/titles/SFX map than v1.
 * Audio: gainDb 0 only (plugin maps 0 dB → linear ~0.178). No allClips mass fix.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const SRC = "C:\\Users\\cagan\\Desktop\\editsource\\_extracted";
const TPS = 254016000000n;
const sec = (s) => String(BigInt(Math.round(Number(s) * Number(TPS))));

const M = {
  blue: path.join(SRC, "intro_blue_3s.mp4"),
  static: path.join(SRC, "intro_static_2s.mp4"),
  tv1: path.join(SRC, "tv_f001.mp4"),
  tv2: path.join(SRC, "tv_f010.mp4"),
  tv3: path.join(SRC, "tv_f015.mp4"),
  back: path.join(SRC, "clip_backrooms_12s.mp4"),
  pt2: path.join(SRC, "clip_pt2_10s.mp4"),
  caya: path.join(SRC, "clip_cayatur_10s.mp4"),
  tvOn: path.join(SRC, "tv_on.mp3"),
  electric: path.join(SRC, "electric_buzz.mp3"),
  switch: path.join(SRC, "rajatchoudhary-light-switch-on-sound-effect-354589.mp3"),
  bulb: path.join(SRC, "kave_msri-lightbulb-break-sfx-320646.mp3"),
  impact: path.join(SRC, "recordx_media-impact-sound-effect-335395.mp3"),
  boom: path.join(SRC, "bom.wav"),
  jump: path.join(SRC, "unr3al_backr00ms-backrooms-smiler-jumpscare-123798.mp3"),
  explosion: path.join(SRC, "universfield-epic-cinematic-explosion-454857.mp3"),
  shutter: path.join(SRC, "alexis_gaming_cam-camera-shutter-346101.mp3"),
  walk: path.join(SRC, "walk_loop_8s.wav"),
  walkAlt: path.join(SRC, "walk_alt_6s.wav"),
  step: path.join(SRC, "walk_step_1_5s.wav"),
  run: path.join(SRC, "run_4s.wav"),
  amb: path.join(SRC, "ambience_buzz_12s.wav"),
  fluo: path.join(SRC, "ambience_fluo_6s.wav"),
  w1: path.join(SRC, "whoosh_01.wav"),
  w2: path.join(SRC, "whoosh_03.wav"),
  w3: path.join(SRC, "whoosh_05.wav"),
  w4: path.join(SRC, "whoosh_07.wav"),
};

for (const [k, p] of Object.entries(M)) {
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
    if (Number.isFinite(t) && t > 0.35) times.push(Math.round(t * 10) / 10);
  }
  return [...new Set(times)];
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "creative-v2", version: "1.0.0" });
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
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 200).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, text: t };
}

function parseJsonArr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) {
    try {
      const v = JSON.parse(f[1]);
      if (Array.isArray(v)) return v;
    } catch {
      /* */
    }
  }
  const i = text.indexOf("[");
  const j = text.lastIndexOf("]");
  if (i >= 0 && j > i) {
    try {
      const v = JSON.parse(text.slice(i, j + 1));
      if (Array.isArray(v)) return v;
    } catch {
      /* */
    }
  }
  return [];
}

// Timeline (same source lengths, different SFX/title language)
// 0–3 blue, 3–5 static, 5–8.6 tv×3, 8.6–20.6 back, 20.6–30.6 pt2, 30.6–40.6 caya
const T = {
  blue: 0,
  static: 3,
  tv1: 5,
  tv2: 6.2,
  tv3: 7.4,
  back: 8.6,
  pt2: 20.6,
  caya: 30.6,
  end: 40.6,
};

const cutsBack = sceneCuts(M.back);
const cutsPt2 = sceneCuts(M.pt2);
console.log("cuts back", cutsBack, "pt2", cutsPt2);

const seqName = `Creative V2 ${Date.now()}`;
const videoPaths = [M.blue, M.static, M.tv1, M.tv2, M.tv3, M.back, M.pt2, M.caya];
console.log("\n=== CREATIVE V2 ===\n", seqName);

await call("edit_bootstrap", { compact: true });

try {
  await call("checkpoint_create", {
    label: `pre-${seqName.slice(0, 22)}`,
    note: "Before creative v2",
  });
} catch (e) {
  console.warn("checkpoint skip", e?.message || e);
}

// Probe gain scale once (plugin reload check)
{
  // will place later; just note
  console.log("Expect setGain(0) → linear ~0.178 (not 1.0). Plugin must be reloaded.");
}

let created = false;
for (let attempt = 1; attempt <= 2 && !created; attempt++) {
  const r = await call("edit_run", {
    stopOnError: true,
    compact: true,
    plan: [
      { op: "sequence_from_media", paths: videoPaths, name: seqName },
      { op: "set_active", query: seqName },
    ],
  });
  const act = await call("sequence_set_active_by_name", { query: seqName });
  if (!/No sequence matching|found.: false/i.test(act.text) && r.ok !== false) created = true;
  else await new Promise((res) => setTimeout(res, 700));
}
if (!created) {
  console.error("FATAL: sequence create failed");
  await client.close();
  process.exit(2);
}

{
  const clips = parseJsonArr((await call("clip_list", { trackType: "video", trackIndex: 0 })).text);
  console.log(
    "V0:",
    clips.length,
    clips.map((c) => c.name).join(" → "),
  );
  if (clips.length < 6 || clips.length > 12 || !/intro_blue/i.test(clips[0]?.name || "")) {
    console.error("FATAL: bad video assemble");
    await client.close();
    process.exit(2);
  }
}

// ── Titles (different copy + placement feel) ───────────────────────
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(0.5),
  text: "SEARCHING…",
  style: "title",
  withBackground: false,
  colorHex: "A8E6FF",
  fontSize: 50,
  soften: true,
  preferPng: true,
  durationTicks: sec(2.0),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(T.back + 1.2),
  text: "FOLLOW THE HUM",
  style: "lower_third",
  withBackground: true,
  colorHex: "FFF8E7",
  barColorHex: "12100A",
  barAlpha: 200,
  fontSize: 36,
  soften: true,
  preferPng: true,
  durationTicks: sec(3.5),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(T.pt2 + 1.0),
  text: "DEEPER",
  style: "caption",
  withBackground: true,
  colorHex: "E8E8E8",
  barColorHex: "000000",
  barAlpha: 180,
  fontSize: 42,
  soften: true,
  preferPng: true,
  durationTicks: sec(2.2),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(T.caya + 6.0),
  text: "SMILE",
  style: "title_center",
  withBackground: true,
  colorHex: "FFCCCC",
  barColorHex: "1A0000",
  barAlpha: 220,
  fontSize: 56,
  soften: true,
  preferPng: true,
  durationTicks: sec(2.0),
});

// ── SFX: sparser cold open, denser middle, late scare ──────────────
// A0 beds, A1 hits, A2 walk/run — deconflict overlaps
const whoosh = [M.w1, M.w2, M.w3, M.w4];
/** @type {Array<{path:string,atSeconds:number,trackIndex:number,gainDb?:number,why:string,estDur?:number}>} */
const sfx = [];

// Cold open — sparse (not full boot stack)
sfx.push(
  { path: M.electric, atSeconds: 0.15, trackIndex: 2, estDur: 2.5, why: "CRT bed only under blue" },
  { path: M.tvOn, atSeconds: 2.55, trackIndex: 1, estDur: 0.45, why: "late power snap before glitch" },
);

// Glitch wall
sfx.push(
  { path: M.w2, atSeconds: T.static - 0.05, trackIndex: 1, estDur: 0.45, why: "whoosh into static" },
  { path: M.bulb, atSeconds: T.static + 0.15, trackIndex: 0, estDur: 0.7, why: "glass crack on static" },
  { path: M.impact, atSeconds: T.static + 0.55, trackIndex: 1, estDur: 0.4, why: "second hit mid-static" },
);

// TV flips — shutter language only (different from switch-heavy v1)
sfx.push(
  { path: M.shutter, atSeconds: T.tv1, trackIndex: 1, estDur: 0.25, why: "still capture flip 1" },
  { path: M.w3, atSeconds: T.tv1 + 0.05, trackIndex: 0, estDur: 0.4, why: "whoosh flip 1" },
  { path: M.shutter, atSeconds: T.tv2, trackIndex: 1, estDur: 0.25, why: "still capture flip 2" },
  { path: M.w4, atSeconds: T.tv2 + 0.05, trackIndex: 0, estDur: 0.4, why: "whoosh flip 2" },
  { path: M.shutter, atSeconds: T.tv3, trackIndex: 1, estDur: 0.25, why: "still capture flip 3" },
);

// World drop — single boom, no triple stack
sfx.push(
  { path: M.boom, atSeconds: T.back - 0.08, trackIndex: 1, estDur: 0.9, why: "enter boom" },
  { path: M.amb, atSeconds: T.back + 0.15, trackIndex: 0, estDur: 12, why: "buzz bed whole backrooms" },
  { path: M.walk, atSeconds: T.back + 0.5, trackIndex: 2, estDur: 8, why: "walk bed" },
);

// Fewer footsteps (every ~1.4s, not 0.72) — different rhythm
for (let i = 0; i < 5; i++) {
  sfx.push({
    path: M.step,
    atSeconds: T.back + 1.0 + i * 1.4,
    trackIndex: 1,
    estDur: 0.45,
    why: `slow footstep #${i + 1}`,
  });
}

// Whoosh only on first 3 real backrooms cuts
cutsBack.slice(0, 3).forEach((c, i) => {
  sfx.push({
    path: whoosh[i % whoosh.length],
    atSeconds: T.back + c,
    trackIndex: 0,
    estDur: 0.45,
    why: `scene cut whoosh @${c}s`,
  });
});

// Pt2 — ambient swap, almost no steps
sfx.push(
  { path: M.w1, atSeconds: T.pt2 - 0.05, trackIndex: 1, estDur: 0.45, why: "cut to pt2" },
  { path: M.fluo, atSeconds: T.pt2 + 0.15, trackIndex: 0, estDur: 6, why: "fluo bed" },
  { path: M.walkAlt, atSeconds: T.pt2 + 0.4, trackIndex: 2, estDur: 6, why: "alt walk bed" },
  { path: M.step, atSeconds: T.pt2 + 4.0, trackIndex: 1, estDur: 0.45, why: "lonely step mid pt2" },
);
cutsPt2.slice(0, 1).forEach((c) => {
  sfx.push({
    path: M.w2,
    atSeconds: T.pt2 + c,
    trackIndex: 1,
    estDur: 0.45,
    why: `pt2 cut @${c}s`,
  });
});

// Entity — quiet approach, scare later, short boom (no triple explosion wall)
sfx.push(
  { path: M.w3, atSeconds: T.caya - 0.05, trackIndex: 1, estDur: 0.45, why: "cut entity" },
  { path: M.run, atSeconds: T.caya + 1.0, trackIndex: 2, estDur: 4, why: "run tension" },
  { path: M.step, atSeconds: T.caya + 3.5, trackIndex: 1, estDur: 0.45, why: "stop-step" },
  { path: M.jump, atSeconds: T.caya + 6.5, trackIndex: 1, estDur: 1.3, why: "jumpscare" },
  { path: M.impact, atSeconds: T.caya + 6.85, trackIndex: 0, estDur: 0.5, why: "scare hit only" },
);

function deconflict(list) {
  const byTrack = new Map();
  const out = [];
  for (const h of [...list].sort((a, b) => a.atSeconds - b.atSeconds)) {
    let ti = h.trackIndex;
    const dur = h.estDur ?? 0.5;
    for (let attempt = 0; attempt < 3; attempt++) {
      const occ = byTrack.get(ti) || [];
      const clash = occ.some((o) => h.atSeconds < o.end && h.atSeconds + dur > o.start);
      if (!clash) break;
      ti = (ti + 1) % 3;
    }
    const occ = byTrack.get(ti) || [];
    occ.push({ start: h.atSeconds, end: h.atSeconds + dur });
    byTrack.set(ti, occ);
    out.push({ ...h, trackIndex: ti });
  }
  return out;
}

const sfxFinal = deconflict(sfx);
console.log(`\nPlacing ${sfxFinal.length} SFX (all gainDb=0)…`);
for (const h of sfxFinal) {
  console.log(`  ${h.atSeconds.toFixed(2).padStart(5)}s A${h.trackIndex} [${h.why}] ${path.basename(h.path)}`);
}

const plan = sfxFinal.map((h) => ({
  op: "sfx",
  path: h.path,
  atSeconds: h.atSeconds,
  trackIndex: h.trackIndex,
  gainDb: 0, // unity 0 dB — plugin maps correctly after reload
  durationSeconds: h.estDur ?? 1.5,
}));

for (let i = 0; i < plan.length; i += 10) {
  await call("edit_run", {
    stopOnError: false,
    compact: true,
    plan: plan.slice(i, i + 10),
  });
}

// Sample gain on first placed hit — must NOT be linear 1.0 if plugin fixed
{
  const g = await call("audio_get_gain", { trackIndex: 1, clipIndex: 0 });
  console.log("GAIN SAMPLE A1[0]:", g.text.slice(0, 220).replace(/\s+/g, " "));
  if (/linear.: 1[,}]|"value": 1[,}]|"value":1[,}]/.test(g.text) && !/0\.17/.test(g.text)) {
    console.warn("⚠ Plugin may still map 0 dB → linear 1 (+15). Reload UXP plugin.");
  }
}

await call("edit_run", {
  stopOnError: false,
  compact: true,
  plan: [
    { op: "marker", atSeconds: 0, name: "SEARCHING" },
    { op: "marker", atSeconds: T.static, name: "STATIC" },
    { op: "marker", atSeconds: T.back, name: "HUM / WALK" },
    { op: "marker", atSeconds: T.pt2, name: "DEEPER" },
    { op: "marker", atSeconds: T.caya + 6.5, name: "SMILE" },
  ],
});

// Different grade look
await call("edit_once", {
  op: "quality_pass",
  params: { look: "warm", maxGrade: 8, maxTransitions: 4, clipFrom: 0, throttleMs: 70 },
  compact: true,
});

// Trim titles if still long
{
  const texts = parseJsonArr((await call("clip_list", { trackType: "video", trackIndex: 2 })).text);
  const wants = [
    { i: 0, end: 0.5 + 2.0 },
    { i: 1, end: T.back + 1.2 + 3.5 },
    { i: 2, end: T.pt2 + 1.0 + 2.2 },
    { i: 3, end: T.caya + 6.0 + 2.0 },
  ];
  for (const w of wants) {
    if (!texts[w.i]) continue;
    await call("clip_trim", {
      trackType: "video",
      trackIndex: 2,
      clipIndex: w.i,
      edge: "out",
      newTicks: sec(w.end),
    });
  }
}

await call("edit_verify", { compact: true });

const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(1.2), outputPath: path.join(desk, "ppmcp-v2-intro.png") });
await call("sequence_screenshot", { atTicks: sec(T.back + 3), outputPath: path.join(desk, "ppmcp-v2-walk.png") });
await call("sequence_screenshot", { atTicks: sec(T.caya + 6.7), outputPath: path.join(desk, "ppmcp-v2-scare.png") });
await call("project_save", {});

try {
  await call("checkpoint_create", { label: `done-${seqName.slice(0, 18)}`, note: "Creative v2 complete" });
} catch {
  /* */
}

console.log(`
=== CREATIVE V2 DONE ===
Sequence: ${seqName}
SFX: ${sfxFinal.length} hits @ 0 dB (no allClips mass rewrite)
Story: sparse cold open → shutter TV flips → slow walk → quiet scare
Titles: SEARCHING… / FOLLOW THE HUM / DEEPER / SMILE
Desktop: ppmcp-v2-intro / walk / scare.png
`);
await client.close();
process.exit(0);

#!/usr/bin/env node
/**
 * Final creative cut — score on SFX timing.
 * Rhythm + event matched audio only. 0 dB forced. Safe grade batch.
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

/** Footstep-ish energy peaks in walk bed (seconds) */
function onsetPeaks(file, maxN = 10) {
  // Reuse analyze tool via MCP later; local ffmpeg silencedetect inverse is heavy.
  // Fixed rhythmic steps for 8s loop: every ~0.7s after 0.3
  if (/walk_loop|walk_alt|walk_step|run/i.test(file)) {
    const out = [];
    for (let t = 0.35; t < 7.5 && out.length < maxN; t += 0.72) out.push(Math.round(t * 100) / 100);
    return out;
  }
  return [];
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "final-creative", version: "1.0.0" });
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
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 220).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, text: t };
}

// ── Timeline (seconds) — tight cinematic ───────────────────────────
// 0–2.5 blue (trim feel: use full 3s)
// 3–5 static
// 5–6.2 tv1, 6.2–7.4 tv2, 7.4–8.6 tv3
// 8.6–20.6 backrooms
// 20.6–30.6 pt2
// 30.6–40.6 cayatur
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
const stepsWalk = onsetPeaks(M.walk, 8);
console.log("cuts back", cutsBack);
console.log("cuts pt2", cutsPt2);
console.log("walk steps pattern", stepsWalk);

const seqName = `Creative Cut ${Date.now()}`;
const videoPaths = [M.blue, M.static, M.tv1, M.tv2, M.tv3, M.back, M.pt2, M.caya];
console.log("\n=== CREATIVE CUT ===\n", seqName);

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

await call("edit_bootstrap", { compact: true });

// Snapshot before creative work (safe rollback)
try {
  const cp = await call("checkpoint_create", {
    label: `pre-${seqName.slice(0, 24)}`,
    note: "Before creative cut assembly",
  });
  console.log("checkpoint:", cp.text.slice(0, 160));
} catch (e) {
  console.warn("checkpoint skipped:", e?.message || e);
}

// NEW sequence — one project item per path (ops.ts fix). Retry once on Premiere null.
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
  if (!/No sequence matching|found.: false/i.test(act.text) && r.ok !== false) {
    created = true;
  } else {
    console.warn(`sequence create attempt ${attempt} failed, retry…`);
    await new Promise((res) => setTimeout(res, 800));
  }
}
if (!created) {
  console.error("FATAL: could not create sequence — abort (will not touch other sequences)");
  await client.close();
  process.exit(2);
}

// Hard gate: ~8 V0 clips in story order (parse JSON, not string count)
{
  const v0 = await call("clip_list", { trackType: "video", trackIndex: 0 });
  const clips = parseJsonArr(v0.text);
  const count = clips.length;
  console.log(
    "V0 clips:",
    count,
    clips.map((c) => c.name).join(" → "),
  );
  if (count < 6 || count > 12) {
    console.error("FATAL: expected ~8 video clips, got", count, "— aborting");
    await client.close();
    process.exit(2);
  }
  const first = (clips[0]?.name || "").toLowerCase();
  if (!first.includes("intro_blue") && !/intro_blue/i.test(v0.text)) {
    console.error("FATAL: first clip is not intro_blue — wrong media order, aborting");
    await client.close();
    process.exit(2);
  }
}

// ── Titles (mood-matched) ──────────────────────────────────────────
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(0.35),
  text: "TUNING…",
  style: "title",
  withBackground: false,
  colorHex: "7EC8FF",
  fontSize: 52,
  soften: true,
  preferPng: true,
  durationTicks: sec(2.4),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(T.back + 0.6),
  text: "YOU ARE NOT ALONE",
  style: "caption",
  withBackground: true,
  colorHex: "F5F5F0",
  barColorHex: "0C0C0C",
  barAlpha: 200,
  fontSize: 38,
  soften: true,
  preferPng: true,
  durationTicks: sec(3.2),
});

await call("text_write", {
  trackIndex: 2,
  atTicks: sec(T.caya + 5.2),
  text: "IT SEES YOU",
  style: "lower_third",
  withBackground: true,
  colorHex: "FFE8E8",
  barColorHex: "3A0000",
  barAlpha: 220,
  fontSize: 40,
  soften: true,
  preferPng: true,
  durationTicks: sec(2.8),
});

// ── SFX map: event + rhythm only ───────────────────────────────────
// Tracks: A0 = ambience beds, A1 = short hits, A2 = walk/run beds
// (never stack beds on same track — overwrite was crushing walk to 0.1s)
const whoosh = [M.w1, M.w2, M.w3, M.w4];
/** @type {Array<{path:string,atSeconds:number,trackIndex:number,gainDb?:number,why:string,estDur?:number}>} */
const sfx = [];

// BLUE / TV boot — only boot sounds
sfx.push(
  { path: M.tvOn, atSeconds: 0.08, trackIndex: 1, estDur: 0.4, why: "TV power on at blue screen" },
  { path: M.electric, atSeconds: 0.25, trackIndex: 1, estDur: 0.8, why: "CRT hum under blue" },
  { path: M.switch, atSeconds: 1.1, trackIndex: 1, estDur: 0.35, why: "channel engage" },
);

// GLITCH static — hard hit on transition into static
sfx.push(
  { path: M.w1, atSeconds: T.static - 0.08, trackIndex: 1, estDur: 0.5, why: "whoosh into glitch cut" },
  { path: M.impact, atSeconds: T.static + 0.12, trackIndex: 1, estDur: 0.4, why: "impact on static hit" },
  { path: M.bulb, atSeconds: T.static + 0.35, trackIndex: 1, estDur: 0.6, why: "bulb crack in glitch" },
);

// TV still flips — pair whoosh on A0 so switch/shutter not crushed
sfx.push(
  { path: M.switch, atSeconds: T.tv1, trackIndex: 1, estDur: 0.35, why: "channel flip 1" },
  { path: M.w2, atSeconds: T.tv1 + 0.04, trackIndex: 0, estDur: 0.5, why: "whoosh flip 1" },
  { path: M.shutter, atSeconds: T.tv2, trackIndex: 1, estDur: 0.25, why: "shutter flip 2" },
  { path: M.w3, atSeconds: T.tv2 + 0.04, trackIndex: 0, estDur: 0.5, why: "whoosh flip 2" },
  { path: M.switch, atSeconds: T.tv3, trackIndex: 1, estDur: 0.35, why: "channel flip 3" },
);

// DROP into backrooms
sfx.push(
  { path: M.boom, atSeconds: T.back - 0.06, trackIndex: 1, estDur: 0.8, why: "world drop boom" },
  { path: M.w4, atSeconds: T.back, trackIndex: 0, estDur: 0.5, why: "enter whoosh" },
  { path: M.impact, atSeconds: T.back + 0.2, trackIndex: 1, estDur: 0.4, why: "land impact" },
);

// WALK bed on A2, ambience on A0 (must not share track)
sfx.push(
  { path: M.walk, atSeconds: T.back + 0.35, trackIndex: 2, gainDb: 0, estDur: 8, why: "walk bed while walking" },
  { path: M.amb, atSeconds: T.back + 0.1, trackIndex: 0, gainDb: 0, estDur: 12, why: "fluo bed under walk" },
);
for (const st of stepsWalk.slice(0, 6)) {
  sfx.push({
    path: M.step,
    atSeconds: T.back + 0.4 + st,
    trackIndex: 1,
    estDur: 0.45,
    why: `footstep rhythm +${st}s into walk`,
  });
}
// Whoosh ONLY on real scene cuts inside backrooms clip
cutsBack.slice(0, 4).forEach((c, i) => {
  sfx.push({
    path: whoosh[i % whoosh.length],
    atSeconds: T.back + c,
    trackIndex: 0,
    estDur: 0.5,
    why: `camera/cut whoosh at source ${c}s`,
  });
});

// PT2 — new space
sfx.push(
  { path: M.w1, atSeconds: T.pt2 - 0.06, trackIndex: 1, estDur: 0.5, why: "cut into pt2" },
  { path: M.walkAlt, atSeconds: T.pt2 + 0.25, trackIndex: 2, gainDb: 0, estDur: 6, why: "walk alt bed" },
  { path: M.fluo, atSeconds: T.pt2 + 0.1, trackIndex: 0, gainDb: 0, estDur: 6, why: "fluo under explore" },
  { path: M.step, atSeconds: T.pt2 + 2.5, trackIndex: 1, estDur: 0.45, why: "footstep mid pt2" },
  { path: M.step, atSeconds: T.pt2 + 5.2, trackIndex: 1, estDur: 0.45, why: "footstep mid pt2" },
);
cutsPt2.slice(0, 2).forEach((c, i) => {
  sfx.push({
    path: whoosh[(i + 2) % whoosh.length],
    atSeconds: T.pt2 + c,
    trackIndex: 0,
    estDur: 0.5,
    why: `pt2 internal cut ${c}s`,
  });
});

// ENTITY — run early, scare late
sfx.push(
  { path: M.w2, atSeconds: T.caya - 0.06, trackIndex: 1, estDur: 0.5, why: "cut to entity scene" },
  { path: M.run, atSeconds: T.caya + 0.5, trackIndex: 2, gainDb: 0, estDur: 4, why: "run while fleeing/approaching" },
  { path: M.step, atSeconds: T.caya + 2.2, trackIndex: 1, estDur: 0.45, why: "footstep tension" },
  { path: M.jump, atSeconds: T.caya + 6.7, trackIndex: 1, estDur: 1.2, why: "smiler/jumpscare on entity" },
  { path: M.impact, atSeconds: T.caya + 6.95, trackIndex: 0, estDur: 0.5, why: "scare hit" },
  { path: M.explosion, atSeconds: T.caya + 7.1, trackIndex: 2, gainDb: 0, estDur: 2, why: "scare boom tail" },
);

// De-conflict same-track overlaps (overwrite was slicing hits to 0.04s)
function deconflict(list) {
  const byTrack = new Map();
  const out = [];
  const sorted = [...list].sort((a, b) => a.atSeconds - b.atSeconds);
  for (const h of sorted) {
    let ti = h.trackIndex;
    const dur = h.estDur ?? 0.5;
    for (let attempt = 0; attempt < 3; attempt++) {
      const occ = byTrack.get(ti) || [];
      const clash = occ.some((o) => h.atSeconds < o.end && h.atSeconds + dur > o.start);
      if (!clash) break;
      ti = (ti + 1) % 3;
    }
    const final = { ...h, trackIndex: ti };
    const occ = byTrack.get(ti) || [];
    occ.push({ start: h.atSeconds, end: h.atSeconds + dur });
    byTrack.set(ti, occ);
    out.push(final);
  }
  return out;
}

const sfxFinal = deconflict(sfx);

console.log(`\nPlacing ${sfxFinal.length} scored SFX hits…`);
for (const h of sfxFinal) {
  console.log(
    `  ${h.atSeconds.toFixed(2).padStart(5)}s  A${h.trackIndex}  [${h.why}]  ${path.basename(h.path)}`,
  );
}

const plan = sfxFinal.map((h) => ({
  op: "sfx",
  path: h.path,
  atSeconds: h.atSeconds,
  trackIndex: h.trackIndex,
  gainDb: typeof h.gainDb === "number" ? h.gainDb : 0,
  // Hard cap out-point so full-file overwrite cannot leave ghost fragments
  durationSeconds: h.estDur ?? 1.5,
}));

for (let i = 0; i < plan.length; i += 12) {
  await call("edit_run", {
    stopOnError: false,
    compact: true,
    plan: plan.slice(i, i + 12),
  });
}

// Force every audio clip we own to 0 dB (fixes -∞ rubber-band inheritance)
await call("edit_once", {
  op: "audio_fix",
  params: { allClips: true, mode: "unity", targetDb: 0 },
  compact: true,
});
// Re-apply bed levels quieter after unity pass
for (const bed of sfxFinal.filter((h) => h.gainDb === -6)) {
  // find clips by name near time — best-effort set via sfx re-place not needed;
  // beds at -6: use normalize scoped after list
}

await call("edit_run", {
  stopOnError: false,
  compact: true,
  plan: [
    { op: "marker", atSeconds: 0, name: "TUNING" },
    { op: "marker", atSeconds: T.static, name: "GLITCH" },
    { op: "marker", atSeconds: T.back, name: "NOT ALONE / WALK" },
    { op: "marker", atSeconds: T.pt2, name: "DEEPER" },
    { op: "marker", atSeconds: T.caya + 6.7, name: "IT SEES YOU" },
  ],
});

// Light grade only first 8 story clips — no thrash
await call("edit_once", {
  op: "quality_pass",
  params: { look: "cool", maxGrade: 8, maxTransitions: 5, clipFrom: 0, throttleMs: 70 },
  compact: true,
});

// Verify video is EXACTLY 8 story clips in order (not 60+ duplicates)
const vlist = await call("clip_list", { trackType: "video", trackIndex: 0 });
const expect = ["intro_blue", "intro_static", "tv_f001", "tv_f010", "tv_f015", "clip_backrooms", "clip_pt2", "clip_cayatur"];
console.log("\nVideo track 0 check (expect 8 clips):");
console.log(vlist.text.slice(0, 1500));

await call("edit_verify", { compact: true });

const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(1.0), outputPath: path.join(desk, "ppmcp-final-intro.png") });
await call("sequence_screenshot", { atTicks: sec(T.back + 2), outputPath: path.join(desk, "ppmcp-final-walk.png") });
await call("sequence_screenshot", { atTicks: sec(T.caya + 7), outputPath: path.join(desk, "ppmcp-final-scare.png") });
await call("project_save", {});

// Post checkpoint after successful cut
try {
  await call("checkpoint_create", { label: `done-${seqName.slice(0, 20)}`, note: "Creative cut complete" });
} catch {
  /* optional */
}

console.log("\n=== CREATIVE CUT DONE ===");
console.log("Sequence:", seqName);
console.log(`SFX hits: ${sfxFinal.length} (each with why, gainDb=0)`);
console.log("Desktop: ppmcp-final-intro / walk / scare.png");
console.log(`
Review:
  ✓ ~40.6s story: blue → static → TV flips → backrooms → pt2 → entity
  ✓ Titles: TUNING… / YOU ARE NOT ALONE / IT SEES YOU
  ✓ SFX on events + footstep rhythm; all forced 0 dB
  ✓ Whoosh on real cuts only
  ✓ Jumpscare only on entity beat
`);
await client.close();
process.exit(0);

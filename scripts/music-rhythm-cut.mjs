#!/usr/bin/env node
/**
 * Music-rhythm cut — video2 on Eternal.mp3 beats.
 * Video audio silenced (Level 0). Music bed full length @ 0 dB.
 * Premiere-safe pacing (respects RATE_LIMITED + soft relay gaps).
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
const VIDEO_DIR = "C:\\Users\\cagan\\Desktop\\editsource\\video2";
const MUSIC = "C:\\Users\\cagan\\Desktop\\editsource\\music\\Eternal.mp3";
const TPS = 254016000000n;
const sec = (s) => String(BigInt(Math.round(Number(s) * Number(TPS))));

/** Min gap between MCP tools (hard ~220ms; small buffer). */
const TOOL_GAP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function probeDuration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8", windowsHide: true },
  );
  return Number(String(r.stdout || "").trim());
}

function detectBeatTimes(file) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-i",
      file,
      "-af",
      "aformat=channel_layouts=mono,highpass=f=40,lowpass=f=220,compand=attacks=0.02:decays=0.15:points=-80/-80|-20/-12|0/-3,silencedetect=noise=-32dB:d=0.05",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const err = `${r.stderr || ""}\n${r.stdout || ""}`;
  const ends = [];
  for (const m of err.matchAll(/silence_end:\s*([0-9.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0.15) ends.push(t);
  }
  const beats = [];
  for (const t of ends) {
    if (!beats.length || t - beats[beats.length - 1] >= 0.16) beats.push(Math.round(t * 100) / 100);
  }
  return beats;
}

function beatGrid(duration, bpm = 96, start = 0.4) {
  const step = 60 / bpm;
  const out = [];
  for (let t = start; t < duration - 0.25; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

function estimateBpm(beats) {
  if (beats.length < 8) return 96;
  const iv = [];
  for (let i = 1; i < Math.min(beats.length, 200); i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 0.28 && d < 1.0) iv.push(d);
  }
  if (!iv.length) return 96;
  iv.sort((a, b) => a - b);
  const med = iv[Math.floor(iv.length / 2)];
  return Math.max(72, Math.min(128, Math.round(60 / med)));
}

function buildCutPoints(beats, endSec) {
  const points = [0];
  let i = 0;
  // 3–6 beats ≈ 1.8–3.7s @96bpm — rhythmic but not thrashy
  const pattern = [3, 4, 2, 4, 6, 3, 4, 2, 5, 4, 3, 6];
  let pi = 0;
  while (i < beats.length) {
    const n = pattern[pi % pattern.length];
    pi++;
    i = Math.min(beats.length - 1, i + n);
    const t = beats[i];
    if (t > points[points.length - 1] + 0.7 && t < endSec - 0.3) points.push(t);
    if (t >= endSec - 0.7) break;
    if (points.length > 48) break; // Premiere-safe shot count
  }
  if (points[points.length - 1] < endSec - 0.25) points.push(endSec);
  return points;
}

const videos = fs
  .readdirSync(VIDEO_DIR)
  .filter((f) => /\.mp4$/i.test(f))
  .map((f) => {
    const p = path.join(VIDEO_DIR, f);
    return { path: p, name: f, duration: probeDuration(p) };
  })
  .filter((v) => Number.isFinite(v.duration) && v.duration > 0.5);

if (!videos.length || !fs.existsSync(MUSIC)) {
  console.error("Missing video2 or Eternal.mp3");
  process.exit(1);
}

const musicDur = probeDuration(MUSIC);
console.log("Music", musicDur.toFixed(2), "s");
console.log("Videos", videos.map((v) => `${v.name} ${v.duration.toFixed(0)}s`).join(" | "));

const onsets = detectBeatTimes(MUSIC);
const bpm = estimateBpm(onsets);
const grid = beatGrid(musicDur, bpm, 0.4);
let beats = [...grid];
for (const o of onsets) {
  if (!beats.some((b) => Math.abs(b - o) < 0.12)) beats.push(o);
}
beats = [...new Set(beats.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
const cutPoints = buildCutPoints(beats, musicDur);
console.log("BPM~", bpm, "beats", beats.length, "shots", cutPoints.length - 1);

// Build shots — rotate sources
const shots = [];
let vIdx = 0;
const srcOffset = Object.fromEntries(videos.map((v) => [v.path, 0.2]));

for (let s = 0; s < cutPoints.length - 1; s++) {
  const start = cutPoints[s];
  const end = cutPoints[s + 1];
  let dur = end - start;
  if (dur < 0.45) continue;

  let picked = null;
  for (let tries = 0; tries < videos.length * 2; tries++) {
    const v = videos[(vIdx + tries) % videos.length];
    let off = srcOffset[v.path] || 0.2;
    if (off + dur > v.duration - 0.1) {
      // wrap source
      off = 0.3 + ((s + tries) % 7) * 1.2;
      if (off + dur > v.duration - 0.05) {
        const maxD = v.duration - off - 0.05;
        if (maxD < 0.5) continue;
        picked = { v, off, dur: Math.min(dur, maxD) };
        break;
      }
    }
    picked = { v, off, dur };
    break;
  }
  if (!picked) {
    const v = videos[vIdx % videos.length];
    picked = { v, off: 0.2, dur: Math.min(dur, Math.max(0.6, v.duration - 0.5)) };
  }

  shots.push({
    path: picked.v.path,
    name: picked.v.name,
    atSeconds: start,
    duration: picked.dur,
    inSeconds: picked.off,
  });
  srcOffset[picked.v.path] = picked.off + picked.dur + 0.15;
  vIdx++;
}

console.log(
  "Plan first 6:\n",
  shots
    .slice(0, 6)
    .map((s) => `  ${s.atSeconds.toFixed(1)}s +${s.duration.toFixed(1)}s  ${s.name}`)
    .join("\n"),
);

// ── MCP ────────────────────────────────────────────────────────────
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "music-rhythm-v3", version: "1.0.0" });
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
      const wait = m ? Number(m[1]) + 80 : TOOL_GAP_MS * 2;
      console.warn(`  ⏳ rate limit on ${name}, wait ${wait}ms`);
      await sleep(wait);
      continue;
    }
    console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 160).replace(/\s+/g, " ")}`);
    await sleep(TOOL_GAP_MS);
    return { ok: !r.isError, text: t };
  }
  return { ok: false, text: "RATE_LIMITED exhausted" };
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

const seqName = `Eternal Rhythm ${Date.now()}`;
console.log("\n=== ETERNAL RHYTHM ===\n", seqName);

await call("edit_bootstrap", { compact: true });
try {
  await call("checkpoint_create", { label: `pre-${seqName.slice(0, 18)}`, note: "music rhythm cut" });
} catch {
  /* */
}

const first = shots[0];
if (!first) {
  console.error("No shots");
  process.exit(2);
}

// Create sequence from first video
{
  const r = await call("edit_run", {
    stopOnError: true,
    compact: true,
    throttleMs: 150,
    plan: [
      { op: "sequence_from_media", paths: [first.path], name: seqName },
      { op: "set_active", query: seqName },
    ],
  });
  if (!r.ok) {
    console.error("FATAL create");
    await client.close();
    process.exit(2);
  }
}
await call("sequence_set_active_by_name", { query: seqName });

// Import all unique sources
const allPaths = [...new Set(shots.map((s) => s.path))];
await call("project_import_media", { paths: allPaths });
await sleep(600);

// Build name→id map
const idByBase = new Map();
function refreshIds(text) {
  const re = /"name"\s*:\s*"([^"]+)"\s*,\s*"id"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) idByBase.set(m[1].toLowerCase(), m[2]);
}
refreshIds((await call("project_list_items", { recursive: true })).text);

function mediaIdFor(filePath) {
  return idByBase.get(path.basename(filePath).toLowerCase());
}

// Trim seed first clip to first shot length only (timeline 0)
{
  const clips = parseJsonArr((await call("clip_list", { trackType: "video", trackIndex: 0 })).text);
  if (clips[0]) {
    await call("clip_trim", {
      trackType: "video",
      trackIndex: 0,
      clipIndex: 0,
      edge: "out",
      newTicks: sec(first.duration),
    });
  }
}

// Place remaining shots slowly
console.log("\nPlacing", shots.length, "shots…");
for (let s = 1; s < shots.length; s++) {
  const sh = shots[s];
  let mid = mediaIdFor(sh.path);
  if (!mid) {
    await call("project_import_media", { paths: [sh.path] });
    refreshIds((await call("project_list_items", { recursive: true })).text);
    mid = mediaIdFor(sh.path);
  }
  if (!mid) {
    console.warn("skip", sh.name);
    continue;
  }

  await call("clip_overwrite", {
    trackType: "video",
    trackIndex: 0,
    projectItemId: mid,
    atTicks: sec(sh.atSeconds),
  });

  // Find clip starting nearest to atSeconds and set out
  const clips = parseJsonArr((await call("clip_list", { trackType: "video", trackIndex: 0 })).text);
  let best = null;
  let bestD = 1e18;
  for (const c of clips) {
    const st = Number(c.startTicks) / Number(TPS);
    const d = Math.abs(st - sh.atSeconds);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best && bestD < 0.8) {
    await call("clip_trim", {
      trackType: "video",
      trackIndex: 0,
      clipIndex: best.clipIndex,
      edge: "out",
      newTicks: sec(sh.atSeconds + sh.duration),
    });
  }

  if (s % 8 === 0) {
    console.log(`  … ${s}/${shots.length}`);
    await sleep(800); // extra breather every 8 shots
  }
}

// Silence all linked video audio on A0–A2 (Level linear 0 = silent; no setMute API)
console.log("\nSilencing video audio…");
for (const ti of [0, 1]) {
  const clips = parseJsonArr((await call("clip_list", { trackType: "audio", trackIndex: ti })).text);
  for (const c of clips) {
    if (/eternal/i.test(c.name || "")) continue;
    await call("effect_set_param", {
      trackType: "audio",
      trackIndex: ti,
      clipIndex: c.clipIndex,
      effectIndex: 0,
      paramName: "Level",
      value: 0,
    });
  }
  console.log(`  A${ti}: silenced ${clips.filter((c) => !/eternal/i.test(c.name || "")).length}`);
}

// Music bed full length @ 0 dB on A2
console.log("\nMusic bed…");
await call("edit_once", {
  op: "music_bed",
  params: {
    path: MUSIC,
    trackIndex: 2,
    atSeconds: 0,
    gainDb: 0,
    durationSeconds: musicDur,
  },
  compact: false,
});

// Ensure music full out + gain
{
  const a2 = parseJsonArr((await call("clip_list", { trackType: "audio", trackIndex: 2 })).text);
  const musicClip = a2.find((c) => /eternal/i.test(c.name || "")) || a2[a2.length - 1];
  if (musicClip) {
    await call("clip_trim", {
      trackType: "audio",
      trackIndex: 2,
      clipIndex: musicClip.clipIndex,
      edge: "out",
      newTicks: sec(musicDur),
    });
    await call("audio_set_gain", {
      trackIndex: 2,
      clipIndex: musicClip.clipIndex,
      decibels: 0,
    });
    try {
      await call("audio_mute_track", { trackIndex: 2, muted: false });
    } catch {
      /* */
    }
    const g = await call("audio_get_gain", { trackIndex: 2, clipIndex: musicClip.clipIndex });
    console.log("Music:", g.text.slice(0, 180).replace(/\s+/g, " "));
  }
}

// Titles
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(1.2),
  text: "ETERNAL",
  style: "title",
  withBackground: false,
  colorHex: "FFFFFF",
  fontSize: 56,
  soften: true,
  preferPng: true,
  durationTicks: sec(3.5),
});
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(Math.max(5, musicDur - 6)),
  text: "RHYTHM",
  style: "caption",
  withBackground: true,
  colorHex: "F5F5F5",
  barColorHex: "000000",
  barAlpha: 170,
  fontSize: 40,
  soften: true,
  preferPng: true,
  durationTicks: sec(3),
});

await call("edit_run", {
  stopOnError: false,
  compact: true,
  throttleMs: 100,
  plan: [
    { op: "marker", atSeconds: 0, name: "INTRO" },
    { op: "marker", atSeconds: Math.min(45, musicDur * 0.2), name: "BUILD" },
    { op: "marker", atSeconds: Math.min(100, musicDur * 0.45), name: "MID" },
    { op: "marker", atSeconds: Math.min(160, musicDur * 0.72), name: "LATE" },
    { op: "marker", atSeconds: Math.max(0, musicDur - 10), name: "OUTRO" },
  ],
});

// Light grade first batch only
await call("edit_once", {
  op: "quality_pass",
  params: { look: "warm", maxGrade: 20, maxTransitions: 10, clipFrom: 0, throttleMs: 100 },
  compact: true,
});

const vclips = parseJsonArr((await call("clip_list", { trackType: "video", trackIndex: 0 })).text);
const a2 = parseJsonArr((await call("clip_list", { trackType: "audio", trackIndex: 2 })).text);
console.log("V0 clips:", vclips.length);
console.log(
  "A2 music:",
  a2.map((c) => `${c.name} ${((Number(c.endTicks) - Number(c.startTicks)) / Number(TPS)).toFixed(1)}s`),
);

await call("edit_verify", { compact: true });

const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(3), outputPath: path.join(desk, "ppmcp-eternal-intro.png") });
await call("sequence_screenshot", {
  atTicks: sec(Math.min(90, musicDur / 2)),
  outputPath: path.join(desk, "ppmcp-eternal-mid.png"),
});
await call("project_save", {});
try {
  await call("checkpoint_create", { label: `done-${seqName.slice(0, 16)}`, note: "Eternal rhythm complete" });
} catch {
  /* */
}

console.log(`
=== DONE ===
Sequence: ${seqName}
Music: Eternal.mp3 ${musicDur.toFixed(1)}s @ 0 dB (A2)
Shots: ${shots.length} beat-driven (BPM~${bpm})
Video audio: Level 0 on A0/A1
Sources: video2 (${videos.length} files)
Desktop: ppmcp-eternal-intro.png / ppmcp-eternal-mid.png
`);
await client.close();
process.exit(0);

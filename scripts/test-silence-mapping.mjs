#!/usr/bin/env node
/**
 * workflow_clean_silence: source-time → sequence-time marker mapping.
 *  1. Unit tests of server/dist/silenceMapping.js (no Premiere, no ffmpeg).
 *  2. End-to-end: real ffmpeg silencedetect on a generated WAV with known
 *     silences + a mocked relay, checking the marker.add ticks. Skipped
 *     (not failed) when ffmpeg isn't installed.
 * Run after `npm run build --workspace=server`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { mapSourceRegionsToSequence, mapRegionToClip, sameMediaPath } = await imp("server/dist/silenceMapping.js");

const T = 254016000000n;
const t = (sec) => String(BigInt(Math.round(sec * 1000)) * (T / 1000n));
const reg = (a, b) => ({ startTicks: t(a), endTicks: t(b) });
const MEDIA = "C:\\Footage\\talk.wav";
const clip = (o) => ({ clipIndex: 0, trackType: "audio", trackIndex: 0, mediaFilePath: MEDIA, speed: 1, ...o });

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split("\n").join("\n     ")}`);
  }
}
const seq = (m) => [m.sequenceStartTicks, m.sequenceEndTicks];

test("clip at sequence start, untrimmed: sequence time == source time", () => {
  const r = mapSourceRegionsToSequence([reg(1, 2), reg(3, 4.5)], [clip({ startTicks: t(0), endTicks: t(6), inPointTicks: t(0), outPointTicks: t(6) })], MEDIA);
  assert.equal(r.matchedClips, 1);
  assert.deepEqual(r.mapped.map(seq), [[t(1), t(2)], [t(3), t(4.5)]]);
});

test("clip offset in the sequence: shifted by clip start", () => {
  const r = mapSourceRegionsToSequence([reg(1, 2)], [clip({ startTicks: t(10), endTicks: t(16), inPointTicks: t(0), outPointTicks: t(6) })], MEDIA);
  assert.deepEqual(r.mapped.map(seq), [[t(11), t(12)]]);
  assert.equal(r.mapped[0].sourceStartTicks, t(1));
});

test("trimmed in point: start + (t - inPoint)", () => {
  const r = mapSourceRegionsToSequence([reg(3, 4.5)], [clip({ startTicks: t(10), endTicks: t(14), inPointTicks: t(2), outPointTicks: t(6) })], MEDIA);
  assert.deepEqual(r.mapped.map(seq), [[t(11), t(12.5)]]);
});

test("regions outside the trim are dropped, straddling ones clipped", () => {
  const regions = [reg(0.2, 0.8), reg(1.5, 2.5), reg(3, 3.5), reg(4.5, 5.5), reg(6, 7)];
  const r = mapSourceRegionsToSequence(regions, [clip({ startTicks: t(10), endTicks: t(13), inPointTicks: t(2), outPointTicks: t(5) })], MEDIA);
  assert.deepEqual(r.mapped.map(seq), [[t(10), t(10.5)], [t(11), t(11.5)], [t(12.5), t(13)]]);
  assert.deepEqual([r.mapped[0].sourceStartTicks, r.mapped[2].sourceEndTicks], [t(2), t(5)]);
});

test("multiple instances: one marker range per instance, sorted, linked A/V deduped", () => {
  const clips = [
    clip({ clipIndex: 1, startTicks: t(30), endTicks: t(36), inPointTicks: t(0), outPointTicks: t(6) }),
    clip({ clipIndex: 0, startTicks: t(5), endTicks: t(11), inPointTicks: t(0), outPointTicks: t(6) }),
    clip({ clipIndex: 0, trackType: "video", startTicks: t(5), endTicks: t(11), inPointTicks: t(0), outPointTicks: t(6) }),
  ];
  const r = mapSourceRegionsToSequence([reg(1, 2)], clips, MEDIA);
  assert.equal(r.matchedClips, 3);
  assert.deepEqual(r.mapped.map(seq), [[t(6), t(7)], [t(31), t(32)]]);
});

test("clip not found (other media only): no mapped regions, matchedClips 0", () => {
  const r = mapSourceRegionsToSequence([reg(1, 2)], [clip({ mediaFilePath: "C:\\Footage\\other.wav", startTicks: t(0), endTicks: t(6) })], MEDIA);
  assert.equal(r.matchedClips, 0);
  assert.deepEqual(r.mapped, []);
});

test("clip without mediaFilePath (older plugin) never matches", () => {
  const r = mapSourceRegionsToSequence([reg(1, 2)], [clip({ mediaFilePath: undefined, startTicks: t(0), endTicks: t(6) })], MEDIA);
  assert.equal(r.matchedClips, 0);
});

test("speed 2x halves sequence offsets and durations", () => {
  const m = mapRegionToClip(reg(3, 4), clip({ startTicks: t(20), endTicks: t(22), inPointTicks: t(1), outPointTicks: t(5), speed: 2 }));
  assert.deepEqual(seq(m), [t(21), t(21.5)]);
});

test("speed 0.5x doubles; missing outPoint derived from duration*speed", () => {
  const m = mapRegionToClip(reg(1, 1.5), clip({ startTicks: t(0), endTicks: t(4), inPointTicks: t(0), outPointTicks: undefined, speed: 0.5 }));
  assert.deepEqual(seq(m), [t(2), t(3)]);
  assert.equal(mapRegionToClip(reg(2.5, 3), clip({ startTicks: t(0), endTicks: t(4), inPointTicks: t(0), speed: 0.5 })), undefined);
});

test("reversed clip (negative speed) is skipped rather than misplaced", () => {
  assert.equal(mapRegionToClip(reg(1, 2), clip({ startTicks: t(0), endTicks: t(6), speed: -1 })), undefined);
});

test("path comparison ignores slash direction and case", () => {
  assert.ok(sameMediaPath("C:\\Footage\\Talk.WAV", "c:/footage/talk.wav"));
  assert.ok(!sameMediaPath("", ""));
  assert.ok(!sameMediaPath("C:/a.wav", "C:/b.wav"));
});

// ---------------------------------------------------------------- e2e
const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
if (ff.status !== 0) {
  console.log("skip e2e: ffmpeg not installed");
} else {
  const { workflowTools } = await imp("server/dist/tools/workflow.js");
  const tool = workflowTools.find((x) => x.name === "workflow_clean_silence");
  const wav = path.join(os.tmpdir(), `ppmcp-silence-e2e-${process.pid}.wav`);
  // tone 1s | silence 1s | tone 1s | silence 1.5s | tone 1s  → silences at 1–2 s and 3–4.5 s
  const tone = "sine=frequency=440:sample_rate=48000:duration=1";
  const sil = (d) => `anullsrc=r=48000:cl=mono:d=${d}`;
  const mk = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", tone, "-f", "lavfi", "-i", sil(1), "-f", "lavfi", "-i", tone, "-f", "lavfi", "-i", sil(1.5), "-f", "lavfi", "-i", tone,
    "-filter_complex", "[0][1][2][3][4]concat=n=5:v=0:a=1", "-ac", "1", wav], { encoding: "utf8", windowsHide: true });
  assert.equal(mk.status, 0, mk.stderr);

  const sequenceClips = {
    "audio:0": [
      // instance A: at 10 s, trimmed to source 0.5–5.0 s
      { clipIndex: 0, startTicks: t(10), endTicks: t(14.5), inPointTicks: t(0.5), outPointTicks: t(5), speed: 1, mediaFilePath: wav.toUpperCase() },
      { clipIndex: 1, startTicks: t(14.5), endTicks: t(18), inPointTicks: t(0), outPointTicks: t(3.5), speed: 1, mediaFilePath: "/other.wav" },
    ],
    "audio:1": [
      // instance B: at 20 s, source 2.5–5.5 s at 2x → 1.5 s long
      { clipIndex: 0, startTicks: t(20), endTicks: t(21.5), inPointTicks: t(2.5), outPointTicks: t(5.5), speed: 2, mediaFilePath: wav },
    ],
    "video:0": [],
  };
  const makeRelay = (clipsByTrack) => {
    const added = [];
    return {
      added,
      relay: {
        async call(method, params) {
          if (method === "track.list")
            return Object.keys(clipsByTrack).map((k) => ({ trackType: k.split(":")[0], trackIndex: Number(k.split(":")[1]) }));
          if (method === "clip.list") return clipsByTrack[`${params.trackType}:${params.trackIndex}`] ?? [];
          if (method === "marker.add") {
            added.push(params);
            return { ok: true };
          }
          throw new Error(`unexpected relay call ${method}`);
        },
      },
    };
  };
  const run = (relay, extra = {}) =>
    tool.handler({ mediaPath: wav, noiseDb: -30, minDuration: 0.4, addMarkers: true, maxMarkers: 40, ...extra }, relay);
  const sec = (ticks) => Number(BigInt(ticks)) / Number(T);
  const near = (a, b) => Math.abs(a - b) <= 0.03;

  const m1 = makeRelay(sequenceClips);
  const out = await run(m1);
  const src = out.data.regions.map((r) => [r.startSeconds, r.endSeconds]);
  console.log("e2e ffmpeg source regions (s):", JSON.stringify(src.map((x) => x.map((v) => +v.toFixed(3)))));
  test("e2e: ffmpeg finds the two generated silences (1–2 s, 3–4.5 s)", () => {
    assert.equal(src.length, 2);
    assert.ok(near(src[0][0], 1) && near(src[0][1], 2) && near(src[1][0], 3) && near(src[1][1], 4.5), JSON.stringify(src));
  });
  // Expected from the generated layout:
  //  A (start 10, in 0.5): 1→10.5, 3→12.5           B (start 20, in 2.5, 2x): 3→20.25
  const expected = [10.5, 12.5, 20.25];
  const actual = m1.added.map((a) => sec(a.atTicks));
  console.log("e2e marker atTicks (s) expected:", JSON.stringify(expected), "actual:", JSON.stringify(actual.map((v) => +v.toFixed(4))));
  console.log("e2e marker names:", JSON.stringify(m1.added.map((a) => a.name)));
  test("e2e: markers land at sequence time for both instances", () => {
    assert.equal(actual.length, expected.length, JSON.stringify(actual));
    actual.forEach((v, i) => assert.ok(near(v, expected[i]), `marker ${i}: expected ${expected[i]}, got ${v}`));
    assert.equal(out.data.matchedClips, 2);
  });
  test("e2e: durations reflect trim and speed (1.0 s, 1.5 s, 0.75 s)", () => {
    const d = out.data.sequenceRegions.map((r) => sec(r.sequenceEndTicks) - sec(r.sequenceStartTicks));
    [1, 1.5, 0.75].forEach((x, i) => assert.ok(near(d[i], x), JSON.stringify(d)));
  });

  const m2 = makeRelay({ "audio:0": [sequenceClips["audio:0"][1]] });
  const out2 = await run(m2);
  test("e2e: media not in sequence → no markers, clear note, regions still returned", () => {
    assert.equal(m2.added.length, 0);
    assert.equal(out2.data.matchedClips, 0);
    assert.match(out2.data.note, /not found in the sequence/);
    assert.equal(out2.data.regions.length, 2);
  });

  const m3 = makeRelay({});
  await run(m3, { sequenceOffsetSeconds: 60 });
  test("e2e: sequenceOffsetSeconds places markers at offset + file time", () => {
    const a = m3.added.map((x) => sec(x.atTicks));
    assert.equal(a.length, 2);
    assert.ok(near(a[0], 61) && near(a[1], 63), JSON.stringify(a));
  });
  fs.rmSync(wav, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

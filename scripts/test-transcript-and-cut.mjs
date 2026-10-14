#!/usr/bin/env node
/**
 * transcript_get / transcript_find_phrase / workflow_cut_silence.
 *  1. Unit tests of server/dist/transcriptMapping.js and silenceCut.js
 *     (no Premiere, no ffmpeg).
 *  2. End-to-end: real ffmpeg silencedetect on a generated WAV + a mocked
 *     relay that simulates split / ripple delete, checking the dry-run plan,
 *     the planToken guard and the timeline after apply. Skipped (not failed)
 *     when ffmpeg isn't installed.
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
const { parsePremiereTranscript, mapTranscriptToSequence, findPhrase, normalizeToken } = await imp("server/dist/transcriptMapping.js");
const { planSilenceCuts } = await imp("server/dist/silenceCut.js");

const T = 254016000000n;
const t = (sec) => String(BigInt(Math.round(sec * 1000)) * (T / 1000n));
const sec = (ticks) => Number(BigInt(ticks)) / Number(T);
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;
const MEDIA = "C:\\Footage\\talk.wav";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split("\n").join("\n     ")}`);
  }
}

// Shape of Premiere 26.5's Transcript.exportToJSON (trimmed from a live export).
const w = (text, start, duration, eos = false) => ({ confidence: 1, duration, eos, start, tags: [], text, type: "word" });
const PREMIERE_JSON = JSON.stringify({
  language: "en-us",
  segments: [
    { start: 0, duration: 1.7, speaker: "s1", language: "en-us", words: [w("Welcome", 0, 0.48), w("to", 0.48, 0.12), w("the", 0.6, 0.12), w("editing", 0.72, 0.4), w("test.", 1.14, 0.52, true)] },
    { start: 4.22, duration: 2.76, speaker: "s1", language: "en-us", words: [w("The", 4.22, 0.28), w("lazy", 6.14, 0.36), w("dog.", 6.5, 0.48, true)] },
  ],
  speakers: [{ id: "s1", name: "Unknown" }],
});
const clip = (o) => ({ clipIndex: 0, trackType: "audio", trackIndex: 0, mediaFilePath: MEDIA, speed: 1, ...o });

await test("parse: segments, words and text from Premiere JSON", () => {
  const tr = parsePremiereTranscript(PREMIERE_JSON);
  assert.equal(tr.language, "en-us");
  assert.equal(tr.segments.length, 2);
  assert.equal(tr.segments[0].text, "Welcome to the editing test.");
  assert.equal(tr.segments[1].words.length, 3);
  assert.ok(near(sec(tr.segments[1].words[2].endTicks), 6.98));
});

await test("parse: rejects JSON without segments", () => {
  assert.throws(() => parsePremiereTranscript("{}"), /segments/);
});

await test("map: untrimmed clip at 0 keeps source times", () => {
  const tr = parsePremiereTranscript(PREMIERE_JSON);
  const r = mapTranscriptToSequence(tr, [clip({ startTicks: t(0), endTicks: t(12), inPointTicks: t(0), outPointTicks: t(12) })], MEDIA, "segments");
  assert.equal(r.items.length, 2);
  assert.ok(near(r.items[1].sequenceStartSeconds, 4.22));
});

await test("map: trimmed second instance at 19 s (in 4.0) shifts words and drops hidden ones", () => {
  const tr = parsePremiereTranscript(PREMIERE_JSON);
  const clips = [
    clip({ startTicks: t(0), endTicks: t(12), inPointTicks: t(0), outPointTicks: t(12) }),
    clip({ clipIndex: 1, startTicks: t(19), endTicks: t(27), inPointTicks: t(4), outPointTicks: t(12) }),
  ];
  const r = mapTranscriptToSequence(tr, clips, MEDIA, "words");
  assert.equal(r.instances, 2);
  const inst1 = r.items.filter((i) => i.instance === 1).map((i) => i.text);
  assert.deepEqual(inst1, ["The", "lazy", "dog."]);
  const lazy = r.items.find((i) => i.instance === 1 && i.text === "lazy");
  assert.ok(near(lazy.sequenceStartSeconds, 21.14));
});

await test("map: linked A/V halves of one instance count once; other media ignored", () => {
  const tr = parsePremiereTranscript(PREMIERE_JSON);
  const base = { startTicks: t(0), endTicks: t(12), inPointTicks: t(0), outPointTicks: t(12) };
  const r = mapTranscriptToSequence(
    tr,
    [clip(base), clip({ ...base, trackType: "video" }), clip({ ...base, clipIndex: 3, mediaFilePath: "C:/other.wav", startTicks: t(30), endTicks: t(40) })],
    MEDIA.replace(/\\/g, "/").toUpperCase(),
    "segments",
  );
  assert.equal(r.instances, 1);
  assert.equal(r.items.length, 2);
});

await test("phrase: case/punctuation-insensitive, one hit per instance", () => {
  const tr = parsePremiereTranscript(PREMIERE_JSON);
  const clips = [
    clip({ startTicks: t(0), endTicks: t(12), inPointTicks: t(0), outPointTicks: t(12) }),
    clip({ clipIndex: 1, startTicks: t(19), endTicks: t(27), inPointTicks: t(4), outPointTicks: t(12) }),
  ];
  const words = mapTranscriptToSequence(tr, clips, MEDIA, "words").items;
  const hits = findPhrase(words, "Lazy, DOG");
  assert.equal(hits.length, 2);
  assert.ok(near(hits[0].sequenceStartSeconds, 6.14) && near(hits[0].sequenceEndSeconds, 6.98));
  assert.ok(near(hits[1].sequenceStartSeconds, 21.14) && near(hits[1].sequenceEndSeconds, 21.98));
  assert.equal(findPhrase(words, "lazy cat").length, 0);
  assert.equal(findPhrase(words, "  ").length, 0);
  assert.equal(normalizeToken("Don't!"), "dont");
});

// ---- silence cut planning ----
const region = (a, b, o = {}) => ({ trackType: "audio", trackIndex: 0, clipIndex: 0, sequenceStartTicks: t(a), sequenceEndTicks: t(b), sourceStartTicks: t(a), sourceEndTicks: t(b), ...o });
const C0 = clip({ startTicks: t(0), endTicks: t(12), inPointTicks: t(0), outPointTicks: t(12) });
const opts = (o = {}) => ({ paddingTicks: BigInt(t(0.1)), minCutTicks: BigInt(t(0.2)), tokenSeed: "seed", ...o });

await test("plan: padding on speech sides only, tail flush to clip end, latest cut first", () => {
  const p = planSilenceCuts([region(1.5, 4.4), region(11, 12)], [C0], opts());
  assert.equal(p.cuts.length, 2);
  assert.ok(near(sec(p.cuts[0].startTicks), 11.1) && near(sec(p.cuts[0].endTicks), 12));
  assert.ok(near(sec(p.cuts[1].startTicks), 1.6) && near(sec(p.cuts[1].endTicks), 4.3));
  assert.ok(near(sec(p.totalRemovedTicks), 0.9 + 2.7));
});

await test("plan: cuts shorter than minCut after padding are skipped", () => {
  const p = planSilenceCuts([region(2, 2.35)], [C0], opts());
  assert.equal(p.cuts.length, 0);
  assert.equal(p.skipped.length, 1);
});

await test("plan: frame snapping rounds inward (never eats speech)", () => {
  const f = 10160640000n; // 25 fps
  const p = planSilenceCuts([region(1.523, 4.417)], [C0], opts({ frameTicks: f }));
  const s = BigInt(p.cuts[0].startTicks);
  const e = BigInt(p.cuts[0].endTicks);
  assert.equal(s % f, 0n);
  assert.equal(e % f, 0n);
  assert.ok(sec(s) >= 1.623 && sec(e) <= 4.317);
});

await test("plan: non-100% speed clips are skipped with a reason", () => {
  const p = planSilenceCuts([region(1, 3)], [{ ...C0, speed: 2 }], opts());
  assert.equal(p.cuts.length, 0);
  assert.match(p.skipped[0].reason, /speed/);
});

await test("plan: overlapping ranges merge; token is stable and seed-sensitive", () => {
  const a = planSilenceCuts([region(1, 3), region(2.5, 5)], [C0], opts());
  assert.equal(a.cuts.length, 1);
  assert.ok(near(sec(a.cuts[0].startTicks), 1.1) && near(sec(a.cuts[0].endTicks), 4.9));
  const b = planSilenceCuts([region(1, 3), region(2.5, 5)], [C0], opts());
  const c = planSilenceCuts([region(1, 3), region(2.5, 5)], [C0], opts({ tokenSeed: "other" }));
  assert.equal(a.token, b.token);
  assert.notEqual(a.token, c.token);
});

// ---- e2e with ffmpeg + simulated timeline ----
const { findFfmpeg } = await imp("server/dist/mediaAnalysis.js");
const ff = findFfmpeg();
if (!ff) {
  console.log("skip e2e: ffmpeg not found");
} else {
  const wav = path.join(os.tmpdir(), `ppmcp-cut-${Date.now()}.wav`);
  // tone 1.5 s | silence 3 s | tone 2 s | silence 2.5 s | tone 1 s  = 10 s
  const g = spawnSync(ff, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.5",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=2.5",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
    "-filter_complex", "[0][1][2][3][4]concat=n=5:v=0:a=1", wav,
  ]);
  assert.equal(g.status, 0, String(g.stderr));
  const { workflowTools } = await imp("server/dist/tools/workflow.js");
  const tool = workflowTools.find((x) => x.name === "workflow_cut_silence");
  const FRAME = 10160640000n;

  // Simulated timeline: one audio track holding the WAV at 0..10 s.
  const makeTimeline = () => {
    let items = [{ startTicks: 0n, endTicks: BigInt(t(10)), inPointTicks: 0n }];
    const calls = [];
    const view = () => items.map((i, k) => ({ clipIndex: k, startTicks: String(i.startTicks), endTicks: String(i.endTicks), inPointTicks: String(i.inPointTicks), outPointTicks: String(i.inPointTicks + i.endTicks - i.startTicks), speed: 1, mediaFilePath: wav }));
    return {
      calls,
      items: () => items,
      relay: {
        async call(method, p) {
          calls.push(method);
          if (method === "track.list") return [{ trackType: "audio", trackIndex: 0 }];
          if (method === "clip.list") return view();
          if (method === "sequence.getSettings") return { timebaseTicksPerFrame: String(FRAME) };
          if (method === "clip.split") {
            const at = BigInt(p.atTicks);
            const it = items[p.clipIndex];
            assert.ok(at > it.startTicks && at < it.endTicks, "split outside clip");
            const right = { startTicks: at, endTicks: it.endTicks, inPointTicks: it.inPointTicks + (at - it.startTicks) };
            it.endTicks = at;
            items.splice(p.clipIndex + 1, 0, right);
            return { split: true };
          }
          if (method === "clip.rippleDelete") {
            const it = items[p.clipIndex];
            const d = it.endTicks - it.startTicks;
            items.splice(p.clipIndex, 1);
            for (const o of items) if (o.startTicks >= it.endTicks) { o.startTicks -= d; o.endTicks -= d; }
            return { deleted: true };
          }
          throw new Error(`unexpected relay call ${method}`);
        },
      },
    };
  };
  const args = (o = {}) => ({ mediaPath: wav, noiseDb: -30, minDuration: 0.4, paddingSeconds: 0.1, minCutSeconds: 0.2, confirm: false, ...o });

  const tl = makeTimeline();
  const dry = await tool.handler(args(), tl);
  await test("e2e: dry run plans 2 cuts (~2.8 s + ~2.3 s) and changes nothing", () => {
    assert.equal(dry.data.dryRun, true);
    assert.equal(dry.data.cuts.length, 2, JSON.stringify(dry.data.cuts));
    assert.ok(near(dry.data.cuts[0].startSeconds, 1.6, 0.05) && near(dry.data.cuts[0].endSeconds, 4.4, 0.05), JSON.stringify(dry.data.cuts));
    assert.ok(near(dry.data.cuts[1].startSeconds, 6.6, 0.05) && near(dry.data.cuts[1].endSeconds, 8.9, 0.05), JSON.stringify(dry.data.cuts));
    assert.ok(!tl.calls.includes("clip.split") && !tl.calls.includes("clip.rippleDelete"));
  });
  const bad = await tool.handler(args({ confirm: true, planToken: "nope" }), tl);
  await test("e2e: confirm with a wrong planToken is refused and changes nothing", () => {
    assert.equal(bad.data.refused, true);
    assert.ok(!tl.calls.includes("clip.split") && !tl.calls.includes("clip.rippleDelete"));
    assert.equal(JSON.stringify(bad).includes(dry.data.planToken), false, "refusal must not leak the token");
  });
  const applied = await tool.handler(args({ confirm: true, planToken: dry.data.planToken }), tl);
  await test("e2e: apply ripple-deletes both ranges, back to front, speech intact", () => {
    assert.equal(applied.data.applied, true);
    assert.deepEqual(applied.data.results.map((r) => r.ok), [true, true]);
    assert.ok(applied.data.results[0].startSeconds > applied.data.results[1].startSeconds, "must cut latest first");
    const it = tl.items();
    assert.equal(it.length, 3);
    const total = sec(it[it.length - 1].endTicks);
    assert.ok(near(total, 10 - dry.data.totalSecondsRemoved, 0.001), `${total}`);
    for (let k = 1; k < it.length; k++) assert.equal(it[k].startTicks, it[k - 1].endTicks, "no gaps");
    // Each kept piece still covers its tone (source 0-1.5, 4.5-6.5, 9-10).
    const src = it.map((i) => [sec(i.inPointTicks), sec(i.inPointTicks + i.endTicks - i.startTicks)]);
    assert.ok(src[0][0] <= 0 && src[0][1] >= 1.5, JSON.stringify(src));
    assert.ok(src[1][0] <= 4.55 && src[1][1] >= 6.45, JSON.stringify(src));
    assert.ok(src[2][0] <= 9.05 && src[2][1] >= 10 - 0.001, JSON.stringify(src));
  });
  const again = await tool.handler(args({ confirm: true, planToken: dry.data.planToken }), tl);
  await test("e2e: replaying the old token after the edit is refused", () => {
    assert.equal(again.data.refused, true);
  });
  fs.rmSync(wav, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

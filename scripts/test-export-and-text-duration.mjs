#!/usr/bin/env node
/**
 * Static tests (no Premiere): default export preset resolution, Windows path
 * normalisation, clear errors on started=false / missing preset, and
 * text_add duration clip lookup. Run after `npm run build --workspace=server`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const ex = await imp("server/dist/exportPreset.js");
const { findClipAt } = await imp("server/dist/tools/title.js");

const env = { ProgramFiles: "C:\\Program Files" };
const pp26 = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\MediaIO\\systempresets\\3F3F3F3F_4D6F6F56\\H264 Match Source - High bitrate.epr";
const adaptive = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\CEP\\extensions\\com.adobe.frameio.v4\\assets\\epr\\Match Source - Adaptive High Bitrate.epr";

// paths
assert.equal(ex.toNativePath("C:/Users/x/out.mp4", "linux"), "C:\\Users\\x\\out.mp4");
assert.equal(ex.toNativePath("/tmp/a.mp4", "linux"), "/tmp/a.mp4");
assert.equal(ex.toNativePath("D:/a/b", "win32"), "D:\\a\\b");

// default preset resolution
const cands = ex.listDefaultExportPresetCandidates(env, "win32");
assert.equal(cands[0], pp26);
assert.ok(cands.includes(adaptive));
assert.equal(ex.resolveDefaultExportPreset((p) => p === pp26, env, "win32").path, pp26);
assert.equal(ex.resolveDefaultExportPreset((p) => p === adaptive, env, "win32").path, adaptive);
assert.equal(ex.resolveDefaultExportPreset(() => false, env, "win32").path, null);

// prepare: omitted preset -> auto, forward slashes normalised, folder created
const made = [];
const existing = new Set([pp26]);
const r = ex.prepareExportParams(
  { outputPath: "C:/Users/x/Desktop/out.mp4" },
  { exists: (p) => existing.has(p), mkdir: (d) => made.push(d), env, platform: "win32" },
);
assert.equal(r.presetPath, pp26);
assert.equal(r.presetAuto, true);
assert.equal(r.outputPath, "C:\\Users\\x\\Desktop\\out.mp4");
assert.deepEqual(made, ["C:\\Users\\x\\Desktop"]);

// preset forward slashes normalised and kept
const r2 = ex.prepareExportParams(
  { outputPath: "C:\\o\\a.mp4", presetPath: pp26.replace(/\\/g, "/") },
  { exists: () => true, env, platform: "win32" },
);
assert.equal(r2.presetPath, pp26);
assert.equal(r2.presetAuto, false);

// clear errors
assert.throws(() => ex.prepareExportParams({ outputPath: "C:\\o\\a.mp4", presetPath: "C:\\nope.epr" }, { exists: (p) => p === "C:\\o", env, platform: "win32" }), /preset not found/);
assert.throws(() => ex.prepareExportParams({ outputPath: "C:\\o\\a.mp4" }, { exists: () => false, mkdir: () => {}, env, platform: "win32" }), /no presetPath given/);
assert.throws(() => ex.prepareExportParams({}, { exists: () => true, env, platform: "win32" }), /outputPath is required/);
assert.throws(() => ex.assertExportStarted({ started: false }, r), /did not start/);
ex.assertExportStarted({ started: true }, r);

// callExportSequence end-to-end with mocked relay (uses real fs: only error path is deterministic here)
const relay = { call: async () => ({ started: false }) };
await assert.rejects(ex.callExportSequence({ relay }, { outputPath: "C:\\o\\a.mp4", presetPath: "C:\\definitely-missing.epr" }), /preset not found/);

// text_add duration: find PNG clip placed at atTicks
const T = 254016000000n;
const clips = [
  { clipIndex: 0, startTicks: "0" },
  { clipIndex: 1, startTicks: String(2n * T) },
  { clipIndex: 2, startTicks: String(5n * T) },
];
assert.equal(findClipAt(clips, String(2n * T)), 1);
assert.equal(findClipAt(clips, String(5n * T + 1000n)), 2);
assert.equal(findClipAt(clips, String(9n * T), 7), 7);
assert.equal(findClipAt([], "0"), undefined);

console.log("test-export-and-text-duration: OK");

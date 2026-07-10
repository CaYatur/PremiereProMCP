#!/usr/bin/env node
/** Offline unit smoke for mediaAnalysis (ffmpeg silence/onsets) — no Premiere. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Import compiled JS (file:// required on Windows)
const maUrl = pathToFileURL(path.join(root, "server/dist/mediaAnalysis.js")).href;
const ma = await import(maUrl);

const wav = path.join(os.tmpdir(), `ppmcp-ma-test-${Date.now()}.wav`);
// tone + silence
const r = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.5",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-filter_complex",
    "[0][1]concat=n=2:v=0:a=1",
    "-t",
    "1.5",
    wav,
  ],
  { encoding: "utf8", windowsHide: true, timeout: 30000 },
);

if (!fs.existsSync(wav)) {
  console.error("FAIL: could not create test wav", r.stderr?.slice(-300));
  process.exit(1);
}

console.log("ffmpeg:", ma.findFfmpeg());
const sil = ma.detectSilenceInFile(wav, { noiseDb: -40, minDuration: 0.2 });
console.log("silence regions:", sil.regions.length, sil.engine);
const on = ma.detectOnsetsInFile(wav, { maxEvents: 20, sensitivity: 0.4 });
console.log("onsets:", on.events.length, on.engine, on.events.slice(0, 3));
const srt = ma.segmentsToSrt([
  {
    startSeconds: 0,
    endSeconds: 1,
    startTicks: "0",
    endTicks: "254016000000",
    text: "hello",
  },
]);
const parsed = ma.parseSrt(srt);
console.log("srt roundtrip:", parsed.length === 1 && parsed[0].text === "hello");

let ok = sil.regions.length >= 0 && on.events.length >= 0 && parsed.length === 1;
console.log(ok ? "PASS mediaAnalysis offline" : "FAIL");
try {
  fs.unlinkSync(wav);
} catch {
  /* */
}
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
/**
 * Live edit using C:\Users\cagan\Desktop\editsource\_extracted assets.
 * Requires: Premiere + UXP plugin + bridge :8265
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const SRC = "C:\\Users\\cagan\\Desktop\\editsource\\_extracted";

const videos = [
  path.join(SRC, "clip_backrooms_12s.mp4"),
  path.join(SRC, "clip_pt2_10s.mp4"),
  path.join(SRC, "clip_cayatur_10s.mp4"),
  path.join(SRC, "still_f001_3s.mp4"),
  path.join(SRC, "still_f010_3s.mp4"),
];
const sfx = {
  whoosh1: path.join(SRC, "whoosh_01.wav"),
  whoosh2: path.join(SRC, "whoosh_03.wav"),
  whoosh3: path.join(SRC, "whoosh_05.wav"),
  impact: path.join(SRC, "recordx_media-impact-sound-effect-335395.mp3"),
  boom: path.join(SRC, "bom.wav"),
  switch: path.join(SRC, "rajatchoudhary-light-switch-on-sound-effect-354589.mp3"),
  bulb: path.join(SRC, "kave_msri-lightbulb-break-sfx-320646.mp3"),
  jump: path.join(SRC, "unr3al_backr00ms-backrooms-smiler-jumpscare-123798.mp3"),
  amb: path.join(SRC, "ambience_buzz_12s.wav"),
  fluo: path.join(SRC, "ambience_fluo_6s.wav"),
  shutter: path.join(SRC, "alexis_gaming_cam-camera-shutter-346101.mp3"),
};

for (const p of [...videos, ...Object.values(sfx)]) {
  if (!fs.existsSync(p)) {
    console.error("MISSING", p);
    process.exit(1);
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-live-edit", version: "0.1.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");
}

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const t = textOf(r);
  const ok = !r.isError;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${t.slice(0, 220)}`);
  return { ok, text: t, raw: r };
}

console.log("=== LIVE EDIT: editsource Backrooms pack ===\n");

const st = await call("app_get_connection_status");
if (!st.ok && !st.text.includes("true") && !st.text.includes("plugin")) {
  /* continue — parse loosely */
}
if (/pluginConnected.: false|plugin=false|not connected/i.test(st.text) && !/pluginConnected.: true/i.test(st.text)) {
  // try bootstrap
  const b = await call("edit_bootstrap", { compact: true });
  if (/Not ready|not connected|load UXP/i.test(b.text)) {
    console.error("\nPremiere UXP plugin not connected. Load plugin + bridge, then re-run.");
    await client.close();
    process.exit(1);
  }
}

await call("edit_bootstrap", { compact: true });
await call("text_bridge_ensure", {});
await call("analyze_media_capabilities", {});

// Onset analysis on long whoosh library (original long file)
const longWhoosh =
  "C:\\Users\\cagan\\Desktop\\editsource\\audio\\20 CINEMATIC WHOOSH Sound Effects (No Copyright).mp3";
await call("analyze_detect_onsets", {
  mediaPath: longWhoosh,
  maxEvents: 15,
  sensitivity: 0.4,
  addMarkers: false,
});
await call("analyze_detect_silence", {
  mediaPath: path.join(SRC, "ambience_buzz_12s.wav"),
  noiseDb: -35,
  minDuration: 0.3,
  addMarkers: false,
});

// Full automatic cut
const auto = await call("edit_auto", {
  intent: "animation cinematic trailer backrooms",
  args: {
    paths: videos,
    name: `Backrooms Edit ${Date.now()}`,
    title: "BACKROOMS",
    subtitle: "Do not enter",
    look: "cool",
    musicPath: sfx.amb,
    musicGainDb: -14,
    sfxHits: [
      { path: sfx.switch, atSeconds: 0.3 },
      { path: sfx.whoosh1, atSeconds: 2.0 },
      { path: sfx.impact, atSeconds: 5.5 },
      { path: sfx.whoosh2, atSeconds: 12.0 },
      { path: sfx.bulb, atSeconds: 15.0 },
      { path: sfx.whoosh3, atSeconds: 22.0 },
      { path: sfx.jump, atSeconds: 28.0 },
      { path: sfx.boom, atSeconds: 30.0 },
      { path: sfx.shutter, atSeconds: 8.0 },
      { path: sfx.fluo, atSeconds: 1.0 },
    ],
    sfxGainDb: -4,
    kenBurns: true,
    filmLook: true,
    endCard: "LEVEL 0 — EXIT?",
    endCardLeadSeconds: 4,
  },
  stopOnError: false,
  compact: true,
});

// Delivery polish
await call("edit_delivery", {
  look: "cool",
  filmLook: true,
  kenBurns: true,
  normalizeAudio: true,
  verify: false,
});

// Extra title lower third style
await call("text_write", {
  trackIndex: 2,
  atTicks: String(BigInt(Math.floor(3 * 254016000000))),
  text: "ENTITY NEARBY",
  style: "lower_third",
  appearance: "plain",
});

// Chapter markers
await call("edit_playbook_run", {
  playbook: "chapters",
  args: {},
  stopOnError: false,
});

// QA
await call("edit_verify", { capture: true });
await call("sequence_export_still", { frame: 0 });
await call("workflow_summarize_timeline", {});
await call("project_save", {});

console.log("\n=== DONE live edit ===");
console.log("Check Premiere active sequence 'Backrooms Edit …'");
await client.close();
process.exit(0);

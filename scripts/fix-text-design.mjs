#!/usr/bin/env node
/** Apply new auto-design: corner text + fitted PNG plates + soft. Save frame to Desktop. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-design-v4", version: "0.4.0" });
await client.connect(transport);

const textOf = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${textOf(r).slice(0, 220)}`);
  return r;
}

const desktop = path.join(os.homedir(), "Desktop", "ppmcp-frame-now.png");

console.log("=== Auto text design + desktop screenshot ===\n");
await call("edit_bootstrap", { compact: true });
await call("sequence_set_active_by_name", { query: "Backrooms" });
await call("text_design_guide", {});

// Clean design overlays: title top-left + LT + optional end card
await call("text_write", {
  trackIndex: 2,
  atTicks: "0",
  text: "BACKROOMS",
  style: "title",
  anchor: "top_left",
  withBackground: true,
  soften: true,
});

const t3 = String(BigInt(Math.floor(3 * 254016000000)));
await call("text_write", {
  trackIndex: 2,
  atTicks: t3,
  text: "ENTITY NEARBY",
  style: "lower_third",
  anchor: "lower_third",
  withBackground: true,
  soften: true,
});

// Park playhead at start so title card is visible
await call("playhead_go_to_frame", { frame: 0 });
await call("audio_fix_levels", { mode: "boost", targetDb: 6 });
await call("project_save", {});

const shotFull = await client.callTool({
  name: "sequence_export_still",
  arguments: { outputPath: desktop, frame: 0 },
});
const embedded = (shotFull.content || []).find((c) => c.type === "image" && c.data);
if (embedded?.data) {
  fs.writeFileSync(desktop, Buffer.from(embedded.data, "base64"));
  console.log("DESKTOP FRAME", desktop, fs.statSync(desktop).size);
} else {
  const m = textOf(shotFull).match(/"outputPath":\s*"([^"]+)"/);
  if (m) {
    const src = m[1].replace(/\\\\/g, "\\");
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, desktop);
      console.log("COPIED", desktop);
    }
  }
  // temp fallback
  if (!fs.existsSync(desktop)) {
    const tmp = os.tmpdir();
    const files = fs
      .readdirSync(tmp)
      .filter((f) => f.includes("ppmcp") && f.endsWith(".png"))
      .map((f) => ({ f, t: fs.statSync(path.join(tmp, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (files[0]) {
      fs.copyFileSync(path.join(tmp, files[0].f), desktop);
      console.log("TEMP COPY", desktop);
    }
  }
}
console.log("exists", fs.existsSync(desktop), desktop);
await client.close();

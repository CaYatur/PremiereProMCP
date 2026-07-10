#!/usr/bin/env node
/**
 * Repair quiet audio (boost +6) + re-layout titles LARGE + dark bg on Backrooms-like cut.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-fix-v2", version: "0.2.0" });
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

console.log("=== Boost audio + large text layouts ===\n");
await call("edit_bootstrap", { compact: true });
await call("sequence_set_active_by_name", { query: "Backrooms" });

// Boost all audio — user complained levels keep getting crushed
await call("audio_fix_levels", { mode: "boost", targetDb: 6 });

// Enlarge / reposition existing Basic Text on V1 / V2
const layouts = {
  1: { x: 0.5, y: 0.42, scale: 200 }, // titles
  2: { x: 0.5, y: 0.8, scale: 155 }, // lower thirds
};
for (const [trackIndex, L] of Object.entries(layouts)) {
  const ti = Number(trackIndex);
  for (let clipIndex = 0; clipIndex < 8; clipIndex++) {
    const r = await call("effect_set_transform", {
      trackType: "video",
      trackIndex: ti,
      clipIndex,
      x: L.x,
      y: L.y,
      scale: L.scale,
    });
    if (r.isError && /No clip at index/i.test(textOf(r))) break;
  }
}

// Fresh readable title + bg plate sample at 0 (optional overlay)
await call("text_write", {
  trackIndex: 2,
  atTicks: "0",
  text: "BACKROOMS",
  style: "title",
  withBackground: true,
  applyLayout: true,
});

await call("project_save", {});
await call("sequence_screenshot", { frame: 0 });
console.log("\nDone. Play — audio ~+6 dB, titles large + bg.");
await client.close();

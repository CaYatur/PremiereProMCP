#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const outDir = path.join(process.cwd(), "tmp-qa");
fs.mkdirSync(outDir, { recursive: true });
const shotPath = path.join(outDir, `text-coverage-${Date.now()}.png`);

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "qa-shot", version: "0.0.1" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

const status = await call("app_get_connection_status");
console.log(text(status).split("\n").slice(0, 4).join(" | "));

// Place fresh visible text, then screenshot
const seq = await call("sequence_create", { name: `PPMCP QA Shot ${Date.now()}` });
const sm = text(seq).match(/"sequenceId":\s*"([^"]+)"/);
const sid = sm?.[1];
if (sid) await call("sequence_set_active", { sequenceId: sid });

const placed = await call("text_write_editable", {
  sequenceId: sid,
  trackIndex: 0,
  atTicks: "0",
  text: "QA COVERAGE TEST",
  scale: 80,
});
console.log("--- place ---\n", text(placed).slice(0, 700));

await call("playhead_go_to_frame", { sequenceId: sid, frame: 0 });

const shot = await call("sequence_export_still", {
  sequenceId: sid,
  frame: 0,
  outputPath: shotPath,
});
console.log("--- shot ---\n", text(shot).slice(0, 500));

// Also dump any image content to file if server returned base64
for (const c of shot.content || []) {
  if (c.type === "image" && c.data) {
    const buf = Buffer.from(c.data, "base64");
    const imgPath = path.join(outDir, `inline-${Date.now()}.png`);
    fs.writeFileSync(imgPath, buf);
    console.log("inline image saved:", imgPath, buf.length, "bytes");
  }
}

console.log("shot path:", shotPath, fs.existsSync(shotPath) ? fs.statSync(shotPath).size : "missing");
await client.close();

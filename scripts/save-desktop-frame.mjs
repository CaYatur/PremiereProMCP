#!/usr/bin/env node
/**
 * Save Program Monitor video frame to Desktop (chrome stripped, no full AME render).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), ".."),
});
const client = new Client({ name: "desktop-shot", version: "1.0.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

const dest = path.join(os.homedir(), "Desktop", "ppmcp-frame-now.png");

const boot = await client.callTool({ name: "edit_bootstrap", arguments: { compact: true } });
console.log(textOf(boot).slice(0, 120));
await client.callTool({ name: "sequence_set_active_by_name", arguments: { query: "Backrooms" } });

// PM video pane only — no full render
const shot = await client.callTool(
  {
    name: "sequence_screenshot",
    arguments: { outputPath: dest, frame: 0 },
  },
  undefined,
  { timeout: 90000 },
);
const t = textOf(shot);
console.log(t.slice(0, 700));

const img = (shot.content || []).find((c) => c.type === "image" && c.data);
if (img?.data) {
  fs.writeFileSync(dest, Buffer.from(img.data, "base64"));
  console.log("WROTE image ->", dest, fs.statSync(dest).size);
} else if (fs.existsSync(dest) && fs.statSync(dest).size > 2000) {
  console.log("FILE at dest", dest, fs.statSync(dest).size);
} else {
  console.log("FAIL", t.slice(0, 1200));
}

if (fs.existsSync(dest)) {
  const buf = fs.readFileSync(dest);
  if (buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    console.log(`PNG ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} bytes=${buf.length}`);
  }
}
console.log("exists", fs.existsSync(dest), dest);
await client.close();

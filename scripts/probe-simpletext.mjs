#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "probe-st", version: "0.0.1" });
await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const data = (r) => {
  const m = text(r).match(/```json\n([\s\S]*?)\n```/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
};

console.log("=== SimpleText probe ===");
const add = await call("effect_add", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
  matchName: "AE.ADBE PPro SimpleText",
});
console.log("add", text(add).slice(0, 300));

const applied = await call("effect_list_applied", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
});
console.log("applied", text(applied).slice(0, 800));

const d = data(applied);
const st = Array.isArray(d)
  ? d.find((e) => /simple\s*text/i.test(e.displayName || e.matchName || ""))
  : null;
console.log("simpletext effect", st);

if (st) {
  // try set various param names
  for (const [paramName, value] of [
    ["Content", "HELLO SIMPLE TEXT"],
    ["Source Text", "HELLO SIMPLE TEXT"],
    ["Text", "HELLO SIMPLE TEXT"],
    ["Position", { x: 0.5, y: 0.5 }],
    ["Size", 80],
  ]) {
    const r = await call("effect_set_param", {
      trackType: "video",
      trackIndex: 0,
      clipIndex: 0,
      effectIndex: st.effectIndex,
      paramName,
      value,
    });
    console.log("set", paramName, r.isError ? "FAIL" : "OK", text(r).slice(0, 200));
  }
}

// list params via title_list_params if works on any clip
const params = await call("title_list_params", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
});
console.log("title_list_params", text(params).slice(0, 1500));

await client.close();

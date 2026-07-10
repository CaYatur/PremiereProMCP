#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "probe-st2", version: "0.0.1" });
await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

// effect_set_param may need empty name or index — try via raw effect.setParam if we extend.
// Use effect_list_applied then set with displayName " " and ""
const applied = await call("effect_list_applied", {
  trackType: "video",
  trackIndex: 0,
  clipIndex: 0,
});
console.log(text(applied).slice(0, 2000));

// Try setting params that might be content
for (const paramName of ["", " ", "Content", "Text", "Source Text"]) {
  const r = await call("effect_set_param", {
    trackType: "video",
    trackIndex: 0,
    clipIndex: 0,
    effectIndex: 10,
    paramName: paramName || " ",
    value: "PPMCP LIVE TEXT",
  });
  console.log("paramName=", JSON.stringify(paramName), r.isError ? "FAIL" : "OK", text(r).slice(0, 250));
}

// Also try Size/Justification as control
for (const [paramName, value] of [
  ["Justification", 1],
  ["Size", 120],
  ["Opacity", 100],
]) {
  const r = await call("effect_set_param", {
    trackType: "video",
    trackIndex: 0,
    clipIndex: 0,
    effectIndex: 10,
    paramName,
    value,
  });
  console.log(paramName, r.isError ? "FAIL" : "OK", text(r).slice(0, 120));
}

await client.close();

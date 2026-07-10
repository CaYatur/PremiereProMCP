import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "v3", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  return (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
}
await call("sequence_set_active_by_name", { query: "Creative Cut 1783721221650" });
for (const [ti, ci] of [[0,0],[1,0],[1,10],[2,0],[2,3]]) {
  const g = await call("audio_get_gain", { trackIndex: ti, clipIndex: ci });
  const m = g.match(/"value":\s*([\d.]+)/) || g.match(/value.:.\s*value.:\s*([\d.]+)/);
  console.log(`A${ti}[${ci}]`, g.includes('"value": 1') || g.includes('"value":1') ? "LINEAR 1.0 OK" : g.slice(0,120).replace(/\s+/g," "));
}
await c.close();

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const TPS = 254016000000;
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "v16", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  return (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
}
function parseArr(text) {
  const f = text.match(/```json\s*([\s\S]*?)```/);
  if (f) {
    try { return JSON.parse(f[1]); } catch {}
  }
  const i = text.indexOf("[");
  const j = text.lastIndexOf("]");
  if (i >= 0 && j > i) {
    try { return JSON.parse(text.slice(i, j + 1)); } catch {}
  }
  return null;
}
await call("sequence_set_active_by_name", { query: "Final Creative 1783720858634" });
const clips = parseArr(await call("clip_list", { trackType: "video", trackIndex: 0 }));
console.log("count", clips?.length);
for (const cl of clips || []) {
  console.log(cl.clipIndex, cl.name, (Number(cl.startTicks) / TPS).toFixed(2) + "s");
}
const name = "Diag FromMedia " + Date.now();
const r = await call("edit_once", {
  op: "sequence_from_media",
  params: {
    name,
    paths: [
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\intro_blue_3s.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\intro_static_2s.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\tv_f001.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\tv_f010.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\tv_f015.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\clip_backrooms_12s.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\clip_pt2_10s.mp4",
      "C:\\Users\\cagan\\Desktop\\editsource\\_extracted\\clip_cayatur_10s.mp4",
    ],
  },
  compact: false,
});
console.log("CREATE", r.slice(0, 2000));
await call("sequence_set_active_by_name", { query: name });
const clips2 = parseArr(await call("clip_list", { trackType: "video", trackIndex: 0 }));
console.log("new count", clips2?.length);
for (const cl of clips2 || []) {
  console.log(cl.clipIndex, cl.name, (Number(cl.startTicks) / TPS).toFixed(2) + "s");
}
await c.close();

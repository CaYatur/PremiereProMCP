import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: ["server/dist/index.js"], cwd: process.cwd() });
const c = new Client({ name: "unity-fix", version: "1.0.0" });
await c.connect(t);
async function call(name, args = {}) {
  const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = (r.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  console.log((r.isError ? "ERR " : "OK  ") + name + ": " + text.slice(0, 350).replace(/\s+/g, " "));
  return text;
}
const list = await call("sequence_list", {});
// activate best Final Creative (latest with 8 clips ideally)
await call("sequence_set_active_by_name", { query: "Final Creative 1783720639001" });
let v = await call("clip_list", { trackType: "video", trackIndex: 0 });
console.log("clipIndexes", (v.match(/"clipIndex"/g) || []).length);
if ((v.match(/"clipIndex"/g) || []).length > 12) {
  await call("sequence_set_active_by_name", { query: "Diag FromMedia" });
}
// Try newest Final Creative that has intro_blue
for (const name of ["Final Creative 1783720639001", "Final Creative 1783720198964", "Diag FromMedia 1783720881836"]) {
  await call("sequence_set_active_by_name", { query: name });
  v = await call("clip_list", { trackType: "video", trackIndex: 0 });
  const n = (v.match(/"clipIndex"/g) || []).length;
  const ok = /intro_blue/i.test(v) && n >= 6 && n <= 12;
  console.log("try", name, "n="+n, "ok="+ok);
  if (ok) {
    await call("audio_fix_levels", { allClips: true, mode: "unity", targetDb: 0 });
    await call("edit_once", { op: "checkpoint", params: { label: "unity-0db-ok", note: "all audio forced 0 dB" }, compact: true });
    await call("project_save", {});
    break;
  }
}
await c.close();

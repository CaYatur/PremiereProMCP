import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const c = new Client({ name: "fit", version: "0.0.1" });
await c.connect(t);
const r = await c.callTool({
  name: "text_write_editable",
  arguments: { trackIndex: 0, atTicks: "0", text: "VISIBLE TEXT", scale: 80 },
});
const all = (r.content || [])
  .filter((x) => x.type === "text")
  .map((x) => x.text)
  .join("\n");
console.log(all.slice(0, 1200));
const hasPos = all.includes('"position"');
console.log(hasPos ? "WARN: position was set (may hide text)" : "OK: only Motion scale, no position hack");
await c.close();

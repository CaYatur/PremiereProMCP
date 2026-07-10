#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "legacy-dual", version: "0.0.1" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .slice(0, 600);

const st = await call("app_get_connection_status");
console.log(text(st).split("\n").slice(0, 5).join(" | "));
const d = text(st);
if (!/legacyBridgeConnected": true/.test(d) && !/Legacy MOGRT-text bridge: connected/.test(d)) {
  console.log("FAIL: legacy not connected — re-open panel after CEP copy (or click Reconnect)");
  await client.close();
  process.exit(1);
}

const seq = await call("sequence_create", { name: `PPMCP Dual ${Date.now()}` });
console.log("seq", text(seq).slice(0, 200));
const m = text(seq).match(/"sequenceId": "([^"]+)"/);
const sid = m && m[1];
if (sid) await call("sequence_set_active", { sequenceId: sid });

const w = await call("text_write", {
  sequenceId: sid,
  trackIndex: 0,
  atTicks: "0",
  text: "Cagan Ates",
  subtitle: "PPMCP Live Edit",
});
console.log("WRITE", w.isError ? "FAIL" : "OK", text(w));

const g = await call("text_get_content_legacy", { trackIndex: 0, clipIndex: 0 });
console.log("GET", g.isError ? "FAIL" : "OK", text(g));

const u = await call("text_set_content_legacy", {
  trackIndex: 0,
  clipIndex: 0,
  text: "UPDATED",
  subtitle: "subtitle ok",
});
console.log("UPDATE", u.isError ? "FAIL" : "OK", text(u));

const g2 = await call("text_get_content_legacy", { trackIndex: 0, clipIndex: 0 });
console.log("GET2", g2.isError ? "FAIL" : "OK", text(g2));

await client.close();

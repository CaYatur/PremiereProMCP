#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: process.cwd(),
});
const client = new Client({ name: "film-title", version: "0.0.1" });
await client.connect(transport);
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) =>
  (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .slice(0, 450);

const status = await call("app_get_connection_status");
console.log("status", text(status).slice(0, 120));

for (const [n, a] of [
  ["workflow_film_look", { trackIndex: 0, clipIndex: 0, look: "warm", grain: true, vignette: true }],
  [
    "workflow_add_lower_third",
    { trackIndex: 2, atTicks: "0", text: "Cagan · PPMCP", durationTicks: "508032000000" },
  ],
  [
    "workflow_add_title_card",
    {
      trackIndex: 1,
      atTicks: "508032000000",
      text: "OPENING TITLE",
      durationTicks: "508032000000",
    },
  ],
  ["text_add", { trackIndex: 2, atTicks: "1016064000000", text: "GOLD CAPTION", style: "caption", colorHex: "FFD700", durationTicks: "508032000000" }],
]) {
  const r = await call(n, a);
  console.log(r.isError ? "FAIL" : "PASS", n);
  console.log("     ", text(r));
}

await client.close();

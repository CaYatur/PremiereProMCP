#!/usr/bin/env node
// End-to-end test of the runtime tool surface over a real MCP stdio session.
//
// Needs no Premiere Pro and no bridge — tools/list and the tool_* meta-tools
// are pure server concerns — so this runs in CI on every push.
//
// What it proves: a session starts on a profile, the model can find hidden
// tools, register them for itself (one tools/list_changed per switch, not one
// per tool), call them directly afterwards, shrink back, and still reach
// disabled tools through tool_invoke.
//
//   node scripts/test-tool-profile.mjs

import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "../server/dist/index.js");

const META = 4; // tool_search, tool_schema, tool_invoke, tool_profile

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  env: { ...process.env, PPMCP_PROFILE: "standard", PPMCP_NO_AUTOSPAWN: "1" },
  stderr: "ignore",
});

const client = new Client({ name: "ppmcp-profile-test", version: "1.0.0" }, { capabilities: {} });

let listChanged = 0;
client.fallbackNotificationHandler = async (n) => {
  if (n.method === "notifications/tools/list_changed") listChanged += 1;
};

await client.connect(transport);

const names = async () => (await client.listTools()).tools.map((t) => t.name);

/** tool_invoke and real tools go through the 220ms Premiere-protection floor. */
const pace = () => new Promise((r) => setTimeout(r, 260));

async function call(name, args, { paced = false } = {}) {
  if (paced) await pace();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const block = r.content.find((c) => c.type === "text" && c.text.startsWith("```json"));
  let data;
  if (block) {
    try {
      data = JSON.parse(block.text.replace(/^```json\n/, "").replace(/\n```$/, ""));
    } catch {
      /* leave undefined */
    }
  }
  return { text, data, isError: r.isError };
}

const failures = [];
function check(cond, label) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures.push(label);
}

try {
  // 1 — the session starts narrow
  console.log("\n[1] starting surface");
  let list = await names();
  const catalogSize = (await call("tool_profile", {})).data?.catalogSize ?? 0;
  check(list.length > 0 && list.length < catalogSize, `starts on a profile (${list.length} of ${catalogSize + META})`);
  check(list.includes("tool_profile"), "tool_profile is registered");
  check(list.includes("tool_invoke"), "tool_invoke is registered");
  check(list.includes("edit_bootstrap"), "the documented entry tool is registered");
  const started = list.length;

  // 2 — reporting must not mutate
  console.log("\n[2] tool_profile with no arguments reports only");
  const report = await call("tool_profile", {});
  check(report.data?.profile === "standard", "reports the active profile");
  check((await names()).length === started, "did not change the surface");

  // 3 — the model can find what it cannot see
  console.log("\n[3] tool_search reaches unregistered tools");
  const search = await call("tool_search", { query: "lut" });
  const lut = search.data?.matches?.find((m) => m.name === "color_apply_lut");
  check(!!lut, "found color_apply_lut in the catalog");
  check(lut?.registered === false, "correctly reported as unregistered");
  check(!(await names()).includes("color_apply_lut"), "and it really is absent from tools/list");

  // 4 — enabling one category
  console.log("\n[4] registering a category");
  const before = listChanged;
  const cat = await call("tool_profile", { category: "color" });
  check(!cat.isError, `category call succeeded: ${cat.text.split("\n")[0]}`);
  list = await names();
  check(list.includes("color_apply_lut"), "the category's tools are now registered");
  check(list.length > started, `surface grew to ${list.length}`);
  check(listChanged === before + 1, `exactly one tools/list_changed (got ${listChanged - before})`);

  // 5 — a newly registered tool actually dispatches.
  //     Empty args must produce a schema-validation error, never "not found":
  //     that distinguishes "registered and reachable" from "unknown tool",
  //     without needing Premiere.
  console.log("\n[5] a newly registered tool dispatches");
  const dispatched = await call("color_apply_lut", {}, { paced: true });
  check(!/not found|unknown tool/i.test(dispatched.text), `dispatched (got: ${dispatched.text.split("\n")[0].slice(0, 80)})`);

  // 6 — the model grants itself the whole catalog
  console.log("\n[6] tool_profile({ profile: 'full' })");
  const beforeFull = listChanged;
  const full = await call("tool_profile", { profile: "full" });
  list = await names();
  check(list.length === catalogSize + META, `full registers everything (${list.length} of ${catalogSize + META})`);
  check(listChanged === beforeFull + 1, `still one notification for ${list.length - started}+ tools`);
  check(full.data?.profile === "full", "reports the new profile");

  // 7 — and can shrink back
  console.log("\n[7] shrinking back to core");
  await call("tool_profile", { profile: "core" });
  list = await names();
  check(list.length < started, `core is smaller than standard (${list.length} < ${started})`);
  check(list.includes("tool_profile"), "core keeps tool_profile — the way back out");
  check(list.includes("edit_bootstrap"), "core keeps the entry tool");
  check(!list.includes("color_apply_lut"), "naming a profile drops earlier category pins");

  // 8 — tool_invoke still reaches disabled tools
  console.log("\n[8] tool_invoke bypasses registration");
  check(!list.includes("time_seconds_to_ticks"), "the target tool is unregistered in core");
  const invoked = await call("tool_invoke", { name: "time_seconds_to_ticks", args: { seconds: 2 } }, { paced: true });
  check(invoked.data?.ticks === "508032000000", `executed correctly (${invoked.data?.ticks})`);

  // 9 — bad input is reported, not fatal
  console.log("\n[9] unknown names are handled");
  const bad = await call("tool_profile", { enable: ["does_not_exist"] });
  check(bad.data?.unknown?.includes("does_not_exist"), "unknown name reported back");
  check(!bad.isError, "not treated as a hard error");
} finally {
  await client.close();
}

console.log(
  failures.length
    ? `\nFAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`
    : "\nTool profile switching OK — all checks passed.",
);
process.exit(failures.length ? 1 : 0);

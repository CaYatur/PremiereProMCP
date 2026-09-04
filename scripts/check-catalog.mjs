#!/usr/bin/env node
// Static integrity check for the MCP tool catalog. Runs without Premiere Pro,
// so it can gate every push — unlike the smoke scripts, which need a live host.
//
// It checks the things that are cheap to break and expensive to notice:
// duplicate names, missing handlers, unusable schemas, and descriptions too
// thin for a model to choose the tool correctly.
//
//   node scripts/check-catalog.mjs

import { z } from "zod";
import { allTools } from "../server/dist/tools/index.js";
import { createMetaTools } from "../server/dist/tools/meta.js";

const problems = [];
const warnings = [];
const seen = new Map();

const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const MIN_DESCRIPTION = 25;

for (const tool of allTools) {
  const where = tool?.name ?? "(unnamed tool)";

  if (!tool.name) {
    problems.push("A tool has no name.");
    continue;
  }
  if (!NAME_RE.test(tool.name)) {
    problems.push(`${where}: name must be lower_snake_case.`);
  }
  if (tool.name.startsWith("tool_")) {
    problems.push(`${where}: the "tool_" prefix is reserved for meta-tools.`);
  }
  if (seen.has(tool.name)) {
    problems.push(`${where}: duplicate name (also in ${seen.get(tool.name)}).`);
  }
  seen.set(tool.name, tool.name.split("_")[0]);

  if (typeof tool.handler !== "function") {
    problems.push(`${where}: handler is not a function.`);
  }
  if (!tool.title) {
    problems.push(`${where}: missing title.`);
  }
  if (!tool.description) {
    problems.push(`${where}: missing description.`);
  } else if (tool.description.length < MIN_DESCRIPTION) {
    warnings.push(`${where}: description is only ${tool.description.length} chars — a model may not pick it correctly.`);
  }

  // The schema must survive being turned into a zod object, which is exactly
  // what both the MCP SDK and tool_invoke do with it.
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    problems.push(`${where}: inputSchema must be a zod raw shape object (use {} for no parameters).`);
  } else {
    try {
      const obj = z.object(tool.inputSchema);
      obj.safeParse({});
    } catch (err) {
      problems.push(`${where}: inputSchema is not a valid zod shape — ${err?.message ?? err}`);
    }
  }
}

// Meta-tools must build and must not collide with the catalog.
let metaNames = [];
try {
  const meta = createMetaTools(allTools, "standard");
  metaNames = meta.map((m) => m.name);
  for (const m of meta) {
    if (seen.has(m.name)) problems.push(`meta-tool ${m.name} collides with a catalog tool.`);
    if (typeof m.handler !== "function") problems.push(`meta-tool ${m.name}: handler is not a function.`);
  }
} catch (err) {
  problems.push(`createMetaTools() threw: ${err?.message ?? err}`);
}

const categories = [...new Set([...seen.values()])].sort();

if (warnings.length) {
  console.warn(`Tool catalog warnings (${warnings.length}):`);
  for (const w of warnings) console.warn(`  ! ${w}`);
}

if (problems.length) {
  console.error(`Tool catalog check FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Tool catalog OK — ${allTools.length} tools across ${categories.length} prefixes, ` +
    `plus meta-tools: ${metaNames.join(", ")}.`,
);

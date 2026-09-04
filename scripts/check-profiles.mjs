#!/usr/bin/env node
// Guards the tool-surface profiles (server/src/toolProfiles.ts).
//
// A typo in a profile list silently shrinks the registered surface — the tool
// just stops being registered and nobody notices until a model can't find it.
// This runs in CI, needs no Premiere, and fails loudly instead.
//
//   node scripts/check-profiles.mjs

import { readFileSync } from "node:fs";
import { allTools } from "../server/dist/tools/index.js";
import { inProfile } from "../server/dist/toolProfiles.js";

const catalog = new Set(allTools.map((t) => t.name));
const src = readFileSync(new URL("../server/src/toolProfiles.ts", import.meta.url), "utf8");

// Every quoted name on its own line inside the profile arrays.
const listed = [...src.matchAll(/^\s+"([a-z][a-z0-9_]+)",$/gm)].map((m) => m[1]);

const problems = [];

const unknown = listed.filter((n) => !catalog.has(n));
if (unknown.length) {
  problems.push(`Profile lists ${unknown.length} name(s) that are not in the catalog: ${unknown.join(", ")}`);
}

const duplicates = listed.filter((n, i) => listed.indexOf(n) !== i);
if (duplicates.length) {
  problems.push(`Duplicate entries in profile lists: ${[...new Set(duplicates)].join(", ")}`);
}

const counts = {
  core: allTools.filter((t) => inProfile(t.name, "core")).length,
  standard: allTools.filter((t) => inProfile(t.name, "standard")).length,
  full: allTools.filter((t) => inProfile(t.name, "full")).length,
};

if (counts.core === 0) problems.push("core profile is empty");
if (counts.standard <= counts.core) problems.push("standard profile must be larger than core");
if (counts.full !== allTools.length) problems.push("full profile must contain the whole catalog");

// The entry tools a weak model is told to call in skill/SKILL.md must always
// be registered, or the documented session flow breaks.
for (const required of ["edit_bootstrap", "edit_auto", "edit_help", "edit_verify"]) {
  if (!inProfile(required, "core")) problems.push(`${required} must be in the core profile`);
}

if (problems.length) {
  console.error("Tool profile check FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `Tool profiles OK — catalog ${allTools.length}, core ${counts.core}, standard ${counts.standard}, full ${counts.full}.`,
);

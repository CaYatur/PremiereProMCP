#!/usr/bin/env node
// Runs scripts/release-prepare.mjs against a scratch copy of the files it
// edits and checks the result, so a broken release step is caught on the PR
// instead of after a merge. No network, no git.
//
//   node scripts/test-release-prepare.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "package.json",
  "package-lock.json",
  "bridge/package.json",
  "server/package.json",
  "shared/package.json",
  "plugin/manifest.json",
  "server/src/index.ts",
  "scripts/release-prepare.mjs",
];

let failures = 0;
function check(ok, label) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

function scratch(changelog, crlf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppmcp-release-"));
  for (const rel of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    let text = fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");
    if (crlf) text = text.replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), crlf ? changelog.replace(/\n/g, "\r\n") : changelog);
  return dir;
}

function run(dir, args) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, "scripts/release-prepare.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message) };
  }
}

const current = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
const [maj, min] = current.split(".").map(Number);
const next = `${maj}.${min + 1}.0`;
const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "",
  "- Something new.",
  "",
  `## [${current}] — 2026-01-01`,
  "",
  "- Older entry.",
  "",
  `[${current}]: https://github.com/o/r/releases/tag/v${current}`,
  "",
].join("\n");

for (const crlf of [false, true]) {
  console.log(`\n[${crlf ? "CRLF" : "LF"} checkout] --bump minor`);
  const dir = scratch(CHANGELOG, crlf);
  const notes = path.join(dir, "notes.md");
  const ghOut = path.join(dir, "gh-output");
  const r = run(dir, ["--bump", "minor", "--date", "2026-10-08", "--repo", "o/r", "--notes-out", notes, "--github-output", ghOut]);
  check(r.ok, `exits 0 (${r.out.trim()})`);
  const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
  for (const rel of ["package.json", "bridge/package.json", "server/package.json", "shared/package.json", "plugin/manifest.json"]) {
    check(readJson(rel).version === next, `${rel} -> ${next}`);
  }
  const lock = readJson("package-lock.json");
  check(
    lock.version === next && ["", "bridge", "server", "shared"].every((k) => lock.packages[k].version === next),
    "package-lock.json root + workspaces",
  );
  const index = fs.readFileSync(path.join(dir, "server/src/index.ts"), "utf8");
  check(index.includes(`version: "${next}"`), "server/src/index.ts");
  const cl = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
  check(/## \[Unreleased\]\r?\n\r?\n## \[\d+\.\d+\.\d+\] — 2026-10-08/.test(cl), "CHANGELOG: fresh [Unreleased] above the dated section");
  check(cl.includes(`[${next}]: https://github.com/o/r/releases/tag/v${next}`), "CHANGELOG: link for the new version");
  check(cl.includes("\r\n") === crlf && (crlf || !cl.includes("\r")), "CHANGELOG keeps its line endings");
  const manifest = fs.readFileSync(path.join(dir, "plugin/manifest.json"), "utf8");
  const original = fs.readFileSync(path.join(repo, "plugin/manifest.json"), "utf8").replace(/\r\n/g, "\n");
  check(
    manifest.replace(/\r\n/g, "\n") === original.replace(`"version": "${current}"`, `"version": "${next}"`),
    "manifest.json: only the version line changes",
  );
  const n = fs.readFileSync(notes, "utf8");
  check(n.includes(`PPMCP-Setup-${next}.zip`) && n.includes("- Something new.") && !n.includes("Older entry"), "release notes = [Unreleased] body");
  check(fs.readFileSync(ghOut, "utf8").includes(`version=${next}`), "GITHUB_OUTPUT version");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n[guards]");
for (const [label, changelog, args] of [
  ["empty [Unreleased] is refused", CHANGELOG.replace("### Added\n\n- Something new.\n", ""), ["--bump", "patch"]],
  ["missing [Unreleased] is refused", CHANGELOG.replace("## [Unreleased]", "## Notes"), ["--bump", "patch"]],
  ["unknown bump is refused", CHANGELOG, ["--bump", "huge"]],
]) {
  const dir = scratch(changelog, false);
  const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");
  const r = run(dir, args);
  check(!r.ok && fs.readFileSync(path.join(dir, "package.json"), "utf8") === before, `${label}, nothing written`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n[patch / major]");
for (const [bump, expected] of [
  ["patch", current.replace(/\d+$/, (p) => String(Number(p) + 1))],
  ["major", `${maj + 1}.0.0`],
]) {
  const dir = scratch(CHANGELOG, false);
  run(dir, ["--bump", bump, "--date", "2026-10-08"]);
  check(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version === expected, `${bump} -> ${expected}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} release-prepare check(s) failed.`);
  process.exit(1);
}
console.log("\nrelease-prepare OK — all checks passed.");

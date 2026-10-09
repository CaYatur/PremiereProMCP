#!/usr/bin/env node
// Prepares a release in the working tree: bumps the version everywhere it
// is written down, dates the CHANGELOG's [Unreleased] section and writes
// the GitHub release notes from it. Used by .github/workflows/release.yml
// (for real when a PR is merged into main, as a dry run on every PR) and
// runnable by hand. It never commits, tags or pushes.
//
//   node scripts/release-prepare.mjs --bump patch|minor|major
//        [--version 1.2.3] [--date 2026-10-08] [--repo owner/name]
//        [--notes-out release-notes.md] [--github-output $GITHUB_OUTPUT]
//
// Fails (exit 1) when [Unreleased] is missing or empty, so a release can't
// go out without a changelog entry.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(`release-prepare: ${message}`);
  process.exit(1);
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
// Keep each file's own line endings (a Windows checkout has CRLF).
function write(rel, text, original) {
  const out = original.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
  fs.writeFileSync(path.join(root, rel), out);
}

export function bumpVersion(current, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`current version "${current}" is not x.y.z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`unknown bump "${bump}" (expected patch, minor or major)`);
}

/** Split CHANGELOG text into the [Unreleased] body and a function that
 * rewrites the file for `version`. */
export function releaseChangelog(text, version, date, repo) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]\s*$/.test(l));
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  if (!body) throw new Error("CHANGELOG.md [Unreleased] section is empty; add an entry for this release");

  const out = [...lines];
  out.splice(start, 1, "## [Unreleased]", "", `## [${version}] — ${date}`);
  const link = `[${version}]: https://github.com/${repo}/releases/tag/v${version}`;
  const firstLink = out.findIndex((l) => /^\[\d+\.\d+\.\d+\]: /.test(l));
  if (firstLink >= 0) out.splice(firstLink, 0, link);
  else out.push("", link);
  return { body, text: out.join("\n") };
}

/** Replace the first top-level "version" field in place, so hand-formatted
 * files (plugin/manifest.json) keep their layout. */
function setVersionField(rel, version) {
  const original = read(rel);
  const field = /("version":\s*)"\d+\.\d+\.\d+"/;
  if (!field.test(original)) fail(`no "version": "x.y.z" field in ${rel}`);
  write(rel, original.replace(field, `$1"${version}"`), original);
}

/** package-lock.json is plain JSON.stringify(…, 2) output, so a round trip
 * changes only the fields we set. */
function setLockVersion(version) {
  const rel = "package-lock.json";
  const original = read(rel);
  const json = JSON.parse(original);
  json.version = version;
  for (const key of ["", "bridge", "server", "shared"]) {
    if (json.packages && json.packages[key]) json.packages[key].version = version;
  }
  write(rel, `${JSON.stringify(json, null, 2)}\n`, original);
}

function main() {
  const pkg = JSON.parse(read("package.json"));
  const current = pkg.version;
  const version = arg("version") || bumpVersion(current, arg("bump", "patch"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version "${version}" is not x.y.z`);
  const date = arg("date", new Date().toISOString().slice(0, 10));
  const repo = arg("repo", process.env.GITHUB_REPOSITORY || "CaYatur/PremiereProMCP");

  let changelog;
  try {
    changelog = releaseChangelog(read("CHANGELOG.md"), version, date, repo);
  } catch (err) {
    fail(err.message);
  }

  for (const rel of [
    "package.json",
    "bridge/package.json",
    "server/package.json",
    "shared/package.json",
    "plugin/manifest.json",
  ]) {
    setVersionField(rel, version);
  }
  setLockVersion(version);

  const indexRel = "server/src/index.ts";
  const index = read(indexRel);
  const versionLine = /(\n\s*version: )"\d+\.\d+\.\d+"/;
  if (!versionLine.test(index)) fail(`no version: "x.y.z" line in ${indexRel}`);
  write(indexRel, index.replace(versionLine, `$1"${version}"`), index);

  const changelogOriginal = read("CHANGELOG.md");
  write("CHANGELOG.md", changelog.text, changelogOriginal);

  const notesOut = arg("notes-out");
  if (notesOut) {
    const notes = [
      `> Install: download \`PPMCP-Setup-${version}.zip\` below, extract the whole folder, double-click **\`Setup.bat\`**. Already installed? Choose **Update / reinstall**, then reload the panel in UXP Developer Tool.`,
      "",
      changelog.body,
      "",
      `Full changelog: [CHANGELOG.md](https://github.com/${repo}/blob/v${version}/CHANGELOG.md)`,
      "",
    ].join("\n");
    fs.writeFileSync(path.resolve(notesOut), notes);
  }

  const ghOut = arg("github-output");
  if (ghOut) fs.appendFileSync(ghOut, `version=${version}\nprevious=${current}\n`);
  console.log(`release-prepare: ${current} -> ${version} (${date})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

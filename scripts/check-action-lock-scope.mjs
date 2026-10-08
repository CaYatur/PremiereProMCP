#!/usr/bin/env node
// Guards against the Premiere 26.3+ "Requires locked access" regression
// (issue #2). Since Premiere 26.3 every `create*Action()` call must run
// while the project is locked — i.e. inside a `project.lockedAccess()` or
// `project.executeTransaction()` callback. In this plugin that means inside
// the callback passed to `runTransaction()` (plugin/src/ppro.js), which
// wraps both.
//
// This mirrors Adobe's `@adobe/eslint-plugin-premierepro`
// `require-action-lock-scope` rule, but also understands our
// `runTransaction(project, label, (c) => { ... })` wrapper (the upstream
// syntactic rule only recognises literal `.lockedAccess(cb)` /
// `.executeTransaction(cb)` calls and would flag every wrapped call). It
// uses the TypeScript compiler API that is already a dev dependency, so it
// needs no extra packages and no Premiere.
//
//   node scripts/check-action-lock-scope.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["plugin/src"];
const ACTION_RE = /^create\w+Action$/;
const LOCK_CALLS = new Set(["runTransaction", "lockedAccess", "executeTransaction"]);

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function isFunctionNode(n) {
  return ts.isArrowFunction(n) || ts.isFunctionExpression(n);
}

/** True when `node` sits inside a function passed as an argument to a lock call. */
function insideLock(node) {
  for (let child = node, p = node.parent; p; child = p, p = p.parent) {
    if (isFunctionNode(child) && ts.isCallExpression(p) && p.arguments.includes(child)) {
      if (LOCK_CALLS.has(calleeName(p))) return true;
    }
  }
  return false;
}

export function findViolations(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      if (ACTION_RE.test(name) && !insideLock(n)) {
        const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push({ file: fileName, line: line + 1, col: character + 1, name });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".js")) yield p;
  }
}

// Self-test: make sure the checker itself still catches the bug pattern.
const selfTest = findViolations(
  "self-test.js",
  `const a = item.createSetInPointAction(t);
   runTransaction(project, "x", (c) => c.addAction(a));
   runTransaction(project, "y", (c) => { c.addAction(item.createSetOutPointAction(t)); });
   project.lockedAccess(() => { const b = item.createMoveAction(t); });`,
);
if (selfTest.length !== 1 || selfTest[0].name !== "createSetInPointAction") {
  console.error("check-action-lock-scope self-test failed:", selfTest);
  process.exit(1);
}

let scanned = 0;
const violations = [];
for (const d of SCAN_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    scanned++;
    violations.push(...findViolations(relative(ROOT, file), readFileSync(file, "utf8")));
  }
}

if (violations.length) {
  console.error(`✗ ${violations.length} create*Action() call(s) outside lockedAccess/executeTransaction/runTransaction:`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}:${v.col}  ${v.name}()`);
  console.error(
    "\nSince Premiere 26.3 these throw \"Requires locked access\" at runtime. Create the action inside the runTransaction callback:\n" +
      '  runTransaction(project, "label", (c) => { c.addAction(item.createXAction(...)); });',
  );
  process.exit(1);
}
console.log(`✓ action lock scope OK — ${scanned} plugin file(s), every create*Action() is inside a lock callback.`);

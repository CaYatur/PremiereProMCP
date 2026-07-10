#!/usr/bin/env node
/**
 * REC pip: right of BACKROOMS REC plate, FAST blink 0↔100 (half=0.12s).
 * Position from measured title plate; shape on V1; title on V2.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const TPS = 254016000000;
const sec = (s) => String(BigInt(Math.round(Number(s) * TPS)));

function measureTitleDot() {
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$font = New-Object System.Drawing.Font 'Arial', 54, ([System.Drawing.FontStyle]::Bold)
$sz = $g.MeasureString('BACKROOMS REC', $font)
$padX = [Math]::Max(36, 54 * 0.85)
$padY = [Math]::Max(20, 54 * 0.5)
$barW = [Math]::Min(1700, [Math]::Max(180, [Math]::Ceiling($sz.Width + $padX * 2)))
$barH = [Math]::Max(48, [Math]::Ceiling($font.GetHeight($g) * 1.15 + $padY * 2))
$cx = [Math]::Round(0.22 * 1920)
$cy = [Math]::Round(0.16 * 1080)
$barX = [Math]::Max(12, [Math]::Min(1920 - $barW - 12, $cx - [Math]::Floor($barW / 2)))
$barY = [Math]::Max(12, [Math]::Min(1080 - $barH - 12, $cy - [Math]::Floor($barH / 2)))
$dotR = [Math]::Max(12, [Math]::Floor($barH * 0.22))
# JUST to the right of the plate (gap 8px), vertical center of plate
$dotCx = $barX + $barW + 8 + $dotR
$dotCy = $barY + [Math]::Floor($barH / 2)
Write-Output "$dotCx,$dotCy,$dotR,$barX,$barY,$barW,$barH"
$g.Dispose(); $bmp.Dispose(); $font.Dispose()
`;
  const sp = path.join(os.tmpdir(), `ppmcp-meas-${Date.now()}.ps1`);
  fs.writeFileSync(sp, ps, "utf8");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", sp],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  try {
    fs.unlinkSync(sp);
  } catch {
    /* */
  }
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  const [dotCx, dotCy, dotR, barX, barY, barW, barH] = line.split(",").map(Number);
  return { dotCx, dotCy, dotR, barX, barY, barW, barH, nx: dotCx / 1920, ny: dotCy / 1080 };
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "fix-rec-fast", version: "1.2.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function call(name, args = {}, timeout = 90000) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const t = textOf(r);
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 220).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, text: t, raw: r };
}

await call("edit_bootstrap", { compact: true });
let act = await call("sequence_set_active_by_name", { query: "Backrooms Agent" });
if (/No sequence matching/i.test(act.text)) {
  await call("sequence_set_active_by_name", { query: "Backrooms Smart" });
}

const m = measureTitleDot();
console.log("measure", m);

const AT = 0.5;
const DUR = 5;

// Title on V2 first
await call("text_write", {
  trackIndex: 2,
  atTicks: sec(AT),
  text: "BACKROOMS REC",
  style: "title",
  withBackground: true,
  soften: false,
  preferPng: true,
  colorHex: "F5F5F5",
  durationTicks: sec(DUR),
});

// REC shape on V1 at measured position (right of plate)
const shape = await call("shape_add", {
  trackIndex: 1,
  atTicks: sec(AT),
  durationTicks: sec(DUR),
  fillColor: { r: 235, g: 15, b: 15, a: 255 },
  width: Math.max(24, m.dotR * 2),
  height: Math.max(24, m.dotR * 2),
  x: m.nx,
  y: m.ny,
});

let clipIndex = 0;
const cm = shape.text.match(/"clipIndex"\s*:\s*(\d+)/);
if (cm) clipIndex = Number(cm[1]);
console.log("shape clipIndex", clipIndex, "nx,ny", m.nx.toFixed(3), m.ny.toFixed(3));

// Force Motion position + small scale
await call("effect_set_transform", {
  trackType: "video",
  trackIndex: 1,
  clipIndex,
  x: m.nx,
  y: m.ny,
  scale: 14,
});
await call("shape_set_fill_color", {
  trackType: "video",
  trackIndex: 1,
  clipIndex,
  r: 235,
  g: 15,
  b: 15,
  a: 255,
});

// List opacity effect index
const fx = await call("effect_list_applied", {
  trackType: "video",
  trackIndex: 1,
  clipIndex,
});
let opacityIdx = 0;
console.log("effects", fx.text.slice(0, 500));
// Prefer effectIndex of component named Opacity
const fxBlocks = fx.text.split(/\{/g);
for (const b of fxBlocks) {
  if (/Opacity/i.test(b)) {
    const im = b.match(/effectIndex["\s:]+(\d+)/i) || b.match(/"effectIndex"\s*:\s*(\d+)/);
    if (im) {
      opacityIdx = Number(im[1]);
      break;
    }
  }
}
// fallback: often Opacity is effectIndex 0
console.log("opacityIdx", opacityIdx);

// FAST blink: 0 ↔ 100 every 0.12s (≈ 4 blinks/sec)
const half = 0.12;
let on = true;
let n = 0;
for (let s = AT; s <= AT + DUR + 0.001; s += half) {
  const op = on ? 100 : 0;
  // Keyframe via setParam (proven path from workflow_fade_clip)
  await call("effect_set_param", {
    trackType: "video",
    trackIndex: 1,
    clipIndex,
    effectIndex: opacityIdx,
    paramName: "Opacity",
    value: op,
    atTicks: sec(s),
  });
  // Also opacity helper
  await call("effect_set_opacity", {
    trackType: "video",
    trackIndex: 1,
    clipIndex,
    opacity: op,
    atTicks: sec(s),
  });
  on = !on;
  n++;
  if (n > 42) break;
}
console.log("blink keys", n, "half", half, "s → period", half * 2, "s");

const desk = path.join(os.homedir(), "Desktop");
await call("sequence_screenshot", { atTicks: sec(1.0), outputPath: path.join(desk, "ppmcp-frame-intro.png") });
await call("sequence_screenshot", { atTicks: sec(1.0), outputPath: path.join(desk, "ppmcp-frame-rec-on.png") });
await call("sequence_screenshot", { atTicks: sec(1.12), outputPath: path.join(desk, "ppmcp-frame-rec-off.png") });
await call("project_save", {});

console.log("\nDone.");
console.log("Plate px", m.barX, m.barY, m.barW + "x" + m.barH);
console.log("Dot px", m.dotCx, m.dotCy, "r", m.dotR, "norm", m.nx.toFixed(3), m.ny.toFixed(3));
console.log("Blink: 0↔100 every", half, "s (~", (1 / (half * 2)).toFixed(1), "Hz)");
await client.close();

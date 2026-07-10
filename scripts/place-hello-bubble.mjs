#!/usr/bin/env node
/**
 * Place "merhaba" speech bubble at CURRENT playhead (do not switch sequence).
 * Screenshot once to locate yellow head, then place bubble above it.
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
const TPS = 254016000000n;

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "hello-bubble", version: "2.0.0" });
await client.connect(transport);

function textOf(r) {
  return (r.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function call(name, args = {}, timeout = 120000) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const t = textOf(r);
  console.log(`${r.isError ? "✗" : "✓"} ${name}: ${t.slice(0, 240).replace(/\s+/g, " ")}`);
  return { ok: !r.isError, text: t, raw: r };
}

/** Find yellow-ish head blob in a 1920x1080-ish screenshot (full Premiere window).
 *  Returns approx content-relative center in 1920x1080 program area if possible.
 *  Fallback: sample full image for yellow cluster.
 */
function findYellowHeadCenter(pngPath) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('${pngPath.replace(/'/g, "''")}')
$w = $img.Width; $h = $img.Height
# Program monitor is typically upper-right / center of Premiere UI — scan full image
# for yellow Minecraft-skin pixels (high R+G, lower B)
$sumX = 0L; $sumY = 0L; $n = 0L
$step = [Math]::Max(2, [int]($w / 400))
for ($y = [int]($h * 0.08); $y -lt [int]($h * 0.72); $y += $step) {
  for ($x = [int]($w * 0.25); $x -lt [int]($w * 0.85); $x += $step) {
    $c = $img.GetPixel($x, $y)
    # yellow / gold skin-ish
    if ($c.R -gt 160 -and $c.G -gt 140 -and $c.B -lt 120 -and ($c.R - $c.B) -gt 50 -and ($c.G - $c.B) -gt 40) {
      $sumX += $x; $sumY += $y; $n++
    }
  }
}
$img.Dispose()
if ($n -lt 8) {
  Write-Output "0,0,0,$w,$h"
} else {
  $cx = [int]($sumX / $n)
  $cy = [int]($sumY / $n)
  Write-Output "$cx,$cy,$n,$w,$h"
}
`;
  const sp = path.join(os.tmpdir(), `ppmcp-yellow-${Date.now()}.ps1`);
  fs.writeFileSync(sp, ps, "utf8");
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", sp],
      { encoding: "utf8", windowsHide: true, timeout: 60000 },
    );
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
    const [cx, cy, n, w, h] = line.split(",").map(Number);
    return { cx, cy, n, w, h, ok: n >= 8 };
  } finally {
    try {
      fs.unlinkSync(sp);
    } catch {
      /* */
    }
  }
}

/**
 * Map a point in full Premiere screenshot to approximate 1920x1080 sequence coords.
 * Heuristic: Program Monitor is the large 16:9 panel — find largest dark video-ish region
 * is hard; use relative position within typical PM bounds if w/h look like full desktop.
 * If image is already ~sequence aspect, use direct scale.
 */
function mapToSequence(cx, cy, w, h) {
  // If capture is roughly 16:9 content-sized, scale directly
  const ar = w / h;
  if (ar > 1.5 && ar < 1.9 && w >= 1600) {
    // Full window 2560x1528 style — Program Monitor content is often center-right
    // Better: scale assuming whole image maps poorly; use relative within scanned region
    // Map: assume PM video sits in a rect estimated from typical layout
    // For 2560x1528: PM roughly x 700-1900, y 80-700 (from earlier sessions)
    const pmL = Math.floor(w * 0.28);
    const pmT = Math.floor(h * 0.06);
    const pmR = Math.floor(w * 0.78);
    const pmB = Math.floor(h * 0.52);
    const pw = pmR - pmL;
    const ph = pmB - pmT;
    const nx = (cx - pmL) / pw;
    const ny = (cy - pmT) / ph;
    return {
      sx: Math.round(Math.max(0.05, Math.min(0.95, nx)) * 1920),
      sy: Math.round(Math.max(0.05, Math.min(0.95, ny)) * 1080),
      via: "pm-heuristic",
    };
  }
  return {
    sx: Math.round((cx / w) * 1920),
    sy: Math.round((cy / h) * 1080),
    via: "direct-scale",
  };
}

function writeSpeechBubblePng(text, headX, headY) {
  const file = path.join(os.tmpdir(), `ppmcp-bubble-merhaba-${Date.now()}.png`);
  const out = file.replace(/\\/g, "\\\\");
  const safe = String(text).replace(/'/g, "''");
  // Bubble centered above head
  const bw = 300;
  const bh = 100;
  const cx = headX;
  const cy = Math.max(80, headY - 95); // above head
  const bx = Math.max(20, Math.min(1920 - bw - 20, cx - Math.floor(bw / 2)));
  const by = Math.max(20, Math.min(1080 - bh - 60, cy - Math.floor(bh / 2)));
  const tailTipX = headX;
  const tailTipY = Math.min(1080 - 10, headY - 20);
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(100, 0, 0, 0))
$rad = 28
$pathS = New-Object System.Drawing.Drawing2D.GraphicsPath
$x = ${bx}+4; $y = ${by}+6; $w = ${bw}; $h = ${bh}
$pathS.AddArc($x, $y, $rad*2, $rad*2, 180, 90)
$pathS.AddArc($x+$w-$rad*2, $y, $rad*2, $rad*2, 270, 90)
$pathS.AddArc($x+$w-$rad*2, $y+$h-$rad*2, $rad*2, $rad*2, 0, 90)
$pathS.AddArc($x, $y+$h-$rad*2, $rad*2, $rad*2, 90, 90)
$pathS.CloseFigure()
$g.FillPath($shadow, $pathS)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 255, 255, 255))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$x = ${bx}; $y = ${by}; $w = ${bw}; $h = ${bh}
$path.AddArc($x, $y, $rad*2, $rad*2, 180, 90)
$path.AddArc($x+$w-$rad*2, $y, $rad*2, $rad*2, 270, 90)
$path.AddArc($x+$w-$rad*2, $y+$h-$rad*2, $rad*2, $rad*2, 0, 90)
$path.AddArc($x, $y+$h-$rad*2, $rad*2, $rad*2, 90, 90)
$path.CloseFigure()
$g.FillPath($white, $path)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 25, 25, 25), 3)
$g.DrawPath($pen, $path)
# Tail toward head
$midX = ${bx} + [int](${bw}/2)
$botY = ${by} + ${bh}
$tail = New-Object System.Drawing.Drawing2D.GraphicsPath
$tail.AddPolygon(@(
  (New-Object System.Drawing.Point ($midX - 16), $botY),
  (New-Object System.Drawing.Point ($midX + 16), $botY),
  (New-Object System.Drawing.Point ${tailTipX}, ${tailTipY})
))
$g.FillPath($white, $tail)
$g.DrawLine($pen, $midX - 16, $botY, ${tailTipX}, ${tailTipY})
$g.DrawLine($pen, $midX + 16, $botY, ${tailTipX}, ${tailTipY})
$font = New-Object System.Drawing.Font 'Segoe UI', 36, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 15, 15))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF ${bx}, ${by}, ${bw}, ${bh}
$g.DrawString('${safe}', $font, $brush, $rect, $sf)
$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $shadow.Dispose(); $white.Dispose(); $pen.Dispose()
$path.Dispose(); $pathS.Dispose(); $tail.Dispose(); $font.Dispose(); $brush.Dispose()
`;
  const sp = path.join(os.tmpdir(), `ppmcp-bubble-${Date.now()}.ps1`);
  fs.writeFileSync(sp, ps, "utf8");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", sp], {
    windowsHide: true,
    timeout: 20000,
  });
  try {
    fs.unlinkSync(sp);
  } catch {
    /* */
  }
  if (!fs.existsSync(file)) throw new Error("bubble png failed");
  return file;
}

// ── 1) Read playhead ONLY — do not set_active ──────────────────────
await call("edit_bootstrap", { compact: true });
const ph = await call("playhead_get_position", {});
let atTicks = "0";
const m1 = ph.text.match(/"ticks"\s*:\s*"?(\d+)"?/);
if (m1) atTicks = m1[1];
console.log("USER PLAYHEAD ticks=", atTicks);

// ── 2) Screenshot at CURRENT time only (restore playhead after) ────
const probe = path.join(os.tmpdir(), `ppmcp-probe-${Date.now()}.png`);
// Pass atTicks = current so we don't scrub away; restore still applies if equal
await call("sequence_screenshot", { atTicks, outputPath: probe });

let headX = 720;
let headY = 420;
const yellow = findYellowHeadCenter(probe);
console.log("yellow detect", yellow);
if (yellow.ok) {
  const mapped = mapToSequence(yellow.cx, yellow.cy, yellow.w, yellow.h);
  headX = mapped.sx;
  headY = mapped.sy;
  console.log("mapped head", mapped);
} else {
  console.log("yellow not found — using default upper-center");
  headX = 780;
  headY = 380;
}

// ── 3) Bubble PNG above head ───────────────────────────────────────
const png = writeSpeechBubblePng("merhaba", headX, headY);
console.log("bubble", png, "above", headX, headY);

await call("project_import_media", { paths: [png] });
await new Promise((r) => setTimeout(r, 700));

const found = await call("media_find_by_path", { matchString: path.basename(png) });
let mediaId = null;
const mid = found.text.match(/"projectItemId"\s*:\s*"([0-9a-f-]{20,})"/i);
if (mid) mediaId = mid[1];
if (!mediaId) {
  const mid2 = found.text.match(/"id"\s*:\s*"([0-9a-f-]{20,})"/i);
  if (mid2) mediaId = mid2[1];
}
if (!mediaId) {
  console.error("no mediaId");
  await client.close();
  process.exit(1);
}

// Place at ORIGINAL playhead — not 0
await call("clip_overwrite", {
  trackType: "video",
  trackIndex: 2,
  projectItemId: mediaId,
  atTicks,
});

// Duration ~3.5s
const endTicks = String(BigInt(atTicks) + 3n * TPS + TPS / 2n);
const clipsR = await client.callTool(
  { name: "clip_list", arguments: { trackType: "video", trackIndex: 2 } },
  undefined,
  { timeout: 30000 },
);
const ct = textOf(clipsR);
const idxs = [...ct.matchAll(/"clipIndex"\s*:\s*(\d+)/g)].map((x) => Number(x[1]));
const clipIndex = idxs.length ? idxs[idxs.length - 1] : 0;
await call("clip_trim", {
  trackType: "video",
  trackIndex: 2,
  clipIndex,
  edge: "out",
  newTicks: endTicks,
});

// Verify — will restore playhead after
const desk = path.join(os.homedir(), "Desktop", "ppmcp-frame-bubble.png");
await call("sequence_screenshot", { atTicks, outputPath: desk });
await call("project_save", {});

console.log("\nOK merhaba bubble @ ticks", atTicks, "head", headX, headY);
console.log(desk);
await client.close();

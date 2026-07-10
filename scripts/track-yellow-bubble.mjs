#!/usr/bin/env node
/**
 * Speech bubble "merhaba" tracks yellow-headed character.
 * When yellow is lost for several samples → opacity 0 (hide).
 * Does NOT switch sequence. Uses current playhead as start.
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
const sec = (s) => String(BigInt(Math.round(Number(s) * Number(TPS))));

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "track-bubble", version: "1.0.0" });
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
  const short = t.slice(0, 200).replace(/\s+/g, " ");
  if (!name.includes("screenshot") || r.isError) console.log(`${r.isError ? "✗" : "✓"} ${name}: ${short}`);
  return { ok: !r.isError, text: t, raw: r };
}

/** Yellow cluster in full Premiere screenshot → 1920x1080 sequence coords */
function findYellowInShot(pngPath) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('${pngPath.replace(/'/g, "''")}')
$w = $img.Width; $h = $img.Height
$sumX = 0L; $sumY = 0L; $n = 0L
$step = [Math]::Max(2, [int]($w / 350))
for ($y = [int]($h * 0.08); $y -lt [int]($h * 0.70); $y += $step) {
  for ($x = [int]($w * 0.22); $x -lt [int]($w * 0.88); $x += $step) {
    $c = $img.GetPixel($x, $y)
    if ($c.R -gt 155 -and $c.G -gt 135 -and $c.B -lt 130 -and ($c.R - $c.B) -gt 45 -and ($c.G - $c.B) -gt 35) {
      $sumX += $x; $sumY += $y; $n++
    }
  }
}
$img.Dispose()
if ($n -lt 10) { Write-Output "miss,0,0,$w,$h,$n" }
else {
  $cx = [int]($sumX / $n); $cy = [int]($sumY / $n)
  Write-Output "hit,$cx,$cy,$w,$h,$n"
}
`;
  const sp = path.join(os.tmpdir(), `ppmcp-yel-${Date.now()}-${Math.random().toString(36).slice(2, 5)}.ps1`);
  fs.writeFileSync(sp, ps, "utf8");
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", sp],
      { encoding: "utf8", windowsHide: true, timeout: 45000 },
    );
    const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
    const [tag, cx, cy, w, h, n] = line.split(",");
    if (tag !== "hit") return { ok: false, n: Number(n) || 0 };
    // Map Premiere window → sequence 1920x1080 (PM heuristic)
    const pmL = Math.floor(Number(w) * 0.28);
    const pmT = Math.floor(Number(h) * 0.06);
    const pmR = Math.floor(Number(w) * 0.78);
    const pmB = Math.floor(Number(h) * 0.52);
    const nx = (Number(cx) - pmL) / (pmR - pmL);
    const ny = (Number(cy) - pmT) / (pmB - pmT);
    const sx = Math.round(Math.max(0.08, Math.min(0.92, nx)) * 1920);
    const sy = Math.round(Math.max(0.08, Math.min(0.92, ny)) * 1080);
    return { ok: true, sx, sy, n: Number(n) };
  } catch {
    return { ok: false, n: 0 };
  } finally {
    try {
      fs.unlinkSync(sp);
    } catch {
      /* */
    }
  }
}

/** Bubble baked at REF (960, 400) so Motion Position keyframes move it. */
function writeBubbleAtRef(text = "merhaba") {
  const file = path.join(os.tmpdir(), `ppmcp-bubble-track-${Date.now()}.png`);
  const out = file.replace(/\\/g, "\\\\");
  const safe = String(text).replace(/'/g, "''");
  // Draw bubble centered at 960, 400 (reference)
  const cx = 960;
  const cy = 400;
  const bw = 280;
  const bh = 96;
  const bx = cx - Math.floor(bw / 2);
  const by = cy - Math.floor(bh / 2);
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$rad = 26
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 255, 255, 255))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$x = ${bx}; $y = ${by}; $w = ${bw}; $h = ${bh}
$path.AddArc($x, $y, $rad*2, $rad*2, 180, 90)
$path.AddArc($x+$w-$rad*2, $y, $rad*2, $rad*2, 270, 90)
$path.AddArc($x+$w-$rad*2, $y+$h-$rad*2, $rad*2, $rad*2, 0, 90)
$path.AddArc($x, $y+$h-$rad*2, $rad*2, $rad*2, 90, 90)
$path.CloseFigure()
$g.FillPath($white, $path)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(240, 30, 30, 30), 3)
$g.DrawPath($pen, $path)
$midX = ${cx}; $botY = ${by}+${bh}
$tail = New-Object System.Drawing.Drawing2D.GraphicsPath
$tail.AddPolygon(@(
  (New-Object System.Drawing.Point ($midX-14), $botY),
  (New-Object System.Drawing.Point ($midX+14), $botY),
  (New-Object System.Drawing.Point $midX, ($botY+34))
))
$g.FillPath($white, $tail)
$g.DrawLine($pen, $midX-14, $botY, $midX, $botY+34)
$g.DrawLine($pen, $midX+14, $botY, $midX, $botY+34)
$font = New-Object System.Drawing.Font 'Segoe UI', 34, ([System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 15, 15))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('${safe}', $font, $brush, (New-Object System.Drawing.RectangleF ${bx}, ${by}, ${bw}, ${bh}), $sf)
$bmp.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $white.Dispose(); $pen.Dispose(); $path.Dispose(); $tail.Dispose(); $font.Dispose(); $brush.Dispose()
`;
  const sp = path.join(os.tmpdir(), `ppmcp-bt-${Date.now()}.ps1`);
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
  return file;
}

// Bubble ref center in PNG
const REF_X = 960;
const REF_Y = 400;
// Want bubble center slightly above head
function motionForHead(headX, headY) {
  const targetX = headX;
  const targetY = Math.max(60, headY - 100);
  // Full-frame graphic: Position is clip center (0.5,0.5 default) at sequence center.
  // Shift so REF point lands on target:
  const mx = 0.5 + (targetX - REF_X) / 1920;
  const my = 0.5 + (targetY - REF_Y) / 1080;
  return {
    x: Math.max(0.05, Math.min(0.95, mx)),
    y: Math.max(0.05, Math.min(0.95, my)),
  };
}

// ── Start: read playhead only ──────────────────────────────────────
await call("edit_bootstrap", { compact: true });
const ph = await call("playhead_get_position", {});
let startTicks = "0";
const tm = ph.text.match(/"ticks"\s*:\s*"?(\d+)"?/);
if (tm) startTicks = tm[1];
const startSec = Number(BigInt(startTicks)) / Number(TPS);
console.log("Track from playhead seconds=", startSec.toFixed(3), "ticks=", startTicks);

// Sample ~6s at 5 fps (0.2s) — enough to follow / hide
const sampleDt = 0.2;
const sampleDur = 6.0;
const samples = [];
const missLimit = 3; // hide after 3 consecutive misses
let consecutiveMiss = 0;

console.log("Sampling yellow head…");
for (let t = 0; t <= sampleDur + 0.001; t += sampleDt) {
  const absSec = startSec + t;
  const atTicks = sec(absSec);
  const probe = path.join(os.tmpdir(), `ppmcp-tr-${Date.now()}-${Math.round(t * 100)}.png`);
  await call("sequence_screenshot", { atTicks, outputPath: probe });
  const y = findYellowInShot(probe);
  try {
    fs.unlinkSync(probe);
  } catch {
    /* */
  }
  if (y.ok) {
    consecutiveMiss = 0;
    samples.push({ sec: absSec, ticks: atTicks, visible: true, sx: y.sx, sy: y.sy });
    process.stdout.write(`  t=${absSec.toFixed(2)}s HIT (${y.sx},${y.sy}) n=${y.n}\n`);
  } else {
    consecutiveMiss++;
    samples.push({ sec: absSec, ticks: atTicks, visible: false });
    process.stdout.write(`  t=${absSec.toFixed(2)}s miss (${consecutiveMiss})\n`);
    // Optional: stop early if lost for long after we had hits
    if (consecutiveMiss >= missLimit && samples.some((s) => s.visible)) {
      // keep sampling a bit more then stop
      if (consecutiveMiss >= missLimit + 2) break;
    }
  }
}

const hits = samples.filter((s) => s.visible);
if (!hits.length) {
  console.error("No yellow head found in sample window — abort place.");
  await client.close();
  process.exit(1);
}

// ── Place bubble graphic once at start ─────────────────────────────
const png = writeBubbleAtRef("merhaba");
await call("project_import_media", { paths: [png] });
await new Promise((r) => setTimeout(r, 700));
const found = await call("media_find_by_path", { matchString: path.basename(png) });
const mid = found.text.match(/"projectItemId"\s*:\s*"([0-9a-f-]{20,})"/i);
if (!mid) {
  console.error("media not found");
  await client.close();
  process.exit(1);
}
const mediaId = mid[1];

const endTicks = sec(startSec + sampleDur + 0.5);
await call("clip_overwrite", {
  trackType: "video",
  trackIndex: 2,
  projectItemId: mediaId,
  atTicks: startTicks,
});

// Resolve clip index
const clipsR = await client.callTool(
  { name: "clip_list", arguments: { trackType: "video", trackIndex: 2 } },
  undefined,
  { timeout: 30000 },
);
const ct = textOf(clipsR);
const idxs = [...ct.matchAll(/"clipIndex"\s*:\s*(\d+)/g)].map((x) => Number(x[1]));
const clipIndex = idxs.length ? idxs[idxs.length - 1] : 0;
console.log("bubble clipIndex", clipIndex);

await call("clip_trim", {
  trackType: "video",
  trackIndex: 2,
  clipIndex,
  edge: "out",
  newTicks: endTicks,
});

// Effects: Opacity=0, Motion=1
const fx = await call("effect_list_applied", {
  trackType: "video",
  trackIndex: 2,
  clipIndex,
});
let opacityIdx = 0;
let motionIdx = 1;
if (/Opacity/i.test(fx.text)) {
  const blocks = fx.text.split("{");
  for (const b of blocks) {
    if (/displayName":\s*"Opacity"/i.test(b) || /"Opacity"/.test(b)) {
      const im = b.match(/effectIndex"\s*:\s*(\d+)/);
      if (im) opacityIdx = Number(im[1]);
    }
    if (/displayName":\s*"Motion"/i.test(b)) {
      const im = b.match(/effectIndex"\s*:\s*(\d+)/);
      if (im) motionIdx = Number(im[1]);
    }
  }
}
console.log("opacityIdx", opacityIdx, "motionIdx", motionIdx);

// Keyframes: position + opacity
let lastVisible = null;
for (const s of samples) {
  if (s.visible) {
    const mot = motionForHead(s.sx, s.sy);
    lastVisible = mot;
    await call("effect_set_param", {
      trackType: "video",
      trackIndex: 2,
      clipIndex,
      effectIndex: motionIdx,
      paramName: "Position",
      value: { x: mot.x, y: mot.y },
      atTicks: s.ticks,
    });
    await call("effect_set_param", {
      trackType: "video",
      trackIndex: 2,
      clipIndex,
      effectIndex: opacityIdx,
      paramName: "Opacity",
      value: 100,
      atTicks: s.ticks,
    });
  } else {
    // Hide when lost — hold last position so it doesn't jump when reappearing
    if (lastVisible) {
      await call("effect_set_param", {
        trackType: "video",
        trackIndex: 2,
        clipIndex,
        effectIndex: motionIdx,
        paramName: "Position",
        value: { x: lastVisible.x, y: lastVisible.y },
        atTicks: s.ticks,
      });
    }
    await call("effect_set_param", {
      trackType: "video",
      trackIndex: 2,
      clipIndex,
      effectIndex: opacityIdx,
      paramName: "Opacity",
      value: 0,
      atTicks: s.ticks,
    });
  }
}

// Ensure start visible if first sample hit
if (hits[0]) {
  const mot = motionForHead(hits[0].sx, hits[0].sy);
  await call("effect_set_param", {
    trackType: "video",
    trackIndex: 2,
    clipIndex,
    effectIndex: opacityIdx,
    paramName: "Opacity",
    value: 100,
    atTicks: startTicks,
  });
  await call("effect_set_param", {
    trackType: "video",
    trackIndex: 2,
    clipIndex,
    effectIndex: motionIdx,
    paramName: "Position",
    value: { x: mot.x, y: mot.y },
    atTicks: startTicks,
  });
}

const desk = path.join(os.homedir(), "Desktop", "ppmcp-frame-bubble.png");
await call("sequence_screenshot", { atTicks: startTicks, outputPath: desk });
await call("project_save", {});

console.log("\n=== TRACKING DONE ===");
console.log("samples", samples.length, "hits", hits.length, "misses", samples.length - hits.length);
console.log("Bubble follows yellow head; opacity 0 when lost.");
console.log(desk);
await client.close();

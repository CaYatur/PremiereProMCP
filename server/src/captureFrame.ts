/**
 * Frame stills without full-sequence AME render:
 * 1) UI Automation finds Program Monitor panel bounds
 * 2) CopyFromScreen full panel (no crop by default)
 * 3) Optional ffmpeg extract from short media
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function which(cmd: string): string | null {
  try {
    const out = execSync(`where.exe ${cmd}`, { encoding: "utf8", windowsHide: true });
    const line = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !s.toLowerCase().includes("windowsapps"));
    return line || null;
  } catch {
    return null;
  }
}

export function findFfmpeg(): string | null {
  return which("ffmpeg") || which("ffmpeg.exe");
}

export function findMagick(): string | null {
  return which("magick") || which("magick.exe");
}

/** Extract frame 0 from a media file into a PNG. */
export function ffmpegExtractFrame(mediaPath: string, pngPath: string, timeoutMs = 60000): boolean {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg || !fs.existsSync(mediaPath)) return false;
  try {
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    execFileSync(
      ffmpeg,
      ["-y", "-i", mediaPath, "-frames:v", "1", "-q:v", "2", pngPath],
      { timeout: timeoutMs, windowsHide: true, stdio: "ignore" },
    );
    return fs.existsSync(pngPath) && fs.statSync(pngPath).size > 100;
  } catch {
    return false;
  }
}

function resolveCaptureScript(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "scripts", "capture-program-monitor.ps1"),
    path.join(here, "..", "scripts", "capture-program-monitor.ps1"),
    path.join(process.cwd(), "server", "scripts", "capture-program-monitor.ps1"),
    path.join(process.cwd(), "scripts", "capture-program-monitor.ps1"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Capture Premiere for QA frames — robust fallbacks, no fragile PM child hunt.
 * 1) Full Adobe Premiere Pro main window (default)
 * 2) Full primary desktop if Premiere HWND fails
 * mode "program"|"window" both use Premiere main (layout-stable).
 */
export function capturePremiereWindow(
  pngPath: string,
  opts: {
    mode?: "program" | "window";
    frameWidth?: number;
    frameHeight?: number;
    /** Ignored — no crop by default (fragile). */
    stripChrome?: boolean;
    smartCrop?: boolean;
  } = {},
): { ok: boolean; error?: string; via: string; hwndHint?: string } {
  const mode = opts.mode || "program";
  const scriptPath = resolveCaptureScript();
  if (!scriptPath) {
    return {
      ok: false,
      error: "capture-program-monitor.ps1 not found",
      via: "printwindow",
    };
  }

  try {
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  } catch {
    /* */
  }

  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-OutFile",
        pngPath,
        "-Mode",
        mode,
      ],
      { timeout: 60000, windowsHide: true, encoding: "utf8" },
    );
    if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 500) {
      return {
        ok: false,
        error: `PNG missing after capture: ${String(out).slice(0, 400)}`,
        via: "printwindow",
      };
    }
    let via = "premiere-main-window";
    if (/via=desktop/i.test(out)) via = "desktop";
    else if (/via=premiere-main|via=main/i.test(out)) via = "premiere-main-window";
    else if (/via=program/i.test(out)) via = "premiere-main-window";
    return { ok: true, via, hwndHint: String(out).trim().slice(0, 450) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      via: "printwindow",
    };
  }
}

/** Read PNG IHDR width/height without extra deps. */
function readPngSize(pngPath: string): { w: number; h: number } | null {
  try {
    const fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * Optional refine (OFF by default). Kept for stripChrome:true only.
 */
function refineProgramMonitorFrame(
  pngPath: string,
  frameW: number,
  frameH: number,
  _aggressive = false,
): void {
  // Intentionally minimal — user prefers raw PM without crop.
  // Only force resize if dimensions wildly off and magick available.
  void _aggressive;
  const sz = readPngSize(pngPath);
  if (!sz || !findMagick()) return;
  if (sz.w === frameW && sz.h === frameH) return;
  // Do not crop content — only skip
}

/**
 * Center-crop image to target aspect ratio (sequence frame).
 */
export function cropCenterAspect(
  pngPath: string,
  frameW: number,
  frameH: number,
  _maxFill = 0.85,
  smart = true,
): void {
  if (smart) {
    const sz = readPngSize(pngPath);
    if (sz && sz.w > 0 && sz.h > 0) {
      const imgAr = sz.w / sz.h;
      const targetAr = frameW / frameH;
      if (Math.abs(imgAr - targetAr) < 0.08) {
        if (sz.w === frameW && sz.h === frameH) return;
      }
    }
  }
  const magick = findMagick();
  const ffmpeg = findFfmpeg();
  if (!fs.existsSync(pngPath)) return;
  const ar = frameW / frameH;
  const tmp = pngPath + ".crop.png";
  try {
    if (magick) {
      execFileSync(
        magick,
        [
          pngPath,
          "-gravity",
          "center",
          "-crop",
          `${ar}:1+0+0`,
          "+repage",
          "-resize",
          `${frameW}x${frameH}^`,
          "-gravity",
          "center",
          "-extent",
          `${frameW}x${frameH}`,
          tmp,
        ],
        { timeout: 15000, windowsHide: true, stdio: "ignore" },
      );
    } else if (ffmpeg) {
      execFileSync(
        ffmpeg,
        [
          "-y",
          "-i",
          pngPath,
          "-vf",
          `crop='if(gt(a,${ar}),ih*${ar},iw)':'if(gt(a,${ar}),ih,iw/${ar})',scale=${frameW}:${frameH}`,
          tmp,
        ],
        { timeout: 15000, windowsHide: true, stdio: "ignore" },
      );
    } else {
      return;
    }
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 500) {
      fs.renameSync(tmp, pngPath);
    }
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* */
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until a file exists and is stable (size not growing). */
export async function waitForFile(filePath: string, timeoutMs = 90000, stableMs = 800): Promise<boolean> {
  const start = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > 1000 && size === lastSize) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return true;
      } else {
        stableSince = 0;
        lastSize = size;
      }
    }
    await sleep(250);
  }
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 1000;
}

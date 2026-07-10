/**
 * Paths to AE-authored MOGRTs (ExtendScript text edit works on these).
 * Premiere-native Basic Title is broken for programmatic text.
 *
 * - plain: minimal AE "Basic Text" (looks like Type Tool — text only)
 * - lower-third: Sports package branded templates
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const YEAR_RANGE = [2026, 2025, 2024, 2023];

function programFilesAdobe(): string[] {
  return [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ];
}

/** Minimal plain-text AE MOGRTs (Type Tool–like: text layer only, no sports chrome). */
export function listPlainTextMogrtCandidates(): string[] {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const cwd = process.cwd();
  return [
    // Project-bundled AE Basic Text (authored via spike/ae-template-builder)
    path.resolve(cwd, "plugin", "templates", "Basic Text.mogrt"),
    path.resolve(cwd, "templates", "Basic Text.mogrt"),
    path.join(appData, "Adobe", "Common", "Motion Graphics Templates", "Basic Text.mogrt"),
    // If user re-exports from AE under another name
    path.resolve(cwd, "plugin", "templates", "AE Text.mogrt"),
    path.resolve(cwd, "templates", "AE Text.mogrt"),
  ];
}

/** Branded lower-third AE packages. */
export function listLowerThirdMogrtCandidates(): string[] {
  const preferred: string[] = [];
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");

  for (const pf of programFilesAdobe()) {
    for (const year of YEAR_RANGE) {
      const base = path.join(pf, "Adobe", `Adobe Premiere Pro ${year}`, "Essential Graphics");
      preferred.push(
        path.join(base, "[AE] Sports Package", "Sports Lower Third Center.mogrt"),
        path.join(base, "[AE] Sports Package", "Sports Lower Third Left.mogrt"),
        path.join(base, "[AE] Sports Package", "Sports Lower Third Right.mogrt"),
        path.join(base, "[AE] Video Gaming Package", "Gaming Lower Third.mogrt"),
      );
    }
  }
  preferred.push(
    path.join(
      appData,
      "Adobe",
      "Common",
      "Motion Graphics Templates",
      "[AE] Sports Package",
      "Sports Lower Third Center.mogrt",
    ),
  );
  return preferred;
}

/** @deprecated use resolvePlainTextMogrt / resolveLowerThirdMogrt */
export function listAeTextMogrtCandidates(): string[] {
  return [...listPlainTextMogrtCandidates(), ...listLowerThirdMogrtCandidates()];
}

function firstExisting(candidates: string[]): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  for (const p of candidates) {
    tried.push(p);
    try {
      if (fs.existsSync(p)) return { path: p, tried };
    } catch {
      /* continue */
    }
  }
  return { path: null, tried: tried.slice(0, 12) };
}

function ameSystemPresets(year: string, folder: string, file: string): string {
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  return path.join(
    programFiles,
    "Adobe",
    `Adobe Media Encoder ${year}`,
    "MediaIO",
    "systempresets",
    folder,
    file,
  );
}

/**
 * Prefer PNG Sequence for pure stills (true image, no decode artifacts).
 * Falls back to H.264 Match Source for 1-frame media + ffmpeg extract.
 */
export function resolveDefaultStillPreset(): { path: string | null; tried: string[]; kind: "png" | "h264" | null } {
  const tried: string[] = [];
  const years = ["2026", "2025", "2024", "2023"];
  // 1) PNG sequence — purest still path when AME honors in/out
  for (const year of years) {
    for (const file of [
      "PNG Sequence (Match Source).epr",
      "PNG Sequence with Alpha (Match Source).epr",
    ]) {
      const p = ameSystemPresets(year, "3F3F3F3F_504E4720", file);
      tried.push(p);
      if (fs.existsSync(p)) return { path: p, tried, kind: "png" };
    }
  }
  // 2) JPEG sequence
  for (const year of years) {
    const p = ameSystemPresets(year, "3F3F3F3F_4A504547", "JPEG Sequence (Match Source).epr");
    tried.push(p);
    if (fs.existsSync(p)) return { path: p, tried, kind: "png" };
  }
  // 3) H.264 Match Source
  for (const year of years) {
    for (const file of ["H264 Match Source - High bitrate.epr", "01 - Match Source.epr"]) {
      const p = ameSystemPresets(year, "3F3F3F3F_4D6F6F56", file);
      tried.push(p);
      if (fs.existsSync(p)) return { path: p, tried, kind: "h264" };
    }
  }
  return { path: null, tried, kind: null };
}

/** H.264 only (for multi-frame media export fallback). */
export function resolveH264MatchSourcePreset(): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  for (const year of ["2026", "2025", "2024", "2023"]) {
    for (const file of ["H264 Match Source - High bitrate.epr", "01 - Match Source.epr"]) {
      const p = ameSystemPresets(year, "3F3F3F3F_4D6F6F56", file);
      tried.push(p);
      if (fs.existsSync(p)) return { path: p, tried };
    }
  }
  return { path: null, tried };
}

/** Plain Type Tool–like AE Basic Text.mogrt */
export function resolvePlainTextMogrt(): { path: string | null; tried: string[] } {
  return firstExisting(listPlainTextMogrtCandidates());
}

/** Branded lower third */
export function resolveLowerThirdMogrt(): { path: string | null; tried: string[] } {
  return firstExisting(listLowerThirdMogrtCandidates());
}

/** Prefer plain Basic Text, then lower-third packages */
export function resolveExistingAeTextMogrt(): { path: string | null; tried: string[] } {
  const plain = resolvePlainTextMogrt();
  if (plain.path) return plain;
  return resolveLowerThirdMogrt();
}

/**
 * Export helpers shared by every tool that calls `export.sequence`.
 *
 * - Picks a default .epr when the caller gives none (Premiere's
 *   EncoderManager rejects an empty preset with "Invalid parameter").
 * - Normalises preset/output paths to native Windows separators: Premiere
 *   silently drops an export whose path uses forward slashes.
 * - Turns `started: false` into a clear error instead of a silent no-op.
 */
import fs from "node:fs";
import path from "node:path";

const YEARS = ["2026", "2025", "2024", "2023"];
const H264_FOLDER = "3F3F3F3F_4D6F6F56";
const H264_FILES = ["H264 Match Source - High bitrate.epr", "01 - Match Source.epr"];
const ADAPTIVE_FILES = [
  "Match Source - Adaptive High Bitrate.epr",
  "Match Source - Adaptive Medium Bitrate.epr",
];

type Env = Record<string, string | undefined>;

/** `C:/a/b.mp4` → `C:\a\b.mp4` on Windows (or for any drive/UNC-looking path). */
export function toNativePath(p: string, platform: string = process.platform): string {
  if (!p) return p;
  const looksWindows = /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
  if (platform !== "win32" && !looksWindows) return p;
  return p.replace(/\//g, "\\");
}

/** Candidate default presets, most preferred first. */
export function listDefaultExportPresetCandidates(
  env: Env = process.env,
  platform: string = process.platform,
): string[] {
  const out: string[] = [];
  if (platform === "darwin") {
    for (const y of YEARS) {
      for (const app of [`Adobe Premiere Pro ${y}/Adobe Premiere Pro ${y}.app`, `Adobe Media Encoder ${y}/Adobe Media Encoder ${y}.app`]) {
        for (const f of H264_FILES) out.push(path.posix.join("/Applications", app, "Contents/MediaIO/systempresets", H264_FOLDER, f));
      }
    }
    return out;
  }
  const roots = [...new Set([env["ProgramFiles"] || "C:\\Program Files", env["ProgramW6432"], env["ProgramFiles(x86)"]].filter(Boolean) as string[])];
  const j = (...parts: string[]) => path.win32.join(...parts);
  for (const y of YEARS) {
    for (const root of roots) {
      for (const app of [`Adobe Premiere Pro ${y}`, `Adobe Media Encoder ${y}`]) {
        for (const f of H264_FILES) out.push(j(root, "Adobe", app, "MediaIO", "systempresets", H264_FOLDER, f));
      }
    }
  }
  for (const y of YEARS) {
    for (const root of roots) {
      for (const f of ADAPTIVE_FILES) {
        out.push(j(root, "Adobe", `Adobe Premiere Pro ${y}`, "CEP", "extensions", "com.adobe.frameio.v4", "assets", "epr", f));
      }
    }
  }
  return out;
}

export function resolveDefaultExportPreset(
  exists: (p: string) => boolean = (p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  },
  env: Env = process.env,
  platform: string = process.platform,
): { path: string | null; tried: string[] } {
  const tried = listDefaultExportPresetCandidates(env, platform);
  return { path: tried.find((p) => exists(p)) ?? null, tried };
}

export type ExportParams = {
  sequenceId?: string;
  outputPath?: string;
  presetPath?: string;
  exportType?: string;
  exportFull?: boolean;
  [k: string]: unknown;
};

export type PrepareDeps = {
  exists?: (p: string) => boolean;
  mkdir?: (dir: string) => void;
  env?: Env;
  platform?: string;
};

/** Resolve + validate before calling Premiere. Throws a readable Error. */
export function prepareExportParams(p: ExportParams, deps: PrepareDeps = {}): ExportParams & { presetAuto?: boolean } {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? ((x: string) => { try { return fs.existsSync(x); } catch { return false; } });
  if (!p.outputPath || !String(p.outputPath).trim()) {
    throw new Error("export: outputPath is required (absolute path to the output file).");
  }
  const outputPath = toNativePath(String(p.outputPath).trim(), platform);
  let presetPath = p.presetPath ? toNativePath(String(p.presetPath).trim(), platform) : "";
  let presetAuto = false;
  if (!presetPath) {
    const r = resolveDefaultExportPreset(exists, deps.env ?? process.env, platform);
    if (!r.path) {
      throw new Error(
        "export: no presetPath given and no default H.264 'Match Source' preset was found in the Premiere Pro / Media Encoder install folders. Pass presetPath (absolute path to a .epr).",
      );
    }
    presetPath = r.path;
    presetAuto = true;
  } else if (!exists(presetPath)) {
    throw new Error(`export: preset not found: ${presetPath}`);
  }
  const dir = platform === "win32" || /^[A-Za-z]:\\/.test(outputPath) ? path.win32.dirname(outputPath) : path.dirname(outputPath);
  if (dir && !exists(dir)) {
    try {
      (deps.mkdir ?? ((d: string) => fs.mkdirSync(d, { recursive: true })))(dir);
    } catch (e) {
      throw new Error(`export: output folder does not exist and could not be created: ${dir} (${e instanceof Error ? e.message : e})`);
    }
  }
  return { ...p, outputPath, presetPath, presetAuto };
}

/** Throw when Premiere reports the export did not start. */
export function assertExportStarted(data: unknown, prepared: ExportParams): void {
  const d = data as { started?: boolean } | null | undefined;
  if (d && d.started === false) {
    throw new Error(
      `export: Premiere did not start the export (started=false). output=${prepared.outputPath} preset=${prepared.presetPath}. Check that the output folder is writable and the preset matches the sequence.`,
    );
  }
}

type Relay = { relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> } };

/** Single entry point for `export.sequence` used by all export tools. */
export async function callExportSequence(ctx: Relay, p: ExportParams): Promise<Record<string, unknown>> {
  const prepared = prepareExportParams(p);
  const { presetAuto, ...send } = prepared;
  const data = await ctx.relay.call("export.sequence", send as Record<string, unknown>);
  assertExportStarted(data, prepared);
  return {
    ...(data as Record<string, unknown>),
    outputPath: prepared.outputPath,
    presetPath: prepared.presetPath,
    presetAuto: !!presetAuto,
  };
}

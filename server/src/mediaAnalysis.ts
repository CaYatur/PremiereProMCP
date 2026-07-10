/**
 * Real media analysis via ffmpeg (no fake DSP).
 * - Silence: ffmpeg silencedetect
 * - Onsets / beat-like peaks: mono PCM energy envelope peaks
 * - Scene cuts: ffmpeg scene score
 * - STT: whisper CLI if present, else Windows System.Speech (short clips), else SRT import path
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TICKS_PER_SECOND = 254016000000n;

export function secondsToTicks(sec: number): string {
  return String(BigInt(Math.max(0, Math.floor(sec * Number(TICKS_PER_SECOND)))));
}

export function ticksToSeconds(ticks: string): number {
  return Number(BigInt(ticks)) / Number(TICKS_PER_SECOND);
}

let cachedFfmpeg: string | null | undefined;

export function findFfmpeg(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const candidates = [
    process.env.FFMPEG_PATH,
    "ffmpeg",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      if (r.status === 0 || (r.stdout && /ffmpeg version/i.test(r.stdout))) {
        cachedFfmpeg = c;
        return c;
      }
    } catch {
      /* next */
    }
  }
  cachedFfmpeg = null;
  return null;
}

function runFfmpeg(args: string[], timeoutMs = 120000): { stdout: string; stderr: string; status: number | null } {
  const bin = findFfmpeg();
  if (!bin) throw new Error("ffmpeg not found. Install ffmpeg and ensure it is on PATH (or set FFMPEG_PATH).");
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status,
  };
}

export type SilenceRegion = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  startTicks: string;
  endTicks: string;
};

/** ffmpeg silencedetect — real silence regions in an audio/video file. */
export function detectSilenceInFile(
  mediaPath: string,
  opts: { noiseDb?: number; minDuration?: number } = {},
): { regions: SilenceRegion[]; noiseDb: number; minDuration: number; engine: string } {
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaPath}`);
  const noiseDb = opts.noiseDb ?? -30;
  const minDuration = opts.minDuration ?? 0.35;
  const { stderr } = runFfmpeg(
    [
      "-hide_banner",
      "-i",
      mediaPath,
      "-af",
      `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
      "-f",
      "null",
      "-",
    ],
    180000,
  );
  const regions: SilenceRegion[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([0-9.]+)/);
    if (s) {
      pendingStart = parseFloat(s[1]!);
      continue;
    }
    const e = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (e && pendingStart !== null) {
      const end = parseFloat(e[1]!);
      const dur = parseFloat(e[2]!);
      regions.push({
        startSeconds: pendingStart,
        endSeconds: end,
        durationSeconds: dur,
        startTicks: secondsToTicks(pendingStart),
        endTicks: secondsToTicks(end),
      });
      pendingStart = null;
    }
  }
  return { regions, noiseDb, minDuration, engine: "ffmpeg-silencedetect" };
}

export type OnsetEvent = {
  seconds: number;
  ticks: string;
  strength: number;
  kind: "onset" | "beat_like" | "footstep_like";
};

/**
 * Energy-peak onset detection on mono PCM from ffmpeg.
 * "beat_like" / "footstep_like" are heuristic labels from inter-onset interval
 * (not ML genre detection) — honest about limits.
 */
export function detectOnsetsInFile(
  mediaPath: string,
  opts: {
    maxEvents?: number;
    hopMs?: number;
    minIntervalMs?: number;
    sensitivity?: number;
  } = {},
): { events: OnsetEvent[]; sampleRate: number; engine: string } {
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaPath}`);
  const sampleRate = 11025;
  const hopMs = opts.hopMs ?? 20;
  const hop = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));
  const minIntervalMs = opts.minIntervalMs ?? 120;
  const sensitivity = Math.min(1, Math.max(0.05, opts.sensitivity ?? 0.35));
  const maxEvents = opts.maxEvents ?? 80;

  const tmp = path.join(os.tmpdir(), `ppmcp-pcm-${Date.now()}.f32`);
  try {
    const r = runFfmpeg(
      [
        "-hide_banner",
        "-y",
        "-i",
        mediaPath,
        "-ac",
        "1",
        "-ar",
        String(sampleRate),
        "-f",
        "f32le",
        tmp,
      ],
      180000,
    );
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 4) {
      throw new Error(`PCM extract failed: ${r.stderr.slice(-400)}`);
    }
    const buf = fs.readFileSync(tmp);
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    const energies: number[] = [];
    for (let i = 0; i + hop <= samples.length; i += hop) {
      let sum = 0;
      for (let j = 0; j < hop; j++) {
        const v = samples[i + j]!;
        sum += v * v;
      }
      energies.push(Math.sqrt(sum / hop));
    }
    // Adaptive threshold from median + sensitivity
    const sorted = [...energies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0.001;
    const thr = median * (2.5 + (1 - sensitivity) * 6);
    const minHopGap = Math.max(1, Math.floor(minIntervalMs / hopMs));
    const peaks: Array<{ idx: number; e: number }> = [];
    for (let i = 1; i < energies.length - 1; i++) {
      const e = energies[i]!;
      if (e > thr && e >= energies[i - 1]! && e >= energies[i + 1]!) {
        if (peaks.length && i - peaks[peaks.length - 1]!.idx < minHopGap) {
          if (e > peaks[peaks.length - 1]!.e) peaks[peaks.length - 1] = { idx: i, e };
        } else {
          peaks.push({ idx: i, e });
        }
      }
    }
    peaks.sort((a, b) => b.e - a.e);
    const top = peaks.slice(0, maxEvents).sort((a, b) => a.idx - b.idx);
    // Label by local interval
    const events: OnsetEvent[] = top.map((p, i) => {
      const seconds = (p.idx * hop) / sampleRate;
      let kind: OnsetEvent["kind"] = "onset";
      if (i > 0) {
        const prev = (top[i - 1]!.idx * hop) / sampleRate;
        const gap = seconds - prev;
        if (gap >= 0.35 && gap <= 0.9) kind = "footstep_like";
        else if (gap >= 0.2 && gap <= 0.6) kind = "beat_like";
      }
      return {
        seconds,
        ticks: secondsToTicks(seconds),
        strength: Number(p.e.toFixed(5)),
        kind,
      };
    });
    return { events, sampleRate, engine: "ffmpeg-pcm-energy-peaks" };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export type SceneCut = { seconds: number; ticks: string; score: number };

export function detectSceneCutsInFile(
  mediaPath: string,
  opts: { threshold?: number; maxCuts?: number } = {},
): { cuts: SceneCut[]; threshold: number; engine: string } {
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaPath}`);
  const threshold = opts.threshold ?? 0.35;
  const maxCuts = opts.maxCuts ?? 100;
  // showinfo on scene-selected frames
  const { stderr } = runFfmpeg(
    [
      "-hide_banner",
      "-i",
      mediaPath,
      "-vf",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-",
    ],
    300000,
  );
  const cuts: SceneCut[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    // pts_time:1.234
    const m = line.match(/pts_time:([0-9.]+)/);
    if (m) {
      const seconds = parseFloat(m[1]!);
      cuts.push({ seconds, ticks: secondsToTicks(seconds), score: threshold });
      if (cuts.length >= maxCuts) break;
    }
  }
  return { cuts, threshold, engine: "ffmpeg-scene-select" };
}

export type TranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  startTicks: string;
  endTicks: string;
  text: string;
};

export function parseSrt(content: string): TranscriptSegment[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\n+/);
  const segs: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const tm = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/,
    );
    if (!tm) continue;
    const toSec = (h: string, m: string, s: string, ms: string) =>
      parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms.padEnd(3, "0").slice(0, 3), 10) / 1000;
    const start = toSec(tm[1]!, tm[2]!, tm[3]!, tm[4]!);
    const end = toSec(tm[5]!, tm[6]!, tm[7]!, tm[8]!);
    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!text) continue;
    segs.push({
      startSeconds: start,
      endSeconds: end,
      startTicks: secondsToTicks(start),
      endTicks: secondsToTicks(end),
      text,
    });
  }
  return segs;
}

export function segmentsToSrt(segs: TranscriptSegment[]): string {
  return segs
    .map((s, i) => {
      const fmt = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const ss = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
      };
      return `${i + 1}\n${fmt(s.startSeconds)} --> ${fmt(s.endSeconds)}\n${s.text}\n`;
    })
    .join("\n");
}

function findWhisper(): string | null {
  const candidates = ["whisper", "whisper.exe", path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python313", "Scripts", "whisper.exe")];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["--help"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      if (r.status === 0 || /whisper/i.test(r.stdout + r.stderr)) return c;
    } catch {
      /* next */
    }
  }
  // python -m whisper
  try {
    const r = spawnSync("python", ["-m", "whisper", "--help"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    if (r.status === 0 || /whisper/i.test(r.stdout + (r.stderr || ""))) return "python-m-whisper";
  } catch {
    /* none */
  }
  return null;
}

/** Extract wav mono 16k for STT. */
export function extractWavForStt(mediaPath: string, maxSeconds?: number): string {
  const out = path.join(os.tmpdir(), `ppmcp-stt-${Date.now()}.wav`);
  const args = ["-hide_banner", "-y", "-i", mediaPath, "-ac", "1", "-ar", "16000"];
  if (maxSeconds && maxSeconds > 0) args.push("-t", String(maxSeconds));
  args.push(out);
  const r = runFfmpeg(args, 180000);
  if (!fs.existsSync(out)) throw new Error(`WAV extract failed: ${r.stderr.slice(-300)}`);
  return out;
}

/**
 * Transcribe media. Engines (first available):
 * 1) openai-whisper CLI
 * 2) Windows System.Speech (short clips, quality varies)
 * Returns segments + srt path.
 */
export function transcribeMedia(
  mediaPath: string,
  opts: { language?: string; maxSeconds?: number; engine?: "auto" | "whisper" | "windows" } = {},
): {
  segments: TranscriptSegment[];
  srtPath: string;
  engine: string;
  note: string;
} {
  if (!fs.existsSync(mediaPath)) throw new Error(`File not found: ${mediaPath}`);
  const maxSeconds = opts.maxSeconds ?? 600;
  const wav = extractWavForStt(mediaPath, maxSeconds);
  const outDir = path.join(os.tmpdir(), `ppmcp-stt-out-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });

  const want = opts.engine || "auto";
  const whisperBin = findWhisper();

  // 1) Whisper
  if ((want === "auto" || want === "whisper") && whisperBin) {
    try {
      const base = path.basename(wav, ".wav");
      if (whisperBin === "python-m-whisper") {
        execFileSync(
          "python",
          ["-m", "whisper", wav, "--model", "base", "--output_dir", outDir, "--output_format", "srt", ...(opts.language ? ["--language", opts.language] : [])],
          { timeout: 600000, windowsHide: true },
        );
      } else {
        execFileSync(
          whisperBin,
          [wav, "--model", "base", "--output_dir", outDir, "--output_format", "srt", ...(opts.language ? ["--language", opts.language] : [])],
          { timeout: 600000, windowsHide: true },
        );
      }
      const srtPath =
        [path.join(outDir, `${base}.srt`), ...fs.readdirSync(outDir).filter((f) => f.endsWith(".srt")).map((f) => path.join(outDir, f))].find((p) =>
          fs.existsSync(p),
        ) || "";
      if (srtPath && fs.existsSync(srtPath)) {
        const segments = parseSrt(fs.readFileSync(srtPath, "utf8"));
        return {
          segments,
          srtPath,
          engine: "whisper",
          note: "openai-whisper CLI. Install: pip install openai-whisper",
        };
      }
    } catch (e) {
      if (want === "whisper") throw e;
      /* fall through */
    }
  }

  // 2) Windows System.Speech — real STT, limited accuracy, short chunks
  if (want === "auto" || want === "windows") {
    try {
      const srtPath = path.join(outDir, "windows-speech.srt");
      const segs = windowsSpeechTranscribe(wav, opts.language || "en-US", maxSeconds);
      if (segs.length) {
        fs.writeFileSync(srtPath, segmentsToSrt(segs), "utf8");
        return {
          segments: segs,
          srtPath,
          engine: "windows-system-speech",
          note: "Windows System.Speech (offline). Better quality: pip install openai-whisper. For production use Whisper.",
        };
      }
    } catch (e) {
      if (want === "windows") throw e;
    }
  }

  throw new Error(
    "No STT engine succeeded. Install: pip install openai-whisper (recommended), or use caption_import_srt with an external SRT. Windows Speech may work for short English clips.",
  );
}

/** Chunked Windows speech recognition via PowerShell System.Speech. */
function windowsSpeechTranscribe(wavPath: string, culture: string, maxSeconds: number): TranscriptSegment[] {
  const ps = `
Add-Type -AssemblyName System.Speech
$wav = '${wavPath.replace(/'/g, "''")}'
$culture = '${culture.replace(/'/g, "''")}'
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine([System.Globalization.CultureInfo]::new($culture))
try {
  $recognizer.SetInputToWaveFile($wav)
} catch {
  # try default culture
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $recognizer.SetInputToWaveFile($wav)
}
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(2)
$recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(2)
$recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.8)
$results = @()
$offset = 0.0
# Recognize entire file in one go when possible
try {
  $r = $recognizer.Recognize([TimeSpan]::FromSeconds(${Math.min(maxSeconds, 120)}))
  if ($r -and $r.Text) {
    $results += [PSCustomObject]@{ start=0; end=[Math]::Max(1, $r.Audio.Duration.TotalSeconds); text=$r.Text }
  }
} catch {}
$recognizer.Dispose()
$results | ConvertTo-Json -Compress
`;
  const scriptPath = path.join(os.tmpdir(), `ppmcp-stt-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, ps, "utf8");
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { encoding: "utf8", timeout: 180000, windowsHide: true },
    );
    const trimmed = out.trim();
    if (!trimmed || trimmed === "null") return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((x) => x && x.text)
      .map((x) => ({
        startSeconds: Number(x.start) || 0,
        endSeconds: Number(x.end) || 1,
        startTicks: secondsToTicks(Number(x.start) || 0),
        endTicks: secondsToTicks(Number(x.end) || 1),
        text: String(x.text),
      }));
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }
}

export type CutSuggestion = {
  seconds: number;
  ticks: string;
  reason: "silence_start" | "silence_end" | "onset" | "scene" | "gap";
  detail?: string;
};

/** Merge silence/onset/scene into cut suggestions (for markers / clean-silence). */
export function suggestCutPoints(
  mediaPath: string,
  opts: { includeSilence?: boolean; includeOnsets?: boolean; includeScenes?: boolean; max?: number } = {},
): { suggestions: CutSuggestion[]; engines: string[] } {
  const engines: string[] = [];
  const suggestions: CutSuggestion[] = [];
  if (opts.includeSilence !== false) {
    try {
      const s = detectSilenceInFile(mediaPath);
      engines.push(s.engine);
      for (const r of s.regions) {
        suggestions.push({
          seconds: r.startSeconds,
          ticks: r.startTicks,
          reason: "silence_start",
          detail: `silence ${r.durationSeconds.toFixed(2)}s`,
        });
        suggestions.push({
          seconds: r.endSeconds,
          ticks: r.endTicks,
          reason: "silence_end",
          detail: "speech resume",
        });
      }
    } catch (e) {
      engines.push(`silence-failed:${e instanceof Error ? e.message : e}`);
    }
  }
  if (opts.includeOnsets) {
    try {
      const o = detectOnsetsInFile(mediaPath, { maxEvents: 40 });
      engines.push(o.engine);
      for (const e of o.events) {
        suggestions.push({
          seconds: e.seconds,
          ticks: e.ticks,
          reason: "onset",
          detail: `${e.kind} str=${e.strength}`,
        });
      }
    } catch (e) {
      engines.push(`onset-failed:${e instanceof Error ? e.message : e}`);
    }
  }
  if (opts.includeScenes) {
    try {
      const sc = detectSceneCutsInFile(mediaPath);
      engines.push(sc.engine);
      for (const c of sc.cuts) {
        suggestions.push({
          seconds: c.seconds,
          ticks: c.ticks,
          reason: "scene",
          detail: `score≥${c.score}`,
        });
      }
    } catch (e) {
      engines.push(`scene-failed:${e instanceof Error ? e.message : e}`);
    }
  }
  suggestions.sort((a, b) => a.seconds - b.seconds);
  // Dedup near-identical times (<80ms)
  const dedup: CutSuggestion[] = [];
  for (const s of suggestions) {
    if (dedup.length && Math.abs(dedup[dedup.length - 1]!.seconds - s.seconds) < 0.08) continue;
    dedup.push(s);
  }
  const max = opts.max ?? 120;
  return { suggestions: dedup.slice(0, max), engines };
}

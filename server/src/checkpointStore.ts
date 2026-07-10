/**
 * Project file checkpoints — model can snapshot before risky edits and restore if broken.
 * Stores copies of the saved .prproj (not Premiere's undo stack).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

export type CheckpointMeta = {
  id: string;
  label: string;
  createdAt: string;
  sourceProjectPath: string;
  checkpointProjectPath: string;
  sequenceName?: string;
  sequenceId?: string;
  note?: string;
};

const ROOT = path.join(os.homedir(), ".ppmcp", "checkpoints");

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function metaPath(id: string) {
  return path.join(ROOT, id, "meta.json");
}

function projectCopyPath(id: string, sourcePath: string) {
  const base = path.basename(sourcePath) || "project.prproj";
  return path.join(ROOT, id, base);
}

export function listCheckpoints(): CheckpointMeta[] {
  ensureRoot();
  const out: CheckpointMeta[] = [];
  if (!fs.existsSync(ROOT)) return out;
  for (const id of fs.readdirSync(ROOT)) {
    const mp = metaPath(id);
    if (!fs.existsSync(mp)) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(mp, "utf8")) as CheckpointMeta);
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

export function getCheckpoint(idOrLabel: string): CheckpointMeta | undefined {
  const all = listCheckpoints();
  const q = idOrLabel.trim().toLowerCase();
  return (
    all.find((c) => c.id.toLowerCase() === q) ||
    all.find((c) => c.label.toLowerCase() === q) ||
    all.find((c) => c.label.toLowerCase().includes(q))
  );
}

export function createCheckpointFiles(opts: {
  sourceProjectPath: string;
  label?: string;
  sequenceName?: string;
  sequenceId?: string;
  note?: string;
}): CheckpointMeta {
  ensureRoot();
  const src = opts.sourceProjectPath;
  if (!src || !fs.existsSync(src)) {
    throw new Error(
      `Project path missing or unsaved: "${src || ""}". Save the project first (project must have a disk path).`,
    );
  }
  const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = projectCopyPath(id, src);
  fs.copyFileSync(src, dest);
  // Copy sidecar media cache is NOT done — restore reopens project; media paths stay absolute.
  const meta: CheckpointMeta = {
    id,
    label: (opts.label || `cp-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`).slice(0, 80),
    createdAt: new Date().toISOString(),
    sourceProjectPath: src,
    checkpointProjectPath: dest,
    sequenceName: opts.sequenceName,
    sequenceId: opts.sequenceId,
    note: opts.note,
  };
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function deleteCheckpoint(idOrLabel: string): boolean {
  const meta = getCheckpoint(idOrLabel);
  if (!meta) return false;
  const dir = path.join(ROOT, meta.id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function checkpointRoot() {
  return ROOT;
}

import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defineTool } from "../toolDefinition.js";
import {
  createCheckpointFiles,
  deleteCheckpoint,
  getCheckpoint,
  listCheckpoints,
  checkpointRoot,
} from "../checkpointStore.js";

async function activeProjectInfo(ctx: {
  relay: { call: (m: string, p: Record<string, unknown>, t?: number) => Promise<unknown> };
}) {
  const p = (await ctx.relay.call("project.getActive", {})) as {
    name?: string;
    path?: string;
    sequenceCount?: number;
  };
  let sequenceName: string | undefined;
  let sequenceId: string | undefined;
  try {
    const seq = (await ctx.relay.call("sequence.getActive", {})) as {
      name?: string;
      sequenceId?: string;
    };
    sequenceName = seq?.name;
    sequenceId = seq?.sequenceId;
  } catch {
    /* optional */
  }
  return { project: p, sequenceName, sequenceId };
}

export const checkpointTools = [
  defineTool({
    name: "checkpoint_create",
    title: "Create project checkpoint",
    description:
      "Snapshot the saved Premiere project to disk so you can roll back after bad cuts/deletes/levels. ALWAYS call before risky mass edits. Saves project first, then copies .prproj. Returns checkpoint id.",
    inputSchema: {
      label: z
        .string()
        .optional()
        .describe('Short name e.g. "before-sfx", "clean-v1". Default timestamp.'),
      note: z.string().optional().describe("Why this checkpoint (for later restore)."),
    },
    handler: async (p, ctx) => {
      try {
        await ctx.relay.call("project.save", {}, 60000);
      } catch (e) {
        return {
          text: `Cannot checkpoint: project save failed (${e instanceof Error ? e.message : e}). Save manually once, then retry.`,
          data: { ok: false },
        };
      }
      const { project, sequenceName, sequenceId } = await activeProjectInfo(ctx);
      const src = project?.path;
      if (!src) {
        return {
          text: "Cannot checkpoint: project has no path (Save As a .prproj first).",
          data: { ok: false },
        };
      }
      try {
        const meta = createCheckpointFiles({
          sourceProjectPath: src,
          label: p.label,
          note: p.note,
          sequenceName,
          sequenceId,
        });
        return {
          text: `Checkpoint created: ${meta.id} (“${meta.label}”). Restore with checkpoint_restore { id: "${meta.id}" }.`,
          data: { ok: true, ...meta, root: checkpointRoot() },
        };
      } catch (e) {
        return {
          text: `Checkpoint failed: ${e instanceof Error ? e.message : e}`,
          data: { ok: false },
        };
      }
    },
  }),

  defineTool({
    name: "checkpoint_list",
    title: "List checkpoints",
    description: "List saved project checkpoints (id, label, time, source path).",
    inputSchema: {},
    handler: async () => {
      const list = listCheckpoints();
      if (!list.length) {
        return {
          text: `No checkpoints yet. Use checkpoint_create before risky edits. Dir: ${checkpointRoot()}`,
          data: { checkpoints: [], root: checkpointRoot() },
        };
      }
      const lines = list
        .slice(0, 20)
        .map((c) => `• ${c.id}  “${c.label}”  ${c.createdAt}${c.sequenceName ? `  seq=${c.sequenceName}` : ""}`)
        .join("\n");
      return {
        text: `Checkpoints (${list.length}):\n${lines}`,
        data: { checkpoints: list, root: checkpointRoot() },
      };
    },
  }),

  defineTool({
    name: "checkpoint_restore",
    title: "Restore project checkpoint",
    description:
      "Roll back to a checkpoint: closes current project WITHOUT saving dirty state (optional), opens the checkpoint .prproj. Use after bad mass edits/deletes/audio damage. Prefer id from checkpoint_create/list.",
    inputSchema: {
      id: z.string().describe("Checkpoint id or label from checkpoint_list / checkpoint_create."),
      saveCurrentFirst: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, save current project before close (keeps bad state on disk). Default false = discard unsaved damage."),
      openAsCopy: z
        .boolean()
        .optional()
        .default(true)
        .describe("If true (default), copy checkpoint to a new path next to original then open (safer). If false, open the checkpoint file itself."),
    },
    handler: async (p, ctx) => {
      const meta = getCheckpoint(p.id);
      if (!meta) {
        return {
          text: `No checkpoint matching "${p.id}". Call checkpoint_list.`,
          data: { ok: false },
        };
      }
      if (!meta.checkpointProjectPath) {
        return { text: "Checkpoint meta missing file path.", data: { ok: false } };
      }

      if (!fs.existsSync(meta.checkpointProjectPath)) {
        return {
          text: `Checkpoint file missing on disk: ${meta.checkpointProjectPath}`,
          data: { ok: false },
        };
      }

      if (p.saveCurrentFirst) {
        try {
          await ctx.relay.call("project.save", {});
        } catch {
          /* continue */
        }
      }

      // Close current without keeping damage (unless saveCurrentFirst)
      try {
        await ctx.relay.call("project.close", { save: p.saveCurrentFirst === true });
      } catch (e) {
        // Some builds need open-over-current; continue
        console.warn("[checkpoint] close:", e instanceof Error ? e.message : e);
      }

      let openPath = meta.checkpointProjectPath;
      if (p.openAsCopy !== false) {
        // Write restored working copy next to original project (or Desktop)
        const srcName = path.basename(meta.sourceProjectPath || "restored.prproj");
        const dir = path.dirname(
          meta.sourceProjectPath || path.join(os.homedir(), "Desktop"),
        );
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        openPath = path.join(dir, srcName.replace(/\.prproj$/i, "") + `_restored_${stamp}.prproj`);
        try {
          fs.copyFileSync(meta.checkpointProjectPath, openPath);
        } catch {
          openPath = meta.checkpointProjectPath;
        }
      }

      try {
        const opened = await ctx.relay.call("project.open", { path: openPath });
        return {
          text: `Restored checkpoint “${meta.label}” (${meta.id}). Opened: ${openPath}. Re-select your sequence if needed.`,
          data: { ok: true, opened, meta, openPath },
        };
      } catch (e) {
        return {
          text: `Restore open failed: ${e instanceof Error ? e.message : e}. Manually open: ${openPath}`,
          data: { ok: false, openPath, meta },
        };
      }
    },
  }),

  defineTool({
    name: "checkpoint_delete",
    title: "Delete a checkpoint",
    description: "Remove one checkpoint folder by id or label.",
    inputSchema: {
      id: z.string(),
    },
    handler: async (p) => {
      const ok = deleteCheckpoint(p.id);
      return {
        text: ok ? `Deleted checkpoint ${p.id}.` : `No checkpoint ${p.id}.`,
        data: { ok },
      };
    },
  }),
];

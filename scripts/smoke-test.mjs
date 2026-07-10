#!/usr/bin/env node
// Ordered live smoke test against a real, running Premiere Pro instance
// with the PPMCP UXP plugin loaded. See docs/ARCHITECTURE.md and the
// project task list's "Live smoke-test core loop" item.
//
// Usage:
//   1. Start the bridge:  npm run dev:bridge   (separate terminal)
//   2. Open Premiere Pro, load /plugin as a UXP plugin (UXP Developer Tool
//      -> Add Plugin -> select plugin/manifest.json -> Load), confirm the
//      panel shows "Connected to PPMCP bridge".
//   3. node scripts/smoke-test.mjs
//      Optionally: PPMCP_TEST_MEDIA_PATH=C:\path\to\clip.mp4 node scripts/smoke-test.mjs
//      (without it, clip/effect/color/audio tests that need real media are skipped)
//
// Each step runs independently (a failure doesn't stop later steps) so one
// run gives a full diagnostic picture. Read the printed [FAIL] lines' error
// text — it names exactly which plugin handler / Premiere API call to fix.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mediaPath = process.env.PPMCP_TEST_MEDIA_PATH;

const transport = new StdioClientTransport({
  command: "node",
  args: ["server/dist/index.js"],
  cwd: repoRoot,
});
const client = new Client({ name: "ppmcp-smoke-test", version: "0.0.1" });
await client.connect(transport);

let passCount = 0;
let failCount = 0;
let skipCount = 0;
const state = {};

function extractText(result) {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join(" | ");
}

function tryExtractJson(result) {
  const jsonBlock = result.content.find((c) => c.type === "text" && c.text.startsWith("```json"));
  if (!jsonBlock) return undefined;
  try {
    return JSON.parse(jsonBlock.text.replace(/```json\n?/, "").replace(/```$/, ""));
  } catch {
    return undefined;
  }
}

async function step(label, { skip, run }) {
  if (skip) {
    console.log(`[SKIP] ${label} — ${skip}`);
    skipCount++;
    return undefined;
  }
  try {
    const result = await run();
    if (result.isError) {
      console.log(`[FAIL] ${label}`);
      console.log(`       ${extractText(result)}`);
      failCount++;
      return undefined;
    }
    console.log(`[PASS] ${label}`);
    console.log(`       ${extractText(result).slice(0, 300)}`);
    passCount++;
    return tryExtractJson(result);
  } catch (err) {
    console.log(`[FAIL] ${label} (threw)`);
    console.log(`       ${err.message}`);
    failCount++;
    return undefined;
  }
}

const call = (name, args) => client.callTool({ name, arguments: args });

console.log("=== PPMCP live smoke test ===\n");

const status = await step("app_get_connection_status", { run: () => call("app_get_connection_status", {}) });
if (!status || !status.pluginConnected) {
  console.log("\nPlugin is not connected. Load /plugin in Premiere Pro (UXP Developer Tool -> Add Plugin -> plugin/manifest.json -> Load), confirm the panel shows 'Connected', then re-run this script.");
  await client.close();
  process.exit(1);
}

await step("project_get_active (read)", { run: () => call("project_get_active", {}) });

const seq = await step('sequence_create ("PPMCP Smoke Test") — creates a throwaway sequence, does not touch existing ones', {
  run: () => call("sequence_create", { name: "PPMCP Smoke Test " + Date.now() }),
});
if (seq && seq.sequenceId) {
  state.sequenceId = seq.sequenceId;
  await step("sequence_set_active", { run: () => call("sequence_set_active", { sequenceId: state.sequenceId }) });
}

await step("track_list (read)", { run: () => call("track_list", { sequenceId: state.sequenceId }) });

const textClip = await step('text_add ("PPMCP smoke test") — THE critical untested write: our own MOGRT Text master property via UXP', {
  run: () => call("text_add", { trackIndex: 0, atTicks: "0", text: "PPMCP smoke test", sequenceId: state.sequenceId }),
});
if (textClip) {
  await step("text_get_content (round-trip check)", {
    run: () => call("text_get_content", { trackIndex: textClip.trackIndex, clipIndex: textClip.clipIndex, sequenceId: state.sequenceId }),
  });
  await step("text_set_position", {
    run: () => call("text_set_position", { trackIndex: textClip.trackIndex, clipIndex: textClip.clipIndex, x: 100, y: 100, sequenceId: state.sequenceId }),
  });
}

const shapeClip = await step("shape_add (red rectangle)", {
  run: () =>
    call("shape_add", {
      trackIndex: 0,
      atTicks: "1270080000000", // 5s in, after the text clip's default duration
      fillColor: { r: 255, g: 0, b: 0 },
      sequenceId: state.sequenceId,
    }),
});
if (shapeClip) {
  await step("shape_set_position", {
    run: () => call("shape_set_position", { trackIndex: shapeClip.trackIndex, clipIndex: shapeClip.clipIndex, x: 200, y: 200, sequenceId: state.sequenceId }),
  });
  await step("shape_set_fill_color", {
    run: () => call("shape_set_fill_color", { trackIndex: shapeClip.trackIndex, clipIndex: shapeClip.clipIndex, r: 0, g: 255, b: 0, sequenceId: state.sequenceId }),
  });
  await step("shape_set_size (known partial gap, see docs/ARCHITECTURE.md §2.4)", {
    run: () => call("shape_set_size", { trackIndex: shapeClip.trackIndex, clipIndex: shapeClip.clipIndex, width: 400, height: 300, sequenceId: state.sequenceId }),
  });
}

await step("marker_add", { run: () => call("marker_add", { atTicks: "0", name: "PPMCP test marker", sequenceId: state.sequenceId }) });
await step("marker_list", { run: () => call("marker_list", { sequenceId: state.sequenceId }) });

await step("effect_list_available (Lumetri search)", { run: () => call("effect_list_available", { query: "lumetri" }) });
await step("transition_list_available", { run: () => call("transition_list_available", { kind: "video" }) });

// --- Steps that need a real imported media clip ---
const mediaSkip = mediaPath ? undefined : "set PPMCP_TEST_MEDIA_PATH=<path to a video file> to exercise clip_insert/effect/color/audio";

const imported = await step("project_import_media", {
  skip: mediaSkip,
  run: () => call("project_import_media", { paths: [mediaPath] }),
});

let mediaClip;
if (imported) {
  const items = await step("project_list_items (find imported item)", { run: () => call("project_list_items", {}) });
  // The root bin also lists sequences, not just imported media — match by
  // filename (without extension) rather than blindly taking items[0].
  const mediaBaseName = mediaPath ? path.basename(mediaPath).replace(/\.[^.]+$/, "") : null;
  const firstItem = items && (items.find((i) => i.name === mediaBaseName) ?? items[0]);
  if (firstItem) {
    // Free hypothesis test: freshly-imported media might not be
    // immediately ready for a timeline insert (mirrors the MOGRT
    // component-chain settling delay found earlier this session).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    mediaClip = await step("clip_insert", {
      run: () =>
        call("clip_insert", {
          trackType: "video",
          trackIndex: 1,
          projectItemId: firstItem.id,
          atTicks: "0",
          sequenceId: state.sequenceId,
        }),
    });
  }
}

await step("clip_list on video track 1", {
  skip: mediaSkip,
  run: () => call("clip_list", { trackType: "video", trackIndex: 1, sequenceId: state.sequenceId }),
});

if (mediaClip) {
  await step("color_apply_lumetri", { run: () => call("color_apply_lumetri", { trackIndex: 1, clipIndex: 0, sequenceId: state.sequenceId }) });
  await step("color_set_param (Saturation)", {
    run: () => call("color_set_param", { trackIndex: 1, clipIndex: 0, paramName: "Saturation", value: 150, sequenceId: state.sequenceId }),
  });
  await step("clip_trim (out edge)", {
    run: () => call("clip_trim", { trackType: "video", trackIndex: 1, clipIndex: 0, edge: "out", newTicks: "127008000000", sequenceId: state.sequenceId }),
  });
}

console.log(`\n=== Done: ${passCount} passed, ${failCount} failed, ${skipCount} skipped ===`);
console.log(state.sequenceId ? `Created sequence for this test: ${state.sequenceId} — safe to delete from Premiere afterward.` : "");

await client.close();
process.exit(failCount > 0 ? 1 : 0);

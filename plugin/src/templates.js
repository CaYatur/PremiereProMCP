// Resolves PPMCP's own bundled, template-free-to-the-model MOGRT assets
// (see /templates at repo root, docs/ARCHITECTURE.md §2.4/§4) to an
// absolute filesystem path the premierepro API can open.

const uxp = require("uxp");

const BUILTIN = {
  "basic-text": "templates/Basic Text.mogrt",
  "basic-shape": "templates/Basic Shape.mogrt",
};

// AE-authored lower thirds (if installed with Premiere) — ExtendScript path
// was proven to edit their Title/Subtitle; UXP may expose different params.
const AE_TEXT_CANDIDATES = [
  "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\[AE] Sports Package\\Sports Lower Third Center.mogrt",
  "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2025\\Essential Graphics\\[AE] Sports Package\\Sports Lower Third Center.mogrt",
  "C:\\Users\\cagan\\AppData\\Roaming\\Adobe\\Common\\Motion Graphics Templates\\[AE] Sports Package\\Sports Lower Third Center.mogrt",
];

let pluginFolderCache;

async function resolveTemplatePath(template) {
  if (!BUILTIN[template]) {
    // Treat as a literal path (advanced/custom template use).
    return template;
  }
  if (!pluginFolderCache) {
    pluginFolderCache = await uxp.storage.localFileSystem.getPluginFolder();
  }
  const relative = BUILTIN[template];
  const parts = relative.split("/");
  let entry = pluginFolderCache;
  for (const part of parts) {
    entry = await entry.getEntry(part);
  }
  return entry.nativePath;
}

/** First existing AE-authored text MOGRT path, or null. */
async function resolveAeTextMogrtPath() {
  const fs = require("uxp").storage.localFileSystem;
  // UXP may not have node fs — try getFileForOpening is interactive.
  // Native path strings work for insertMogrtFromPath when file exists.
  // Probe via fetch/XHR is not available; use localFileSystem.getEntryWithUrl if supported.
  for (const p of AE_TEXT_CANDIDATES) {
    try {
      // UXP  localFileSystem.getEntryWithUrl('file:...') — not always available.
      // insertMogrtFromPath will throw if missing; callers try/catch.
      if (typeof fs.getEntryWithUrl === "function") {
        const url = "file:" + p.replace(/\\/g, "/");
        await fs.getEntryWithUrl(url);
        return p;
      }
      return p; // optimistic — insert will validate
    } catch {
      /* try next */
    }
  }
  return AE_TEXT_CANDIDATES[0];
}

module.exports = { resolveTemplatePath, resolveAeTextMogrtPath, AE_TEXT_CANDIDATES };

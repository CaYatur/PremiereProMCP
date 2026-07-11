// Category L (proxy/media) + K (multicam check only).
// Confirmed against Adobe UXP ClipProjectItem docs
// (developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem):
//   cast, attachProxy, canProxy, hasProxy, getProxyPath, getMediaFilePath,
//   isOffline, createSetOfflineAction, changeMediaFilePath, refreshMedia,
//   isMulticamClip, isMergedClip, isSequence, createSetNameAction,
//   findItemsMatchingMediaPath, getContentType
// No create-proxy / multicam-sync / switch-angle APIs exist — those stay out.

const {
  apiError,
  ppro,
  getActiveProject,
  findProjectItemById,
  runTransaction,
} = require("../ppro.js");

async function asClipProjectItem(projectItem) {
  if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") {
    const e = new Error("ClipProjectItem.cast is not available in this Premiere build.");
    e.code = "PREMIERE_API_ERROR";
    throw e;
  }
  return ppro.ClipProjectItem.cast(projectItem);
}

async function clipInfo(clip) {
  const safe = async (fn) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };
  // Duration/resolution/frame rate were never confirmed reachable on
  // ClipProjectItem (see file header). These extra fields are opportunistic,
  // zero-risk probes (safe() swallows "not a function" like everything
  // else here) in case a build/version exposes any of them — no worse than
  // the current "always undefined" if none exist.
  const ticks = await safe(() => clip.getDuration && clip.getDuration());
  return {
    name: clip.name,
    mediaFilePath: await safe(() => clip.getMediaFilePath()),
    isOffline: await safe(() => clip.isOffline()),
    canProxy: await safe(() => clip.canProxy()),
    hasProxy: await safe(() => clip.hasProxy()),
    proxyPath: await safe(() => clip.getProxyPath()),
    isMulticamClip: await safe(() => clip.isMulticamClip()),
    isMergedClip: await safe(() => clip.isMergedClip()),
    isSequence: await safe(() => clip.isSequence()),
    canChangeMediaPath: await safe(() => clip.canChangeMediaPath()),
    durationTicks: ticks && ticks.ticks !== undefined ? String(ticks.ticks) : await safe(() => clip.duration),
    frameSize: await safe(() => clip.getFrameSize && clip.getFrameSize()),
    width: await safe(() => clip.width),
    height: await safe(() => clip.height),
    frameRate: await safe(() => clip.getFrameRate && clip.getFrameRate()),
  };
}

module.exports = {
  "media.getInfo": async ({ projectItemId }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      return {
        projectItemId,
        id: await item.getId(),
        ...(await clipInfo(clip)),
      };
    } catch (err) {
      throw apiError("media.getInfo", err);
    }
  },

  "media.attachProxy": async ({ projectItemId, proxyPath, isHiRes, teamProjectsAlternateLink }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      // Signature: attachProxy(mediaPath, isHiRes, inMakeAlternateLinkInTeamProjects)
      const ok = await clip.attachProxy(proxyPath, !!isHiRes, !!teamProjectsAlternateLink);
      return { attached: !!ok, proxyPath, isHiRes: !!isHiRes };
    } catch (err) {
      throw apiError("media.attachProxy", err);
    }
  },

  "media.setOffline": async ({ projectItemId }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      const action = clip.createSetOfflineAction();
      if (!action) throw new Error("createSetOfflineAction returned null/undefined.");
      await runTransaction(project, "PPMCP media_set_offline", (c) => c.addAction(action));
      return { offline: true };
    } catch (err) {
      throw apiError("media.setOffline", err);
    }
  },

  "media.relink": async ({ projectItemId, newPath, overrideCompatibilityCheck }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      const ok = await clip.changeMediaFilePath(newPath, !!overrideCompatibilityCheck);
      return { relinked: !!ok, newPath };
    } catch (err) {
      throw apiError("media.relink", err);
    }
  },

  "media.refresh": async ({ projectItemId }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      const ok = await clip.refreshMedia();
      return { refreshed: !!ok };
    } catch (err) {
      throw apiError("media.refresh", err);
    }
  },

  "media.rename": async ({ projectItemId, name }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      const action = clip.createSetNameAction(name);
      if (!action) throw new Error("createSetNameAction returned null/undefined.");
      await runTransaction(project, "PPMCP media_rename", (c) => c.addAction(action));
      return { renamed: true, name };
    } catch (err) {
      throw apiError("media.rename", err);
    }
  },

  "media.findByPath": async ({ matchString, ignoreSubclips }) => {
    const project = await getActiveProject();
    try {
      // Documented on ClipProjectItem; try static first, then instance on root.
      let items;
      if (typeof ppro.ClipProjectItem.findItemsMatchingMediaPath === "function") {
        items = await ppro.ClipProjectItem.findItemsMatchingMediaPath(matchString, !!ignoreSubclips);
      } else {
        const root = await project.getRootItem();
        const clipRoot = await asClipProjectItem(root).catch(() => null);
        if (clipRoot && typeof clipRoot.findItemsMatchingMediaPath === "function") {
          items = await clipRoot.findItemsMatchingMediaPath(matchString, !!ignoreSubclips);
        } else {
          // Fallback: walk the project tree and filter by getMediaFilePath.
          items = await walkMatchingMedia(project, matchString);
        }
      }
      const result = [];
      for (const it of items || []) {
        let id;
        try {
          id = await it.getId();
        } catch {
          id = undefined;
        }
        let path;
        try {
          const c = await asClipProjectItem(it);
          path = await c.getMediaFilePath();
        } catch {
          path = undefined;
        }
        result.push({ projectItemId: id, name: it.name, mediaFilePath: path });
      }
      return result;
    } catch (err) {
      throw apiError("media.findByPath", err);
    }
  },

  /** Category K minimal surface — only isMulticamClip is confirmed. */
  "multicam.check": async ({ projectItemId }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const clip = await asClipProjectItem(item);
      const isMulticamClip = await clip.isMulticamClip();
      const isMergedClip = await clip.isMergedClip().catch(() => undefined);
      return {
        projectItemId,
        isMulticamClip: !!isMulticamClip,
        isMergedClip: isMergedClip === undefined ? undefined : !!isMergedClip,
        note:
          "UXP exposes only isMulticamClip/isMergedClip — no create, sync, switch-angle, or flatten methods exist in the official type declarations.",
      };
    } catch (err) {
      throw apiError("multicam.check", err);
    }
  },
};

async function walkMatchingMedia(project, matchString) {
  const q = String(matchString).toLowerCase();
  const matches = [];
  async function walk(bin) {
    const children = await bin.getItems();
    for (const child of children) {
      if (typeof child.getItems === "function") {
        await walk(child).catch(() => undefined);
        continue;
      }
      try {
        const clip = await asClipProjectItem(child);
        const path = await clip.getMediaFilePath();
        if (path && path.toLowerCase().includes(q)) matches.push(child);
      } catch {
        /* not a clip project item */
      }
    }
  }
  await walk(await project.getRootItem());
  return matches;
}

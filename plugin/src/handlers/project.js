const { ppro, apiError, getActiveProject, findProjectItemById, runTransaction } = require("../ppro.js");

async function projectSummary(project) {
  const sequences = await project.getSequences();
  return {
    name: project.name,
    path: project.path,
    sequenceCount: sequences.length,
  };
}

function asFolderItem(item) {
  if (ppro.FolderItem && typeof ppro.FolderItem.cast === "function") {
    try {
      return ppro.FolderItem.cast(item);
    } catch {
      return item;
    }
  }
  return item;
}

async function resolveOrCreateBin(project, binPath, createIfMissing = true) {
  let current = await project.getRootItem();
  for (const segment of binPath) {
    const children = await current.getItems();
    let next = children.find((c) => c.name === segment);
    if (!next) {
      if (!createIfMissing) {
        const e = new Error(`Bin path segment "${segment}" not found.`);
        e.code = "NOT_FOUND";
        throw e;
      }
      next = await project.createBin(segment, current);
    }
    current = next;
  }
  return current;
}

async function listItems(bin, recursive) {
  const children = await bin.getItems();
  const result = [];
  for (const child of children) {
    const isBin = typeof child.getItems === "function";
    const entry = {
      name: child.name,
      id: await child.getId(),
      isBin: !!isBin,
    };
    if (isBin && recursive) {
      entry.children = await listItems(child, true);
    }
    result.push(entry);
  }
  return result;
}

async function walkItems(bin, path = [], visit) {
  const children = await bin.getItems();
  for (const child of children) {
    const isBin = typeof child.getItems === "function";
    await visit(child, path, isBin);
    if (isBin) {
      await walkItems(child, [...path, child.name], visit);
    }
  }
}

module.exports = {
  "project.getActive": async () => {
    const project = await getActiveProject();
    return projectSummary(project);
  },

  "project.create": async ({ path }) => {
    try {
      const project = await ppro.Project.createProject(path);
      return projectSummary(project);
    } catch (err) {
      throw apiError("project.create", err);
    }
  },

  "project.open": async ({ path }) => {
    try {
      const project = await ppro.Project.open(path);
      return projectSummary(project);
    } catch (err) {
      throw apiError("project.open", err);
    }
  },

  "project.close": async ({ save }) => {
    const project = await getActiveProject();
    try {
      // closeProjectOptions shape is loosely typed — pass what we can.
      const options = save === false ? { promptIfDirty: false } : undefined;
      const ok = options !== undefined ? await project.close(options) : await project.close();
      return { closed: !!ok };
    } catch (err) {
      throw apiError("project.close", err);
    }
  },

  "project.save": async () => {
    const project = await getActiveProject();
    try {
      await project.save();
      return { saved: true };
    } catch (err) {
      throw apiError("project.save", err);
    }
  },

  "project.saveAs": async ({ path }) => {
    const project = await getActiveProject();
    try {
      await project.saveAs(path);
      return { saved: true, path };
    } catch (err) {
      throw apiError("project.saveAs", err);
    }
  },

  "project.importMedia": async ({ paths, binPath }) => {
    const project = await getActiveProject();
    const targetBin =
      binPath && binPath.length ? await resolveOrCreateBin(project, binPath) : await project.getRootItem();
    try {
      const ok = await project.importFiles(paths, true, targetBin, false);
      return { imported: ok, count: paths.length };
    } catch (err) {
      throw apiError("project.importMedia", err);
    }
  },

  "project.createBin": async ({ name, parentBinPath }) => {
    const project = await getActiveProject();
    const parent =
      parentBinPath && parentBinPath.length
        ? await resolveOrCreateBin(project, parentBinPath)
        : await project.getRootItem();
    try {
      const bin = await project.createBin(name, parent);
      return { name: bin.name, id: await bin.getId() };
    } catch (err) {
      throw apiError("project.createBin", err);
    }
  },

  "project.listItems": async ({ binPath, recursive }) => {
    const project = await getActiveProject();
    const root =
      binPath && binPath.length
        ? await resolveOrCreateBin(project, binPath, false)
        : await project.getRootItem();
    return listItems(root, !!recursive);
  },

  "project.moveItem": async ({ projectItemId, destBinPath }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    const dest =
      destBinPath && destBinPath.length
        ? await resolveOrCreateBin(project, destBinPath)
        : await project.getRootItem();
    try {
      const folder = asFolderItem(dest);
      if (typeof folder.createMoveItemAction !== "function") {
        throw new Error("FolderItem.createMoveItemAction not available.");
      }
      const action = folder.createMoveItemAction(item, folder);
      await runTransaction(project, "PPMCP project_move_item", (c) => c.addAction(action));
      return { moved: true, projectItemId, destBinPath: destBinPath || [] };
    } catch (err) {
      throw apiError("project.moveItem", err);
    }
  },

  "project.deleteItem": async ({ projectItemId }) => {
    const project = await getActiveProject();
    const item = await findProjectItemById(project, projectItemId);
    try {
      const root = asFolderItem(await project.getRootItem());
      // Prefer remove from parent — root createRemoveItemAction often works for direct children;
      // for nested items walk to find parent.
      let parent = root;
      let foundParent = null;
      await walkItems(await project.getRootItem(), [], async (child, path, isBin) => {
        if (isBin) {
          const kids = await child.getItems();
          for (const k of kids) {
            if ((await k.getId()) === projectItemId) foundParent = child;
          }
        }
      });
      // Also check root-level children
      const rootKids = await (await project.getRootItem()).getItems();
      for (const k of rootKids) {
        if ((await k.getId()) === projectItemId) foundParent = await project.getRootItem();
      }
      parent = asFolderItem(foundParent || (await project.getRootItem()));
      if (typeof parent.createRemoveItemAction !== "function") {
        throw new Error("FolderItem.createRemoveItemAction not available.");
      }
      const action = parent.createRemoveItemAction(item);
      await runTransaction(project, "PPMCP project_delete_item", (c) => c.addAction(action));
      return { deleted: true, projectItemId };
    } catch (err) {
      throw apiError("project.deleteItem", err);
    }
  },

  "project.searchItems": async ({ query, recursive }) => {
    const project = await getActiveProject();
    const q = String(query || "").toLowerCase();
    const matches = [];
    await walkItems(await project.getRootItem(), [], async (child, path, isBin) => {
      if (child.name && child.name.toLowerCase().includes(q)) {
        matches.push({
          name: child.name,
          id: await child.getId(),
          isBin: !!isBin,
          path,
        });
      }
    });
    if (recursive === false) {
      return matches.filter((m) => m.path.length === 0);
    }
    return matches;
  },

  "project.findOffline": async () => {
    const project = await getActiveProject();
    const offline = [];
    await walkItems(await project.getRootItem(), [], async (child, path, isBin) => {
      if (isBin) return;
      try {
        if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") return;
        const clip = ppro.ClipProjectItem.cast(child);
        const isOff = await clip.isOffline();
        if (isOff) {
          offline.push({
            name: child.name,
            id: await child.getId(),
            path,
            mediaFilePath: await clip.getMediaFilePath().catch(() => undefined),
          });
        }
      } catch {
        /* not a clip */
      }
    });
    return offline;
  },
};

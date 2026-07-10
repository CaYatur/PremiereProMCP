import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

export const projectTools = [
  defineTool({
    name: "project_get_active",
    title: "Get active project",
    description: "Get the name, file path, and sequence count of the project currently open in Premiere Pro.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("project.getActive", {});
      return { text: `Active project: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "project_get_info",
    title: "Get project info",
    description: "Alias of project_get_active — name, path, sequence count.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("project.getActive", {});
      return { text: `Project info: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "project_create",
    title: "Create a new project",
    description: "Create a new Premiere Pro project file at the given absolute .prproj path (Project.createProject).",
    inputSchema: { path: z.string().describe("Absolute path ending in .prproj") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.create", p);
      return { text: `Created project at ${p.path}.`, data };
    },
  }),

  defineTool({
    name: "project_open",
    title: "Open project",
    description: "Open an existing Premiere Pro project (.prproj) file by absolute path.",
    inputSchema: { path: z.string().describe("Absolute path to a .prproj file") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.open", p);
      return { text: `Opened project at ${p.path}`, data };
    },
  }),

  defineTool({
    name: "project_close",
    title: "Close project",
    description: "Close the currently active project.",
    inputSchema: { save: z.boolean().optional().describe("If false, try to close without save prompt.") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.close", p);
      return { text: "Project closed.", data };
    },
  }),

  defineTool({
    name: "project_save",
    title: "Save project",
    description: "Save the currently active project in place.",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("project.save", {});
      return { text: "Project saved.", data };
    },
  }),

  defineTool({
    name: "project_save_as",
    title: "Save project as",
    description: "Save the currently active project to a new .prproj path.",
    inputSchema: { path: z.string().describe("Absolute destination path, must end in .prproj") },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.saveAs", p);
      return { text: `Project saved to ${p.path}`, data };
    },
  }),

  defineTool({
    name: "project_import_media",
    title: "Import media files",
    description:
      "Import one or more media files into the active project's bin structure. Returns success; use project_list_items to get projectItemIds.",
    inputSchema: {
      paths: z.array(z.string()).min(1).describe("Absolute file paths to import"),
      binPath: z.array(z.string()).optional().describe('Bin path from root, e.g. ["Footage"]. Created if missing.'),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.importMedia", p);
      return { text: `Imported ${p.paths.length} file(s).`, data };
    },
  }),

  defineTool({
    name: "project_create_bin",
    title: "Create a bin (folder)",
    description: "Create a new organizational bin inside the project panel.",
    inputSchema: {
      name: z.string(),
      parentBinPath: z.array(z.string()).optional().describe("Path of the parent bin from project root; omit for root."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.createBin", p);
      return { text: `Created bin "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "project_list_items",
    title: "List project items",
    description: "List media items and sub-bins inside a bin (or root), including projectItemId, name, isBin.",
    inputSchema: {
      binPath: z.array(z.string()).optional(),
      recursive: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.listItems", p);
      return { text: `Project items: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "project_move_item_to_bin",
    title: "Move project item to bin",
    description: "Move a project item into a destination bin (FolderItem.createMoveItemAction).",
    inputSchema: {
      projectItemId: z.string(),
      destBinPath: z.array(z.string()).optional().describe("Destination bin path from root; omit for root."),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.moveItem", p);
      return { text: `Moved item ${p.projectItemId}.`, data };
    },
  }),

  defineTool({
    name: "project_delete_item",
    title: "Delete project item",
    description: "Remove a project item from its parent bin (FolderItem.createRemoveItemAction).",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.deleteItem", p);
      return { text: `Deleted project item ${p.projectItemId}.`, data };
    },
  }),

  defineTool({
    name: "project_rename_item",
    title: "Rename project item",
    description: "Rename a media/bin item in the project panel (ClipProjectItem.createSetNameAction).",
    inputSchema: { projectItemId: z.string(), name: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.rename", p);
      return { text: `Renamed to "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "project_search_items",
    title: "Search project items by name",
    description: "Find project items whose name contains the query (case-insensitive tree walk).",
    inputSchema: {
      query: z.string(),
      recursive: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("project.searchItems", p);
      return { text: `Search results: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "project_find_offline_media",
    title: "Find offline media",
    description: "List project items whose media is offline (ClipProjectItem.isOffline).",
    inputSchema: {},
    handler: async (_p, ctx) => {
      const data = await ctx.relay.call("project.findOffline", {});
      return { text: `Offline media: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "project_relink_media",
    title: "Relink media",
    description: "Relink a project item to a new file path (ClipProjectItem.changeMediaFilePath).",
    inputSchema: {
      projectItemId: z.string(),
      newPath: z.string(),
      overrideCompatibilityCheck: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.relink", p);
      return { text: `Relinked to ${p.newPath}.`, data };
    },
  }),
];

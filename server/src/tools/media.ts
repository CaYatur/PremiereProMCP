import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

// Category L (proxy/media) + K (multicam check only).
// Backed by ClipProjectItem methods confirmed in Adobe's UXP reference.
// Intentionally omitted (no real UXP primitive): proxy_create (transcode),
// proxy_toggle_playback_resolution, multicam create/sync/switch/flatten.

export const mediaTools = [
  defineTool({
    name: "media_get_info",
    title: "Get media / project-item info",
    description:
      "Read file path, offline state, proxy status, multicam/merged/sequence flags for a project item (by projectItemId from project_list_items).",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.getInfo", p);
      return { text: `Media info: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "proxy_attach",
    title: "Attach proxy to media",
    description:
      "Attach an existing proxy (or hi-res) file to a project item. Does not create/transcode a proxy — only links a file already on disk. Uses ClipProjectItem.attachProxy.",
    inputSchema: {
      projectItemId: z.string(),
      proxyPath: z.string().describe("Absolute path to the proxy (or hi-res) media file."),
      isHiRes: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, treat the path as high-resolution footage instead of a proxy."),
      teamProjectsAlternateLink: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.attachProxy", p);
      return { text: `Attached ${p.isHiRes ? "hi-res" : "proxy"} at ${p.proxyPath}.`, data };
    },
  }),

  defineTool({
    name: "media_go_offline",
    title: "Set media offline",
    description: "Mark a project item's media as offline (ClipProjectItem.createSetOfflineAction).",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.setOffline", p);
      return { text: "Media set offline.", data };
    },
  }),

  defineTool({
    name: "media_relink",
    title: "Relink media to a new path",
    description:
      "Change the media file path for a project item (bring offline media online, or re-point to a moved file). Uses ClipProjectItem.changeMediaFilePath.",
    inputSchema: {
      projectItemId: z.string(),
      newPath: z.string().describe("Absolute path to the replacement media file."),
      overrideCompatibilityCheck: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.relink", p);
      return { text: `Relinked to ${p.newPath}.`, data };
    },
  }),

  defineTool({
    name: "media_refresh",
    title: "Refresh media representation",
    description: "Refresh Premiere's representation of a project item's media file (ClipProjectItem.refreshMedia).",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.refresh", p);
      return { text: "Media refreshed.", data };
    },
  }),

  defineTool({
    name: "media_rename",
    title: "Rename a project item",
    description: "Rename a media item in the project panel (ClipProjectItem.createSetNameAction).",
    inputSchema: { projectItemId: z.string(), name: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.rename", p);
      return { text: `Renamed to "${p.name}".`, data };
    },
  }),

  defineTool({
    name: "media_find_by_path",
    title: "Find project items by media path",
    description:
      "Find project items whose media file path contains the given substring (ClipProjectItem.findItemsMatchingMediaPath, with a tree-walk fallback).",
    inputSchema: {
      matchString: z.string().describe("Substring to match against media file paths."),
      ignoreSubclips: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.findByPath", p);
      return { text: `Matches: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "multicam_check",
    title: "Check if a project item is multicam",
    description:
      "Return whether a project item is a multicam (or merged) clip. UXP only exposes isMulticamClip/isMergedClip — create/sync/switch/flatten are not available and are not fabricated here.",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("multicam.check", p);
      return { text: `Multicam check: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "media_go_online",
    title: "Bring media online (relink)",
    description: "Alias of media_relink — point offline media at a file path that exists.",
    inputSchema: {
      projectItemId: z.string(),
      newPath: z.string(),
      overrideCompatibilityCheck: z.boolean().optional().default(false),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.relink", p);
      return { text: `Media online at ${p.newPath}.`, data };
    },
  }),

  defineTool({
    name: "media_analyze_file_info",
    title: "Analyze media file info",
    description: "Alias of media_get_info — path, offline, proxy, multicam flags for a project item.",
    inputSchema: { projectItemId: z.string() },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.getInfo", p);
      return { text: `Media info: ${JSON.stringify(data)}`, data };
    },
  }),

  defineTool({
    name: "media_browser_search",
    title: "Search media by path/name",
    description: "Find project items by media path substring (media_find_by_path).",
    inputSchema: {
      matchString: z.string(),
      ignoreSubclips: z.boolean().optional().default(true),
    },
    handler: async (p, ctx) => {
      const data = await ctx.relay.call("media.findByPath", p);
      return { text: `Matches: ${JSON.stringify(data)}`, data };
    },
  }),
];

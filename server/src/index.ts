#!/usr/bin/env node
// PPMCP MCP server entry point. Launched per-session over stdio by the MCP
// client (Claude Desktop/Code/etc). Connects out to the bridge/relay as a
// WS client — never hosts anything itself. See docs/ARCHITECTURE.md §2.3.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RelayClient } from "./relayClient.js";
import { formatRelayError, ToolContext } from "./toolDefinition.js";
import { allTools } from "./tools/index.js";
import { createMetaTools, SurfaceControl } from "./tools/meta.js";
import { inProfile, META_TOOL_NAMES, parseProfile, ProfileName } from "./toolProfiles.js";
import { checkToolRateLimit, markToolComplete, RateLimitError } from "./rateLimit.js";

const relay = new RelayClient();
relay.connect();

const server = new McpServer({
  name: "premiere-pro-mcp",
  version: "1.1.0",
});

const ctx: ToolContext = { relay };

// Registering all ~277 schemas costs the client thousands of tokens per
// session and measurably hurts tool selection, so a session starts on a
// profile. But every tool is *registered* with the SDK up front and the ones
// outside the profile are merely disabled — that is what lets `tool_profile`
// switch them on later, at which point the SDK emits
// `notifications/tools/list_changed` and the client picks them up. The model
// can widen its own surface; PPMCP_PROFILE only sets the starting point.
// See server/src/toolProfiles.ts.
const startingProfile = parseProfile(process.env.PPMCP_PROFILE);
let activeProfile: ProfileName = startingProfile;

// Tools kept enabled no matter what — without these the model cannot find its
// way back to the rest of the catalog.
const alwaysOn = new Set<string>(META_TOOL_NAMES);

/** Names enabled beyond the active profile, via tool_profile's category/enable. */
const pinned = new Set<string>();

const shouldBeEnabled = (name: string): boolean =>
  alwaysOn.has(name) || pinned.has(name) || inProfile(name, activeProfile);

const handles = new Map<string, { enabled: boolean }>();

const surface: SurfaceControl = {
  startingProfile,
  current: () => activeProfile,
  registered: () => {
    const out = new Set<string>();
    for (const [name, handle] of handles) if (handle.enabled) out.add(name);
    return out;
  },
  apply(profile, extra, resetExtras) {
    activeProfile = profile;
    if (resetExtras) pinned.clear();
    for (const name of extra ?? []) pinned.add(name);
    let count = 0;
    for (const [name, handle] of handles) {
      // Written directly rather than via enable()/disable(), which would emit
      // one tools/list_changed per tool — up to 277 notifications for a single
      // switch. `enabled` is part of the SDK's public RegisteredTool type.
      handle.enabled = shouldBeEnabled(name);
      if (handle.enabled) count += 1;
    }
    server.sendToolListChanged();
    return count;
  },
};

const metaTools = createMetaTools(allTools, surface);

for (const tool of [...metaTools, ...allTools]) {
  const handle = server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args: Record<string, unknown>) => {
      try {
        // Hard rate limit: too-fast tools return INVALID / RATE_LIMITED (no Premiere hit)
        checkToolRateLimit(tool.name);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic
        // dispatch over a heterogeneous tool list; each tool's own defineTool()
        // call already checked handler/inputSchema consistency.
        const outcome = await tool.handler(args as any, ctx);
        markToolComplete(tool.name);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [{ type: "text", text: outcome.text }];
        if (outcome.data !== undefined) {
          content.push({ type: "text", text: `\`\`\`json\n${JSON.stringify(outcome.data, null, 2)}\n\`\`\`` });
        }
        // Multimodal clients (Claude) can "see" these stills and decide next edits.
        for (const img of outcome.images ?? []) {
          content.push({ type: "image", data: img.data, mimeType: img.mimeType });
        }
        return { content, isError: false as const };
      } catch (err) {
        markToolComplete(tool.name);
        if (err instanceof RateLimitError) {
          return {
            content: [
              { type: "text" as const, text: `Error: [RATE_LIMITED] ${err.message}` },
              {
                type: "text" as const,
                text: `\`\`\`json\n${JSON.stringify(
                  {
                    ok: false,
                    invalid: true,
                    code: "RATE_LIMITED",
                    retryAfterMs: err.retryAfterMs,
                    detail: err.detail,
                    recovery:
                      "INVALID while rate-limited. Wait retryAfterMs. Prefer edit_run (batched ops). Do not hammer tools — Premiere will crash.",
                  },
                  null,
                  2,
                )}\n\`\`\``,
              },
            ],
            isError: true as const,
          };
        }
        const content: Array<{ type: "text"; text: string }> = [
          { type: "text", text: `Error: ${formatRelayError(err)}` },
        ];
        return { content, isError: true as const };
      }
    },
  );
  handles.set(tool.name, handle);
}

// Disable everything outside the starting profile *before* connecting, so the
// SDK's isConnected() guard swallows the per-tool notifications and the client
// only ever sees the final list.
let initialCount = 0;
for (const [name, handle] of handles) {
  handle.enabled = shouldBeEnabled(name);
  if (handle.enabled) initialCount += 1;
}

const transport = new StdioServerTransport();
await server.connect(transport);

const total = allTools.length + metaTools.length;
console.error(
  `[ppmcp-server] MCP server running over stdio. Profile "${startingProfile}": ` +
    `${initialCount} of ${total} tools registered. ` +
    `The model can widen this itself with tool_profile({ profile: "full" }); ` +
    `unregistered tools stay callable via tool_invoke. ` +
    `Set PPMCP_PROFILE=core|standard|full to change the starting point.`,
);

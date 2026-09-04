#!/usr/bin/env node
// PPMCP MCP server entry point. Launched per-session over stdio by the MCP
// client (Claude Desktop/Code/etc). Connects out to the bridge/relay as a
// WS client — never hosts anything itself. See docs/ARCHITECTURE.md §2.3.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RelayClient } from "./relayClient.js";
import { formatRelayError, ToolContext } from "./toolDefinition.js";
import { allTools } from "./tools/index.js";
import { createMetaTools } from "./tools/meta.js";
import { inProfile, parseProfile } from "./toolProfiles.js";
import { checkToolRateLimit, markToolComplete, RateLimitError } from "./rateLimit.js";

const relay = new RelayClient();
relay.connect();

const server = new McpServer({
  name: "premiere-pro-mcp",
  version: "1.1.0",
});

const ctx: ToolContext = { relay };

// Registering all ~277 schemas costs the client thousands of tokens per
// session and measurably hurts tool selection. Register a profile instead;
// everything else stays reachable via the tool_search/tool_schema/tool_invoke
// meta-tools. See server/src/toolProfiles.ts.
const profile = parseProfile(process.env.PPMCP_PROFILE);
const metaTools = createMetaTools(allTools, profile);
const registered = [...metaTools, ...allTools.filter((t) => inProfile(t.name, profile))];

for (const tool of registered) {
  server.registerTool(
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
}

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(
  `[ppmcp-server] MCP server running over stdio. Profile "${profile}": ` +
    `${registered.length} tools registered of ${allTools.length + metaTools.length} available ` +
    `(the rest via tool_search / tool_schema / tool_invoke). ` +
    `Set PPMCP_PROFILE=core|standard|full to change.`,
);

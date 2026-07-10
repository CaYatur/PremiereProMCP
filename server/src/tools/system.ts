import { z } from "zod";
import { defineTool } from "../toolDefinition.js";

export const systemTools = [
  defineTool({
    name: "app_get_connection_status",
    title: "Get Premiere connection status",
    description:
      "Check whether the Premiere Pro UXP plugin and the legacy MOGRT-text bridge are currently connected. Call this first if any other tool fails with PLUGIN_NOT_CONNECTED or LEGACY_BRIDGE_NOT_CONNECTED, or at the start of a session to confirm Premiere Pro is ready to be controlled.",
    inputSchema: {},
    handler: async (_params, ctx) => {
      const status = await ctx.relay.getStatus();
      const { rateLimitInfo } = await import("../rateLimit.js");
      const rl = rateLimitInfo();
      const lines = [
        `Premiere Pro plugin: ${status.pluginConnected ? "connected" : "NOT connected"}`,
        `Legacy MOGRT-text bridge: ${status.legacyBridgeConnected ? "connected" : "NOT connected"}`,
        `Rate limit: tools≥${rl.minToolMs}ms, max ${rl.maxToolsPerMin}/min (heavy ${rl.maxHeavyPerMin}/min). Last 60s: ${rl.toolsLast60s} tools / ${rl.heavyLast60s} heavy.`,
      ];
      if (status.pluginInfo) lines.push(`Plugin info: ${JSON.stringify(status.pluginInfo)}`);
      if (!status.pluginConnected) {
        lines.push("Premiere Pro must be running with the PPMCP UXP plugin loaded before editing tools will work.");
      }
      if (!status.legacyBridgeConnected) {
        lines.push(
          "Optional: for real editable MOGRT text, run legacy-bridge/install-dev.ps1, restart Premiere, open Window > PPMCP Text Bridge. Without it, text_write uses PNG fallback.",
        );
      } else {
        lines.push("Legacy text bridge is connected — text_write will prefer ExtendScript MOGRT text (AE templates).");
      }
      lines.push(
        "Too-fast tools return RATE_LIMITED (invalid). Wait retryAfterMs; prefer edit_run. Fast spam crashes Premiere.",
      );
      return { text: lines.join("\n"), data: { ...status, rateLimit: rl } };
    },
  }),
];

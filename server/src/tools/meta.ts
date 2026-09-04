// Meta-tools: reach the full catalog without paying for its schemas, and let
// the model widen its own tool surface when it decides it needs to.
//
// The server registers a profile (see server/src/toolProfiles.ts), not all
// ~277 tools. These four keep everything else within reach:
//
//   tool_search("fade")       → candidate names + one-line descriptions
//   tool_schema("clip_trim")  → that tool's parameters
//   tool_invoke("clip_trim", {...}) → run it, registered or not
//   tool_profile({ profile: "full" }) → register more tools for real
//
// tool_invoke is the always-works path: it dispatches through our own catalog,
// so it reaches disabled tools regardless of what the client believes.
// tool_profile is the better path when the model expects to use a category
// repeatedly — it makes the tools appear in the client's own tool list.
//
// Built as a factory so `index.ts` can pass the catalog in — importing
// `./index.js` from here would be a cycle.

import { z, ZodRawShape, ZodTypeAny } from "zod";
import { defineTool, ToolContext, ToolDef, ToolOutcome } from "../toolDefinition.js";
import { inProfile, ProfileName, PROFILE_ORDER } from "../toolProfiles.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous catalog
type AnyTool = ToolDef<any>;

/**
 * How index.ts lets the meta-tools change what is registered. Kept as an
 * interface so meta.ts never imports the MCP SDK.
 */
export interface SurfaceControl {
  /** Profile the session started with. */
  readonly startingProfile: ProfileName;
  /** Profile currently in force (may have been widened at runtime). */
  current(): ProfileName;
  /** Names currently registered with the MCP server (meta-tools included). */
  registered(): Set<string>;
  /**
   * Switch to `profile` and/or additionally enable `extra` tool names.
   * `resetExtras` drops previously pinned names — used when the caller names a
   * profile explicitly, so "go back to core" really shrinks.
   * Emits one `tools/list_changed`. Returns the new registered count.
   */
  apply(profile: ProfileName, extra?: string[], resetExtras?: boolean): number;
}

/** Compact, model-readable description of one zod field. */
function describeField(schema: ZodTypeAny): string {
  const parts: string[] = [];
  let node: ZodTypeAny = schema;
  let optional = false;
  let fallback: unknown;

  // Unwrap optional/default/nullable wrappers to reach the real type.
  for (let i = 0; i < 8; i += 1) {
    const def = (node as { _def?: { typeName?: string } })._def;
    const name = def?.typeName;
    if (name === "ZodOptional" || name === "ZodNullable") {
      optional = true;
      node = (node as unknown as { unwrap: () => ZodTypeAny }).unwrap();
    } else if (name === "ZodDefault") {
      optional = true;
      const d = (node as unknown as { _def: { defaultValue: () => unknown; innerType: ZodTypeAny } })._def;
      try {
        fallback = d.defaultValue();
      } catch {
        /* ignore */
      }
      node = d.innerType;
    } else {
      break;
    }
  }

  const def = (node as { _def?: Record<string, unknown> })._def ?? {};
  const typeName = String(def.typeName ?? "unknown").replace(/^Zod/, "").toLowerCase();

  if (typeName === "enum" && Array.isArray(def.values)) {
    parts.push(`enum(${(def.values as unknown[]).join("|")})`);
  } else if (typeName === "array") {
    parts.push("array");
  } else if (typeName === "object") {
    parts.push("object");
  } else {
    parts.push(typeName);
  }

  if (optional) parts.push("optional");
  if (fallback !== undefined) parts.push(`default=${JSON.stringify(fallback)}`);
  const desc = (node as { description?: string }).description ?? (schema as { description?: string }).description;
  if (desc) parts.push(`— ${desc}`);
  return parts.join(" ");
}

function describeShape(shape: ZodRawShape): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(shape)) {
    try {
      out[key] = describeField(value as ZodTypeAny);
    } catch {
      out[key] = "unknown";
    }
  }
  return out;
}

/** First sentence / clause of a description — enough to pick a candidate. */
function shortDescription(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 160) return oneLine;
  return `${oneLine.slice(0, 157)}...`;
}

function scoreMatch(tool: AnyTool, terms: string[]): number {
  const name = tool.name.toLowerCase();
  const haystack = `${name} ${tool.title} ${tool.description}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return 0; // every term must appear somewhere
    if (name.includes(term)) score += 3;
    if (name.startsWith(term)) score += 2;
    score += 1;
  }
  return score;
}

export function createMetaTools(catalog: AnyTool[], surface: SurfaceControl): AnyTool[] {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  const categories = Array.from(new Set(catalog.map((t) => t.name.split("_")[0] ?? ""))).sort();
  const isRegistered = (name: string) => surface.registered().has(name);

  return [
    defineTool({
      name: "tool_search",
      title: "Search the full tool catalog",
      description:
        `Find tools that are not currently registered. Returns name + one-line ` +
        `description for each match, and whether it is registered right now. ` +
        `Then either run it once with tool_invoke, or — if you expect to use that ` +
        `area repeatedly — register it properly with tool_profile. ` +
        `Search before assuming a capability is missing: the full catalog is ` +
        `${catalog.length} tools and only some are registered at any moment.`,
      inputSchema: {
        query: z.string().min(1).describe("Words to match against tool name, title and description, e.g. \"fade audio\"."),
        category: z
          .string()
          .optional()
          .describe(`Restrict to a name prefix, e.g. "clip", "color", "export". Known: ${categories.join(", ")}`),
        limit: z.number().int().min(1).max(50).default(15),
      },
      handler: async (p): Promise<ToolOutcome> => {
        const terms = p.query.toLowerCase().split(/\s+/).filter(Boolean);
        const pool = p.category ? catalog.filter((t) => t.name.startsWith(`${p.category}_`) || t.name === p.category) : catalog;
        const ranked = pool
          .map((t) => ({ tool: t, score: scoreMatch(t, terms) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
          .slice(0, p.limit);

        const matches = ranked.map((r) => ({
          name: r.tool.name,
          registered: isRegistered(r.tool.name),
          description: shortDescription(r.tool.description),
        }));

        if (!matches.length) {
          return {
            text: `No tool matches "${p.query}"${p.category ? ` in category "${p.category}"` : ""}. Try fewer words, or drop the category filter.`,
            data: { matches: [], categories },
          };
        }
        return {
          text: `${matches.length} tool(s) match "${p.query}". Use tool_schema(name) for parameters, then tool_invoke(name, args).`,
          data: { matches, catalogSize: catalog.length, profile: surface.current() },
        };
      },
    }),

    defineTool({
      name: "tool_schema",
      title: "Show a tool's parameters",
      description:
        "Return the full description and parameter list for one tool by exact name. Use after tool_search, before tool_invoke.",
      inputSchema: {
        name: z.string().min(1).describe("Exact tool name, e.g. \"clip_trim\"."),
      },
      handler: async (p): Promise<ToolOutcome> => {
        const tool = byName.get(p.name);
        if (!tool) {
          return {
            text: `No tool named "${p.name}". Use tool_search to find the right name.`,
            data: { found: false },
          };
        }
        return {
          text: `${tool.name} — ${tool.title}`,
          data: {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            registered: isRegistered(tool.name),
            parameters: describeShape(tool.inputSchema as ZodRawShape),
          },
        };
      },
    }),

    defineTool({
      name: "tool_invoke",
      title: "Call any catalog tool by name",
      description:
        "Run a tool that is not registered in the active profile. Arguments are validated against that tool's own schema, " +
        "and it goes through the same rate limiter as a direct call. Check tool_schema first — a wrong shape fails here " +
        "exactly as it would if the tool were registered.",
      inputSchema: {
        name: z.string().min(1).describe("Exact tool name from tool_search / tool_schema."),
        args: z.record(z.unknown()).default({}).describe("Arguments object for that tool."),
      },
      handler: async (p, ctx: ToolContext): Promise<ToolOutcome> => {
        const tool = byName.get(p.name);
        if (!tool) {
          return {
            text: `No tool named "${p.name}". Use tool_search to find the right name.`,
            data: { ok: false, code: "NOT_FOUND" },
          };
        }
        if (p.name.startsWith("tool_")) {
          return {
            text: "tool_invoke cannot call another meta-tool.",
            data: { ok: false, code: "INVALID" },
          };
        }
        const parsed = z.object(tool.inputSchema as ZodRawShape).safeParse(p.args ?? {});
        if (!parsed.success) {
          return {
            text: `Invalid arguments for ${p.name}. Call tool_schema("${p.name}") and fix the shape.`,
            data: {
              ok: false,
              code: "INVALID_ARGS",
              issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
            },
          };
        }
        // Delegate to the real handler — same relay, same rate limiter (the
        // caller already passed the limiter for `tool_invoke` itself).
        return tool.handler(parsed.data, ctx);
      },
    }),

    defineTool({
      name: "tool_profile",
      title: "Register more tools for yourself",
      description:
        `Change which tools are registered in this session — you may raise your own tool surface. ` +
        `The session starts on a profile ("${surface.startingProfile}") to keep the tool list small, but the full ` +
        `catalog of ${catalog.length} tools is loaded and one call away.\n` +
        `• profile:"full" — register everything (${catalog.length} tools). Do this if you are doing complex, ` +
        `varied work and want the whole catalog visible.\n` +
        `• category:"color" — register just one area (repeatable, additive).\n` +
        `• enable:["clip_trim"] — register specific tools by name.\n` +
        `• profile:"core" — shrink back down when you are done.\n` +
        `Call with no arguments to see the current state. ` +
        `Prefer tool_invoke for a one-off call; use this when you expect to use an area repeatedly. ` +
        `The tool list refreshes automatically in most clients — if yours does not show the new tools, ` +
        `they are still callable through tool_invoke.`,
      inputSchema: {
        profile: z
          .enum(["core", "standard", "full"])
          .optional()
          .describe("Switch the whole surface. \"full\" registers the entire catalog."),
        category: z
          .string()
          .optional()
          .describe(`Additionally register every tool with this name prefix. Known: ${categories.join(", ")}`),
        enable: z
          .array(z.string())
          .optional()
          .describe("Additionally register these exact tool names."),
      },
      handler: async (p): Promise<ToolOutcome> => {
        const before = surface.registered().size;
        const previous = surface.current();

        // No arguments: report, do not change anything.
        if (!p.profile && !p.category && !p.enable?.length) {
          return {
            text:
              `Profile "${previous}" — ${before} of ${catalog.length + META_COUNT} tools registered. ` +
              `Call tool_profile({ profile: "full" }) to register everything.`,
            data: {
              profile: previous,
              startingProfile: surface.startingProfile,
              registeredCount: before,
              catalogSize: catalog.length,
              available: PROFILE_ORDER,
              categories,
            },
          };
        }

        const extra: string[] = [];
        const unknown: string[] = [];

        if (p.category) {
          const prefix = `${p.category.replace(/_+$/, "")}_`;
          const hits = catalog.filter((t) => t.name.startsWith(prefix)).map((t) => t.name);
          if (!hits.length) unknown.push(`category:${p.category}`);
          extra.push(...hits);
        }
        for (const name of p.enable ?? []) {
          if (byName.has(name)) extra.push(name);
          else unknown.push(name);
        }

        // Naming a profile is a reset: "back to core" must actually shrink,
        // not keep whatever categories were pinned earlier in the session.
        const target = p.profile ?? previous;
        const count = surface.apply(target, extra, p.profile !== undefined);
        const added = count - before;

        const notes: string[] = [];
        if (unknown.length) notes.push(`Not found, ignored: ${unknown.join(", ")}. Use tool_search to get exact names.`);
        if (added > 0) notes.push("Your client should refresh its tool list shortly; tool_invoke works either way.");
        if (added < 0) notes.push("Tools were unregistered. They remain callable via tool_invoke.");

        return {
          text:
            `Profile "${target}"${target !== previous ? ` (was "${previous}")` : ""} — ` +
            `${count} tools registered${added === 0 ? " (no change)" : `, ${added > 0 ? "+" : ""}${added}`}. ` +
            notes.join(" "),
          data: {
            profile: target,
            previousProfile: previous,
            registeredCount: count,
            delta: added,
            catalogSize: catalog.length,
            unknown,
          },
        };
      },
    }),
  ];
}

/** tool_search, tool_schema, tool_invoke, tool_profile. */
const META_COUNT = 4;

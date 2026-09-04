// Meta-tools: reach the full catalog without paying for its schemas.
//
// The server registers a profile (see server/src/toolProfiles.ts), not all
// ~277 tools. These three keep everything else one call away:
//
//   tool_search("fade")  → candidate names + one-line descriptions
//   tool_schema("clip_trim") → that tool's parameters
//   tool_invoke("clip_trim", { ... }) → runs it
//
// Built as a factory so `index.ts` can pass the catalog in — importing
// `./index.js` from here would be a cycle.

import { z, ZodRawShape, ZodTypeAny } from "zod";
import { defineTool, ToolContext, ToolDef, ToolOutcome } from "../toolDefinition.js";
import { inProfile, ProfileName } from "../toolProfiles.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous catalog
type AnyTool = ToolDef<any>;

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

export function createMetaTools(catalog: AnyTool[], profile: ProfileName): AnyTool[] {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  const categories = Array.from(new Set(catalog.map((t) => t.name.split("_")[0] ?? ""))).sort();

  return [
    defineTool({
      name: "tool_search",
      title: "Search the full tool catalog",
      description:
        `Find tools that are not registered in the active profile (${profile}). ` +
        `Returns name + one-line description for each match. ` +
        `Follow with tool_schema to see parameters, then tool_invoke to run it. ` +
        `Search before assuming a capability is missing — the full catalog is ${catalog.length} tools.`,
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
          registered: inProfile(r.tool.name, profile),
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
          data: { matches, catalogSize: catalog.length, profile },
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
            registered: inProfile(tool.name, profile),
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
  ];
}

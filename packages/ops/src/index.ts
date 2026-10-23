// The primitive: an operation is a function. Everything else (an HTTP route, an MCP tool, a WebMCP tool,
// a CLI command, a skill file, a Ctrl-K entry, a test) is a thin view of it that decodes its input, calls
// `ops.call` and encodes the answer. None of them holds logic or decides who may do what.
//
// Auth happens at the edge (cookie, API key, OAuth) and yields a context. `call` still asks `can(ctx,
// needs)` before every run, because the check is cheap and "the route already did it" is how a new
// surface ships without it. Plain functions, no imports: safe in a Worker, the browser and the sim.

type Schema = { type: "object"; properties: Record<string, { type: string; description?: string; enum?: unknown[] }>; required?: string[] };

export interface Op<Ctx = unknown, In = any, Out = unknown> {
  /** snake_case, unique: the MCP tool name, the CLI command (kebab-cased) and the skill heading. */
  name: string;
  summary: string;
  input: Schema;
  /** The permission, in the app's own vocabulary (qCRM's `ACTIONS`). Omit for an open operation. */
  needs?: string;
  /** read changes nothing; write changes data; danger can't be undone or changes who gets in: a view asks a person first. */
  risk?: "read" | "write" | "danger";
  run(input: In, ctx: Ctx): Out | Promise<Out>;
}

export class OpError extends Error {
  constructor(readonly code: "unknown" | "forbidden" | "invalid", message: string) { super(message); }
}

export const defineOp = <Ctx, In, Out>(op: Op<Ctx, In, Out>) => op;

const typeOk = (v: unknown, t: string) => (t === "integer" ? Number.isInteger(v) : t === "array" ? Array.isArray(v) : t === "object" ? !!v && typeof v === "object" && !Array.isArray(v) : typeof v === t);

/** Minimal input check: required keys, known keys, primitive types, enums. A view that needs more (formats, ranges) says so in `run`. */
export function check(schema: Schema, input: unknown): string | null {
  if (!typeOk(input, "object")) return "input must be an object";
  const o = input as Record<string, unknown>;
  for (const k of schema.required ?? []) if (o[k] === undefined) return `${k} is required`;
  for (const [k, v] of Object.entries(o)) {
    const p = schema.properties[k];
    if (!p) return `unknown input ${k}`;
    if (!typeOk(v, p.type)) return `${k} must be a ${p.type}`;
    if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(", ")}`;
  }
  return null;
}

export function createOps<Ctx>(list: Op<Ctx>[], can: (ctx: Ctx, needs: string) => boolean) {
  const byName = new Map(list.map((o) => [o.name, o]));
  if (byName.size !== list.length) throw new Error("two operations share a name");
  const visible = (ctx: Ctx) => list.filter((o) => !o.needs || can(ctx, o.needs));

  return {
    /** What this caller may see: an operation they can't run is not listed. */
    list: (ctx: Ctx) => visible(ctx).map(({ name, summary, input, risk, needs }) => ({ name, summary, input, risk: risk ?? "read", needs })),

    /** The one way in. Every view goes through here. */
    async call(name: string, input: unknown, ctx: Ctx) {
      const op = byName.get(name);
      if (!op) throw new OpError("unknown", `no operation ${name}`);
      if (op.needs && !can(ctx, op.needs)) throw new OpError("forbidden", `${name} needs ${op.needs}`);
      const bad = check(op.input, input ?? {});
      if (bad) throw new OpError("invalid", `${name}: ${bad}`);
      return op.run((input ?? {}) as never, ctx);
    },

    /** MCP and WebMCP tool definitions (the two share a shape; WebMCP registers them with `execute`). */
    mcpTools: (ctx: Ctx) => visible(ctx).map((o) => ({
      name: o.name, description: o.summary, inputSchema: { ...o.input, additionalProperties: false },
      annotations: { readOnlyHint: (o.risk ?? "read") === "read", destructiveHint: o.risk === "danger", openWorldHint: false },
    })),

    /** `deals-create --title Acme --amount 5` or `deals-create --json '{"title":"Acme"}'` to [name, input]. */
    parseArgv(argv: string[]): [string, Record<string, unknown>] {
      const [cmd = "", ...rest] = argv;
      const name = cmd.replace(/-/g, "_"), op = byName.get(name);
      if (!op) throw new OpError("unknown", `no command ${cmd}`);
      const input: Record<string, unknown> = {};
      for (let i = 0; i < rest.length; i += 2) {
        const flag = rest[i]!.replace(/^--/, "").replace(/-/g, "_"), raw = rest[i + 1] ?? "";
        if (flag === "json") { Object.assign(input, JSON.parse(raw)); continue; }
        const t = op.input.properties[flag]?.type;
        input[flag] = t === "integer" || t === "number" ? Number(raw) : t === "boolean" ? raw === "true" : raw;
      }
      return [name, input];
    },

    /** A SKILL.md for the operations this caller can run, so an agent with a shell can use the CLI without the tools loaded. */
    skill(cli: string, ctx: Ctx, about: string) {
      const rows = visible(ctx).map((o) => {
        const flags = Object.entries(o.input.properties).map(([k, p]) => `--${k.replace(/_/g, "-")} <${p.type}>${o.input.required?.includes(k) ? "" : "?"}`).join(" ");
        return `- \`${cli} ${o.name.replace(/_/g, "-")} ${flags}\`: ${o.summary}${o.risk === "danger" ? " Ask the person first." : ""}`;
      });
      return `---\nname: ${cli}\ndescription: ${about}\n---\n\n${about}\n\n${rows.join("\n")}\n\n\`--json '{...}'\` passes the whole input. Output is JSON.\n`;
    },
  };
}

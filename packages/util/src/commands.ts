// A page's commands: plain functions tied to what the page does, kept in one list that three doors open onto.
//
//   - WebMCP: each one is a tool for an agent in the browser (document.modelContext; earlier Chrome builds put it
//     on navigator), registered when the browser has it, unregistered when the command goes away.
//   - window.__commands: list() and run(name, args) for anything driving the page without WebMCP (bun run probe,
//     a test, the console).
//   - The Cmd/Ctrl+K palette (palette.ts) for a person: the same list, searched by title.
//
// codeSplitter's palette is the model: "everything an agent can call, you can press", and both do the same thing
// the same way. A command is a WebMCP tool's shape (name, title, description, inputSchema, annotations, execute)
// plus a few things the palette reads (group, keys, ask), so a tools array an app already has goes straight in.
//
//   const off = addCommands([{ name: "tf_state", title: "Look at the battle", description: "...",
//     annotations: { readOnlyHint: true }, execute: () => state() }]);
//   off(); // gone from WebMCP, window.__commands and the palette
//
// Like codeSplitter's, what a page offers can depend on where it is: add a route's commands when it opens and call
// the returned off() when it closes. A command added under a name already taken replaces the older one.

/** A command's arguments, as a JSON Schema object: what WebMCP hands the agent. */
export interface InputSchema { type: "object" | (string & {}); properties: Record<string, object | undefined>; required?: readonly string[]; additionalProperties?: boolean }

/** WebMCP's hints: what calling it does. A risky command (destructiveHint) tells the agent to ask the person first. */
export interface Hints { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; untrustedContentHint?: boolean }

export interface Command {
  /** The tool's name: lowercase snake_case, an app prefix keeps it apart from other pages' (`tf_jump`). */
  name: string;
  /** What a person reads in the palette, and the tool's title. */
  title: string;
  /** What an agent reads: what it does, what it answers with. */
  description: string;
  /** Its arguments. None when left out. */
  inputSchema?: InputSchema;
  annotations?: Hints;
  /** The function. Its argument came from an agent or a person, so it is `unknown` until a guard looks at it. */
  execute(args: unknown): unknown;
  /** The palette's section ("Battle", "This file"). */
  group?: string;
  /** A shortcut the page already has for it, shown beside it ("R", "Shift+N"). The palette shows it; the page binds it. */
  keys?: string;
  /**
   * The palette asks for one line before running it, with this as the prompt, and passes it as the first property
   * of inputSchema (a number property gets a number). Without `ask`, the palette runs it with no arguments.
   */
  ask?: string;
  /** false: an agent's only, not in the palette (a snapshot, a raw read). */
  palette?: boolean;
  /** false: a person's only, not a WebMCP tool. */
  agent?: boolean;
}

const NONE: InputSchema = { type: "object", properties: {} };
const all = new Map<string, Command>();
const offs = new Map<string, AbortController>();
const watchers = new Set<() => void>();

interface ModelContext { registerTool(tool: object, opts: { signal: AbortSignal }): unknown; unregisterTool?(name: string): unknown }
const isMc = (v: unknown): v is ModelContext => typeof v === "object" && v !== null && typeof Reflect.get(v, "registerTool") === "function";
const g: object = globalThis;
/** The browser's agent, if it has one. */
export function modelContext(): ModelContext | null {
  const doc: unknown = Reflect.get(g, "document"), nav: unknown = Reflect.get(g, "navigator");
  const mc: unknown = (doc && Reflect.get(doc, "modelContext")) ?? (nav && Reflect.get(nav, "modelContext"));
  return isMc(mc) ? mc : null;
}

function register(c: Command) {
  const mc = modelContext();
  if (!mc || c.agent === false) return;
  const off = new AbortController();
  offs.set(c.name, off);
  const tool = { name: c.name, title: c.title, description: c.description, inputSchema: c.inputSchema ?? NONE, ...(c.annotations && { annotations: c.annotations }), execute: (a: unknown) => runCommand(c.name, a) };
  // Some builds answer with a handle to unregister, some take the signal, some only unregisterTool(name).
  void Promise.resolve().then(() => mc.registerTool(tool, { signal: off.signal })).then((h) => {
    off.signal.addEventListener("abort", () => { try { if (h && typeof Reflect.get(h, "unregister") === "function") Reflect.get(h, "unregister").call(h); else mc.unregisterTool?.(c.name); } catch { /* already gone */ } });
  }).catch(() => { /* a build that wants another tool shape: window.__commands and the palette still have it */ });
}

function drop(name: string) { offs.get(name)?.abort(); offs.delete(name); all.delete(name); }

/** Add commands; the answer takes these ones away again. */
export function addCommands(cmds: readonly Command[]): () => void {
  for (const c of cmds) { drop(c.name); all.set(c.name, c); register(c); }
  hang();
  watchers.forEach((w) => w());
  return () => { let gone = false; for (const c of cmds) if (all.get(c.name) === c) { drop(c.name); gone = true; } if (gone) watchers.forEach((w) => w()); };
}

/** Every command there is now, in the order added. */
export const listCommands = (): Command[] => [...all.values()];

/** Run a command by name, as an agent or the palette would. A command's answer is passed back; undefined becomes { ok: true }. */
export async function runCommand(name: string, args: unknown = {}): Promise<unknown> {
  const c = all.get(name);
  if (!c) throw new Error(`no command "${name}": ${[...all.keys()].join(", ") || "this page has none"}`);
  const out = await c.execute(args ?? {});
  return out === undefined ? { ok: true } : out;
}

/** Called when the list changes (the palette re-renders). The answer stops it. */
export function watchCommands(fn: () => void): () => void { watchers.add(fn); return () => { watchers.delete(fn); }; }

/** What window.__commands.list() answers with: enough for an agent to call each one. */
export const describeCommands = () => listCommands().map((c) => ({ name: c.name, title: c.title, description: c.description, ...(c.inputSchema && Object.keys(c.inputSchema.properties).length ? { input: c.inputSchema } : {}), ...(c.annotations?.readOnlyHint ? { readOnly: true } : {}), ...(c.annotations?.destructiveHint ? { risky: true } : {}) }));

function hang() {
  if (typeof window === "undefined" || Reflect.has(window, "__commands")) return;
  Reflect.set(window, "__commands", { list: describeCommands, run: runCommand });
}

/**
 * The commands that match what was typed, best first: title starting with it, then a word of the title starting with
 * it, then anywhere in the title, group or name, then its letters in order through the title (`lkb` finds "Look at the
 * battle"). Each word typed must match; an empty query is every command in its order.
 */
export function rankCommands<C extends Pick<Command, "name" | "title" | "group">>(cmds: readonly C[], query: string): C[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...cmds];
  const score = (c: C) => {
    const t = c.title.toLowerCase(), rest = `${c.group ?? ""} ${c.name}`.toLowerCase();
    let s = 0;
    for (const w of words) {
      const at = t.indexOf(w);
      if (at === 0) s += 4;
      else if (at > 0 && !/[a-z0-9]/.test(t[at - 1]!)) s += 3;
      else if (at > 0 || rest.includes(w)) s += 2;
      else if (inOrder(t, w)) s += 1;
      else return 0;
    }
    return s;
  };
  return cmds.map((c, i) => ({ c, i, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

const inOrder = (hay: string, w: string) => { let k = 0; for (const ch of hay) if (ch === w[k] && ++k === w.length) return true; return false; };

/** The palette's one line as a command's arguments: the first property of its inputSchema, a number when that property is one. */
export function askArgs(c: Pick<Command, "inputSchema">, line: string): Record<string, unknown> {
  const [key, prop] = Object.entries(c.inputSchema?.properties ?? {})[0] ?? [];
  if (!key) return {};
  const type = prop && Reflect.get(prop, "type");
  return { [key]: type === "number" || type === "integer" ? Number(line) : line };
}

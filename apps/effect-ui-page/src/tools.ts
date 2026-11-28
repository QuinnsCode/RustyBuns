// The world's tools as one list, for every door: WebMCP in the page (agent.ts), and HTTP and MCP in the relay
// (relay.ts), for an agent in a terminal (Claude Code, Codex, opencode). No DOM or Bun here: the Worker, the
// local dev server and the page all import it. The frames between the relay and the page are here too.
import { bool, obj, opt, raw, int, str, type Of } from "@rustybuns/util/guard";
import type { Hints, InputSchema } from "@rustybuns/util/commands";
import { Schema } from "effect";
import { EditFile, FILE_MAX, FILES_MAX, Path, Reset, SetBackdrop, WORLD_MAX, WriteFile } from "./page.ts";
import { LIBRARY_HOSTS } from "./world.ts";

export const Undo = Schema.TaggedStruct("Undo", {});
/** What a call asks the page for: an action on the page, or undo (which needs the page's history). */
export const Request = Schema.Union([WriteFile, EditFile, SetBackdrop, Reset, Undo]);
export type Request = typeof Request.Type;

type Tagged = typeof WriteFile | typeof EditFile | typeof SetBackdrop | typeof Reset | typeof Undo;
export interface Tool { name: string; title: string; description: string; schema: Tagged; hints?: Hints }

/** How a world is made, told once with the write tool: what the frame opens, how files load, what it may reach. */
const HOW = [
  "The frame opens index.html, which loads your other files by <script src> and <link rel=stylesheet>; modules import each other as \"./name.js\".",
  `Libraries: pinned versions from ${LIBRARY_HOSTS.map((h) => h.slice("https://".length)).join(", ")}.`,
  "A module may import \"@world/kit\" (three.js ready-made, plot 200x200 around 0; kit worlds stand in 3D among neighbours): world({orbit}) gives {scene}; ground({type:flat|dunes|hills|grass,color}), sky(day|night|dusk), weather(rain|snow|fog|clear), water({y,x,z,width,depth}), trees(n), cactus(n), rocks(n), lights(), lamp({x,y,z,color}), onPlayer(cb), every(f), heightAt(x,z), THREE.",
  "Sealed: no fetch, sockets, storage or forms; draw images and sounds in code or data: URLs.",
  `Limits: ${FILE_MAX / 1000}k characters a file, ${WORLD_MAX / 1000}k and ${FILES_MAX} files a world.`,
].join(" ");

export const TOOLS: readonly Tool[] = [
  { name: "page_write_file", title: "Write a file", schema: WriteFile, description: `Set a file to this whole text ("" removes it); the frame reloads. For a small change use page_edit_file. ${HOW}` },
  { name: "page_edit_file", title: "Edit a file", schema: EditFile, description: "Replace the one exact match of `find` in a file with `replace`." },
  { name: "page_set_backdrop", title: "Set the backdrop", schema: SetBackdrop, description: "Show a codeSplitter handle's profile page behind the world, where the world is clear. \"\" removes it." },
  { name: "page_undo", title: "Undo", schema: Undo, description: "Take back the last change." },
  { name: "page_reset", title: "Start over", schema: Reset, description: "Back to the starter city (undoable).", hints: { destructiveHint: true } },
];

export const READ = {
  name: "page_read", title: "Look at the world",
  description: "Files and sizes, the backdrop, and the frame's errors and blocked loads since it last loaded. Call after changes.",
  inputSchema: { type: "object", properties: {} } satisfies InputSchema,
  annotations: { readOnlyHint: true } satisfies Hints,
};

export const ReadFile = Schema.Struct({ path: Path });
export const READ_FILE = {
  name: "page_read_file", title: "Read a file",
  description: "One file's whole text.",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } satisfies InputSchema,
  annotations: { readOnlyHint: true } satisfies Hints,
};

/** A tool's arguments as JSON Schema, from the same Schema that checks them (without the `_tag`). */
export const inputSchema = (schema: Tagged): InputSchema => {
  const { _tag, ...fields } = schema.fields;
  const s: { properties?: unknown; required?: unknown } = Schema.toJsonSchemaDocument(Schema.Struct(fields)).schema;
  const objects = (v: unknown) => Object.entries(typeof v === "object" && v !== null ? v : {}).filter((e): e is [string, object] => typeof e[1] === "object" && e[1] !== null);
  const required = Array.isArray(s.required) ? s.required.filter((r) => typeof r === "string") : [];
  return { type: "object", properties: Object.fromEntries(objects(s.properties)), ...(required.length ? { required } : {}) };
};

/** Check a tool's arguments: the request it makes, or a thrown error that says what was wrong. */
export const decode = (tool: Tool, args: unknown): Request =>
  Schema.decodeUnknownSync(Request)({ ...(typeof args === "object" && args !== null ? args : {}), _tag: tool.schema.fields._tag.schema.literal });

/** Every tool as an agent is told of it: name, title, description, inputSchema and annotations. */
export const listTools = () => [READ, READ_FILE, ...TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t.schema), annotations: t.hints ?? {} }))];
export const toolNames = new Set(listTools().map((t) => t.name));

/** The relay to the page: run this tool with these arguments. */
export const ToPage = obj({ t: str(8, { re: /^call$/ }), id: int(1, Number.MAX_SAFE_INTEGER), name: str(64), args: raw });
export type ToPage = Of<typeof ToPage>;
/** The page to the relay: what came of call `id`. */
export const FromPage = obj({ t: str(8, { re: /^reply$/ }), id: int(1, Number.MAX_SAFE_INTEGER), ok: bool(), result: raw, error: opt(str(2000)) });
export type FromPage = Of<typeof FromPage>;

/** A room's id: what the page's address and the relay's routes carry. Lowercase letters and digits, hard to guess. */
export const ROOM = /^[a-z0-9]{10,32}$/;

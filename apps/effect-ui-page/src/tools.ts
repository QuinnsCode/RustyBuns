// The world's tools as one list, for every door: WebMCP in the page (agent.ts), and HTTP and MCP in the relay
// (relay.ts), for an agent in a terminal (Claude Code, Codex, opencode). No DOM or Bun here: the Worker, the
// local dev server and the page all import it. The frames between the relay and the page are here too.
import { bool, obj, opt, raw, int, str, type Of } from "@rustybuns/util/guard";
import type { Hints, InputSchema } from "@rustybuns/util/commands";
import { Schema } from "effect";
import { FILE_MAX, FILES_MAX, Path, Reset, SetBackdrop, WORLD_MAX, WriteFile } from "./page.ts";
import { LIBRARY_HOSTS } from "./world.ts";

export const Undo = Schema.TaggedStruct("Undo", {});
/** A few words on what the agent is doing, for the page to show: no file changes, nothing to undo. */
export const Status = Schema.TaggedStruct("Status", { text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)) });
/** What a call asks the page for: an action on the page, undo (which needs the page's history), or a status line. */
export const Request = Schema.Union([WriteFile, SetBackdrop, Reset, Undo, Status]);
export type Request = typeof Request.Type;

type Tagged = typeof WriteFile | typeof SetBackdrop | typeof Reset | typeof Undo | typeof Status;

/** What the agent does before a new world, told in the tools, the pasted prompt and the MCP instructions alike. */
export const ASK = "Before writing a new world, ask the person three things in your chat, one at a time: what the ground is, what is on it, what the weather is. Say page_status while you ask, then write it.";
export interface Tool { name: string; title: string; description: string; schema: Tagged; hints?: Hints }

/** How a world is made, told once with the write tool: what the frame opens, how files load, what it may reach. */
const HOW = [
  "The world is a few text files that run in a sealed frame filling the person's screen, like a codeSplitter page.",
  "index.html is what the frame opens. It loads your other files with <script src=\"world.js\"> (type=\"module\" too) and <link rel=\"stylesheet\" href=\"style.css\">; a module imports another of your files as \"./name.js\".",
  `Libraries load from ${LIBRARY_HOSTS.join(", ")} at a pinned version: import * as THREE from "https://esm.sh/three@0.170.0".`,
  "The frame is sealed: no fetch or sockets, no cookies or localStorage, no forms. Images, sounds and models are drawn in code or written as data: URLs.",
  `A file is ${FILE_MAX.toLocaleString("en")} characters at most, the world ${WORLD_MAX.toLocaleString("en")}, ${FILES_MAX} files.`,
  ASK,
].join(" ");

export const TOOLS: readonly Tool[] = [
  { name: "page_write_file", title: "Write a file", schema: WriteFile, description: `Set one file of the world to this whole text, and the frame reloads with it. "" takes the file away. ${HOW} Then call page_read: it says what went wrong in the frame, if anything.` },
  { name: "page_set_backdrop", title: "Set the backdrop", schema: SetBackdrop, description: "Put a codeSplitter profile page (that handle's public `page` repo) full screen behind the world, seen where the world leaves the background clear: \"quinn\" shows @quinn's. \"\" takes it away." },
  { name: "page_undo", title: "Undo", schema: Undo, description: "Take back the last change, the agent's or the person's." },
  { name: "page_reset", title: "Start over", schema: Reset, description: "Put the world back to the starter desert. page_undo puts it back.", hints: { destructiveHint: true } },
  { name: "page_status", title: "Say what you're doing", schema: Status, description: "Show the person a few words on what you are doing, like \"Asking about the weather\"." },
];

export const READ = {
  name: "page_read", title: "Look at the world",
  description: "The world as it stands: each file's path and size, the backdrop (a codeSplitter handle, when set), and what the frame said since it last loaded: errors with their file and line, and loads it blocked. Call it after each write. page_read_file gives a file's text.",
  inputSchema: { type: "object", properties: {} } satisfies InputSchema,
  annotations: { readOnlyHint: true } satisfies Hints,
};

export const ReadFile = Schema.Struct({ path: Path });
export const READ_FILE = {
  name: "page_read_file", title: "Read a file",
  description: "One file of the world, its whole text. page_read lists them.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "A path page_read listed, like index.html or world.js" } }, required: ["path"] } satisfies InputSchema,
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

// The world's tools as one list, for every door: WebMCP in the page (agent.ts), and HTTP and MCP in the relay
// (relay.ts), for an agent in a terminal (Claude Code, Codex, opencode). No DOM or Bun here: the Worker, the
// local dev server and the page all import it. The frames between the relay and the page are here too.
import { arr, bool, obj, opt, raw, int, str, type Of } from "@rustybuns/util/guard";
import type { Hints, InputSchema } from "@rustybuns/util/commands";
import { Schema, SchemaIssue } from "effect";
import { Build, EditFile, EditWorld, FILE_MAX, FILES_MAX, Path, plain, Reset, SetBackdrop, WORLD_MAX, WriteFile } from "./page.ts";
import { LIBRARY_HOSTS } from "./world.ts";

export const Undo = Schema.TaggedStruct("Undo", {});
/** A few words on what the agent is doing, for the page to show: no file changes, nothing to undo. */
export const Status = Schema.TaggedStruct("Status", {
  text: plain("a few words, 80 characters at most, like adding a pond", (says) => Schema.isMinLength(1, says), (says) => Schema.isMaxLength(80, says)),
});
/** What a call asks the page for: an action on the page, undo (which needs the page's history), or a status line. */
export const Request = Schema.Union([WriteFile, EditFile, SetBackdrop, Reset, Build, EditWorld, Undo, Status]);
export type Request = typeof Request.Type;

type Tagged = typeof WriteFile | typeof EditFile | typeof SetBackdrop | typeof Reset | typeof Build | typeof EditWorld | typeof Undo | typeof Status;

/** What the agent does before a new world, told in the tools, the pasted prompt and the MCP instructions alike. */
export const asking = (say: string) => `New world? Ask in chat first: the ground, what's on it, the weather; ${say} as you ask.`;
export const ASK = asking("page_status");
export interface Tool { name: string; title: string; description: string; schema: Tagged; hints?: Hints }

const PLOT = "three.js; plot 200x200 around 0, x east, z south";
/** `@world/kit`'s calls by name: every door's only copy of them. */
export const KIT_CALLS = "world({orbit}) gives {scene}; ground({type:flat|dunes|hills|grass}), sky(day|night|dusk), weather(rain|snow|fireflies|fog), mood({top,low,fog,bloom}), smoke(x,y,z), flyers(n), grass|flowers(n), water({y,x,z,width,depth}), trees|cactus|rocks(n,{area}), lamp({x,y,z,color}), building({x,z,w,d,h,color,roof:peak|flat}), box({x,z,w,h,d,color}); voxels(layers,palette,{x,z,size}) and sprite(rows,palette,{x,z,size}) draw text rows, a letter a cube or pixel ([rows,rows] animates); streets() gives 4 blocks {x,z,w,d}; path([[x,z]...]), sign(text,{x,z}), creature({sprite|voxels,palette,area,flee,follow}), near(x,z,r,onEnter,onLeave), block(x,z,w,d), glow:2 on box|voxels|sign lights it, onPlayer(cb), every(f), heightAt(x,z), THREE.";
/** What a world is, for the doors that say nothing else: where it runs and what it imports. */
export const ABOUT = `module in a sealed frame (no fetch or storage). import from "@world/kit" (${PLOT}): ${KIT_CALLS}`;
export const LIBRARIES = `Libraries: pinned versions from ${LIBRARY_HOSTS.map((h) => h.slice("https://".length)).join(", ")}.`;

/** How a world is made, told once with the write tool: what the frame opens, how files load, what it may reach. */
const HOW = [
  "The frame opens index.html, which loads your other files by <script src> and <link rel=stylesheet>; modules import each other as \"./name.js\".",
  LIBRARIES,
  `A module may import "@world/kit" (${PLOT}; kit worlds stand in 3D among neighbours): ${KIT_CALLS}`,
  "Sealed: no fetch, sockets, storage or forms; draw images and sounds in code or data: URLs.",
  ASK,
  `Limits: ${FILE_MAX / 1000}k characters a file, ${WORLD_MAX / 1000}k and ${FILES_MAX} files a world.`,
].join(" ");

export const TOOLS: readonly Tool[] = [
  { name: "page_write_file", title: "Write a file", schema: WriteFile, description: `Set a file to this whole text ("" removes it); the frame reloads. For a small change use page_edit_file. ${HOW}` },
  { name: "page_edit_file", title: "Edit a file", schema: EditFile, description: "Replace the one exact match of `find` in a file with `replace`." },
  { name: "page_set_backdrop", title: "Set the backdrop", schema: SetBackdrop, description: "Show a codeSplitter handle's profile page behind the world, where the world is clear. \"\" removes it." },
  { name: "page_undo", title: "Undo", schema: Undo, description: "Take back the last change." },
  { name: "page_reset", title: "Start over", schema: Reset, description: "Back to the starter desert (undoable).", hints: { destructiveHint: true } },
  { name: "page_status", title: "Say what you're doing", schema: Status, description: "Tell the person what you're doing." },
];

export const READ = {
  name: "page_read", title: "Look at the world",
  description: "Files and sizes, the backdrop, and the frame's errors and blocked loads since it last loaded. Call after changes.",
  inputSchema: { type: "object", properties: {} } satisfies InputSchema,
  annotations: { readOnlyHint: true } satisfies Hints,
};

/** The default door, code mode: write world.js and hear how it ran in the same reply. All an MCP client is listed,
 *  with page_status; the tools above stay callable by name. */
export const BUILD_TOOLS: readonly Tool[] = [
  { name: "world_build", title: "Build the world", schema: Build, description: `Run \`code\` as world.js, a ${ABOUT} Replies {ok,errors}. ${ASK}` },
  { name: "world_edit", title: "Change the world", schema: EditWorld, description: "Replace the one exact match of `find` in world.js; replies like world_build." },
];
/** What world_build and world_edit answer: whether the frame loaded clean, and each thing it said if not. */
export const Checked = obj({ ok: bool(), errors: arr(str(2000), 40) });
export type Checked = Of<typeof Checked>;

const ReadFile = Schema.Struct({ path: Path });
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

const issues = SchemaIssue.makeFormatterStandardSchemaV1();
/** The value as the schema reads it, or a thrown error an agent can act on: `path: a file name like world.js`. */
const read = <T>(schema: Schema.Decoder<T>, value: unknown): T => {
  try { return Schema.decodeUnknownSync(schema)(value); }
  catch (e) {
    if (!Schema.isSchemaError(e)) throw e;
    throw new Error(issues(e.issue).issues.map((i) => `${i.path?.join(".")}: ${i.message}`).join("; "));
  }
};

/** Check a tool's arguments: the request it makes, or a thrown error that says what was wrong. */
export const decode = (tool: Tool, args: unknown): Request =>
  read(Request, { ...(typeof args === "object" && args !== null ? args : {}), _tag: tool.schema.fields._tag.schema.literal });
/** The same check for page_read_file, which asks for nothing to change. */
export const decodeReadFile = (args: unknown) => read(ReadFile, args);

/** Every tool as an agent is told of it: name, title, description, inputSchema and annotations. */
export const listTools = () => [READ, READ_FILE, ...TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t.schema), annotations: t.hints ?? {} }))];
/** What `tools/list` over MCP answers: the default door and page_status, each argument just a string (the Schema still
 *  checks its limits when it's called; telling them costs tokens). */
export const slimTools = () => [...BUILD_TOOLS, ...TOOLS.filter((t) => t.name === "page_status")].map(({ name, title, description, schema }) => {
  const args = Object.keys(schema.fields).filter((k) => k !== "_tag");
  return { name, title, description, inputSchema: { type: "object", properties: Object.fromEntries(args.map((k) => [k, { type: "string" }])), required: args } satisfies InputSchema };
});
export const toolNames = new Set([...listTools(), ...BUILD_TOOLS].map((t) => t.name));

/** The relay to the page: run this tool with these arguments. */
export const ToPage = obj({ t: str(8, { re: /^call$/ }), id: int(1, Number.MAX_SAFE_INTEGER), name: str(64), args: raw });
export type ToPage = Of<typeof ToPage>;
/** The page to the relay: what came of call `id`. */
export const FromPage = obj({ t: str(8, { re: /^reply$/ }), id: int(1, Number.MAX_SAFE_INTEGER), ok: bool(), result: raw, error: opt(str(2000)) });
export type FromPage = Of<typeof FromPage>;

/** A room's id: what the page's address and the relay's routes carry. Lowercase letters and digits, hard to guess. */
export const ROOM = /^[a-z0-9]{10,32}$/;

// The page's tools as one list, for every door: WebMCP in the page (agent.ts), and HTTP and MCP in the relay
// (relay.ts), for an agent in a terminal (Claude Code, Codex, opencode). No DOM or Bun here: the Worker, the
// local dev server and the page all import it. The frames between the relay and the page are here too.
import { bool, obj, opt, raw, int, str, type Of } from "@rustybuns/util/guard";
import type { Hints, InputSchema } from "@rustybuns/util/commands";
import { Schema } from "effect";
import { AddBlock, EditBlock, MoveBlock, RemoveBlock, Reset, SetBackdrop, SetProfile, SetTheme } from "./page.ts";

export const Undo = Schema.TaggedStruct("Undo", {});
/** What a call asks the page for: an action on the page, or undo (which needs the page's history). */
export const Request = Schema.Union([SetProfile, SetTheme, AddBlock, EditBlock, RemoveBlock, MoveBlock, SetBackdrop, Reset, Undo]);
export type Request = typeof Request.Type;

type Tagged = typeof SetProfile | typeof SetTheme | typeof AddBlock | typeof EditBlock | typeof RemoveBlock | typeof MoveBlock | typeof SetBackdrop | typeof Reset | typeof Undo;
export interface Tool { name: string; title: string; description: string; schema: Tagged; hints?: Hints }

const block = "A block is {kind, title, body, items}: text (title and body), links (items with label and an https url), stats (items with label and value), quote (body, title says who) or tags (items with a label).";

export const TOOLS: readonly Tool[] = [
  { name: "page_set_profile", title: "Set the name and tagline", schema: SetProfile, description: "Set the page's name (the big heading) and tagline (the line under it). Leave one out to keep it." },
  { name: "page_set_theme", title: "Set the theme", schema: SetTheme, description: "Set the colors (#rrggbb: accent, paper behind everything, ink for text) and the font (sans, serif, mono, rounded). Leave any out to keep it." },
  { name: "page_add_block", title: "Add a block", schema: AddBlock, description: `Add a block at index \`at\` (the end when left out). ${block} The answer has its id.` },
  { name: "page_edit_block", title: "Edit a block", schema: EditBlock, description: `Change the fields given of the block with this id; items, when given, replaces the whole list. ${block}` },
  { name: "page_move_block", title: "Move a block", schema: MoveBlock, description: "Move the block with this id to index `to` (0 is the top)." },
  { name: "page_remove_block", title: "Remove a block", schema: RemoveBlock, description: "Remove the block with this id. page_undo puts it back.", hints: { destructiveHint: true } },
  { name: "page_set_backdrop", title: "Set the backdrop", schema: SetBackdrop, description: "Put a codeSplitter profile page (that handle's public `page` repo, its own world or scene) full screen behind the blocks, in a sandbox: \"quinn\" shows @quinn's. \"\" takes it away. Pick ink and a paper that read over it." },
  { name: "page_undo", title: "Undo", schema: Undo, description: "Take back the last change, the agent's or the person's." },
  { name: "page_reset", title: "Start over", schema: Reset, description: "Put the page back to the starter. page_undo puts it back.", hints: { destructiveHint: true } },
];

export const READ = {
  name: "page_read", title: "Read the page",
  description: `The page as it stands: name, tagline, theme, blocks (each with its id) and backdrop (a codeSplitter handle, when set). ${block}`,
  inputSchema: { type: "object", properties: {} } satisfies InputSchema,
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
export const listTools = () => [READ, ...TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t.schema), annotations: t.hints ?? {} }))];
export const toolNames = new Set(listTools().map((t) => t.name));

/** The relay to the page: run this tool with these arguments. */
export const ToPage = obj({ t: str(8, { re: /^call$/ }), id: int(1, Number.MAX_SAFE_INTEGER), name: str(64), args: raw });
export type ToPage = Of<typeof ToPage>;
/** The page to the relay: what came of call `id`. */
export const FromPage = obj({ t: str(8, { re: /^reply$/ }), id: int(1, Number.MAX_SAFE_INTEGER), ok: bool(), result: raw, error: opt(str(2000)) });
export type FromPage = Of<typeof FromPage>;

/** A room's id: what the page's address and the relay's routes carry. Lowercase letters and digits, hard to guess. */
export const ROOM = /^[a-z0-9]{10,32}$/;

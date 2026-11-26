// The door between the agent and the page. Its Layer puts the page's WebMCP tools up (`@rustybuns/util/commands`:
// document.modelContext when the browser has one, window.__commands always) for as long as the page is mounted, and
// takes them down when it goes. A tool call is checked against its Schema, goes into the page as a message
// (`calls`), and waits for the page to say what came of it (`report`): the page after it, or why it couldn't.
import { addCommands, type Command, type InputSchema } from "@rustybuns/util/commands";
import { Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { AddBlock, EditBlock, MoveBlock, type Page, RemoveBlock, Reset, SetProfile, SetTheme, starter } from "./page.ts";

export const Undo = Schema.TaggedStruct("Undo", {});
/** What a call asks the page for: an action on the page, or undo (which needs the page's history). */
export const Request = Schema.Union([SetProfile, SetTheme, AddBlock, EditBlock, RemoveBlock, MoveBlock, Reset, Undo]);
export type Request = typeof Request.Type;

export const Call = Schema.Struct({ call: Schema.Number, tool: Schema.String, request: Request });
export type Call = typeof Call.Type;

export interface Report { readonly call: number; readonly error: string | null; readonly page: Page }

export class Agent extends Context.Service<Agent, {
  /** The agent's calls, in the order they came. */
  readonly calls: Stream.Stream<Call>;
  /** What came of a call (0 for a person's click): answers the agent waiting on it. */
  readonly report: (r: Report) => Effect.Effect<void>;
}>()("effect-ui-page/Agent") {}

type Tagged = typeof SetProfile | typeof SetTheme | typeof AddBlock | typeof EditBlock | typeof RemoveBlock | typeof MoveBlock | typeof Reset | typeof Undo;
interface Tool { name: string; title: string; description: string; schema: Tagged; hints?: Command["annotations"] }

const block = "A block is {kind, title, body, items}: text (title and body), links (items with label and an https url), stats (items with label and value), quote (body, title says who) or tags (items with a label).";

export const TOOLS: readonly Tool[] = [
  { name: "page_set_profile", title: "Set the name and tagline", schema: SetProfile, description: "Set the page's name (the big heading) and tagline (the line under it). Leave one out to keep it." },
  { name: "page_set_theme", title: "Set the theme", schema: SetTheme, description: "Set the colors (#rrggbb: accent, paper behind everything, ink for text) and the font (sans, serif, mono, rounded). Leave any out to keep it." },
  { name: "page_add_block", title: "Add a block", schema: AddBlock, description: `Add a block at index \`at\` (the end when left out). ${block} The answer has its id.` },
  { name: "page_edit_block", title: "Edit a block", schema: EditBlock, description: `Change the fields given of the block with this id; items, when given, replaces the whole list. ${block}` },
  { name: "page_move_block", title: "Move a block", schema: MoveBlock, description: "Move the block with this id to index `to` (0 is the top)." },
  { name: "page_remove_block", title: "Remove a block", schema: RemoveBlock, description: "Remove the block with this id. page_undo puts it back.", hints: { destructiveHint: true } },
  { name: "page_undo", title: "Undo", schema: Undo, description: "Take back the last change, the agent's or the person's." },
  { name: "page_reset", title: "Start over", schema: Reset, description: "Put the page back to the starter. page_undo puts it back.", hints: { destructiveHint: true } },
];

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

export const layer = Layer.effect(Agent, Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Call>();
  const waiting = new Map<number, (r: Report) => void>();
  let page: Page = starter, next = 1;
  const call = (tool: Tool, args: unknown) => {
    const request = decode(tool, args);
    const id = next++;
    return new Promise<{ ok: boolean; error?: string; page: Page }>((done) => {
      waiting.set(id, (r) => done(r.error === null ? { ok: true, page: r.page } : { ok: false, error: r.error, page: r.page }));
      Queue.offerUnsafe(queue, { call: id, tool: tool.name, request });
    });
  };
  const off = addCommands([
    { name: "page_read", title: "Read the page", group: "Page", description: `The page as it stands: name, tagline, theme and blocks (each with its id). ${block}`,
      inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true }, palette: false, execute: () => page },
    ...TOOLS.map((t): Command => ({ name: t.name, title: t.title, group: "Page", description: t.description, inputSchema: inputSchema(t.schema),
      annotations: t.hints, palette: false, execute: (args) => call(t, args) })),
  ]);
  yield* Effect.addFinalizer(() => Effect.sync(off));
  return Agent.of({
    calls: Stream.fromQueue(queue),
    report: (r) => Effect.sync(() => {
      page = r.page;
      waiting.get(r.call)?.(r);
      waiting.delete(r.call);
    }),
  });
}));

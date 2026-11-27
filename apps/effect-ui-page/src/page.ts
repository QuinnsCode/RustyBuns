// The page an agent builds: a profile (name, tagline), a theme and a list of blocks, all Effect Schemas. The
// same Schemas check what an agent sends (decode) and tell it what to send (each tool's JSON Schema), so the
// page can't be put in a shape it can't draw. `apply` is the only way it changes: pure, no DOM, no Effect runtime.
import { Schema } from "effect";

const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));
const Url = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));
const Line = Schema.String.check(Schema.isMaxLength(120));
const Para = Schema.String.check(Schema.isMaxLength(800));
/** A codeSplitter handle, or "" for none. */
const Handle = Schema.String.check(Schema.isPattern(/^([A-Za-z0-9][A-Za-z0-9_-]{0,38})?$/));

/** Where a backdrop comes from: codeSplitter serves each person's page (their public `page` repo) in a sandbox there. */
export const CODESPLITTER = "https://codesplitter.notryanquinn.workers.dev";
export const backdropUrl = (handle: string) => `${CODESPLITTER}/api/users/${encodeURIComponent(handle)}/page/`;

export const Font = Schema.Literals(["sans", "serif", "mono", "rounded"]);
export const Kind = Schema.Literals(["text", "links", "stats", "quote", "tags"]);

export const Theme = Schema.Struct({ accent: Hex, paper: Hex, ink: Hex, font: Font });
export type Theme = typeof Theme.Type;

/** One row of a links, stats or tags block: a link has a url, a stat a value. */
export const Item = Schema.Struct({ label: Line, url: Schema.optionalKey(Url), value: Schema.optionalKey(Line) });
export type Item = typeof Item.Type;

export const Block = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  title: Line,
  body: Para,
  items: Schema.Array(Item),
});
export type Block = typeof Block.Type;

export const Page = Schema.Struct({
  name: Line,
  tagline: Line,
  theme: Theme,
  blocks: Schema.Array(Block),
  next: Schema.Number,
  /** A codeSplitter handle whose profile page fills the window behind the blocks. */
  backdrop: Schema.optionalKey(Handle),
});
export type Page = typeof Page.Type;

// What an agent (or a person, for undo and reset) can do to the page. Each case is one WebMCP tool's arguments.
export const SetProfile = Schema.TaggedStruct("SetProfile", { name: Schema.optionalKey(Line), tagline: Schema.optionalKey(Line) });
export const SetTheme = Schema.TaggedStruct("SetTheme", {
  accent: Schema.optionalKey(Hex), paper: Schema.optionalKey(Hex), ink: Schema.optionalKey(Hex), font: Schema.optionalKey(Font),
});
export const AddBlock = Schema.TaggedStruct("AddBlock", {
  kind: Kind, title: Line, body: Schema.optionalKey(Para), items: Schema.optionalKey(Schema.Array(Item)), at: Schema.optionalKey(Schema.Int),
});
export const EditBlock = Schema.TaggedStruct("EditBlock", {
  id: Schema.String, kind: Schema.optionalKey(Kind), title: Schema.optionalKey(Line), body: Schema.optionalKey(Para), items: Schema.optionalKey(Schema.Array(Item)),
});
export const RemoveBlock = Schema.TaggedStruct("RemoveBlock", { id: Schema.String });
export const MoveBlock = Schema.TaggedStruct("MoveBlock", { id: Schema.String, to: Schema.Int });
export const SetBackdrop = Schema.TaggedStruct("SetBackdrop", { codesplitter: Handle });
export const Reset = Schema.TaggedStruct("Reset", {});

export const Action = Schema.Union([SetProfile, SetTheme, AddBlock, EditBlock, RemoveBlock, MoveBlock, SetBackdrop, Reset]);
export type Action = typeof Action.Type;

export const starter: Page = {
  name: "Your name",
  tagline: "Connect an agent and ask it to build this page.",
  theme: { accent: "#ff3d8b", paper: "#0a0918", ink: "#e9ecf8", font: "mono" },
  blocks: [
    { id: "b1", kind: "text", title: "About", body: "This page is an Effect UI component. Every change comes in as a message, from your agent's WebMCP tools or from the buttons beside it.", items: [] },
  ],
  next: 2,
};

const at = (n: number, len: number) => Math.max(0, Math.min(len, Math.trunc(n)));

/** The page after one action, or why it can't be done (an unknown block id). */
export function apply(page: Page, a: Action): { page: Page } | { error: string } {
  const find = (id: string) => page.blocks.findIndex((b) => b.id === id);
  const missing = (id: string) => ({ error: `no block "${id}": the blocks are ${page.blocks.map((b) => b.id).join(", ") || "none"}` });
  switch (a._tag) {
    case "SetProfile":
      return { page: { ...page, name: a.name ?? page.name, tagline: a.tagline ?? page.tagline } };
    case "SetTheme": {
      const { _tag, ...theme } = a;
      return { page: { ...page, theme: { ...page.theme, ...theme } } };
    }
    case "AddBlock": {
      const block: Block = { id: `b${page.next}`, kind: a.kind, title: a.title, body: a.body ?? "", items: a.items ?? [] };
      const blocks = [...page.blocks];
      blocks.splice(at(a.at ?? blocks.length, blocks.length), 0, block);
      return { page: { ...page, blocks, next: page.next + 1 } };
    }
    case "EditBlock": {
      const i = find(a.id);
      if (i < 0) return missing(a.id);
      const { _tag, id, ...patch } = a;
      return { page: { ...page, blocks: page.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) } };
    }
    case "RemoveBlock": {
      const i = find(a.id);
      if (i < 0) return missing(a.id);
      return { page: { ...page, blocks: page.blocks.filter((_, j) => j !== i) } };
    }
    case "MoveBlock": {
      const i = find(a.id);
      if (i < 0) return missing(a.id);
      const blocks = [...page.blocks];
      const [b] = blocks.splice(i, 1);
      blocks.splice(at(a.to, blocks.length), 0, b);
      return { page: { ...page, blocks } };
    }
    case "SetBackdrop": {
      const { backdrop: _, ...rest } = page;
      return { page: a.codesplitter ? { ...rest, backdrop: a.codesplitter } : rest };
    }
    case "Reset":
      return { page: starter };
  }
}

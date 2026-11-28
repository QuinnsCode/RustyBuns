// The world an agent writes: a few text files (index.html, and the scripts and styles it loads) that run in a sealed
// frame (world.ts), the way codeSplitter runs each person's page. The agent writes real code, a canvas city or a
// three.js scene; what keeps it safe is the frame, not a short list of things it may say. The Schemas check every
// write before it lands (a file name, text only, a size) and tell the agent what to send. `apply` is the only way the
// world changes: pure, no DOM, no Effect runtime.
import { Schema, type SchemaAST } from "effect";
import { STARTER_FILES } from "./starter.ts";

/** A string whose refusal is these words, whether it fails a check, isn't text or is missing (`decode` in tools.ts
 * puts the field's name in front). */
export const plain = (message: string, ...checks: ((says: { message: string }) => SchemaAST.Check<string>)[]) =>
  checks.reduce((s, check) => s.check(check({ message })), Schema.String.annotate({ message })).pipe(Schema.annotateKey({ messageMissingKey: message }));

/** A file of the world: a plain name or one folder deep (`world.js`, `lib/noise.js`), a text type. */
export const Path = plain("a file name like world.js or lib/noise.js: one folder deep at most, text types only",
  (says) => Schema.isPattern(/^([a-z0-9][a-z0-9_-]{0,40}\/)?[a-z0-9][a-z0-9._-]{0,60}\.(html|js|mjs|css|json|svg|txt|glsl)$/i, says));
/** One file's text, and the whole world's: a page's worth, so a save fits the browser and a reply fits the socket. */
export const FILE_MAX = 100_000, WORLD_MAX = 400_000, FILES_MAX = 30;
const A_FILE = `a file is text, ${FILE_MAX.toLocaleString("en")} characters at most`;
const Text = plain(A_FILE, (says) => Schema.isMaxLength(FILE_MAX, says));
const Find = plain(`the exact text to replace, like sky("day"): 1 to ${FILE_MAX.toLocaleString("en")} characters`,
  (says) => Schema.isMinLength(1, says), (says) => Schema.isMaxLength(FILE_MAX, says));
/** A codeSplitter handle, or "" for none. */
const Handle = plain('a codeSplitter handle like ada, or "" for none', (says) => Schema.isPattern(/^([A-Za-z0-9][A-Za-z0-9_-]{0,38})?$/, says));

/** Where a backdrop comes from: codeSplitter serves each person's page (their public `page` repo) in a sandbox there. */
export const CODESPLITTER = "https://codesplitter.notryanquinn.workers.dev";
export const backdropUrl = (handle: string) => `${CODESPLITTER}/api/users/${encodeURIComponent(handle)}/page/`;

export const Page = Schema.Struct({
  /** Every file by its path; `index.html` is the one the frame opens. */
  files: Schema.Record(Path, Text),
  /** A codeSplitter handle whose profile page fills the window behind the world (seen where the world is clear). */
  backdrop: Schema.optionalKey(Handle),
});
export type Page = typeof Page.Type;

// What an agent (or a person, for undo and reset) can do to the world. Each case is one tool's arguments.
export const WriteFile = Schema.TaggedStruct("WriteFile", { path: Path, text: Text });
export const EditFile = Schema.TaggedStruct("EditFile", { path: Path, find: Find, replace: Text });
export const SetBackdrop = Schema.TaggedStruct("SetBackdrop", { codesplitter: Handle });
export const Reset = Schema.TaggedStruct("Reset", {});

export const Action = Schema.Union([WriteFile, EditFile, SetBackdrop, Reset]);
export type Action = typeof Action.Type;

export const starter: Page = { files: STARTER_FILES };

/** The world's files as an agent is told of them: each path and its size, index.html first. */
export const listing = (page: Page) => Object.entries(page.files)
  .sort(([a], [b]) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
  .map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text).length }));

const size = (files: Page["files"]) => Object.values(files).reduce((n, t) => n + t.length, 0);

/** Where `find` begins in `text`, every time, overlapping ones too: an edit needs exactly one place. */
const places = (text: string, find: string) => {
  const at: number[] = [];
  for (let i = text.indexOf(find); i !== -1; i = text.indexOf(find, i + 1)) at.push(i);
  return at;
};

/** The world after one action, or why it can't be done (too many files, too much text). */
export function apply(page: Page, a: Action): { page: Page } | { error: string } {
  switch (a._tag) {
    case "WriteFile": {
      // An empty text takes the file away, as codeSplitter's page does.
      const { [a.path]: _, ...rest } = page.files;
      const files = a.text === "" ? rest : { ...rest, [a.path]: a.text };
      if (Object.keys(files).length > FILES_MAX) return { error: `a world is ${FILES_MAX} files at most: write "" to a file to take it away` };
      if (size(files) > WORLD_MAX) return { error: `a world is ${WORLD_MAX.toLocaleString("en")} characters at most, and this write makes it ${size(files).toLocaleString("en")}` };
      return { page: { ...page, files } };
    }
    case "EditFile": {
      const text = page.files[a.path];
      if (text === undefined) return { error: `no file "${a.path}" to edit` };
      const [at, ...more] = places(text, a.find);
      if (at === undefined || more.length) return { error: `\`find\` matches ${at === undefined ? 0 : more.length + 1} places in ${a.path}: it must match exactly 1` };
      const next = text.slice(0, at) + a.replace + text.slice(at + a.find.length);
      if (next.length > FILE_MAX) return { error: `a file is ${FILE_MAX.toLocaleString("en")} characters at most, and this edit makes it ${next.length.toLocaleString("en")}` };
      return apply(page, { _tag: "WriteFile", path: a.path, text: next });
    }
    case "SetBackdrop": {
      const { backdrop: _, ...rest } = page;
      return { page: a.codesplitter ? { ...rest, backdrop: a.codesplitter } : rest };
    }
    case "Reset":
      return { page: starter };
  }
}

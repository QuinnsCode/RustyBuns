// What the page's tools answer, as plain data: the page (agent.ts) sends these, and the tests' stand-in page
// (test/app-kit.ts) sends the same, so the token count (test/tokens.test.ts) measures what an agent really reads.
import { field } from "@rustybuns/util/guard";
import { listing, type Page } from "./page.ts";
import type { Checked } from "./tools.ts";

/** A write the page refused, which goes back as its error alone. world_build's `{ ok: false, errors }` is its answer. */
export const refused = (r: unknown) => field(r, "ok") === false && !Array.isArray(field(r, "errors"));

/** The key a reply carries a person's note under, and what the agent is told of it (relay.ts, doors.ts). */
export const NOTE_KEY = "user_note";
export const NOTE_MAX = 300;
export const NOTE_TOLD = `Follow a reply's ${NOTE_KEY}, world only.`;
/** What the person typed on the page for their agent. A page can't start a turn in the agent, so it waits here and goes
 *  with the reply to the agent's next call (a refused one carries only its error, so it waits for the one after).
 *  `changed` hears what is waiting, and what just went. */
export function noteBox(changed: (n: { waiting: string; sent: string }) => void = () => {}) {
  let notes: string[] = [];
  return {
    leave(text: string) {
      const note = text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
      if (!note) return false;
      notes.push(note);
      changed({ waiting: notes.join(" / "), sent: "" });
      return true;
    },
    carry(r: unknown): unknown {
      if (!notes.length || typeof r !== "object" || r === null || refused(r)) return r;
      const sent = notes.join(" / ");
      notes = [];
      changed({ waiting: "", sent });
      return { ...r, [NOTE_KEY]: sent };
    },
  };
}

/** world_build and world_edit: ok, or what went wrong. Nothing else. */
export const checked = (errors: readonly string[]) => ({ ok: errors.length === 0, errors: [...errors] }) satisfies Checked;

/** page_read: the files by path and size, the backdrop, and what the frame said since it last loaded. */
export const looked = (page: Page, said: readonly string[]) =>
  ({ files: listing(page), ...(page.backdrop ? { backdrop: page.backdrop } : {}), said: said.length ? said : ["nothing: no errors since it loaded"] });

/** page_read_file: one file's whole text, or which files there are. */
export const fileRead = (page: Page, path: string) => {
  const text = page.files[path];
  return text === undefined ? { ok: false, error: `no file "${path}": the files are ${Object.keys(page.files).join(", ") || "none"}` } : { path, text };
};

/** A change (a write, an undo, ...): the files after it, and why it couldn't be done if it couldn't. */
export const changed = (error: string | null, page: Page) =>
  error === null ? { ok: true, files: listing(page) } : { ok: false, error, files: listing(page) };

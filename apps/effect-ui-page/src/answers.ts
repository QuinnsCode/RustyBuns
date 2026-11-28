// What the page's tools answer, as plain data: the page (agent.ts) sends these, and the tests' stand-in page
// (test/app-kit.ts) sends the same, so the token count (test/tokens.test.ts) measures what an agent really reads.
import { listing, type Page } from "./page.ts";

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

// A failed codeSplitter reply as a sentence an agent or a person acts on (#3804). Plain on purpose: the MCP server
// and hosted agent runs are in the Worker, which never imports effect (EFFECT.md ruling 9). The typed client
// (client.ts) names failures for code outside the Worker; this is the part both sides share.

import { parseJson } from "@rustybuns/util/http";
import { ERRORS, type ErrorTag } from "./openapi.ts";
import { isPlainObject } from "./util.ts";

const isTag = (t: unknown): t is ErrorTag => typeof t === "string" && Object.hasOwn(ERRORS, t);

/** The app's sentence, with what its tag means (openapi.ts ERRORS) when the app's own is terse. The CLI's say() uses it too. */
export function explain(message: string, tag: unknown): string {
  const means = isTag(tag) && ERRORS[tag][1];
  return means && message.length < 40 && !message.includes(means) ? `${message}: ${means}` : message;
}

/**
 * A failed reply as an agent reads it (#3804): status and tag first, so it can branch on either, then the
 * sentence, then the reply's other fields (conflicts, claims, retryAfter) as JSON to act on. A missing argument is its own line.
 */
export function failed(status: number, text: string): string {
  const body = parseJson(text);
  if (!isPlainObject(body)) return status === 400 && text && !text.startsWith("{") ? text : `${status}: ${text}`;
  const { error, tag, ...rest } = body;
  const said = typeof error === "string" ? explain(error, tag) : typeof body.message === "string" ? explain(body.message, tag) : null;
  if (said === null) return `${status}: ${text}`;
  const head = `${status}${typeof tag === "string" ? ` ${tag}` : ""}: ${said}`;
  if (typeof error !== "string") delete rest.message;
  return Object.keys(rest).length ? `${head}\n${JSON.stringify(rest)}` : head;
}

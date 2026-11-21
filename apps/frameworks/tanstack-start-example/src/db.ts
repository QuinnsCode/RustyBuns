// Server only: the notes in D1 and the visit count in KV. Imported by server functions and server routes.
import { env } from "./env.ts";

export type Note = { id: number; text: string; at: number };

export async function listNotes() {
  return (await env.DB.prepare("SELECT id, text, at FROM notes ORDER BY id DESC LIMIT 50").bind().all<Note>()).results;
}

export async function addNote(text: string) {
  await env.DB.prepare("INSERT INTO notes (text, at) VALUES (?, ?)").bind(text.slice(0, 280), Date.now()).run();
}

/** Counts this page view in KV and returns the total. */
export async function countVisit() {
  const n = Number((await env.VISITS.get("visits")) ?? 0) + 1;
  await env.VISITS.put("visits", String(n));
  return n;
}

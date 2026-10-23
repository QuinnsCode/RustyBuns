import { createServerFn } from "@tanstack/react-start";
import { addNote, countVisit, listNotes } from "./db.ts";

export const getPage = createServerFn({ method: "GET" }).handler(async () => ({ notes: await listNotes(), visits: await countVisit() }));

export const postNote = createServerFn({ method: "POST" })
  .validator((text: unknown) => {
    if (typeof text !== "string" || !text.trim()) throw new Error("a note needs some text");
    return text.trim();
  })
  .handler(async ({ data }) => { await addNote(data); });

import { createFileRoute } from "@tanstack/react-router";
import { addNote, listNotes } from "../../db.ts";

// A server route: the same notes as JSON, for scripts and the test.
export const Route = createFileRoute("/api/notes")({
  server: {
    handlers: {
      GET: async () => Response.json(await listNotes()),
      POST: async ({ request }) => {
        const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
        if (typeof text !== "string" || !text.trim()) return Response.json({ error: "text is required" }, { status: 400 });
        await addNote(text.trim());
        return Response.json({ ok: true }, { status: 201 });
      },
    },
  },
});

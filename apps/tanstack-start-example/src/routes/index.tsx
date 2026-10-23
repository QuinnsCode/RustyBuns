import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getPage, postNote } from "../notes.ts";

export const Route = createFileRoute("/")({
  loader: () => getPage(),
  component: Home,
});

function Home() {
  const { notes, visits } = Route.useLoaderData();
  const router = useRouter();
  const [text, setText] = useState("");
  return (
    <main>
      <h1>Notes</h1>
      <p>Rendered on the server from D1. Visit {visits}, counted in KV.</p>
      <form onSubmit={async (e) => { e.preventDefault(); await postNote({ data: text }); setText(""); router.invalidate(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note" aria-label="Note" />
        <button type="submit" disabled={!text.trim()}>Add</button>
      </form>
      <ul>{notes.map((n) => <li key={n.id}>{n.text}</li>)}</ul>
    </main>
  );
}

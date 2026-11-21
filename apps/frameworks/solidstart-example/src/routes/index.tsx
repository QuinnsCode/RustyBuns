// The page reads the count on the server, through a `"use server"` function the router preloads,
// from the Worker's KV binding. Nothing here knows about Rusty Buns: `cloudflare:workers` is what
// a Worker imports, and the desktop host shims it to its own KV (a folder under ~/.solidstart-example).
import { createAsync, query, type RouteDefinition } from "@solidjs/router";

const getCount = query(async () => {
  "use server";
  const { env } = await import("cloudflare:workers");
  return Number((await env.COUNTER.get("count")) ?? 0);
}, "count");

export const route = { preload: () => getCount() } satisfies RouteDefinition;

export default function Home() {
  const n = createAsync(() => getCount());
  return (
    <main>
      <h1 id="count">count: {n()}</h1>
      <form method="post" action="/increment"><button type="submit">+1</button></form>
    </main>
  );
}

// A Hono Worker as its own docs write it: a page that shows a count kept in KV, and a form
// that bumps it. Nothing here knows about Rusty Buns; `c.env.COUNTER` is the Worker's binding,
// which the desktop and box hosts back with a folder.
import { Hono } from "hono";
import { html } from "hono/html";

type Bindings = { COUNTER: KVNamespace };
const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const n = Number((await c.env.COUNTER.get("count")) ?? 0);
  return c.html(html`<!doctype html>
    <html><head><meta charset="utf-8"><title>hono-example</title></head>
    <body>
      <h1 id="count">count: ${n}</h1>
      <form method="post" action="/increment"><button type="submit">+1</button></form>
    </body></html>`);
});

app.post("/increment", async (c) => {
  const n = Number((await c.env.COUNTER.get("count")) ?? 0) + 1;
  await c.env.COUNTER.put("count", String(n));
  return c.redirect("/", 303);
});

export default app;

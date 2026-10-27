// An Elysia Worker as Elysia's Cloudflare guide writes it: `aot: false` (Workers forbid the compiler's
// `new Function`), the bindings through `env` from `cloudflare:workers`, and `app.fetch` exported as
// the Worker's handler. Nothing here knows about Rusty Buns; on the desktop and box hosts the same
// `cloudflare:workers` import resolves to the local twins, so KV is a folder.
import { env } from "cloudflare:workers";
import { Elysia } from "elysia";

const { COUNTER } = env as { COUNTER: KVNamespace };
const count = async () => Number((await COUNTER.get("count")) ?? 0);

const app = new Elysia({ aot: false })
  .get("/", async ({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return `<!doctype html>
    <html><head><meta charset="utf-8"><title>elysia-example</title></head>
    <body>
      <h1 id="count">count: ${await count()}</h1>
      <form method="post" action="/increment"><button type="submit">+1</button></form>
    </body></html>`;
  })
  .post("/increment", async ({ redirect }) => {
    await COUNTER.put("count", String((await count()) + 1));
    return redirect("/", 303);
  });

export default { fetch: (req: Request) => app.fetch(req) };

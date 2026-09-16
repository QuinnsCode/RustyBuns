import { mkdir } from "node:fs/promises";
await mkdir("dist/worker", { recursive: true });
await mkdir("dist/client", { recursive: true });
await Bun.write("dist/client/index.html", `<!doctype html><h1>druids-curse</h1><pre id=o></pre>
<script>fetch("/api/hello").then(r=>r.text()).then(t=>o.textContent=t)</script>`);
await Bun.write("dist/worker/worker.js", `export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/api/hello") {
      await env.DB.exec("CREATE TABLE IF NOT EXISTS visits (n INTEGER)");
      await env.DB.prepare("INSERT INTO visits (n) VALUES (1)").run();
      const { results } = await env.DB.prepare("SELECT COUNT(*) AS c FROM visits").all();
      await env.PRESENCE_KV.put("last", new Date().toISOString(), { expirationTtl: 60 });
      return new Response("hello from the worker. visits=" + results[0].c + " last=" + await env.PRESENCE_KV.get("last") + " debug=" + JSON.stringify(env.DEBUG_DIRECTOR_USERS));
    }
    return new Response("not found", { status: 404 });
  }
};`);

import { mkdir } from "node:fs/promises";
await mkdir("dist/worker", { recursive: true });
await mkdir("dist/client", { recursive: true });
await Bun.write("dist/client/index.html", `<!doctype html><h1>druids-curse</h1><pre id=o></pre>
<script>
fetch("/api/hello").then(r=>r.text()).then(t=>o.textContent=t);
const ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws");
ws.onmessage=m=>o.textContent+="\\n"+m.data; ws.onopen=()=>ws.send("hi from browser");
</script>`);
await Bun.write("dist/worker/worker.js", `
export class WorldDurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.n = 0;
    ctx.blockConcurrencyWhile(async () => { this.n = (await ctx.storage.get("n")) ?? 0; }); }
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("ws only", { status: 400 });
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.send("hello from DO, boots=" + (++this.n)); await this.ctx.storage.put("n", this.n);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, m) {
    const last = await this.env.PRESENCE_KV.get("last");
    for (const s of this.ctx.getWebSockets()) s.send("echo:" + m + " (kv last=" + last + ")");
  }
  webSocketClose() {}
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/ws") return env.WORLD_DURABLE_OBJECT.get(env.WORLD_DURABLE_OBJECT.idFromName("veil")).fetch(req);
    if (u.pathname === "/api/hello") {
      await env.DB.exec("CREATE TABLE IF NOT EXISTS visits (n INTEGER)");
      await env.DB.prepare("INSERT INTO visits (n) VALUES (1)").run();
      const { results } = await env.DB.prepare("SELECT COUNT(*) AS c FROM visits").all();
      await env.PRESENCE_KV.put("last", new Date().toISOString(), { expirationTtl: 60 });
      return new Response("hello from the worker. visits=" + results[0].c);
    }
    return new Response("not found", { status: 404 });
  }
};`);

// Slim borg's Worker. Each /borg/<check> route uses one binding the way an app would and
// says whether it behaved like Cloudflare documents it. The same file runs on the edge and
// on the local twins; src/suite.ts calls it from outside and compares.

type Row = Record<string, unknown>;
interface Stmt { bind(...v: unknown[]): Stmt; all(): Promise<{ results: Row[] }>; first(col?: string): Promise<unknown>; run(): Promise<unknown> }
interface Env {
  DB: { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown[]>; exec(sql: string): Promise<unknown> };
  KV: { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void>; delete(k: string): Promise<void>; list(o: { prefix: string }): Promise<{ keys: { name: string }[] }> };
  BUCKET: { put(k: string, v: string): Promise<unknown>; get(k: string): Promise<{ text(): Promise<string> } | null>; head(k: string): Promise<{ size: number } | null>; delete(k: string): Promise<void>; list(o: { prefix: string }): Promise<{ objects: { key: string }[] }> };
  PROBE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request | string): Promise<Response> } };
  JOBS: { send(body: unknown): Promise<void> };
}
interface Socket { send(m: string): void; serializeAttachment(v: unknown): void; deserializeAttachment(): any }
interface State {
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
  acceptWebSocket(ws: Socket): void;
}
declare const WebSocketPair: { new (): { 0: unknown; 1: Socket } };

export type Verdict = { ok: boolean; detail: string };
const verdict = (ok: boolean, detail: string) => Response.json({ ok, detail } satisfies Verdict);
const nonce = () => crypto.randomUUID().slice(0, 8);

/** One object per id: a counter, and a socket that keeps an attachment across messages. */
export class Probe {
  constructor(private ctx: State, private env: Env) {}
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ joined: new URL(req.url).searchParams.get("n") });
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
    // Read, then write: the edge's input gate keeps two requests from interleaving here.
    const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
    await this.ctx.storage.put("n", n);
    return Response.json({ n });
  }
  webSocketMessage(ws: Socket, m: string | ArrayBuffer) {
    ws.send(JSON.stringify({ echo: m, joined: ws.deserializeAttachment()?.joined }));
  }
  webSocketClose() {}
}

const checks: Record<string, (env: Env, url: URL) => Promise<Response>> = {
  async kv(env) {
    const k = `borg:${nonce()}`;
    await env.KV.put(k, "v");
    const got = await env.KV.get(k);
    const listed = (await env.KV.list({ prefix: k })).keys.map((x) => x.name);
    await env.KV.delete(k);
    const gone = await env.KV.get(k);
    return verdict(got === "v" && listed.includes(k) && gone === null, `get=${got} listed=${listed.length} afterDelete=${gone}`);
  },

  async d1(env) {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS borg (id TEXT PRIMARY KEY, n INTEGER)");
    const id = nonce();
    await env.DB.prepare("INSERT INTO borg (id, n) VALUES (?, ?)").bind(id, 7).run();
    const n = await env.DB.prepare("SELECT n FROM borg WHERE id = ?").bind(id).first("n");
    return verdict(n === 7, `n=${n}`);
  },

  // D1 runs a batch as one transaction, so a bad statement undoes the good one before it.
  async "d1-batch"(env) {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS borg (id TEXT PRIMARY KEY, n INTEGER)");
    const id = nonce();
    let threw = false;
    try {
      await env.DB.batch([env.DB.prepare("INSERT INTO borg (id, n) VALUES (?, 1)").bind(id), env.DB.prepare("INSERT INTO borg_missing VALUES (1)")]);
    } catch { threw = true; }
    const kept = await env.DB.prepare("SELECT COUNT(*) AS c FROM borg WHERE id = ?").bind(id).first("c");
    return verdict(threw && kept === 0, `threw=${threw} rowsKept=${kept}`);
  },

  async r2(env) {
    const k = `borg/${nonce()}.txt`;
    await env.BUCKET.put(k, "hello");
    const text = await (await env.BUCKET.get(k))?.text();
    const size = (await env.BUCKET.head(k))?.size;
    const listed = (await env.BUCKET.list({ prefix: k })).objects.map((o) => o.key);
    await env.BUCKET.delete(k);
    const gone = await env.BUCKET.get(k);
    return verdict(text === "hello" && size === 5 && listed.includes(k) && gone === null, `text=${text} size=${size} listed=${listed.length} afterDelete=${gone === null ? "null" : "object"}`);
  },

  // Ten concurrent bumps on one object must land as ten distinct counts; another id starts at 1.
  async do(env) {
    const name = nonce();
    const stub = env.PROBE.get(env.PROBE.idFromName(name));
    const ns = await Promise.all(Array.from({ length: 10 }, () => stub.fetch("https://borg/bump").then((r) => r.json() as Promise<{ n: number }>)));
    const seen = new Set(ns.map((x) => x.n));
    const other = (await (await env.PROBE.get(env.PROBE.idFromName(name + "-b")).fetch("https://borg/bump")).json() as { n: number }).n;
    return verdict(seen.size === 10 && Math.max(...seen) === 10 && other === 1, `distinct=${seen.size} max=${Math.max(...seen)} otherId=${other}`);
  },

  async "queue-send"(env, url) {
    await env.JOBS.send({ n: url.searchParams.get("n") });
    return verdict(true, "sent");
  },
  async "queue-seen"(env, url) {
    const v = await env.KV.get(`queue:${url.searchParams.get("n")}`);
    return verdict(v === "seen", `kv=${v}`);
  },
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/borg/ws") return env.PROBE.get(env.PROBE.idFromName("ws")).fetch(req);
    if (url.pathname === "/borg") return Response.json(Object.keys(checks));
    const check = url.pathname.startsWith("/borg/") ? checks[url.pathname.slice(6)] : undefined;
    if (!check) return new Response("not found", { status: 404 });
    try { return await check(env, url); } catch (e) { return verdict(false, `threw: ${e instanceof Error ? e.message : String(e)}`); }
  },
  async queue(batch: { messages: { body: { n: string }; ack(): void }[] }, env: Env) {
    for (const m of batch.messages) { await env.KV.put(`queue:${m.body.n}`, "seen"); m.ack(); }
  },
};

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
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean> };
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
    if (new URL(req.url).pathname === "/big") {
      // Over the 2 MB value limit of a SQLite-backed object.
      await this.ctx.storage.put("big", "x".repeat(3_000_000));
      await this.ctx.storage.delete("big");
      return Response.json({ stored: 3_000_000 });
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

// Each limit goes over one the edge documents, on purpose. Refused is what the edge does;
// accepted means the target is looser. The edge kills a request over memory or CPU outright,
// so the suite counts an HTTP error as refused too.
const limits: Record<string, (env: Env) => Promise<string>> = {
  // D1: at most 100 bound parameters per query.
  async "d1-params"(env) {
    const vs = Array.from({ length: 101 }, (_, i) => i);
    await env.DB.prepare(`SELECT ${vs.map(() => "?").join(", ")}`).bind(...vs).first();
    return "101 parameters bound";
  },
  // KV: keys up to 512 bytes.
  async "kv-key"(env) {
    const k = `borg:${nonce()}:`.padEnd(513, "k");
    await env.KV.put(k, "v");
    await env.KV.delete(k);
    return "513-byte key stored";
  },
  // Queues: a message up to 128 KB.
  async "queue-size"(env) {
    await env.JOBS.send({ n: `limit-${nonce()}`, pad: "x".repeat(140_000) });
    return "140 KB message sent";
  },
  // Durable Objects (SQLite-backed): a value up to 2 MB.
  async "do-value"(env) {
    const r = await env.PROBE.get(env.PROBE.idFromName(`limit-${nonce()}`)).fetch("https://borg/big");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return "3 MB value stored";
  },
  // An isolate gets 128 MB.
  async memory() {
    const held = Array.from({ length: 200 }, () => new Uint8Array(1 << 20).fill(1));
    return `${held.length} MB held`;
  },
  // 10 ms of CPU on the Free plan, 30 s by default on Paid. Clocks stand still while a Worker
  // computes, so this counts work, not time: a few hundred ms on a laptop.
  async cpu() {
    let x = 1;
    for (let i = 0; i < 30_000_000; i++) x = (x * 1103515245 + 12345) | 0;
    return `30M steps done (${x & 1})`;
  },
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/borg/ws") return env.PROBE.get(env.PROBE.idFromName("ws")).fetch(req);
    if (url.pathname === "/borg") return Response.json({ checks: Object.keys(checks), limits: Object.keys(limits) });
    if (url.pathname.startsWith("/borg/limit/")) {
      const over = limits[url.pathname.slice(12)];
      if (!over) return new Response("not found", { status: 404 });
      try { return verdict(false, `accepted: ${await over(env)}`); } catch (e) { return verdict(true, `refused: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const check = url.pathname.startsWith("/borg/") ? checks[url.pathname.slice(6)] : undefined;
    if (!check) return new Response("not found", { status: 404 });
    try { return await check(env, url); } catch (e) { return verdict(false, `threw: ${e instanceof Error ? e.message : String(e)}`); }
  },
  async queue(batch: { messages: { body: { n: string }; ack(): void }[] }, env: Env) {
    for (const m of batch.messages) { await env.KV.put(`queue:${m.body.n}`, "seen"); m.ack(); }
  },
};

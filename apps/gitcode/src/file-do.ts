// One Durable Object per file. It is the only writer for that file, so every
// edit from every agent lands in one order. Thousands of files means thousands
// of independent objects: they scale out, not up.
//
// Storage is the plain key/value API (get, single-key put, prefix list) so the same class runs on
// Cloudflare and in-process under Bun with sqlite behind it.
//   doc            the current lines
//   op:<rev>       one applied op per key (the log)
//   commit:<n>     a snapshot: sha, parent, rev, message

import { apply, empty, replay, sha, text, type Applied, type Doc, type Op } from "./lines.ts";

interface Commit { n: number; sha: string; parent: string | null; rev: number; by: string; at: number; message: string }

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const pad = (n: number) => String(n).padStart(10, "0");
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

export class FileDurableObject {
  doc: Doc = empty();
  commits = 0;
  queue: Promise<unknown> = Promise.resolve();

  constructor(private ctx: any, _env: unknown) {
    ctx.blockConcurrencyWhile(async () => {
      this.doc = (await ctx.storage.get("doc")) ?? empty();
      this.commits = (await ctx.storage.get("commits")) ?? 0;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const by = req.headers.get("x-gitcode-user") ?? "anon";
    const route = url.pathname.split("/").pop();

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    if (req.method === "GET" && route === "file") return json(this.doc);
    if (req.method === "POST" && route === "ops") {
      const { ops } = (await req.json()) as { ops: Op[] };
      // Apply synchronously on the in-memory doc, then persist. No await sits
      // between reading and mutating, so concurrent requests cannot interleave.
      const r = apply(this.doc, ops, by);
      if (!r.ok) return json({ rev: this.doc.rev, conflicts: r.conflicts }, 409);
      const doc = structuredClone(this.doc);
      await Promise.all([this.ctx.storage.put("doc", doc), ...r.applied.map((a) => this.ctx.storage.put("op:" + pad(a.rev), a))]);
      this.broadcast({ type: "ops", rev: this.doc.rev, applied: r.applied });
      return json({ rev: this.doc.rev, applied: r.applied });
    }
    if (req.method === "GET" && route === "log") return json(await this.log(Number(url.searchParams.get("since") ?? 0)));
    if (req.method === "GET" && route === "at") return json(replay(await this.log(0), Number(url.searchParams.get("rev"))));
    if (req.method === "POST" && route === "commit") {
      const { message } = (await req.json()) as { message?: string };
      // Commits hash their parent, so they run one at a time.
      const done = this.queue.then(() => this.commit(by, message));
      this.queue = done.catch(() => {});
      const { commit, content } = await done;
      return json({ commit, content });
    }
    if (req.method === "GET" && route === "commits") {
      const m: Map<string, Commit> = await this.ctx.storage.list({ prefix: "commit:" });
      return json([...m.values()].reverse());
    }
    return json({ error: "not found" }, 404);
  }

  async commit(by: string, message?: string) {
    const content = text(this.doc);
    const prev: Commit | undefined = this.commits ? await this.ctx.storage.get("commit:" + pad(this.commits)) : undefined;
    const commit: Commit = {
      n: this.commits + 1, sha: await sha((prev?.sha ?? "") + "\n" + content), parent: prev?.sha ?? null,
      rev: this.doc.rev, by, at: Date.now(), message: message || "commit",
    };
    this.commits = commit.n;
    await Promise.all([this.ctx.storage.put("commit:" + pad(commit.n), commit), this.ctx.storage.put("commits", this.commits)]);
    this.broadcast({ type: "commit", commit });
    return { commit, content };
  }

  async log(since: number): Promise<Applied[]> {
    // Only prefix lists: that is the storage shape both Cloudflare and the local twin share.
    const m: Map<string, Applied> = await this.ctx.storage.list({ prefix: "op:" });
    return [...m.values()].filter((a) => a.rev > since);
  }

  broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) try { ws.send(s); } catch {}
  }

  webSocketMessage() {}
  webSocketClose() {}
}

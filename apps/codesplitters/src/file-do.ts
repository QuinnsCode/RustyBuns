// One Durable Object per file. It is the only writer for that file, so every
// edit from every agent lands in one order. Thousands of files means thousands
// of independent objects: they scale out, not up.
//
// Storage is the plain key/value API (get, single-key put, prefix list) so the same class runs on
// Cloudflare and in-process under Bun with sqlite behind it.
//   doc            the current lines
//   op:<rev>       one applied op per key (the log)
//   commit:<n>     a snapshot: sha, parent, rev, message
//   base           on a branch's copy of a file: main's doc when it forked

import { apply, empty, merge, replay, sha, text, type Applied, type Doc, type Op } from "./lines.ts";

interface Commit { n: number; sha: string; parent: string | null; rev: number; by: string; at: number; message: string }

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const pad = (n: number) => String(n).padStart(10, "0");
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

export class FileDurableObject {
  doc: Doc = empty();
  base: Doc | null = null;
  commits = 0;
  queue: Promise<unknown> = Promise.resolve();

  constructor(private ctx: any, _env: unknown) {
    ctx.blockConcurrencyWhile(async () => {
      this.doc = (await ctx.storage.get("doc")) ?? empty();
      this.commits = (await ctx.storage.get("commits")) ?? 0;
      this.base = (await ctx.storage.get("base")) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const by = req.headers.get("x-codesplitters-user") ?? "anon";
    const route = url.pathname.split("/").pop();

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // The Worker vouches for who this is and whether they may write; the
      // socket carries that across hibernation.
      const [client, server] = Object.values(new WebSocketPair()) as [unknown, any];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ user: by, write: req.headers.get("x-codesplitters-write") === "1" });
      this.presence();
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    if (req.method === "GET" && route === "file") return json(this.doc);
    if (req.method === "POST" && route === "ops") {
      const { ops, ifRev } = (await req.json()) as { ops: Op[]; ifRev?: number };
      const r = await this.edit(by, ops, ifRev);
      return r.ok ? json({ rev: r.rev, applied: r.applied }) : json({ rev: r.rev, conflicts: r.conflicts }, 409);
    }
    if (req.method === "GET" && route === "log") return json(await this.log(Number(url.searchParams.get("since") ?? 0)));
    if (req.method === "GET" && route === "at") return json(replay(await this.log(0), Number(url.searchParams.get("rev")), this.base ?? empty()));
    if (req.method === "GET" && route === "base") return json(this.base);
    if (req.method === "POST" && route === "wipe") {
      // Its repo was evicted: forget everything.
      const all: Map<string, unknown> = await this.ctx.storage.list();
      await Promise.all([...all.keys()].map((k) => this.ctx.storage.delete(k)));
      [this.doc, this.base, this.commits] = [empty(), null, 0];
      return json({ ok: true });
    }
    if (req.method === "POST" && route === "fork") {
      // A branch's copy starts as main's doc, ids and revs and all, once.
      const { doc } = (await req.json()) as { doc: Doc };
      if (!this.base && !this.doc.rev) {
        this.base = doc; this.doc = structuredClone(doc);
        await Promise.all([this.ctx.storage.put("base", doc), this.ctx.storage.put("doc", this.doc)]);
      }
      return json(this.doc);
    }
    if (req.method === "POST" && route === "merge") {
      // Main's copy merges a branch into itself: computed and applied with no
      // await between, so nothing lands in the middle and the ids line up.
      const { base, branch, resolve, dry, deleter } = (await req.json()) as { base: Doc; branch: Doc; resolve?: Record<string, "branch" | "main">; dry?: boolean; deleter?: string };
      const m = merge(base, branch, this.doc, resolve, deleter);
      if (m.conflicts.length || dry || !m.ops.length) return json({ rev: this.doc.rev, ops: m.ops, conflicts: m.conflicts }, m.conflicts.length && !dry ? 409 : 200);
      const r = await this.edit(m.by, m.ops);
      return r.ok ? json({ rev: r.rev, ops: m.ops, applied: r.applied, conflicts: [] }) : json({ rev: r.rev, conflicts: r.conflicts }, 409);
    }
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

  /**
   * Apply a batch and tell everyone. Synchronous on the in-memory doc, so no
   * await sits between reading and mutating and concurrent edits can't
   * interleave; then persisted, then broadcast as the exact applied ops, so
   * every open page updates in place without refetching.
   */
  async edit(by: string | string[], ops: Op[], ifRev?: number) {
    const r = apply(this.doc, ops, by, Date.now(), ifRev);
    if (!r.ok) return { ok: false as const, rev: this.doc.rev, conflicts: r.conflicts };
    const doc = structuredClone(this.doc);
    await Promise.all([this.ctx.storage.put("doc", doc), ...r.applied.map((a) => this.ctx.storage.put("op:" + pad(a.rev), a))]);
    this.broadcast({ type: "ops", rev: this.doc.rev, applied: r.applied });
    return { ok: true as const, rev: this.doc.rev, applied: r.applied };
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

  /** Edits over the socket: {type:"ops", id, ops, ifRev?} -> {type:"ack"|"nack", id, ...}. */
  async webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    let msg: { type?: string; id?: number; ops?: Op[]; ifRev?: number };
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (msg.type !== "ops" || !Array.isArray(msg.ops)) return;
    const who = (ws.deserializeAttachment() ?? {}) as { user?: string; write?: boolean };
    if (!who.write) return ws.send(JSON.stringify({ type: "nack", id: msg.id, error: "no write access" }));
    const r = await this.edit(who.user ?? "anon", msg.ops, msg.ifRev);
    ws.send(JSON.stringify(r.ok ? { type: "ack", id: msg.id, rev: r.rev } : { type: "nack", id: msg.id, rev: r.rev, conflicts: r.conflicts }));
  }
  webSocketClose(ws: any) { try { ws.close(); } catch {} this.presence(ws); }
  webSocketError(ws: any) { this.presence(ws); }

  /** Who has this file open, sent to everyone in it. */
  presence(leaving?: unknown) {
    const who = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) if (ws !== leaving) who.add((ws.deserializeAttachment?.() ?? {}).user ?? "anon");
    this.broadcast({ type: "presence", who: [...who].sort() });
  }
}

// One Durable Object per file. It is the only writer for that file, so every
// edit from every agent lands in one order. Thousands of files means thousands
// of independent objects: they scale out, not up.
//
// Storage is the plain key/value API (get, single-key put, prefix list) so the same class runs on
// Cloudflare and in-process under Bun with sqlite behind it.
//   doc, doc:<n>   the current lines, a manifest and runs of lines (doc-store.ts)
//   op:<rev>       one applied op per key (the log), read by key range, never whole
//   snap:<rev>     the doc as it was at rev, every SNAP_EVERY ops, chunked like the doc; `snaps` lists them
//   trimmed        the rev history starts after: older ops and snapshots are gone (#625)
//   commit:<n>     a snapshot: sha, parent, rev, message, and who edited the file since the last one
//   base, base:<n> on a branch's copy of a file: main's doc when it forked, chunked the same way
//   private        ids of lines only the crew may read (in a public repo too)
//   claim:<id>     who is working on which lines right now (see Claim), one key each
//   where          [owner, repo, path] on main's copy, so its edits reach the home feed (feed.ts)
//   branch         [owner, repo, branch] on a branch's copy, so its edits mark the branch changed (checks.ts)
//   authors        who is named here that D1's authors already has for the repo, so a scrub finds it (#748)
//
// Private lines: the Worker says whether the caller is crew
// (`x-codesplitters-crew: 1`); everyone else gets each private line as a
// placeholder, its id and place kept and its text blank, in the file, the log,
// time travel and the live socket. A commit hands back that public text too,
// for git and search, so the real text never leaves the app.

import type { Env } from "./env.ts";
import { recordEdits, type Recent } from "./line-events.ts";
import { noteStep } from "./insights.ts";
import { branchEdited } from "./checks.ts";
import { Tally } from "./limits.ts";
import { lintMerge } from "./lint.ts";
import { DocStore } from "./doc-store.ts";
import { apply, empty, merge, replay, sha, text, type Applied, type Doc, type Line, type Op, type Resolve } from "./lines.ts";

/** `writers`: everyone whose edits since the file's last commit this one carries (a hosted deploy asks about others', deploy.ts). */
interface Commit { n: number; sha: string; parent: string | null; rev: number; by: string; at: number; message: string; writers: string[] }

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

const pad = (n: number) => String(n).padStart(10, "0");
/** One read of the log takes this many ops at most, so no read holds the whole log in memory. */
const OP_PAGE = 1000;
/** The doc is snapshotted every this many ops, so time travel replays at most this many. */
export const SNAP_EVERY = 2000;
/** Snapshots kept: history reaches back KEEP_SNAPS * SNAP_EVERY ops; the ops before the oldest go. */
export const KEEP_SNAPS = 10;

/** Asked for history from before `trimmed`. */
class Trimmed extends Error { constructor(readonly from: number) { super(`history before rev ${from} is trimmed: read the file instead`); } }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

type Shown = Line & { private?: true };

/**
 * Lines someone is working on. While a claim stands only its holder edits
 * those lines: an agent's claim keeps people off the lines it is rewriting,
 * a person's (a hold) keeps agents off theirs. A line is in one claim at most.
 * Every agent of a harness edits as the same `agent-<harness>`, so an agent's
 * ops name their claim's id; a person's claim is theirs by name alone.
 * Lines the holder inserts inside its claim join it; deleted ones leave it.
 */
export interface Claim { id: string; who: string; bot: boolean; lines: string[]; task?: string; at: number; until: number | null }

/** An agent's claim lapses after this unless it says otherwise, so a run that dies doesn't hold lines forever. */
const CLAIM_MS = 30 * 60_000;
/** Presence goes out at most this often, so a thousand sockets opening at once isn't a million messages. */
const PRESENCE_MS = 250;

export class FileDurableObject {
  doc: Doc = empty();
  base: Doc | null = null;
  secret = new Set<string>();
  commits = 0;
  queue: Promise<unknown> = Promise.resolve();
  claims = new Map<string, Claim>();
  /** Line id -> the claim it is in. */
  claimOf = new Map<string, Claim>();
  presenceTimer: ReturnType<typeof setTimeout> | null = null;
  leaving = new Set<unknown>();
  /** Main's copy knows where it lives (the Worker says so), so its edits go into the feed's line events. */
  where: [string, string, string] | null = null;
  /** A branch's copy knows which branch it is, so an edit marks the branch changed since its checks. */
  onBranch: [string, string, string] | null = null;
  /** Each writer's line event still being folded into, and the writes to D1, one after another. */
  recent = new Map<string, Recent>();
  logging: Promise<unknown> = Promise.resolve();
  /** Its sockets' edits, counted against the edit limit without waiting on D1. */
  edits: Tally;
  /** Where the doc and the base sit in storage, in chunks, so an edit writes only what it touched. */
  docs: DocStore;
  bases: DocStore;
  /** Revs the doc was snapshotted at, oldest first, and the rev history starts after. */
  snaps: number[] = [];
  trimmed = 0;
  /** Old ops still being deleted, a page per edit. */
  sweeping: Promise<unknown> = Promise.resolve();
  /** Handles D1's authors has for this file's repo; null until this copy has noted its lines' (#748). */
  authors: Set<string> | null = null;

  constructor(private ctx: any, private env: Env) {
    this.edits = new Tally(env, "edit");
    this.docs = new DocStore(ctx.storage, "doc");
    this.bases = new DocStore(ctx.storage, "base");
    ctx.blockConcurrencyWhile(async () => {
      this.doc = (await this.docs.load()) ?? empty();
      this.commits = (await ctx.storage.get("commits")) ?? 0;
      this.base = await this.bases.load();
      this.secret = new Set((await ctx.storage.get("private")) ?? []);
      this.where = (await ctx.storage.get("where")) ?? null;
      this.onBranch = (await ctx.storage.get("branch")) ?? null;
      this.snaps = (await ctx.storage.get("snaps")) ?? [];
      this.trimmed = (await ctx.storage.get("trimmed")) ?? 0;
      const authors: string[] | undefined = await ctx.storage.get("authors");
      this.authors = authors ? new Set(authors) : null;
      // A sweep the object was evicted in the middle of picks up where it stopped.
      if (this.trimmed) this.sweeping = this.sweep().catch(() => {});
      for (const c of ((await ctx.storage.list({ prefix: "claim:" })) as Map<string, Claim>).values()) this.index(c);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const by = req.headers.get("x-codesplitters-user") ?? "anon";
    const route = url.pathname.split("/").pop();
    const crew = req.headers.get("x-codesplitters-crew") === "1";
    const where = req.headers.get("x-codesplitters-file");
    if (where && decodeURIComponent(where) !== JSON.stringify(this.where)) {
      this.where = JSON.parse(decodeURIComponent(where));
      await this.ctx.storage.put("where", this.where);
    }
    const onBranch = req.headers.get("x-codesplitters-branch");
    if (onBranch && decodeURIComponent(onBranch) !== JSON.stringify(this.onBranch)) {
      this.onBranch = JSON.parse(decodeURIComponent(onBranch));
      await this.ctx.storage.put("branch", this.onBranch);
    }
    // A file from before #748: its lines' authors, once, now that it knows its repo.
    if (!this.authors) this.noteAuthors([...this.doc.lines, ...this.base?.lines ?? []].map((l) => l.by));

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      // The Worker vouches for who this is and whether they may write; the
      // socket carries that across hibernation.
      const [client, server] = Object.values(new WebSocketPair()) as [unknown, any];
      this.ctx.acceptWebSocket(server);
      // and who its edits count as under the edit limit, if they're counted at all,
      // and whose "wrote code" step its first edit is (insights.ts), if anyone's.
      server.serializeAttachment({ user: by, write: req.headers.get("x-codesplitters-write") === "1", limitAs: req.headers.get("x-codesplitters-limit-as"), stepAs: req.headers.get("x-codesplitters-step-as") });
      this.presence();
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    if (req.method === "GET" && route === "file") return json(this.shown(this.doc, crew));
    if (req.method === "POST" && route === "ops") {
      const { ops, ifRev, claim } = (await req.json()) as { ops: Op[]; ifRev?: number; claim?: string };
      const r = await this.edit(by, ops, ifRev, claim);
      return r.ok ? json({ rev: r.rev, applied: r.applied }) : json({ rev: r.rev, conflicts: r.conflicts }, 409);
    }
    try {
      if (req.method === "GET" && route === "log") {
        const page = await this.log(Number(url.searchParams.get("since") ?? 0), Number(url.searchParams.get("limit") || OP_PAGE));
        return json({ ops: this.hide(page.ops, crew), next: page.next });
      }
      if (req.method === "GET" && route === "at") return json(this.shown(await this.at(Number(url.searchParams.get("rev"))), crew));
    } catch (e) {
      if (e instanceof Trimmed) return json({ error: e.message, from: e.from }, 410);
      throw e;
    }
    if (req.method === "GET" && route === "base") return json(this.base && this.shown(this.base, crew));
    if (req.method === "GET" && route === "private") return json([...this.secret]);
    if (req.method === "POST" && route === "private") {
      // Crew only (the Worker checks). A line keeps its id when it's edited, so it stays private.
      const { lines, private: on } = (await req.json()) as { lines: string[]; private: boolean };
      for (const id of lines ?? []) on ? this.secret.add(id) : this.secret.delete(id);
      await this.ctx.storage.put("private", [...this.secret]);
      // Each page fetches the file again, and gets it as its reader may see it.
      this.broadcast({ type: "private", lines, private: on });
      return json([...this.secret]);
    }
    if (req.method === "POST" && route === "pushclash") {
      // A push to the repo's git clashed with edits here, or that was settled (mirror.ts, #788).
      // Just a ping: each page asks the repo whether it's still held.
      this.broadcast({ type: "pushclash" });
      return json({ ok: true });
    }
    if (req.method === "POST" && route === "stamped") {
      // A stamp went on or came off (stamps.ts). Just a ping, so a private line's
      // stamps don't reach outside the crew: each page asks again for what it may see.
      this.broadcast({ type: "stamps" });
      return json({ ok: true });
    }
    if (req.method === "GET" && route === "here") return json(this.here());
    if (req.method === "GET" && route === "claims") return json(this.live());
    if (req.method === "POST" && route === "claims") {
      // Crew only (the Worker checks). Any of the crew may lift any claim: that's how a person steers an agent off lines.
      const b = (await req.json()) as { id?: string; lines?: string[]; task?: string; ttl?: number | null; release?: boolean };
      if (b.release) return json({ released: await this.release(b.id ?? "") });
      return this.claim(by, b);
    }
    if (req.method === "POST" && route === "wipe") {
      // Its repo was evicted: forget everything.
      const all: Map<string, unknown> = await this.ctx.storage.list();
      await Promise.all([...all.keys()].map((k) => this.ctx.storage.delete(k)));
      [this.doc, this.base, this.commits, this.secret, this.where, this.onBranch, this.snaps, this.trimmed, this.authors] = [empty(), null, 0, new Set(), null, null, [], 0, new Set()];
      this.docs.clear(); this.bases.clear();
      this.claims.clear(); this.claimOf.clear(); this.recent.clear();
      return json({ ok: true });
    }
    if (req.method === "POST" && route === "scrub") {
      // A deleted account's handle, swapped for the ghost's everywhere here (privacy.ts).
      const { from, to } = (await req.json()) as { from: string; to: string };
      return json({ changed: await this.ctx.blockConcurrencyWhile(() => this.scrub(from, to)) });
    }
    if (req.method === "POST" && route === "authors") {
      // The admin's backfill (privacy.ts, #770): every line's author into D1's authors
      // again, D1 deduping, so a copy whose first note failed gets another go.
      this.authors = new Set();
      this.noteAuthors([...this.doc.lines, ...this.base?.lines ?? []].map((l) => l.by));
      await this.logging;
      return json({ authors: this.authors.size });
    }
    if (req.method === "POST" && route === "fork") {
      // A branch's copy starts as main's doc, ids and revs and all, once,
      // and main's private lines are private here too.
      const { doc } = (await req.json()) as { doc: Doc & { lines: Shown[] } };
      if (!this.base && !this.doc.rev) {
        for (const l of doc.lines) if (l.private) { this.secret.add(l.id); delete l.private; }
        this.base = doc; this.doc = structuredClone(doc);
        await Promise.all([...this.bases.replace(doc), ...this.docs.replace(this.doc), this.ctx.storage.put("private", [...this.secret])]);
        this.noteAuthors(doc.lines.map((l) => l.by));
      }
      return json(this.doc);
    }
    if (req.method === "POST" && route === "merge") {
      // Main's copy merges a branch into itself: computed and applied with no
      // await between, so nothing lands in the middle and the ids line up.
      const { base, branch, resolve, dry, deleter, path, writer } = (await req.json()) as { base: Doc; branch: Doc; resolve?: Resolve; dry?: boolean; deleter?: string; path?: string; writer?: string };
      const m = merge(base, branch, this.doc, resolve, deleter, path, writer);
      // Every line settled: check the merged code still builds before it lands.
      if (!m.conflicts.length && path) m.conflicts = lintMerge(path, this.doc, branch, m, resolve);
      if (m.conflicts.length || dry || !m.ops.length) return json({ rev: this.doc.rev, ops: m.ops, conflicts: m.conflicts }, m.conflicts.length && !dry ? 409 : 200);
      const r = await this.edit(m.by, m.ops);
      return r.ok ? json({ rev: r.rev, ops: m.ops, applied: r.applied, conflicts: [] }) : json({ rev: r.rev, conflicts: r.conflicts }, 409);
    }
    if (req.method === "POST" && route === "commit") {
      const { message } = (await req.json()) as { message?: string };
      // Commits hash their parent, so they run one at a time.
      const done = this.queue.then(() => this.commit(by, message));
      this.queue = done.catch(() => {});
      const { commit, content, published } = await done;
      return json({ commit, content, published });
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
      writers: await this.writers(prev?.rev ?? 0),
    };
    this.commits = commit.n;
    await Promise.all([this.ctx.storage.put("commit:" + pad(commit.n), commit), this.ctx.storage.put("commits", this.commits)]);
    this.noteAuthors([by]);
    this.broadcast({ type: "commit", commit });
    // What git and search get: private lines blank.
    return { commit, content, published: text(this.shown(this.doc, false)) };
  }

  /**
   * Apply a batch and tell everyone. Synchronous on the in-memory doc, so no
   * await sits between reading and mutating and concurrent edits can't
   * interleave; then persisted, then broadcast as the exact applied ops, so
   * every open page updates in place without refetching.
   */
  async edit(by: string | string[], ops: Op[], ifRev?: number, claim?: string) {
    // A merge (one author per op) lands whole: claims guard live edits, not a branch coming home.
    const held = typeof by === "string" ? this.held(by, ops, claim) : [];
    if (held.length) return { ok: false as const, rev: this.doc.rev, conflicts: held };
    const r = apply(this.doc, ops, by, Date.now(), ifRev);
    if (!r.ok) return { ok: false as const, rev: this.doc.rev, conflicts: r.conflicts };
    if (this.claimOf.size) await this.follow(typeof by === "string" ? by : "", r.applied, claim);
    this.noteAuthors(r.applied.map((a) => a.by));
    await Promise.all([...this.docs.save(this.doc, r.applied.map((a) => a.line)), ...r.applied.map((a) => this.ctx.storage.put("op:" + pad(a.rev), a))]);
    if (this.doc.rev - (this.snaps.at(-1) ?? this.base?.rev ?? 0) >= SNAP_EVERY) await this.snapshot();
    const msg = (crew: boolean) => JSON.stringify({ type: "ops", rev: this.doc.rev, applied: this.hide(r.applied, crew) });
    const [toCrew, toOthers] = [msg(true), msg(false)];
    for (const ws of this.ctx.getWebSockets()) try { ws.send(ws.deserializeAttachment?.()?.write ? toCrew : toOthers); } catch {}
    // Into the feed, after the edit has landed and gone out: an edit never waits on it, and a failed write loses an event, not the edit.
    if (this.where) {
      const [owner, repo, path] = this.where;
      this.logging = this.logging.then(() => recordEdits(this.env, { owner, repo, path }, r.applied, this.recent, claim)).catch(() => {});
    }
    // A branch's edit: the branch has changed since its checks ran, and may queue a run of them.
    if (this.onBranch) {
      const [owner, repo, branch] = this.onBranch, at = r.applied.at(-1)?.at ?? Date.now();
      this.logging = this.logging.then(() => branchEdited(this.env, owner, repo, branch, at, typeof by === "string" ? by : by[0] ?? "upstream")).catch(() => {});
    }
    return { ok: true as const, rev: this.doc.rev, applied: r.applied };
  }

  /**
   * `from` becomes `to` on every line, op, snapshot, commit and claim in storage, a page
   * at a time, then the doc, base and claims are read back. Returns how many keys changed.
   */
  async scrub(from: string, to: string) {
    const swap = (v: any): boolean => {
      if (Array.isArray(v)) return v.map(swap).some(Boolean);
      if (!v || typeof v !== "object") return false;
      let hit = false;
      for (const k of Object.keys(v)) {
        if ((k === "by" || k === "who") && v[k] === from) { v[k] = to; hit = true; }
        else if ((k === "by" || k === "writers") && Array.isArray(v[k]) && v[k].includes(from)) { v[k] = v[k].map((w: unknown) => w === from ? to : w); hit = true; }
        else if (typeof v[k] === "object" && swap(v[k])) hit = true;
      }
      return hit;
    };
    let changed = 0, start: string | undefined;
    for (;;) {
      const m: Map<string, unknown> = await this.ctx.storage.list({ start, limit: OP_PAGE });
      const hits = [...m].filter(([, v]) => swap(v));
      await Promise.all(hits.map(([k, v]) => this.ctx.storage.put(k, v)));
      changed += hits.length;
      if (m.size < OP_PAGE) break;
      start = [...m.keys()].at(-1)! + "\0";
    }
    if (!changed) return 0;
    // D1's authors the scrub swaps itself (privacy.ts).
    if (this.authors?.delete(from)) { this.authors.add(to); await this.ctx.storage.put("authors", [...this.authors]); }
    this.docs = new DocStore(this.ctx.storage, "doc");
    this.bases = new DocStore(this.ctx.storage, "base");
    this.doc = (await this.docs.load()) ?? empty();
    this.base = await this.bases.load();
    this.claims.clear(); this.claimOf.clear();
    for (const c of ((await this.ctx.storage.list({ prefix: "claim:" })) as Map<string, Claim>).values()) this.index(c);
    return changed;
  }

  /**
   * Put anyone in `who` new to this file's repo into D1's authors, so a scrub of their
   * handle finds the repo even if they never edited it themselves: a line can come in
   * with its author, by a cut or a merge (#748). Behind the edit, like the feed's events.
   */
  noteAuthors(who: string[]) {
    const repo = this.where ?? this.onBranch;
    if (!repo || !this.env.DB) return;
    const known = this.authors ??= new Set();
    const fresh = [...new Set(who)].filter((w) => w && !known.has(w));
    if (!fresh.length) return;
    for (const w of fresh) known.add(w);
    const [owner, name] = repo, db = this.env.DB;
    this.logging = this.logging.then(async () => {
      if (fresh.length) await db.batch(fresh.map((w) => db.prepare("INSERT OR IGNORE INTO authors (owner, repo, handle) VALUES (?, ?, ?)").bind(owner, name, w)));
      await this.ctx.storage.put("authors", [...known]);
    }).catch(() => { for (const w of fresh) known.delete(w); });
  }

  /** Every op after rev `since` (up to `until`), a page at a time by key range, so a long log is never read whole. */
  async *ops(since: number, until = Infinity): AsyncGenerator<Applied> {
    if (since < this.trimmed) throw new Trimmed(this.trimmed);
    let from = since + 1;
    while (from <= until) {
      const m: Map<string, Applied> = await this.ctx.storage.list({ prefix: "op:", start: "op:" + pad(from), limit: OP_PAGE });
      for (const a of m.values()) { if (a.rev > until) return; yield a; from = a.rev + 1; }
      if (m.size < OP_PAGE) return;
    }
  }

  /** A page of the log after rev `since`: at most `limit` ops (capped at OP_PAGE), and the rev to pass as
   *  `since` for the next page, or null when this page reached the end (#719). */
  async log(since: number, limit = OP_PAGE): Promise<{ ops: Applied[]; next: number | null }> {
    const max = Math.min(Math.max(1, Math.floor(limit) || OP_PAGE), OP_PAGE);
    const ops: Applied[] = [];
    for await (const a of this.ops(since)) {
      if (ops.length === max) return { ops, next: ops.at(-1)!.rev };
      ops.push(a);
    }
    return { ops, next: null };
  }

  /** Who edited after rev `since`; what was trimmed counts from where history starts. */
  async writers(since: number): Promise<string[]> {
    const who = new Set<string>();
    for await (const a of this.ops(Math.max(since, this.trimmed))) who.add(a.by);
    return [...who].sort();
  }

  /** Time travel: the doc as it was at rev, from the last snapshot at or before it, or from the start. */
  async at(rev: number): Promise<Doc> {
    if (rev < this.trimmed) throw new Trimmed(this.trimmed);
    const snap = this.snaps.findLast((n) => n <= rev);
    const from = snap === undefined ? this.base ?? empty() : (await new DocStore(this.ctx.storage, "snap:" + pad(snap)).load()) ?? empty();
    const log: Applied[] = [];
    for await (const a of this.ops(snap ?? 0, rev)) log.push(a);
    return replay(log, rev, from);
  }

  /**
   * Snapshot the doc as it is now, and past KEEP_SNAPS let the oldest go with every op up to the
   * one after it: history then starts at that snapshot. The ops themselves go a page at a time.
   * A file's first snapshot on a log already longer than KEEP_SNAPS snapshots reach (one from
   * before trimming) starts history right there, rather than after 20,000 more edits (#707).
   */
  async snapshot() {
    const rev = this.doc.rev;
    const long = !this.snaps.length && rev - (this.base?.rev ?? 0) > KEEP_SNAPS * SNAP_EVERY;
    this.snaps.push(rev);
    const drop = this.snaps.length > KEEP_SNAPS ? this.snaps.shift()! : null;
    if (drop !== null || long) this.trimmed = this.snaps[0];
    await Promise.all([...new DocStore(this.ctx.storage, "snap:" + pad(rev)).replace(this.doc), this.ctx.storage.put("snaps", this.snaps), this.ctx.storage.put("trimmed", this.trimmed)]);
    if (drop !== null) {
      const gone: Map<string, unknown> = await this.ctx.storage.list({ prefix: "snap:" + pad(drop) });
      await Promise.all([...gone.keys()].map((k) => this.ctx.storage.delete(k)));
    }
    if (drop !== null || long) this.sweeping = this.sweeping.then(() => this.sweep()).catch(() => {});
  }

  /** Delete the ops history no longer reaches, a page at a time. */
  async sweep() {
    for (;;) {
      const m: Map<string, unknown> = await this.ctx.storage.list({ prefix: "op:", end: "op:" + pad(this.trimmed + 1), limit: OP_PAGE });
      await Promise.all([...m.keys()].map((k) => this.ctx.storage.delete(k)));
      if (m.size < OP_PAGE) return;
    }
  }

  /** The doc as this reader may see it: private lines flagged, and blank unless they're crew. */
  shown(doc: Doc, crew: boolean): Doc & { lines: Shown[] } {
    if (!this.secret.size) return doc;
    return { ...doc, lines: doc.lines.map((l) => this.secret.has(l.id) ? { ...l, text: crew ? l.text : "", private: true as const } : l) };
  }

  /** Log entries as this reader may see them: a private line's text blank, unless they're crew. */
  hide(log: Applied[], crew: boolean): Applied[] {
    if (crew || !this.secret.size) return log;
    return log.map((a) => this.secret.has(a.line) && a.op.kind !== "delete" ? { ...a, op: { ...a.op, text: "" } } : a);
  }

  broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) try { ws.send(s); } catch {}
  }

  /**
   * Edits over the socket: {type:"ops", id, ops, ifRev?} -> {type:"ack"|"nack", id, ...}.
   * Every ops message gets one or the other, even when something throws, so a page never
   * waits on an edit that went nowhere (#659).
   */
  async webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    let msg: { type?: string; id?: number; ops?: Op[]; ifRev?: number; claim?: string };
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (msg.type !== "ops" || !Array.isArray(msg.ops)) return;
    const answer = (m: Record<string, unknown>) => { try { ws.send(JSON.stringify({ ...m, id: msg.id })); } catch {} };
    try {
      const who = (ws.deserializeAttachment() ?? {}) as { user?: string; write?: boolean; limitAs?: string | null; stepAs?: string | null };
      if (!who.write) return answer({ type: "nack", error: "no write access" });
      // The limit reads its rules from D1: if that fails, the edit goes through rather than nowhere.
      const over = who.limitAs ? await this.edits.hit(who.limitAs).catch(() => null) : null;
      if (over) return answer({ type: "nack", error: over.error, retryAfter: over.wait });
      const r = await this.edit(who.user ?? "anon", msg.ops, msg.ifRev, msg.claim);
      answer(r.ok ? { type: "ack", rev: r.rev } : { type: "nack", rev: r.rev, conflicts: r.conflicts });
      if (r.ok && who.stepAs) {
        ws.serializeAttachment({ ...who, stepAs: null });
        await noteStep(this.env, who.stepAs, "code");
      }
    } catch (e) {
      console.error("codeSplitters: socket edit failed", String((e as Error)?.message ?? e));
      answer({ type: "nack", rev: this.doc.rev, error: `the file couldn't take it: ${(e as Error)?.message ?? e}` });
    }
  }
  webSocketClose(ws: any) { try { ws.close(); } catch {} this.presence(ws); }
  webSocketError(ws: any) { this.presence(ws); }

  /** Who has this file open, sent to everyone in it, at most every PRESENCE_MS. */
  presence(leaving?: unknown) {
    if (leaving) this.leaving.add(leaving);
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const who = this.here();
      this.leaving.clear();
      this.broadcast({ type: "presence", who });
      if (this.where) {
        const [owner, repo, path] = this.where;
        this.logging = this.logging.then(() => notePresence(this.env, owner, repo, path, who)).catch(() => {});
      }
    }, PRESENCE_MS);
  }

  /** Who has this file open, sorted, leaving out sockets that are closing. */
  here(): string[] {
    const who = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) if (!this.leaving.has(ws)) who.add((ws.deserializeAttachment?.() ?? {}).user ?? "anon");
    return [...who].sort();
  }

  /** The claims still standing; lapsed ones go. */
  live(): Claim[] {
    const now = Date.now();
    for (const c of this.claims.values()) if (c.until !== null && c.until <= now) void this.release(c.id);
    return [...this.claims.values()];
  }

  index(c: Claim) {
    this.claims.set(c.id, c);
    for (const id of c.lines) this.claimOf.set(id, c);
  }

  /** Lay a claim on lines, or renew one (same id, same holder). 409 names the claims in the way. */
  async claim(by: string, b: { id?: string; lines?: string[]; task?: string; ttl?: number | null }) {
    this.live();
    const old = b.id ? this.claims.get(b.id) : undefined;
    if (old && old.who !== by) return json({ error: `claim ${b.id} is ${old.who}'s` }, 409);
    const have = new Set(this.doc.lines.map((l) => l.id));
    const lines = [...new Set(b.lines ?? old?.lines ?? [])].filter((id) => have.has(id));
    if (!lines.length) return json({ error: "lines required: ids of lines in the file" }, 400);
    const clash = [...new Set(lines.map((id) => this.claimOf.get(id)).filter((c) => c && c !== old))] as Claim[];
    if (clash.length) return json({ error: `held by ${clash.map((c) => "@" + c.who).join(", ")}`, claims: clash }, 409);
    const bot = by.startsWith("agent-"), now = Date.now();
    // An agent's claim lapses; a person's hold stands until they lift it, unless they give it a ttl.
    const ttl = b.ttl === undefined ? (bot ? CLAIM_MS : null) : b.ttl;
    const c: Claim = { id: b.id ?? `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, who: by, bot, lines, ...(b.task ? { task: b.task.slice(0, 200) } : {}), at: old?.at ?? now, until: ttl === null ? null : now + ttl };
    if (old) for (const id of old.lines) this.claimOf.delete(id);
    this.index(c);
    await this.ctx.storage.put("claim:" + c.id, c);
    this.broadcast({ type: "claim", claim: c });
    return json(c, old ? 200 : 201);
  }

  async release(id: string) {
    const c = this.claims.get(id);
    if (!c) return false;
    this.claims.delete(id);
    for (const l of c.lines) if (this.claimOf.get(l) === c) this.claimOf.delete(l);
    await this.ctx.storage.delete("claim:" + id);
    this.broadcast({ type: "unclaim", id });
    return true;
  }

  /** The ops that land on someone else's claim, as conflicts. An insert lands on the line it goes after. */
  held(by: string, ops: Op[], claim?: string) {
    if (!this.claimOf.size) return [];
    const now = Date.now(), out: { index: number; reason: string; claim: string }[] = [];
    ops.forEach((op, index) => {
      const c = this.claimOf.get(op.kind === "insert" ? op.after ?? "" : op.line);
      if (!c || (c.until !== null && c.until <= now)) return;
      if (c.who === by && (!c.bot || claim === c.id)) return;
      out.push({ index, reason: `held by @${c.who}${c.task ? `: ${c.task}` : ""}`, claim: c.id });
    });
    return out;
  }

  /** Keep claims on the lines they cover: the holder's inserts inside join, deleted lines leave. */
  async follow(by: string, applied: Applied[], claim?: string) {
    const changed = new Set<Claim>();
    for (const a of applied) {
      if (a.op.kind === "delete") {
        const c = this.claimOf.get(a.line);
        if (c) { c.lines = c.lines.filter((id) => id !== a.line); this.claimOf.delete(a.line); changed.add(c); }
      } else if (a.op.kind === "insert" && a.op.after) {
        const c = this.claimOf.get(a.op.after);
        if (c && c.who === by && (!c.bot || claim === c.id)) { c.lines.push(a.line); this.claimOf.set(a.line, c); changed.add(c); }
      }
    }
    for (const c of changed) {
      if (!c.lines.length) await this.release(c.id);
      else { await this.ctx.storage.put("claim:" + c.id, c); this.broadcast({ type: "claim", claim: c }); }
    }
  }
}

/** Main's copy of a file keeps D1's presence rows for it in step with who has it open (signed in: not "anon"), for the code city. */
async function notePresence(env: Env, owner: string, repo: string, path: string, who: string[]) {
  if (!env.DB) return;
  const named = who.filter((w) => w !== "anon");
  await env.DB.prepare(`DELETE FROM presence WHERE owner = ? AND repo = ? AND path = ?${named.length ? ` AND who NOT IN (${named.map(() => "?").join(",")})` : ""}`)
    .bind(owner, repo, path, ...named).run();
  const now = Date.now();
  for (const w of named) await env.DB.prepare("INSERT OR IGNORE INTO presence (owner, repo, path, who, at) VALUES (?, ?, ?, ?, ?)").bind(owner, repo, path, w, now).run();
}

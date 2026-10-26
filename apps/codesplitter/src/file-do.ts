// Layout: the file Durable Object: ops, log, time travel, commits, a live socket
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
//   claim:<id>     who is working on which lines right now (see Claim), one key each. The
//                  alarm is set for the earliest lapse, so a lapsed claim goes out as `unclaim`
//   rest:<id>      an agent's claim that ended within a lease of its cap: who, its lines, and
//                  till when that agent may not claim them again (see REST_MS)
//   wait:<id>      someone waiting in line for lines (see Waiter), granted them in order
//   where          [owner, repo, path] on main's copy, so its edits reach the home feed (feed.ts)
//   branch         [owner, repo, branch] on a branch's copy, so its edits mark the branch changed (checks.ts)
//   authors        who is named here that D1's authors already has for the repo, so a scrub finds it (#748)
//
// Private lines: the Worker says whether the caller is crew
// (`x-codesplitter-crew: 1`); everyone else gets each private line as a
// placeholder, its id and place kept and its text blank, in the file, the log,
// time travel and the live socket. A commit hands back that public text too,
// for git and search, so the real text never leaves the app.

import { json, type Env } from "./env.ts";
import { recordEdits, type Recent } from "./line-events.ts";
import { noteStep } from "./insights.ts";
import { branchEdited } from "./checks.ts";
import { Tally } from "./limits.ts";
import { lintMerge } from "./lint.ts";
import { DocStore } from "./doc-store.ts";
import { sha256 as sha } from "./util.ts";
import { apply, empty, MAX_OPS, merge, mergeWords, parseOps, PROTOCOL, replay, text, type Applied, type Doc, type Line, type Op, type Resolve } from "./lines.ts";
import type { Live, Rule } from "./policy.ts";
import { pad10 } from "./util.ts";

/** `writers`: everyone whose edits since the file's last commit this one carries (a hosted deploy asks about others', deploy.ts). */
interface Commit { n: number; sha: string; parent: string | null; rev: number; by: string; at: number; message: string; writers: string[] }

declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

/** One read of the log takes this many ops at most, so no read holds the whole log in memory. */
const OP_PAGE = 1000;
/** The doc is snapshotted every this many ops, so time travel replays at most this many. */
export const SNAP_EVERY = 2000;
/** Snapshots kept: history reaches back KEEP_SNAPS * SNAP_EVERY ops; the ops before the oldest go. */
export const KEEP_SNAPS = 10;

/** Asked for history from before `trimmed`. */
class Trimmed extends Error { constructor(readonly from: number) { super(`history before rev ${from} is trimmed: read the file instead`); } }

type Shown = Line & { private?: true };

/**
 * Lines someone is working on. While a claim stands only its holder edits
 * those lines: an agent's claim keeps people off the lines it is rewriting,
 * a person's (a hold) keeps agents off theirs. A line is in one claim at most.
 * Every agent of a harness edits as the same `agent-<harness>`, so an agent's
 * ops name their claim's id; a person's claim is theirs by name alone.
 * Lines the holder inserts inside its claim join it; deleted ones leave it.
 *
 * An agent's claim is a lease: it lapses at `until` unless renewed (claim it again by id,
 * or edit with `claim`), and never past `cap` unless a person extends it, so one agent
 * can't keep lines from everyone else. `until` comes from this object's clock; clients
 * only ever send durations, so their clock skew never matters.
 *
 * A soft claim is an intent ("rewriting 40–80"): shown and listed like any other, renewed and
 * lapsing the same way, but it keeps nobody off its lines, and other claims may overlap it.
 */
export interface Claim { id: string; who: string; bot: boolean; lines: string[]; task?: string; at: number; until: number | null; cap?: number; soft?: true;
  /** Granted to a waiter that wasn't asking: its grant window (GRANT_MS) starts again if the object restarts before it takes the lines. */
  grant?: true }
/** An agent's claim that ended within a lease of its cap: `who` may not claim any of `lines` again till `until`. */
interface Rest { who: string; lines: string[]; until: number }
/**
 * Someone waiting in line for lines (`claim_lines` with `wait`). Once none of its lines is held,
 * and nobody ahead in line wants any of them, it's granted them: as a claim straight away when
 * it's still asking, or else for GRANT_MS, its grant window, to take by claiming again by id.
 * It keeps its place while it keeps asking: one quiet for WAIT_KEEP_MS leaves the line.
 */
interface Waiter { id: string; who: string; lines: string[]; task?: string; at: number; seen: number; rank?: number }

/** An agent's claim lapses after this unless it's renewed, so a run that dies frees its lines in minutes. */
export const LEASE_MS = 2 * 60_000;
/** How long an agent's claim may stand in all, from when it was laid or a person last extended it. */
export const LEASE_CAP_MS = 30 * 60_000;
/**
 * After an agent's claim ends within a lease of its cap (it lapses there, or is let go), its holder
 * waits this long before it may claim any of those lines again, so people and other agents get the
 * first turn at them (#962, #966). It's by name, so every agent of that harness waits.
 */
export const REST_MS = LEASE_MS;
/** An edit renews its claim only once the lease has run down this much, so renewing costs a write a minute at most. */
const RENEW_SLACK = 30_000;
/** How long a waiter that isn't asking right then has to take lines it's granted, before the next in line gets them. */
export const GRANT_MS = 15_000;
/**
 * How long one ask with `wait` is held open, at most, before it answers "still in line". An open
 * request keeps the object awake (duration billed), so it's short and the waiter asks again.
 */
export const WAIT_POLL_MS = 20_000;
/** A waiter that hasn't asked for this long has gone: it leaves the line. Well past WAIT_POLL_MS. */
export const WAIT_KEEP_MS = 60_000;
/** What a refused-because-of-an-update answer says to wait, in seconds. */
export const UPDATE_RETRY_S = 5;
/** What every answer that was cut by an update says: the same words, so a client can match them. */
export const UPDATING = "update in progress, retry";
/** Presence goes out at most this often, so a thousand sockets opening at once isn't a million messages. */
const PRESENCE_MS = 250;

/**
 * A window of a doc's lines, when the reader asks for one (`from`, 0-based, and `limit`): the doc
 * with only those lines, plus `total` and `from` so they can ask for the next. Without either, the
 * whole doc, as before.
 */
function window<D extends { lines: unknown[] }>(doc: D, from: string | null, limit: string | null): D | (D & { total: number; from: number }) {
  if (from === null && limit === null) return doc;
  const start = Math.max(0, Math.floor(Number(from)) || 0), n = Math.max(1, Math.min(Math.floor(Number(limit)) || doc.lines.length, 5000));
  return { ...doc, lines: doc.lines.slice(start, start + n), total: doc.lines.length, from: start };
}

export class FileDurableObject {
  doc: Doc = empty();
  base: Doc | null = null;
  secret = new Set<string>();
  commits = 0;
  queue: Promise<unknown> = Promise.resolve();
  claims = new Map<string, Claim>();
  /** Line id -> the claim it is in. */
  claimOf = new Map<string, Claim>();
  /** Claim id -> an agent's claim that ended near its cap, which its holder may not lay again till `until`. */
  rests = new Map<string, Rest>();
  /** Who's waiting in line for lines, first come first. */
  waits: Waiter[] = [];
  /** Waiter id -> its ask that's being held open, to answer with the claim when it's granted. */
  polls = new Map<string, (c: Claim | null) => void>();
  /** A deploy is coming (drain): when it is expected. From then on the file takes no new claims, waiters or leases. Memory only: a restart is the deploy. */
  soon: number | null = null;
  soonTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether its sockets have been told it is draining. */
  told = false;
  /** When the alarm that lets lapsed claims go is set for, as far as this instance knows. */
  alarmAt: number | null = null;
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
      for (const c of ((await ctx.storage.list({ prefix: "claim:" })) as Map<string, Claim>).values()) {
        // A grant window the restart cut short starts again: the waiter never had its turn to take the lines.
        if (c.grant && c.until !== null && c.until < Date.now() + GRANT_MS) { c.until = Date.now() + GRANT_MS; await ctx.storage.put("claim:" + c.id, c); }
        this.index(c);
      }
      this.rests = new Map([...((await ctx.storage.list({ prefix: "rest:" })) as Map<string, Rest>)].map(([k, r]) => [k.slice(5), r]));
      // Each waiter gets WAIT_KEEP_MS from now to ask again; it's been asking all along, as far as it knows.
      const now = Date.now();
      this.waits = [...((await ctx.storage.list({ prefix: "wait:" })) as Map<string, Waiter>).values()].sort((a, b) => a.at - b.at).map((w) => ({ ...w, seen: now }));
      // Cloudflare keeps an alarm through eviction; the desktop and a box lose theirs on restart (a
      // setTimeout), so it's set again from the claims themselves.
      this.alarmAt = (await ctx.storage.getAlarm?.()) ?? null;
      await this.arm();
    });
  }

  /** The alarm: claims that lapsed go, and everyone hears so. */
  async alarm() {
    this.alarmAt = null;
    await this.expire();
  }

  /** Let lapsed claims go (each one an `unclaim`) and quiet waiters leave, then set the alarm for the next lapse. */
  async expire() {
    const now = Date.now();
    for (const c of [...this.claims.values()]) if (c.until !== null && c.until <= now) await this.release(c.id, false);
    await this.serve();
    await this.arm();
  }

  /** Set the alarm for the earliest lapse (or quiet waiter), or clear it when nothing lapses. */
  async arm() {
    let next: number | null = null;
    for (const c of this.claims.values()) if (c.until !== null && (next === null || c.until < next)) next = c.until;
    for (const w of this.waits) if (next === null || w.seen + WAIT_KEEP_MS < next) next = w.seen + WAIT_KEEP_MS;
    if (next === this.alarmAt) return;
    this.alarmAt = next;
    if (next === null) await this.ctx.storage.deleteAlarm?.();
    else await this.ctx.storage.setAlarm(next);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const by = req.headers.get("x-codesplitter-user") ?? "anon";
    const route = url.pathname.split("/").pop();
    const crew = req.headers.get("x-codesplitter-crew") === "1";
    const where = req.headers.get("x-codesplitter-file");
    // How the path takes live edits (#1011), from main's .gitattributes: the Worker reads it for an edit or a claim.
    const live = (req.headers.get("x-codesplitter-live") ?? undefined) as Live | undefined;
    if (where && decodeURIComponent(where) !== JSON.stringify(this.where)) {
      this.where = JSON.parse(decodeURIComponent(where));
      await this.ctx.storage.put("where", this.where);
    }
    const onBranch = req.headers.get("x-codesplitter-branch");
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
      server.serializeAttachment({ user: by, write: req.headers.get("x-codesplitter-write") === "1", live, limitAs: req.headers.get("x-codesplitter-limit-as"), stepAs: req.headers.get("x-codesplitter-step-as") });
      this.presence();
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }
    if (req.method === "GET" && route === "file") return json(window(this.shown(this.doc, crew), url.searchParams.get("from"), url.searchParams.get("limit")));
    if (req.method === "POST" && route === "ops") {
      const b = (await req.json().catch(() => ({}))) as { ops?: unknown; ifRev?: unknown; claim?: unknown; proto?: unknown };
      if (b.proto !== undefined && b.proto !== PROTOCOL) return json(this.stale(), 409);
      const ops = parseOps(b.ops);
      if (typeof ops === "string") return json({ error: ops }, 400);
      if (b.ifRev !== undefined && !Number.isInteger(b.ifRev)) return json({ error: "ifRev: a rev" }, 400);
      if (b.claim !== undefined && typeof b.claim !== "string") return json({ error: "claim: a claim id" }, 400);
      const r = await this.edit(by, ops, b.ifRev as number | undefined, b.claim as string | undefined, live);
      return r.ok ? json({ rev: r.rev, applied: r.applied }) : json(refused(r), 409);
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
      const { lines, private: on } = (await req.json().catch(() => ({}))) as { lines?: unknown; private?: unknown };
      if (typeof on !== "boolean" || !isIds(lines)) return json({ error: "{lines: [line id], private: true|false}, please" }, 400);
      for (const id of lines) on ? this.secret.add(id) : this.secret.delete(id);
      await this.ctx.storage.put("private", [...this.secret]);
      // Each page fetches the file again, and gets it as its reader may see it.
      this.broadcast({ type: "private", lines, private: on });
      return json([...this.secret]);
    }
    if (req.method === "POST" && route === "hidden") {
      // Lines just went private: if the last commit holds text for any of them, git's copy
      // of that commit with them blank (null when there is nothing to take out).
      const { lines } = (await req.json().catch(() => ({}))) as { lines?: unknown };
      if (!isIds(lines) || !this.commits) return json(null);
      const last: Commit | undefined = await this.ctx.storage.get("commit:" + pad10(this.commits));
      if (!last) return json(null);
      const doc = await this.at(last.rev), ids = new Set(lines);
      if (!doc.lines.some((l) => ids.has(l.id) && l.text)) return json(null);
      return json({ content: text(doc), published: text(this.shown(doc, false)) });
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
    // The deploy's call, through the Worker's admin route (drain.ts): { in: seconds } warns, { in: 0 } drains now, { cancel: true } lifts it.
    if (req.method === "POST" && route === "drain") return json(await this.drain((await req.json().catch(() => ({}))) as { in?: unknown; cancel?: unknown }));
    if (req.method === "GET" && route === "claims") return json(this.live());
    if (req.method === "POST" && route === "claims") {
      // Crew only (the Worker checks). Any of the crew may lift any claim: that's how a person steers an agent off lines.
      const b = claimAsk(await req.json().catch(() => null));
      if (typeof b === "string") return json({ error: b }, 400);
      if (b.release) return json({ released: await this.release(b.id ?? "") });
      if (live === "locked") return json({ error: LOCKED }, 409);
      const rank = Number(req.headers.get("x-codesplitter-rank"));
      return this.claim(by, b, req.headers.has("x-codesplitter-rank") && Number.isFinite(rank) ? rank : undefined);
    }
    if (req.method === "POST" && route === "release") {
      const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
      return json({ released: await this.release(typeof id === "string" ? id : "") });
    }
    if (req.method === "POST" && route === "revoke") {
      // Access is checked once, at the upgrade: when it is taken back, the Worker has the sockets of `user` (or of everyone not in `keep`) closed.
      const user = url.searchParams.get("user"), keep = new Set((url.searchParams.get("keep") ?? "").split(",").filter(Boolean));
      let closed = 0;
      for (const ws of this.ctx.getWebSockets()) {
        const who = ws.deserializeAttachment?.()?.user ?? "anon";
        if (user !== null ? who !== user : keep.has(who)) continue;
        try { ws.close(1008, "access removed"); closed++; } catch {}
        this.presence(ws);
      }
      return json({ closed });
    }
    if (req.method === "POST" && route === "wipe") {
      // Its repo was evicted: forget everything.
      const all: Map<string, unknown> = await this.ctx.storage.list();
      await Promise.all([...all.keys()].map((k) => this.ctx.storage.delete(k)));
      [this.doc, this.base, this.commits, this.secret, this.where, this.onBranch, this.snaps, this.trimmed, this.authors] = [empty(), null, 0, new Set(), null, null, [], 0, new Set()];
      this.docs.clear(); this.bases.clear();
      this.claims.clear(); this.claimOf.clear(); this.rests.clear(); this.recent.clear(); this.waits = [];
      for (const answer of this.polls.values()) answer(null);
      this.polls.clear();
      await this.arm();
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
      const { base, branch, resolve, dry, deleter, path, writer, rule } = (await req.json()) as { base: Doc; branch: Doc; resolve?: Resolve; dry?: boolean; deleter?: string; path?: string; writer?: string; rule?: Rule };
      const m = merge(base, branch, this.doc, resolve, deleter, path, writer, rule);
      // Every line settled: check the merged code still builds before it lands.
      if (!m.conflicts.length && path) m.conflicts = lintMerge(path, this.doc, branch, m, resolve);
      // Generated text both sides touched kept main's copy: its command runs once the merge lands.
      // Prose that settled but may say something untrue now goes back as checks for the review (#1254).
      const regen = { ...m.regenerate && { regenerate: m.regenerate }, ...m.checks && { checks: m.checks }, ...m.solved && { solved: m.solved } };
      if (m.conflicts.length || dry || !m.ops.length) return json({ rev: this.doc.rev, ops: m.ops, conflicts: m.conflicts, ...regen }, m.conflicts.length && !dry ? 409 : 200);
      const r = await this.edit(m.by, m.ops);
      return r.ok ? json({ rev: r.rev, ops: m.ops, applied: r.applied, conflicts: [], ...regen }) : json(refused(r), 409);
    }
    if (req.method === "POST" && route === "commit") {
      const { message } = (await req.json().catch(() => ({}))) as { message?: unknown };
      // Commits hash their parent, so they run one at a time.
      const done = this.queue.then(() => this.commit(by, typeof message === "string" ? message.slice(0, 1000) : undefined));
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
    const prev: Commit | undefined = this.commits ? await this.ctx.storage.get("commit:" + pad10(this.commits)) : undefined;
    const commit: Commit = {
      n: this.commits + 1, sha: await sha((prev?.sha ?? "") + "\n" + content), parent: prev?.sha ?? null,
      rev: this.doc.rev, by, at: Date.now(), message: message || "commit",
      writers: await this.writers(prev?.rev ?? 0),
    };
    this.commits = commit.n;
    await Promise.all([this.ctx.storage.put("commit:" + pad10(commit.n), commit), this.ctx.storage.put("commits", this.commits)]);
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
  async edit(by: string | string[], ops: Op[], ifRev?: number, claim?: string, live?: Live) {
    // What stale lines said is read first: from here to the apply, nothing awaits.
    if (typeof by === "string" && ifRev === undefined) ops = this.rebase(ops, await this.startedFrom(ops));
    // The path's policy, on a live edit: a locked file takes none, and on a `line` one an agent claims first.
    const barred = typeof by === "string" ? this.barred(by, ops, live, claim) : null;
    if (barred) return { ok: false as const, rev: this.doc.rev, ...barred };
    // A merge (one author per op) lands whole: claims guard live edits, not a branch coming home.
    const held = typeof by === "string" ? this.held(by, ops, claim) : [];
    if (held.length) {
      // Who holds them and till when, so an agent can work elsewhere and come back after retryAfter.
      const claims = [...new Set(held.map((h) => this.claims.get(h.claim)!))];
      return { ok: false as const, rev: this.doc.rev, conflicts: held, claims, retryAfter: retryAfter(claims) };
    }
    const r = apply(this.doc, ops, by, Date.now(), ifRev);
    if (!r.ok) return { ok: false as const, rev: this.doc.rev, conflicts: r.conflicts };
    if (claim && typeof by === "string") await this.renew(by, claim);
    if (this.claims.size) await this.follow(typeof by === "string" ? by : "", r.applied, claim);
    this.noteAuthors(r.applied.map((a) => a.by));
    await Promise.all([...this.docs.save(this.doc, r.applied.map((a) => a.line)), ...r.applied.map((a) => this.ctx.storage.put("op:" + pad10(a.rev), a))]);
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
    for (const w of this.waits) if (w.who === from) w.who = to;
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
      const m: Map<string, Applied> = await this.ctx.storage.list({ prefix: "op:", start: "op:" + pad10(from), limit: OP_PAGE });
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
    const from = snap === undefined ? this.base ?? empty() : (await new DocStore(this.ctx.storage, "snap:" + pad10(snap)).load()) ?? empty();
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
    await Promise.all([...new DocStore(this.ctx.storage, "snap:" + pad10(rev)).replace(this.doc), this.ctx.storage.put("snaps", this.snaps), this.ctx.storage.put("trimmed", this.trimmed)]);
    if (drop !== null) {
      const gone: Map<string, unknown> = await this.ctx.storage.list({ prefix: "snap:" + pad10(drop) });
      await Promise.all([...gone.keys()].map((k) => this.ctx.storage.delete(k)));
    }
    if (drop !== null || long) this.sweeping = this.sweeping.then(() => this.sweep()).catch(() => {});
  }

  /** Delete the ops history no longer reaches, a page at a time. */
  async sweep() {
    for (;;) {
      const m: Map<string, unknown> = await this.ctx.storage.list({ prefix: "op:", end: "op:" + pad10(this.trimmed + 1), limit: OP_PAGE });
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
    let msg: { type?: unknown; id?: unknown; ops?: unknown; ifRev?: unknown; claim?: unknown; proto?: unknown };
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (!msg || msg.type !== "ops") return;
    const answer = (m: Record<string, unknown>) => { try { ws.send(JSON.stringify({ ...m, id: msg.id })); } catch {} };
    if (msg.proto !== undefined && msg.proto !== PROTOCOL) return answer({ type: "nack", rev: this.doc.rev, ...this.stale() });
    const ops = parseOps(msg.ops);
    if (typeof ops === "string") return answer({ type: "nack", rev: this.doc.rev, error: ops });
    const ifRev = Number.isInteger(msg.ifRev) ? (msg.ifRev as number) : undefined, claim = typeof msg.claim === "string" ? msg.claim : undefined;
    try {
      const who = (ws.deserializeAttachment() ?? {}) as { user?: string; write?: boolean; live?: Live; limitAs?: string | null; stepAs?: string | null };
      if (!who.write) return answer({ type: "nack", error: "no write access" });
      // The limit reads its rules from D1: if that fails, the edit goes through rather than nowhere.
      const over = who.limitAs ? await this.edits.hit(who.limitAs).catch(() => null) : null;
      if (over) return answer({ type: "nack", error: over.error, retryAfter: over.wait });
      const r = await this.edit(who.user ?? "anon", ops, ifRev, claim, who.live);
      answer(r.ok ? { type: "ack", rev: r.rev } : { type: "nack", ...refused(r) });
      if (r.ok && who.stepAs) {
        ws.serializeAttachment({ ...who, stepAs: null });
        await noteStep(this.env, who.stepAs, "code");
      }
    } catch (e) {
      console.error("codeSplitter: socket edit failed", String((e as Error)?.message ?? e));
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

  /** The claims still standing; lapsed ones go (the alarm lets them go too, a moment later at most). */
  live(): Claim[] {
    const now = Date.now();
    for (const c of [...this.claims.values()]) if (c.until !== null && c.until <= now) void this.release(c.id);
    for (const [id, r] of this.rests) if (r.until <= now) { this.rests.delete(id); void this.ctx.storage.delete("rest:" + id); }
    return [...this.claims.values()];
  }

  /** An edit under an agent's claim renews its lease, once it has run down by RENEW_SLACK. */
  async renew(by: string, id: string) {
    const c = this.claims.get(id), now = Date.now();
    if (!c || !c.bot || c.who !== by || c.until === null || c.until <= now) return;
    const until = Math.min(now + LEASE_MS, c.cap ?? Infinity);
    if (until - c.until < RENEW_SLACK) return;
    c.until = until;
    await this.ctx.storage.put("claim:" + c.id, c);
    this.broadcast({ type: "claim", claim: c });
    await this.arm();
  }

  index(c: Claim) {
    this.claims.set(c.id, c);
    if (!c.soft) for (const id of c.lines) this.claimOf.set(id, c);
  }

  /**
   * Lay a claim on lines, or renew one (same id, same holder; lines optional). A person may
   * `extend` an agent's claim past its cap, for another LEASE_CAP_MS. 409 names the claims in
   * the way, and `retryAfter`: seconds till the first of them lapses (null: people's holds).
   * Lines someone is waiting in line for are taken in turn: with `wait`, it joins the line (see `wait`).
   */
  async claim(by: string, b: ClaimAsk, rank?: number) {
    this.live();
    const bot = by.startsWith("agent-"), now = Date.now();
    const old = b.id ? this.claims.get(b.id) : undefined;
    if (old && old.who !== by) {
      if (!(b.extend && !bot && old.bot)) return json({ error: `claim ${b.id} is ${old.who}'s`, claims: [old], retryAfter: retryAfter([old]) }, 409);
      old.cap = now + LEASE_CAP_MS;
      old.until = Math.min(Math.max(old.until ?? 0, now + LEASE_MS), old.cap);
      await this.ctx.storage.put("claim:" + old.id, old);
      this.broadcast({ type: "claim", claim: old });
      await this.arm();
      return json(old);
    }
    const have = new Set(this.doc.lines.map((l) => l.id));
    const lines = [...new Set(b.lines ?? old?.lines ?? this.waits.find((w) => w.id === b.id && w.who === by)?.lines ?? [])].filter((id) => have.has(id));
    if (!lines.length) return json({ error: "lines required: ids of lines in the file" }, 400);
    // An intent keeps nobody off its lines, so nothing's in its way.
    const soft = b.soft ?? old?.soft ?? false, want = new Set(lines);
    // A deploy is coming: no new claims or places in line. Renewals (above, `old`) and soft intents carry on; edits are never refused.
    if (this.draining() && !old && !soft) {
      const place = b.wait ? this.waits.findIndex((w) => w.id === b.id && w.who === by) + 1 : 0;
      if (place) return json({ queued: true, id: b.id, place, waiting: this.waits.length, draining: true, retryAfter: UPDATE_RETRY_S }, 202);
      return json({ ...this.stale(), draining: true }, 409);
    }
    // An agent whose claim just ended at or near its cap can't lay a fresh one (and a fresh cap) on those lines straight away.
    const rest = old || soft ? undefined : [...this.rests.values()].filter((r) => r.who === by && r.lines.some((id) => want.has(id))).sort((a, b) => b.until - a.until)[0];
    if (rest) return json({ error: `@${by} just held these lines for ${LEASE_CAP_MS / 60_000} minutes: others get a turn first`, retryAfter: Math.max(1, Math.ceil((rest.until - now) / 1000)) }, 409);
    if (!soft) {
      const clash = [...new Set(lines.map((id) => this.claimOf.get(id)).filter((c) => c && c !== old))] as Claim[];
      // People steer agents: a person's hold doesn't wait behind agents in line for free lines.
      const ahead = bot || b.wait ? this.ahead(b.id, want) : [];
      if (clash.length || ahead.length) {
        if (b.wait) return this.wait(by, b, lines, rank);
        if (clash.length) return json({ error: `held by ${clash.map((c) => "@" + c.who).join(", ")}`, claims: clash, retryAfter: retryAfter(clash) }, 409);
        const blocking = this.blocking(ahead);
        return json({ error: `${ahead.length} waiting in line for these lines: claim with wait to join them`, queued: ahead.length, claims: blocking, retryAfter: retryAfter(blocking) }, 409);
      }
    }
    // An agent's claim is a lease (LEASE_MS unless it asks for less or more, never past its cap);
    // a person's hold stands until they lift it, unless they give it a ttl.
    const ttl = b.ttl === undefined || (bot && b.ttl === null) ? (bot ? LEASE_MS : null) : Math.max(0, Number(b.ttl) || 0);
    // Its cap stays where it was laid: only a person moves it (above).
    const cap = bot ? old?.cap ?? now + LEASE_CAP_MS : undefined;
    const until = ttl === null ? null : Math.min(now + ttl, cap ?? Infinity);
    const task = b.task ?? old?.task;
    const c: Claim = { id: b.id ?? newId(now), who: by, bot, lines, ...(task ? { task: task.slice(0, 200) } : {}), at: old?.at ?? now, until, ...(cap !== undefined && { cap }), ...(soft && { soft: true as const }) };
    if (old) for (const id of old.lines) if (this.claimOf.get(id) === old) this.claimOf.delete(id);
    this.index(c);
    // A waiter whose lines came free as it asked again takes them like this.
    if (await this.unwait(c.id)) this.answer(c.id, c);
    await this.ctx.storage.put("claim:" + c.id, c);
    this.broadcast({ type: "claim", claim: c });
    if (soft !== !!old?.soft || !old) this.noteHeld(c, !soft);
    // Lines it gave up (fewer of them, or it went soft) go to whoever's waiting.
    if (old) await this.serve();
    await this.arm();
    return json(c, old ? 200 : 201);
  }

  /** The answer to a writer that met a file on another build, or one about to be replaced. */
  stale() { return { error: UPDATING, updating: true, retryAfter: UPDATE_RETRY_S }; }

  /** Whether the deploy's warning has run out: from then on the file takes no new claims, leases or places in line. */
  draining() { return this.soon !== null && Date.now() >= this.soon; }

  /**
   * The deploy's call: `in` seconds of warning ({t:"deploy-soon", at}) and then {t:"draining"}; 0 drains now.
   * `cancel` lifts it (the deploy failed or was called off). Memory only: the restart a deploy brings clears it.
   * Edits keep applying throughout; draining flushes what's pending to storage and answers held-open waiters
   * (they keep their places, in storage, for the next build).
   */
  async drain(b: { in?: unknown; cancel?: unknown }) {
    if (this.soonTimer) clearTimeout(this.soonTimer);
    this.soonTimer = null;
    if (b.cancel) {
      if (this.told || this.soon !== null) this.broadcast({ t: "drain-over" });
      this.soon = null; this.told = false;
      return { draining: false };
    }
    const wait = Math.max(0, Math.min(Number(b.in) || 0, 600)) * 1000, now = Date.now();
    const at = this.soon === null ? now + wait : Math.min(this.soon, now + wait);
    if (this.soon === null) this.broadcast({ t: "deploy-soon", at });
    this.soon = at;
    if (at > now) this.soonTimer = setTimeout(() => { void this.begin(); }, at - now);
    else await this.begin();
    return { draining: this.draining(), at, sockets: this.ctx.getWebSockets().length, claims: this.claims.size, waiting: this.waits.length };
  }

  /** The warning ran out: tell the sockets once, flush, and let held-open waiters ask again later. */
  async begin() {
    if (this.told) return;
    this.told = true;
    this.broadcast({ t: "draining" });
    for (const id of [...this.polls.keys()]) this.answer(id, null);
    await this.logging.catch(() => {});
    await this.ctx.storage.sync?.();
  }

  /** Waiters ahead of waiter `id` (or all of them, for someone not in line) who want any of `want`. */
  ahead(id: string | undefined, want: Set<string>) {
    const i = this.waits.findIndex((w) => w.id === id);
    return (i < 0 ? this.waits : this.waits.slice(0, i)).filter((w) => w.lines.some((l) => want.has(l)));
  }

  /** The claims holding any of these waiters' lines. */
  blocking(waits: Waiter[]) {
    return [...new Set(waits.flatMap((w) => w.lines.map((id) => this.claimOf.get(id))).filter(Boolean))] as Claim[];
  }

  /**
   * Get in line for lines that are held, or that others are already in line for, and wait for them
   * up to `timeout` seconds (WAIT_POLL_MS at most): 201 with the claim when it's granted meanwhile,
   * else 202 `{queued, id, place}`, and it asks again with that id at once to keep its place.
   * Someone holding lines here may not wait (nor, the Worker sees to it, in another file): holding
   * some lines while waiting for others is how two waiters end up waiting on each other for ever.
   */
  async wait(by: string, b: ClaimAsk, lines: string[], rank?: number) {
    const holding = [...this.claims.values()].filter((c) => c.who === by && !c.soft);
    if (holding.length) return json({ error: `you hold lines here (${holding.map((c) => c.id).join(", ")}): finish with them and let go before you wait for more`, claims: holding }, 409);
    const now = Date.now();
    let w = this.waits.find((x) => x.id === b.id);
    if (w && w.who !== by) return json({ error: `${b.id} is @${w.who}'s place in line` }, 409);
    if (!w) {
      w = { id: b.id ?? newId(now), who: by, lines, ...(b.task ? { task: b.task.slice(0, 200) } : {}), at: now, seen: now, ...(rank !== undefined && { rank }) };
      // Under a ranked policy (codesplitter-order=rank) it steps ahead of waiters of lower rank, behind its equals.
      const lower = rank === undefined ? -1 : this.waits.findIndex((x) => (x.rank ?? 0) < rank);
      if (lower < 0) this.waits.push(w); else this.waits.splice(lower, 0, w);
      await this.ctx.storage.put("wait:" + w.id, w);
    } else {
      w.seen = now;
      if (b.lines && lines.join() !== w.lines.join()) { w.lines = lines; await this.ctx.storage.put("wait:" + w.id, w); }
    }
    await this.arm();
    const id = w.id, ms = Math.min(WAIT_POLL_MS, Math.max(0, (b.timeout ?? WAIT_POLL_MS / 1000) * 1000));
    const got = ms ? await new Promise<Claim | null>((done) => {
      this.answer(id, null);
      const t = setTimeout(() => { if (this.polls.get(id) === answer) this.polls.delete(id); done(null); }, ms);
      const answer = (c: Claim | null) => { clearTimeout(t); done(c); };
      this.polls.set(id, answer);
    }) : null;
    if (got) return json(got, 201);
    const still = this.waits.find((x) => x.id === id);
    if (!still) {
      // Granted as the ask ended, or it left the line (released, or the file was wiped).
      const c = this.claims.get(id);
      return c?.who === by ? json(c, 201) : json({ error: "no longer in line: claim again" }, 409);
    }
    still.seen = Date.now();
    const place = this.waits.indexOf(still) + 1;
    return json({ queued: true, id, place, waiting: this.waits.length, claims: this.blocking([still, ...this.ahead(id, new Set(still.lines))]) }, 202);
  }

  /** Answer the ask a waiter is holding open, if it is. */
  answer(id: string, c: Claim | null) {
    const done = this.polls.get(id);
    if (!done) return;
    this.polls.delete(id);
    done(c);
  }

  /** Take a waiter out of line. False if it wasn't in it. */
  async unwait(id: string) {
    const i = this.waits.findIndex((w) => w.id === id);
    if (i < 0) return false;
    this.waits.splice(i, 1);
    await this.ctx.storage.delete("wait:" + id);
    return true;
  }

  /**
   * Grant lines to whoever's waiting for them, first come first: a waiter goes once none of its
   * lines is held and nobody ahead of it wants any of them. Still asking, it gets a claim like any
   * other; not, it gets GRANT_MS to take it (claiming again by id), and then it lapses to the next
   * in line. Waiters whose lines are all gone, or that stopped asking, leave the line.
   */
  async serve() {
    // A draining file grants nothing new: waiters keep their places (they're in storage) for the next build to serve.
    if (!this.waits.length || this.draining()) return;
    const now = Date.now(), have = new Set(this.doc.lines.map((l) => l.id)), spoken = new Set<string>();
    for (const w of [...this.waits]) {
      if (!this.waits.includes(w)) continue;
      w.lines = w.lines.filter((id) => have.has(id));
      const asking = this.polls.has(w.id);
      if (!w.lines.length || (!asking && w.seen + WAIT_KEEP_MS <= now)) { await this.unwait(w.id); this.answer(w.id, null); continue; }
      const free = w.lines.every((id) => !this.claimOf.has(id) && !spoken.has(id));
      for (const id of w.lines) spoken.add(id);
      if (!free) continue;
      const bot = w.who.startsWith("agent-");
      const c: Claim = { id: w.id, who: w.who, bot, lines: w.lines, ...(w.task ? { task: w.task } : {}), at: now, until: asking ? (bot ? now + LEASE_MS : null) : now + GRANT_MS, ...(bot && { cap: now + LEASE_CAP_MS }), ...(!asking && { grant: true as const }) };
      this.index(c);
      await this.unwait(w.id);
      await this.ctx.storage.put("claim:" + c.id, c);
      this.broadcast({ type: "claim", claim: c });
      this.broadcast({ type: "grant", claim: c });
      this.noteHeld(c, true);
      this.answer(c.id, c);
    }
  }

  /**
   * Main's copy keeps D1's `held` rows in step with its claims that keep others off (not intents),
   * so the Worker can refuse `wait` to someone holding lines in another file.
   */
  noteHeld(c: Claim, on: boolean) {
    if (!this.where || !this.env.DB) return;
    const [owner, repo, path] = this.where;
    this.logging = this.logging.then(() => on
      ? this.env.DB.prepare("INSERT OR REPLACE INTO held (owner, repo, path, id, who) VALUES (?, ?, ?, ?, ?)").bind(owner, repo, path, c.id, c.who).run()
      : this.env.DB.prepare("DELETE FROM held WHERE owner = ? AND repo = ? AND path = ? AND id = ?").bind(owner, repo, path, c.id).run()).catch(() => {});
  }

  /**
   * Let a claim go, however it ends: lapsed, released or lifted, and its lines go to whoever's
   * waiting. If it was an agent's and it ends within a lease of its cap, its holder rests: it may
   * not claim those lines again for REST_MS, so letting go just before the cap doesn't buy a fresh
   * one (#966). Releasing a place in line leaves the line.
   */
  async release(id: string, rearm = true) {
    const c = this.claims.get(id);
    if (!c) {
      if (!(await this.unwait(id))) return false;
      this.answer(id, null);
      if (rearm) { await this.serve(); await this.arm(); }
      return true;
    }
    this.claims.delete(id);
    for (const l of c.lines) if (this.claimOf.get(l) === c) this.claimOf.delete(l);
    // The rest is in memory before the first await: `live()` doesn't wait for this, and a claim checks rests right after.
    const now = Date.now(), rest = c.bot && !c.soft && c.cap !== undefined && c.lines.length && now >= c.cap - LEASE_MS;
    if (rest) this.rests.set(c.id, { who: c.who, lines: c.lines, until: now + REST_MS });
    await this.ctx.storage.delete("claim:" + id);
    if (rest) await this.ctx.storage.put("rest:" + c.id, this.rests.get(c.id));
    this.broadcast({ type: "unclaim", id });
    if (!c.soft) this.noteHeld(c, false);
    await this.serve();
    if (rearm) await this.arm();
    return true;
  }

  /**
   * What each stale `set` started from, keyed `line@rev`: the line's text in the op at its base
   * rev, or in main's doc when this branch forked. Missing once history is trimmed: that set stays stale.
   */
  async startedFrom(ops: Op[]) {
    const out = new Map<string, string>();
    for (const op of ops) {
      if (op.kind !== "set" || this.doc.lines.find((l) => l.id === op.line)?.rev === op.base) continue;
      const a: Applied | undefined = op.base > this.trimmed ? await this.ctx.storage.get("op:" + pad10(op.base)) : undefined;
      const was = a?.line === op.line && a.op.kind !== "delete" ? a.op.text : this.base?.lines.find((l) => l.id === op.line && l.rev === op.base)?.text;
      if (was !== undefined) out.set(`${op.line}@${op.base}`, was);
    }
    return out;
  }

  /**
   * A stale `set` (someone wrote the line since its `base`) rewritten onto the line as it is now,
   * word by word, when the two edits' words don't overlap (#928): both land, blamed on the sender,
   * with no retry. Otherwise it stays stale and the batch is a 409 as ever. Code-strict (mergeWords).
   */
  rebase(ops: Op[], from: Map<string, string>) {
    if (!from.size) return ops;
    const touched = ops.map((op) => op.kind === "insert" ? "" : op.line);
    return ops.map((op) => {
      if (op.kind !== "set") return op;
      const was = from.get(`${op.line}@${op.base}`), now = this.doc.lines.find((l) => l.id === op.line);
      // A batch that touches the line twice is past rebasing.
      if (was === undefined || !now || now.rev === op.base || touched.filter((id) => id === op.line).length > 1) return op;
      // Nothing left to add (the same edit sent again): stale, not a no-op write.
      const text = mergeWords(was, now.text, op.text);
      return text === null || text === now.text ? op : { ...op, text, base: now.rev };
    });
  }

  /** The ops that land on someone else's claim, as conflicts. An insert lands on the line it goes after. Intents keep nobody off. */
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

  /**
   * What the path's live policy refuses (#1011): every op on a `locked` file, and on a `line` one,
   * an agent's op on a line outside its own claim (named with `claim`), so it waits in line first.
   * A person's edit isn't held. An insert needs the line it goes after, or at the top the first line.
   */
  barred(by: string, ops: Op[], live?: Live, claim?: string) {
    if (live === "locked") return { error: LOCKED, conflicts: ops.map((_, index) => ({ index, reason: "locked" })) };
    if (live !== "line" || !by.startsWith("agent-") || !this.doc.lines.length) return null;
    const now = Date.now(), first = this.doc.lines[0]!.id;
    const out = ops.flatMap((op, index) => {
      const c = this.claimOf.get(op.kind === "insert" ? op.after ?? first : op.line);
      return c && c.who === by && c.id === claim && (c.until === null || c.until > now) ? [] : [{ index, reason: "claim first" }];
    });
    return out.length ? { error: "this file takes an agent's edits on lines it has claimed: claim_lines (with wait to get in line), then edit with that claim", conflicts: out } : null;
  }

  /** Keep claims (intents too) on the lines they cover: the holder's inserts inside join, deleted lines leave. */
  async follow(by: string, applied: Applied[], claim?: string) {
    const changed = new Set<Claim>();
    // Intents may overlap, so a line can be in several.
    const softOf = new Map<string, Claim[]>();
    for (const c of this.claims.values()) if (c.soft) for (const id of c.lines) softOf.set(id, [...softOf.get(id) ?? [], c]);
    const on = (id: string) => [this.claimOf.get(id), ...softOf.get(id) ?? []].filter(Boolean) as Claim[];
    for (const a of applied) {
      if (a.op.kind === "delete") {
        for (const c of on(a.line)) { c.lines = c.lines.filter((id) => id !== a.line); changed.add(c); }
        this.claimOf.delete(a.line);
      } else if (a.op.kind === "insert" && a.op.after) {
        for (const c of on(a.op.after)) {
          if (c.who !== by || (c.bot && claim !== c.id)) continue;
          c.lines.push(a.line); changed.add(c);
          if (c.soft) softOf.set(a.line, [...softOf.get(a.line) ?? [], c]);
          else this.claimOf.set(a.line, c);
        }
      }
    }
    for (const c of changed) {
      if (!c.lines.length) await this.release(c.id);
      else { await this.ctx.storage.put("claim:" + c.id, c); this.broadcast({ type: "claim", claim: c }); }
    }
  }
}

/** What `claim_lines` takes: see `claim` and `wait`. `timeout` is seconds. */
type ClaimAsk = { id?: string; lines?: string[]; task?: string; ttl?: number | null; extend?: boolean; soft?: boolean; wait?: boolean; timeout?: number };

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_OPS && v.every((x) => typeof x === "string" && x.length <= 40);
/** `v` as a claim request, or what's wrong with it: ids and the task are short text, lines are ids, times are seconds. */
function claimAsk(v: unknown): (ClaimAsk & { release?: boolean }) | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "a claim is {lines, task?, ttl?, …}";
  const b = v as Record<string, unknown>;
  if (b.id !== undefined && !(typeof b.id === "string" && b.id.length <= 40)) return "id: a claim id";
  if (b.lines !== undefined && !isIds(b.lines)) return "lines: a list of line ids";
  if (b.task !== undefined && typeof b.task !== "string") return "task: text";
  if (b.ttl !== undefined && b.ttl !== null && !(typeof b.ttl === "number" && Number.isFinite(b.ttl))) return "ttl: seconds";
  if (b.timeout !== undefined && !(typeof b.timeout === "number" && Number.isFinite(b.timeout))) return "timeout: seconds";
  for (const k of ["extend", "soft", "wait", "release"]) if (b[k] !== undefined && typeof b[k] !== "boolean") return `${k}: true or false`;
  return b as ClaimAsk & { release?: boolean };
}

const newId = (now: number) => `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** What a refused edit answers: its conflicts, and when lines are held, the claims in the way and when to try again. */
const refused = (r: { rev: number; conflicts: unknown[]; claims?: Claim[]; retryAfter?: number | null; error?: string }) =>
  ({ ...(r.error && { error: r.error }), rev: r.rev, conflicts: r.conflicts, ...(r.claims && { claims: r.claims, retryAfter: r.retryAfter }) });

/** A `codesplitter-live=locked` file (lockfiles, by default) changes by regenerating it or by a push, never line by line. */
const LOCKED = "this file is locked (codesplitter-live=locked): regenerate it or push it, it takes no live edits";

/** Seconds till the first of these claims lapses, at least 1; null when they're all people's holds, which stand till lifted. */
function retryAfter(claims: Claim[]): number | null {
  const until = claims.map((c) => c.until).filter((u): u is number => u !== null);
  return until.length ? Math.max(1, Math.ceil((Math.min(...until) - Date.now()) / 1000)) : null;
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

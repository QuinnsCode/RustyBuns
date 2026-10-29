// One Durable Object per person: their friends, who of them is on and in which app, and their notifications.
// The user directory stays in D1; a hub only knows the people it has been introduced to.
//
// Nobody reaches a hub directly. The Worker checks an app's token (handle.ts) and calls it as
//   /socket?id=&name=&app=   a page's live socket: the state on connect and after every change, `status` and ops in
//   /op { who, op }          one op from an app's server or page, answered with the state
// and hubs call each other at /peer { from, kind, ... } when something between two people changes.
//
// Price: a hub wakes for a socket opening or closing, a frame, an op, or a friend's change, and sleeps between
// (hibernating sockets, no alarms). A status change costs one request per friend; nothing runs while people idle.
import { arr, check, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { appOf, returnTo } from "./apps.ts";
import { json, loopbackOn, type D1 } from "./env.ts";

export const MAX_FRIENDS = 200, MAX_ASKS = 100, MAX_NOTES = 50, MAX_SOCKETS = 10;

const Id = str(200, { min: 1 });
const Name = str(200);
const Person = obj({ id: Id, name: Name });
export type Person = Of<typeof Person>;
/** One app a person has open, and what they say they're doing there ("hiding in the hedge"). */
const Presence = obj({ app: str(64), doing: str(80, { min: 0 }) });
export type Presence = Of<typeof Presence>;

/** What a page or server may ask its own hub. */
export const Op = obj({
  op: oneOf(["state", "befriend", "accept", "drop", "notify", "clear", "status"]),
  id: opt(Id), email: opt(str(320)), text: opt(str(280)), link: opt(str(2000)), doing: opt(str(80, { min: 0 })),
});
export type Op = Of<typeof Op>;

const Who = obj({ id: Id, name: Name, app: str(64) });
type Who = Of<typeof Who>;
const OpCall = obj({ who: Who, op: Op });
const Peer = obj({
  from: Person, kind: oneOf(["ask", "accept", "drop", "presence", "note"]),
  presence: opt(arr(Presence, MAX_SOCKETS)), app: opt(str(64)), text: opt(str(280)), link: opt(str(2000)),
});
type Peer = Of<typeof Peer>;

export interface Friend extends Person { since: number; presence: Presence[] }
export interface Asked extends Person { at: number }
export interface Note { key: string; at: number; kind: "ask" | "accept" | "app"; from: Person; app?: string; text?: string; link?: string }
export interface HubState { me: Person | null; friends: Friend[]; incoming: Asked[]; outgoing: Asked[]; notes: Note[] }
export type HubOut = { t: "state" } & HubState | { t: "error"; error: string };

interface Storage {
  get<T>(k: string): Promise<T | undefined>;
  put(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<boolean>;
  list<T>(o: { prefix: string }): Promise<Map<string, T>>;
}
interface HubCtx extends RoomCtx { storage: Storage }
interface Stub { fetch(req: Request): Promise<Response> }
/** The HUB binding: one hub per user id. */
export interface Hubs { idFromName(name: string): unknown; get(id: unknown): Stub }
export interface HubEnv { HUB?: Hubs; DB: D1; LOOPBACK_RETURNS?: string }

/** A person's hub, by their eqosys user id. */
export const hubOf = (hubs: Hubs, id: string): Stub => hubs.get(hubs.idFromName(id));

/** One tab: the app it is in, and what its page last said they're doing there. */
type Attach = { app: string; doing: string };

export class Hub {
  private sockets: Sockets<Attach, HubOut>;

  constructor(private ctx: HubCtx, private env: HubEnv) {
    this.sockets = new Sockets<Attach, HubOut>(ctx, { maxBytes: 4000, rate: 5, burst: 20 });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/socket") {
      const who = check(Who, Object.fromEntries(url.searchParams));
      if (!who) return json({ error: "who?" }, 400);
      await this.meet(who);
      const { server, response } = this.sockets.upgrade({ app: who.app, doing: "" });
      // Past MAX_SOCKETS, the oldest tab goes.
      for (const old of this.sockets.open().slice(0, -MAX_SOCKETS)) try { old.close(4000, "too many tabs"); } catch { /* closing */ }
      this.sockets.send(server, { t: "state", ...await this.state() });
      await this.presenceChanged();
      return response;
    }
    const body: unknown = await req.json().catch(() => null);
    if (url.pathname === "/op") {
      const call = check(OpCall, body);
      if (!call) return json({ error: "send { who, op }" }, 400);
      await this.meet(call.who);
      const error = await this.act(call.who, call.op);
      return error ? json({ error }, 400) : json(await this.state());
    }
    if (url.pathname === "/peer") {
      const p = check(Peer, body);
      if (!p) return json({ error: "bad peer message" }, 400);
      await this.peer(p);
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw);
    const op = frame && check(Op, frame.value);
    const at = this.sockets.who(ws);
    const me = await this.ctx.storage.get<Person>("me");
    if (!op || !at || !me) return;
    if (op.op === "status") {
      this.sockets.attach(ws, { ...at, doing: op.doing ?? "" });
      await this.presenceChanged();
      return;
    }
    const error = await this.act({ ...me, app: at.app }, op);
    if (error) this.sockets.send(ws, { t: "error", error });
  }

  /** One key at a time: the edge takes a list, the in-process host's storage doesn't. */
  private async forget(keys: string[]) { for (const k of keys) await this.ctx.storage.delete(k); }

  async webSocketClose(ws: RoomSocket) { await this.presenceChanged(ws); }
  async webSocketError(ws: RoomSocket) { await this.presenceChanged(ws); }

  /** The person this hub belongs to, as their latest token names them. */
  private async meet(who: Who) {
    const me = await this.ctx.storage.get<Person>("me");
    if (me?.id !== who.id || me.name !== who.name) await this.ctx.storage.put("me", { id: who.id, name: who.name });
  }

  /** One op from the owner: an error to show them, or null when it went through (then every tab gets the new state). */
  private async act(who: Who, op: Op): Promise<string | null> {
    const s = this.ctx.storage, me: Person = { id: who.id, name: who.name };
    const done = async (e: string | null = null) => { if (!e) await this.push(); return e; };
    switch (op.op) {
      case "state": return null;
      case "status": return "status is for a socket";
      case "befriend": {
        const to = op.email ? await this.env.DB.prepare('SELECT id, name FROM "user" WHERE lower(email) = lower(?)').bind(op.email.trim()).first<Person>() : null;
        // Nobody by that email: the same answer as a request sent, so an email is never confirmed as an account.
        if (!to || to.id === me.id || await s.get(`f:${to.id}`)) return done();
        if (await s.get(`in:${to.id}`)) return this.act(who, { op: "accept", id: to.id });
        if ((await s.list({ prefix: "out:" })).size >= MAX_ASKS) return "too many requests waiting: wait for some answers";
        await s.put(`out:${to.id}`, { ...to, at: Date.now() } satisfies Asked);
        await this.send(to.id, { from: me, kind: "ask" });
        return done();
      }
      case "accept": {
        const asked = op.id ? await s.get<Asked>(`in:${op.id}`) : undefined;
        if (!asked) return "no request from them";
        if ((await s.list({ prefix: "f:" })).size >= MAX_FRIENDS) return `${MAX_FRIENDS} friends is the most`;
        await s.delete(`in:${asked.id}`);
        await s.put(`f:${asked.id}`, { id: asked.id, name: asked.name, since: Date.now(), presence: [] } satisfies Friend);
        await this.send(asked.id, { from: me, kind: "accept", presence: await this.mine() });
        return done();
      }
      case "drop": {
        if (!op.id) return "drop whom?";
        await this.forget([`f:${op.id}`, `in:${op.id}`, `out:${op.id}`]);
        await this.send(op.id, { from: me, kind: "drop" });
        return done();
      }
      case "notify": {
        // Only to a friend, and only words and a link on the app's own origin.
        if (!op.id || !await s.get(`f:${op.id}`)) return "only a friend can be notified";
        if (!op.text) return "say something";
        const app = appOf(who.app);
        if (op.link && (!app || !returnTo(app, op.link, loopbackOn(this.env)))) return "a link must be on the app's own site";
        await this.send(op.id, { from: me, kind: "note", app: who.app, text: op.text, ...(op.link ? { link: op.link } : {}) });
        return null;
      }
      case "clear": {
        await this.forget([...(await s.list({ prefix: "n:" })).keys()]);
        return done();
      }
    }
  }

  /** Another hub telling this one about its owner. Only a hub can call /peer: the Worker never routes there. */
  private async peer(p: Peer) {
    const s = this.ctx.storage, me = await s.get<Person>("me");
    const id = p.from.id;
    if (!me || id === me.id) return;
    const friend = await s.get<Friend>(`f:${id}`);
    switch (p.kind) {
      case "ask": {
        if (friend) return;
        // They asked while this side was asking them: that is a yes both ways.
        if (await s.get(`out:${id}`)) {
          await s.delete(`out:${id}`);
          await s.put(`f:${id}`, { ...p.from, since: Date.now(), presence: [] } satisfies Friend);
          await this.send(id, { from: me, kind: "accept", presence: await this.mine() });
          break;
        }
        if ((await s.list({ prefix: "in:" })).size >= MAX_ASKS) return;
        await s.put(`in:${id}`, { ...p.from, at: Date.now() } satisfies Asked);
        await this.note({ kind: "ask", from: p.from });
        break;
      }
      case "accept": {
        // Only an answer to this side's own request makes a friend.
        if (!await s.get(`out:${id}`)) return;
        await s.delete(`out:${id}`);
        await s.put(`f:${id}`, { ...p.from, since: Date.now(), presence: p.presence ?? [] } satisfies Friend);
        await this.note({ kind: "accept", from: p.from });
        const presence = await this.mine();
        if (presence.length) await this.send(id, { from: me, kind: "presence", presence });
        break;
      }
      case "drop":
        await this.forget([`f:${id}`, `in:${id}`, `out:${id}`]);
        break;
      case "presence":
        if (!friend) return;
        await s.put(`f:${id}`, { ...friend, name: p.from.name, presence: p.presence ?? [] } satisfies Friend);
        break;
      case "note":
        if (!friend || !p.text) return;
        await this.note({ kind: "app", from: p.from, ...(p.app ? { app: p.app } : {}), text: p.text, ...(p.link ? { link: p.link } : {}) });
        break;
    }
    await this.push();
  }

  private async note(n: Omit<Note, "key" | "at">) {
    const s = this.ctx.storage, at = Date.now();
    const key = `n:${String(at).padStart(15, "0")}:${crypto.randomUUID().slice(0, 8)}`;
    await s.put(key, { ...n, key, at } satisfies Note);
    const all = [...(await s.list({ prefix: "n:" })).keys()];
    if (all.length > MAX_NOTES) await this.forget(all.slice(0, all.length - MAX_NOTES));
  }

  /** What this person has open right now, one entry an app, from their open sockets (less one that is closing). */
  private async mine(closing?: RoomSocket): Promise<Presence[]> {
    const by = new Map<string, string>();
    for (const ws of this.sockets.open()) {
      const a = ws === closing ? null : this.sockets.who(ws);
      if (a && (!by.has(a.app) || a.doing)) by.set(a.app, a.doing);
    }
    return [...by].map(([app, doing]) => ({ app, doing })).sort((x, y) => x.app.localeCompare(y.app));
  }

  /** Tell every friend when what this person has open changed; nothing when it didn't. */
  private async presenceChanged(closing?: RoomSocket) {
    const s = this.ctx.storage, me = await s.get<Person>("me");
    const now = await this.mine(closing);
    if (!me || JSON.stringify(now) === JSON.stringify((await s.get<Presence[]>("presence")) ?? [])) return;
    await s.put("presence", now);
    const friends = [...(await s.list<Friend>({ prefix: "f:" })).values()];
    await Promise.all(friends.map((f) => this.send(f.id, { from: me, kind: "presence", presence: now })));
  }

  private async send(to: string, p: Peer) {
    if (!this.env.HUB) return;
    await hubOf(this.env.HUB, to).fetch(new Request("https://hub/peer", { method: "POST", body: JSON.stringify(p) }))
      .catch(() => { /* their hub is down: they hear nothing, the same as a dropped socket frame */ });
  }

  async state(): Promise<HubState> {
    const s = this.ctx.storage;
    const vals = async <T,>(prefix: string) => [...(await s.list<T>({ prefix })).values()];
    return {
      me: (await s.get<Person>("me")) ?? null,
      friends: (await vals<Friend>("f:")).sort((a, b) => a.name.localeCompare(b.name)),
      incoming: await vals<Asked>("in:"), outgoing: await vals<Asked>("out:"),
      notes: (await vals<Note>("n:")).reverse(),
    };
  }

  /** The state to every open tab. */
  private async push() { this.sockets.broadcast({ t: "state", ...await this.state() }); }
}

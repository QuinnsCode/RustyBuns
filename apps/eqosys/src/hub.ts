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
import { arr, check, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { appOf, onSite } from "./apps.ts";
import { json, loopbackOn, sha256, type D1 } from "./env.ts";

export const MAX_FRIENDS = 200, MAX_ASKS = 100, MAX_NOTES = 50, MAX_SOCKETS = 10;
/** Friend requests by email an hour: plenty for adding friends, too few to walk a list of addresses for accounts. */
export const LOOKUPS_PER_HOUR = 20;

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

export const Who = obj({ id: Id, name: Name, app: str(64) });
export type Who = Of<typeof Who>;
const OpCall = obj({ who: Who, op: Op });
// `to` is whose hub this is for: a hub nobody has opened yet learns who it belongs to from the first message it gets.
const Peer = obj({
  from: Person, to: Person, kind: oneOf(["ask", "accept", "drop", "presence", "note"]),
  presence: opt(arr(Presence, MAX_SOCKETS)), app: opt(str(64)), text: opt(str(280)), link: opt(str(2000)),
});
type Peer = Of<typeof Peer>;

const At = num(0, 1e14);
const Friend = obj({ id: Id, name: Name, since: At, presence: arr(Presence, MAX_SOCKETS) });
export type Friend = Of<typeof Friend>;
const Asked = obj({ id: Id, name: Name, at: At });
export type Asked = Of<typeof Asked>;
/**
 * An ask this side sent, as the hub keeps it: shown as the email typed (`id` an opaque `e_` hash of it), whether or not anyone has
 * that email, so a request never says an account exists. `to` is the account, when there is one, and never leaves the hub; the
 * row is keyed by it so their answer finds it. Their name shows once they accept.
 */
type Out = Asked & { to?: Person };
const emailId = async (email: string) => `e_${(await sha256(email.trim().toLowerCase())).slice(0, 16)}`;
const Note = obj({ key: str(64), at: At, kind: oneOf(["ask", "accept", "app"]), from: Person, app: opt(str(64)), text: opt(str(280)), link: opt(str(2000)) });
export type Note = Of<typeof Note>;
/** Everything a person's hub knows, the way every page and app gets it. The lists are capped by the hub; the guard only reads them. */
export const HubState = obj({ me: nul(Person), friends: arr(Friend, 1000), incoming: arr(Asked, 1000), outgoing: arr(Asked, 1000), notes: arr(Note, 1000) });
export type HubState = Of<typeof HubState>;
export type HubOut = { t: "state" } & HubState | { t: "error"; error: string };
const Err = obj({ error: str(500) });

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

/** Wipe a person's hub, telling their friends: the last step of deleting the account. */
/** Close the person's hub tabs that `app`'s tokens opened ("*": every app's). */
export const hubOut = (hubs: Hubs, id: string, app: string) => hubOf(hubs, id).fetch(new Request(`https://hub/out?${new URLSearchParams({ app })}`, { method: "POST", body: "{}" }));
export const hubErase = (hubs: Hubs, id: string) => hubOf(hubs, id).fetch(new Request("https://hub/erase", { method: "POST", body: "{}" }));

/** Tell a person's friends (one note each) something an app did for them. Quiet when it fails: the unlock stands. */
export const hubAnnounce = (hubs: Hubs, who: Who, text: string) =>
  hubOf(hubs, who.id).fetch(new Request("https://hub/announce", { method: "POST", body: JSON.stringify({ who, text }) })).catch(() => null);

/** A person's hub, by their eqosys user id. */
export const hubOf = (hubs: Hubs, id: string): Stub => hubs.get(hubs.idFromName(id));

/** The Worker asking someone's own hub one op for them (a token's app, or the friends page signed in by cookie): their state, or the error to show them. */
export async function hubAsk(hubs: Hubs, who: Who, op: Op): Promise<HubState | { error: string }> {
  const res = await hubOf(hubs, who.id).fetch(new Request("https://hub/op", { method: "POST", body: JSON.stringify({ who, op }) }));
  const body: unknown = await res.json().catch(() => null);
  return check(HubState, body) ?? { error: check(Err, body)?.error ?? "the hub didn't answer" };
}

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
    // Account deletion (members.ts): tell everyone who knows this person they are gone, close their tabs, forget it all.
    if (url.pathname === "/erase") {
      await this.erase();
      return json({ ok: true });
    }
    // A sign-out everywhere, or an app's tokens revoked (members.ts): the tabs those tokens opened close; a cut token can't open another.
    if (url.pathname === "/out") {
      const app = url.searchParams.get("app") ?? "*";
      for (const ws of this.sockets.open()) if (app === "*" || this.sockets.who(ws)?.app === app) try { ws.close(4003, "signed out"); } catch { /* closing */ }
      await this.presenceChanged();
      return json({ ok: true });
    }
    // The Worker, after someone unlocked an achievement: each friend's hub hears it once, as a note.
    if (url.pathname === "/announce") {
      const a = check(obj({ who: Who, text: str(280) }), body);
      if (!a) return json({ error: "send { who, text }" }, 400);
      await this.meet(a.who);
      const me: Person = { id: a.who.id, name: a.who.name };
      const friends = [...(await this.ctx.storage.list<Friend>({ prefix: "f:" })).values()];
      await Promise.all(friends.map((f) => this.send(f, { from: me, kind: "note", app: a.who.app, text: a.text })));
      return json({ ok: true });
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
        if (op.email && !(await this.lookup())) return "too many friend requests this hour: try again later";
        if (!op.email) return "befriend whom? send their email";
        const email = op.email.trim(), to = await this.env.DB.prepare('SELECT id, name FROM "user" WHERE lower(email) = lower(?)').bind(email).first<Person>();
        // Someone they already know (a friend, or someone who asked them): no secret in that.
        if (to && (to.id === me.id || await s.get(`f:${to.id}`))) return done();
        if (to && await s.get(`in:${to.id}`)) return this.act(who, { op: "accept", id: to.id });
        if ((await s.list({ prefix: "out:" })).size >= MAX_ASKS) return "too many requests waiting: wait for some answers";
        // Nobody by that email waits the same as somebody: the asker sees the email they typed either way (Out).
        const id = await emailId(email);
        await s.put(`out:${to?.id ?? id}`, { id, name: email.slice(0, 200), at: Date.now(), ...(to ? { to } : {}) } satisfies Out);
        if (to) await this.send(to, { from: me, kind: "ask" });
        return done();
      }
      case "accept": {
        const asked = op.id ? await s.get<Asked>(`in:${op.id}`) : undefined;
        if (!asked) return "no request from them";
        if ((await s.list({ prefix: "f:" })).size >= MAX_FRIENDS) return `${MAX_FRIENDS} friends is the most`;
        await s.delete(`in:${asked.id}`);
        await s.put(`f:${asked.id}`, { id: asked.id, name: asked.name, since: Date.now(), presence: [] } satisfies Friend);
        await this.send(asked, { from: me, kind: "accept", presence: await this.mine() });
        return done();
      }
      case "drop": {
        if (!op.id) return "drop whom?";
        // A waiting ask goes by the id the page shows (`e_`), its row by the account's id when there is one.
        const asked = [...(await s.list<Out>({ prefix: "out:" })).entries()].find(([, o]) => o.id === op.id || o.to?.id === op.id);
        const them = (await s.get<Person>(`f:${op.id}`)) ?? (await s.get<Person>(`in:${op.id}`)) ?? asked?.[1].to;
        await this.forget([`f:${op.id}`, `in:${op.id}`, ...(asked ? [asked[0]] : [])]);
        if (them) await this.send(them, { from: me, kind: "drop" });
        return done();
      }
      case "notify": {
        // Only to a friend, and only words and a link on the app's own origin.
        const friend = op.id ? await s.get<Friend>(`f:${op.id}`) : undefined;
        if (!friend) return "only a friend can be notified";
        if (!op.text) return "say something";
        const app = appOf(who.app);
        if (op.link && (!app || !onSite(app, op.link, loopbackOn(this.env)))) return "a link must be on the app's own site";
        await this.send(friend, { from: me, kind: "note", app: who.app, text: op.text, ...(op.link ? { link: op.link } : {}) });
        return null;
      }
      case "clear": {
        await this.forget([...(await s.list({ prefix: "n:" })).keys()]);
        return done();
      }
    }
  }

  private async erase() {
    const s = this.ctx.storage, me = await s.get<Person>("me");
    if (me) {
      const known = [
        ...(await Promise.all(["f:", "in:"].map((prefix) => s.list<Person>({ prefix })))).flatMap((m) => [...m.values()]),
        ...[...(await s.list<Out>({ prefix: "out:" })).values()].flatMap((o) => (o.to ? [o.to] : [])),
      ];
      await Promise.all(known.map((p) => this.send(p, { from: me, kind: "drop" })));
    }
    for (const ws of this.sockets.open()) try { ws.close(4001, "account deleted"); } catch { /* closing */ }
    await this.forget([...(await s.list({ prefix: "" })).keys()]);
  }

  /** Another hub telling this one about its owner. Only a hub can call /peer: the Worker never routes there. */
  private async peer(p: Peer) {
    const s = this.ctx.storage;
    let me = await s.get<Person>("me");
    if (!me) await s.put("me", me = p.to);
    const id = p.from.id;
    if (id === me.id) return;
    const friend = await s.get<Friend>(`f:${id}`);
    switch (p.kind) {
      case "ask": {
        if (friend) return;
        // They asked while this side was asking them: that is a yes both ways.
        if (await s.get(`out:${id}`)) {
          await s.delete(`out:${id}`);
          await s.put(`f:${id}`, { ...p.from, since: Date.now(), presence: [] } satisfies Friend);
          await this.send(p.from, { from: me, kind: "accept", presence: await this.mine() });
          break;
        }
        if ((await s.list({ prefix: "in:" })).size >= MAX_ASKS) return;
        await s.put(`in:${id}`, { ...p.from, at: Date.now() } satisfies Asked);
        // One ask note per asker: asking again (ask, drop, ask) replaces it rather than pushing the other notes out.
        await this.forget(await this.askNotesFrom(id));
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
        if (presence.length) await this.send(p.from, { from: me, kind: "presence", presence });
        break;
      }
      case "drop":
        await this.forget([`f:${id}`, `in:${id}`, `out:${id}`, ...(await this.askNotesFrom(id))]);
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

  /** The keys of the ask notes one person left here. */
  private async askNotesFrom(id: string) {
    return [...(await this.ctx.storage.list<Note>({ prefix: "n:" })).entries()].filter(([, n]) => n.kind === "ask" && n.from.id === id).map(([k]) => k);
  }

  /** Spend one of this hour's lookups by email, kept in storage so a restart doesn't refill them; false when they are spent. */
  private async lookup(now = Date.now()) {
    const recent = (await this.ctx.storage.get<number[]>("lookups") ?? []).filter((t) => t > now - 3_600_000);
    if (recent.length >= LOOKUPS_PER_HOUR) return false;
    await this.ctx.storage.put("lookups", [...recent, now]);
    return true;
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
    await Promise.all(friends.map((f) => this.send(f, { from: me, kind: "presence", presence: now })));
  }

  private async send(to: Person, p: Omit<Peer, "to">) {
    if (!this.env.HUB) return;
    const msg: Peer = { ...p, to: { id: to.id, name: to.name } };
    await hubOf(this.env.HUB, to.id).fetch(new Request("https://hub/peer", { method: "POST", body: JSON.stringify(msg) }))
      .catch(() => { /* their hub is down: they hear nothing, the same as a dropped socket frame */ });
  }

  async state(): Promise<HubState> {
    const s = this.ctx.storage;
    const vals = async <T,>(prefix: string) => [...(await s.list<T>({ prefix })).values()];
    return {
      me: (await s.get<Person>("me")) ?? null,
      friends: (await vals<Friend>("f:")).sort((a, b) => a.name.localeCompare(b.name)),
      incoming: await vals<Asked>("in:"), outgoing: (await vals<Out>("out:")).map(({ id, name, at }) => ({ id, name, at })),
      notes: (await vals<Note>("n:")).reverse(),
    };
  }

  /** The state to every open tab. */
  private async push() { this.sockets.broadcast({ t: "state", ...await this.state() }); }
}

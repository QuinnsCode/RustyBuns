// One Durable Object a space (Qollab, QOLLAB.md): a group that lasts, with text channels and their history, across every Q app.
// A party is the lobby before one game; a space is where the same people hang out between games, the way a chat server's
// rooms work. Who is in a space is D1's (`spaces`, `space_members`, handle.ts checks it at the door); this object holds the
// channels, the messages and who is online, and nobody reaches it but the Worker:
//   /socket?id=&name=&app=&sid=&space=&owner=&studio=&iss=   a member's live socket (sid is the space's id, space its name,
//                                           owner that they run it, studio the studio that owns it, if one does)
//   /erase?id=                              their account was deleted: their sockets close and their messages go
//   /gone?id=                               they left the studio that owns it: their sockets close
//   /drop                                   the space was deleted: every socket closes and everything here goes
//   /roster { channel, in, at }             Qlave says who is in a voice channel (handle.ts checked its signature)
// Messages are kept in pages of PAGE under `p:<channel>:<page>`, the last KEEP_PAGES pages a channel, numbered from 1.
// Voice channels (QLAVE.md) carry no messages here: a member asks for a one-use Qlave ticket over the socket, Qlave
// carries the audio, and Qlave says who is in each room (QLAVE.md §4); until it has, the page's own word stands. What the owner does
// (mute, kick, deleting a channel or the space) goes to Qlave as an order, through an outbox the alarm retries.
import { bool, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import type { SpaceMsg, SpaceMessage } from "@rustybuns/util/eqosys";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { appOf } from "../listings.ts";
import { ChatGate, SAY_MAX, STUDIO_SAY_MAX, type Said } from "./chat.ts";
import { removeMember, roleIn, type Made } from "../studios.ts";
import { json, type Env } from "../env.ts";
import { Present, roomOf, send, ticket, qlaveUrl, type Order } from "./qlave.ts";
import { file, reporterId } from "../reports.ts";
import { mintCode } from "./party.ts";

export const PAGE = 50, KEEP_PAGES = 200, CHANNELS = 20, SPACES_OWNED = 10, SPACE_MEMBERS = 500;
export const CHANNEL = str(24, { min: 1, re: /^[a-z0-9-]+$/ });
/** A space's name as its owner typed it. */
export const SPACE_NAME = str(60, { min: 1 });

/** A message as a channel keeps it: its number in the channel, and who said what when. */
type Msg = SpaceMessage;
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), sid: str(64, { min: 1 }), space: str(60), owner: opt(oneOf(["1"])), studio: opt(str(64)), iss: opt(str(300)) });
/** `voice` is the voice channel their page says it is in. */
type Member = { id: string; name: string; app: string; owner: boolean; voice?: string };
/** A voice channel: its fixed-length id (Qlave's room is `space:<space>:<id>`) and the name the owner gave it. */
type Voice = { id: string; name: string };
/** Who Qlave last said is in a voice channel, and when it said so (its clock). Kept under `roster:<channel id>`. */
type Roster = { in: Of<typeof Present>; at: number };
const RosterIn = obj({ channel: str(16, { min: 1 }), in: Present, at: int(0, 1e15) });
/** An order waiting for Qlave to answer 200, and how many times it has been tried. */
type Pending = { order: Order; iss: string; tries: number };
/** Tries an order gets before it is dropped: 5 s, 10 s, 20 s, 40 s and 80 s apart. */
export const ORDER_TRIES = 6;

const SpaceIn = obj({
  t: oneOf(["say", "history", "channel", "drop", "talk", "voice", "mute", "kick", "report", "leave"]),
  channel: opt(CHANNEL), text: opt(str(STUDIO_SAY_MAX)), before: opt(int(1, 1e12)), id: opt(str(200, { min: 1 })), on: opt(bool()), voice: opt(bool()),
});
/** What a space says to a member: the page's guard is SpaceMsg in @rustybuns/util/eqosys. */
export type SpaceOut = SpaceMsg;

interface Storage {
  get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean>;
  list<T>(o?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(at: number): Promise<void>;
}
interface SpaceCtx extends RoomCtx { storage: Storage }
interface Stub { fetch(req: Request): Promise<Response> }
/** The SPACE binding: one object a space id. */
export interface Spaces { idFromName(name: string): unknown; get(id: unknown): Stub }
export const spaceOf = (spaces: Spaces, id: string): Stub => spaces.get(spaces.idFromName(id));

/** The ids of every space a person is in (bind their id as ?1): the ones they joined, and their studios' spaces. */
export const SPACES_OF = `SELECT space_id AS id FROM space_members WHERE user_id = ?1
  UNION SELECT s.id FROM spaces s JOIN studio_members sm ON sm.studio_id = s.studio_id WHERE sm.user_id = ?1`;

/** A seat in a space, or null when they aren't in it. `runs`: channels, mute and kick are theirs (a space's owner, a studio's owners and admins). */
export type Seat = { name: string; studio: string | null; runs: boolean };
/** A studio's space seats the studio's members; any other space its space_members rows. */
export async function seatIn(conf: Pick<Env, "DB">, sid: string, userId: string): Promise<Seat | null> {
  const r = await conf.DB.prepare(`SELECT s.name, s.studio_id AS studio, CASE WHEN s.studio_id IS NULL THEN s.owner = ?2 ELSE sm.role IN ('owner', 'admin') END AS runs
    FROM spaces s LEFT JOIN studio_members sm ON sm.studio_id = s.studio_id AND sm.user_id = ?2
    WHERE s.id = ?1 AND (sm.user_id IS NOT NULL OR (s.studio_id IS NULL AND EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = s.id AND m.user_id = ?2)))`)
    .bind(sid, userId).first<{ name: string; studio: string | null; runs: number }>();
  return r ? { name: r.name, studio: r.studio, runs: !!r.runs } : null;
}

export type MadeSpace = { ok: true; id: string; invite?: string } | { ok: false; status: number; error: string };
/**
 * A new space, `owner`'s, with its invite to hand out (SPACES_OWNED a person). With `studio`, the studio's own space (one a studio,
 * its owner or admin asks): no member rows and no invite to hand out, since its members are the studio's.
 */
export async function makeSpace(conf: Pick<Env, "DB">, owner: string, name: string, studio: string | null, now = Date.now()): Promise<MadeSpace> {
  if (studio) {
    const role = await roleIn(conf, studio, owner);
    if (role !== "owner" && role !== "admin") return { ok: false, status: 403, error: "only a studio's owner or admin makes its space" };
    if (await conf.DB.prepare("SELECT 1 AS y FROM spaces WHERE studio_id = ?").bind(studio).first("y")) return { ok: false, status: 409, error: "that studio has its space already" };
  } else if (((await conf.DB.prepare("SELECT COUNT(*) AS n FROM spaces WHERE owner = ? AND studio_id IS NULL").bind(owner).first<number>("n")) ?? 0) >= SPACES_OWNED)
    return { ok: false, status: 409, error: `you own ${SPACES_OWNED} spaces already` };
  const id = crypto.randomUUID();
  for (let i = 0; i < 5; i++) {
    const invite = mintCode();
    const made = await conf.DB.prepare("INSERT INTO spaces (id, name, owner, invite, at, studio_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id")
      .bind(id, name, owner, invite, now, studio).first<string>("id");
    if (!made) continue;
    if (studio) return { ok: true, id };
    await conf.DB.prepare("INSERT INTO space_members (space_id, user_id, at) VALUES (?, ?, ?)").bind(id, owner, now).run();
    return { ok: true, id, invite };
  }
  return { ok: false, status: 503, error: "couldn't mint an invite; try again" };
}

/**
 * Takes someone out of a studio by their email (the Studio tab, eq_studio_remove), by studios.ts removeMember's rules, and closes the
 * sockets they have open in the studio's space: they are out of every channel at once.
 */
export async function studioRemove(conf: Pick<Env, "DB" | "SPACE">, studio: string, by: string, email: string): Promise<Made> {
  const who = await conf.DB.prepare(`SELECT u.id FROM "user" u JOIN studio_members m ON m.user_id = u.id AND m.studio_id = ? WHERE lower(u.email) = lower(?)`)
    .bind(studio, email.trim()).first<string>("id");
  if (!who) return { ok: false, status: 404, error: "nobody in that studio has that email" };
  const r = await removeMember(conf, studio, by, who);
  const sid = r.ok && conf.SPACE && await conf.DB.prepare("SELECT id FROM spaces WHERE studio_id = ?").bind(studio).first<string>("id");
  if (sid) await spaceOf(conf.SPACE!, sid).fetch(new Request(`https://space/gone?${new URLSearchParams({ id: who })}`)).catch(() => null);
  return r;
}

const pageKey = (channel: string, page: number) => `p:${channel}:${String(page).padStart(8, "0")}`;

export class Space {
  private sockets: Sockets<Member, SpaceOut>;
  private chat = new ChatGate();

  constructor(private ctx: SpaceCtx, private env: Env) {
    this.sockets = new Sockets<Member, SpaceOut>(ctx, { maxBytes: 4 * STUDIO_SAY_MAX + 500, rate: 5, burst: 10 });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const iss = url.searchParams.get("iss");
    if (iss) await this.ctx.storage.put("iss", iss);
    if (url.pathname === "/drop") return this.drop();
    if (url.pathname === "/erase") return this.erase(url.searchParams.get("id") ?? "");
    // Signed out (members.ts closeSockets): the person's sockets that `app`'s tokens opened close; they stay a member.
    if (url.pathname === "/out") {
      const id = url.searchParams.get("id"), app = url.searchParams.get("app") ?? "*";
      if (id) this.close((m) => m.id === id && (app === "*" || m.app === app), 4003, "signed out");
      return json({ ok: true });
    }
    // Out of the studio that owns this space (studioLeft): their sockets close and Qlave drops them from its voice channels.
    if (url.pathname === "/gone") { await this.out(url.searchParams.get("id") ?? "", "removed from the studio"); return json({ ok: true }); }
    if (url.pathname === "/mine") return this.mine(url.searchParams.get("id") ?? "");
    // How many people are in it now (two tabs are one), for the eqosys home's list of your spaces.
    if (url.pathname === "/on") return json({ on: (await this.members()).length });
    if (url.pathname === "/roster") return this.roster(check(RosterIn, await req.json().catch(() => null)));
    const who = check(Who, Object.fromEntries(url.searchParams));
    if (url.pathname !== "/socket" || !who) return json({ error: "not found" }, 404);
    await this.ctx.storage.put("sid", who.sid);
    await this.ctx.storage.put("name", who.space);
    if (who.studio) await this.ctx.storage.put("studio", who.studio);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name, app: who.app, owner: who.owner === "1" });
    this.sockets.send(server, await this.info(who.owner === "1"));
    this.online();
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(SpaceIn, frame.value);
    if (!msg || !me) return;
    const channels = await this.channels();
    const ch = msg.channel ?? "general";
    if (msg.t === "leave") return await this.studio() ? this.sockets.send(ws, { t: "refused", why: "a studio's space follows the studio: leave the studio to leave it" }) : this.leave(me.id);
    if (msg.t === "report") return this.report(ws, me, msg.id ?? "");
    if (msg.t === "history") return channels.includes(ch) ? this.sockets.send(ws, await this.history(ch, msg.before)) : undefined;
    if (msg.t === "talk") return this.talk(ws, me, msg.channel ?? "");
    if (msg.t === "voice") {
      // The page joined (or left, with no channel) a voice room on Qlave: everyone sees it beside the online list.
      const voice = msg.channel && (await this.voices()).some((v) => v.id === msg.channel) ? msg.channel : undefined;
      this.sockets.attach(ws, { id: me.id, name: me.name, app: me.app, owner: me.owner, ...(voice ? { voice } : {}) });
      return this.online();
    }
    if (msg.t === "say") {
      if (!channels.includes(ch)) return this.sockets.send(ws, { t: "refused", why: `no channel #${ch}` });
      const text = this.chat.line(ws, msg.text ?? "", Date.now(), await this.studio() ? STUDIO_SAY_MAX : SAY_MAX);
      if (!text || (await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return;
      return this.say(ch, { from: { id: me.id, name: me.name }, text, at: Date.now() });
    }
    // The rest is the owner's.
    if (!me.owner) return this.sockets.send(ws, { t: "refused", why: "only the space's owner can do that" });
    const voices = await this.voices();
    if (msg.t === "channel") {
      if (!msg.channel || (msg.voice ? voices.some((v) => v.name === msg.channel) : channels.includes(msg.channel))) return;
      if (channels.length + voices.length >= CHANNELS) return this.sockets.send(ws, { t: "refused", why: `a space has up to ${CHANNELS} channels` });
      if (msg.voice) await this.ctx.storage.put("voice", [...voices, { id: `v${crypto.randomUUID().slice(0, 8)}`, name: msg.channel }]);
      else await this.ctx.storage.put("channels", [...channels, msg.channel]);
      return this.announce();
    }
    if (msg.t === "drop") return this.dropChannel(ws, msg.channel ?? "");
    const id = msg.id ?? "";
    if (!id || id === me.id) return;
    if (msg.t === "mute") {
      const muted = new Set(await this.ctx.storage.get<string[]>("muted") ?? []), on = msg.on ?? true;
      if (on) muted.add(id); else muted.delete(id);
      await this.ctx.storage.put("muted", [...muted]);
      // A space mute is a voice mute too, in every voice channel.
      const sid = await this.sid();
      return this.enqueue(voices.map((v): Order => ({ t: "mute", room: roomOf(sid, v.id), sub: id, on })));
    }
    // kick: out of the space's members (D1) and off every socket now; an invite brings them back. In a studio's space, out of the studio,
    // by the studio's own rules (an admin can't take out an owner).
    const studio = await this.studio();
    if (!studio) return this.leave(id, "removed from the space");
    const r = await removeMember(this.env, studio, me.id, id);
    return r.ok ? this.out(id, "removed from the studio") : this.sockets.send(ws, { t: "refused", why: r.error });
  }

  webSocketClose(ws: RoomSocket) { this.online(ws); }
  webSocketError(ws: RoomSocket) { this.online(ws); }

  private async channels(): Promise<string[]> { return await this.ctx.storage.get<string[]>("channels") ?? ["general"]; }
  private async voices(): Promise<Voice[]> { return await this.ctx.storage.get<Voice[]>("voice") ?? []; }
  /** The studio that owns this space, if one does. */
  private async studio(): Promise<string | undefined> { return await this.ctx.storage.get<string>("studio"); }
  private async sid(): Promise<string> { return await this.ctx.storage.get<string>("sid") ?? ""; }
  /** eqosys's origin as the Worker saw it, for the tickets' and orders' `iss`. */
  private async iss(): Promise<string> {
    return await this.ctx.storage.get<string>("iss") ?? (this.env.BETTER_AUTH_URL ? new URL(this.env.BETTER_AUTH_URL).origin : "https://eqosys.qntbr.com");
  }

  private async info(owner: boolean): Promise<SpaceOut> {
    return { t: "space", name: await this.ctx.storage.get<string>("name") ?? "", channels: await this.channels(), voice: await this.voices(), owner, max: await this.studio() ? STUDIO_SAY_MAX : SAY_MAX };
  }

  /** The channels changed: everyone hears the new list. */
  private async announce() {
    const own = await this.info(true), not = await this.info(false);
    for (const sock of this.sockets.open()) { const m = this.sockets.who(sock); if (m) this.sockets.send(sock, m.owner ? own : not); }
  }

  /**
   * A ticket into a voice channel, to the asker only. A muted member's mute reaches Qlave before they do, so their
   * first word is already silent; if Qlave can't take it now, no ticket.
   */
  private async talk(ws: RoomSocket, me: Member, channel: string) {
    const v = (await this.voices()).find((x) => x.id === channel);
    if (!v) return this.sockets.send(ws, { t: "refused", why: "no such voice channel" });
    const iss = await this.iss(), room = roomOf(await this.sid(), v.id);
    if ((await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id) && await send(this.env, iss, { t: "mute", room, sub: me.id, on: true }) !== "done")
      return this.sockets.send(ws, { t: "refused", why: "Voice is busy. Try again in a minute." });
    const t = await ticket(this.env, iss, me, room);
    if (!t) return this.sockets.send(ws, { t: "refused", why: "voice isn't set up here" });
    this.sockets.send(ws, { t: "ticket", channel: v.id, url: qlaveUrl(this.env), ticket: t });
  }

  /** The owner deletes a channel: a text one's messages go (never #general's), a voice one's room ends on Qlave. */
  private async dropChannel(ws: RoomSocket, channel: string) {
    const voices = await this.voices(), v = voices.find((x) => x.id === channel);
    if (v) {
      await this.ctx.storage.put("voice", voices.filter((x) => x !== v));
      await this.ctx.storage.delete(`roster:${v.id}`);
      for (const sock of this.sockets.open()) {
        const m = this.sockets.who(sock);
        if (m?.voice === v.id) this.sockets.attach(sock, { id: m.id, name: m.name, app: m.app, owner: m.owner });
      }
      await this.enqueue([{ t: "end", prefix: roomOf(await this.sid(), v.id) }]);
    } else {
      const channels = await this.channels();
      if (channel === "general" || !channels.includes(channel)) return this.sockets.send(ws, { t: "refused", why: channel === "general" ? "#general stays" : "no such channel" });
      await this.ctx.storage.put("channels", channels.filter((c) => c !== channel));
      for (const k of (await this.ctx.storage.list({ prefix: `p:${channel}:` })).keys()) await this.ctx.storage.delete(k);
      await this.ctx.storage.delete(`n:${channel}`);
    }
    await this.announce();
    this.online();
  }

  /** Orders for Qlave, kept until it answers: the alarm sends them. */
  private async enqueue(orders: Order[]) {
    if (!orders.length) return;
    const iss = await this.iss();
    await this.ctx.storage.put("outbox", [...await this.ctx.storage.get<Pending[]>("outbox") ?? [], ...orders.map((order) => ({ order, iss, tries: 0 }))]);
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Send what is waiting. 200 and a refused order (400, 401) are done with; anything else waits longer and goes again. */
  async alarm() {
    const sent = await this.ctx.storage.get<Pending[]>("outbox") ?? [], left: Pending[] = [];
    for (const p of sent) if (await send(this.env, p.iss, p.order) === "retry" && p.tries + 1 < ORDER_TRIES) left.push({ ...p, tries: p.tries + 1 });
    // Orders queued while these were out stay, and go at once.
    const fresh = (await this.ctx.storage.get<Pending[]>("outbox") ?? []).slice(sent.length);
    await this.ctx.storage.put("outbox", [...left, ...fresh]);
    if (fresh.length) await this.ctx.storage.setAlarm(Date.now());
    else if (left.length) await this.ctx.storage.setAlarm(Date.now() + 5000 * 2 ** (Math.min(...left.map((p) => p.tries)) - 1));
  }

  private async say(channel: string, said: Said) {
    const n = (await this.ctx.storage.get<number>(`n:${channel}`) ?? 0) + 1, page = Math.ceil(n / PAGE);
    const m: Msg = { ...said, id: n };
    await this.ctx.storage.put(pageKey(channel, page), [...(await this.ctx.storage.get<Msg[]>(pageKey(channel, page)) ?? []), m]);
    await this.ctx.storage.put(`n:${channel}`, n);
    if (n % PAGE === 1 && page > KEEP_PAGES) await this.ctx.storage.delete(pageKey(channel, page - KEEP_PAGES));
    this.sockets.broadcast({ t: "said", channel, ...m });
  }

  private async history(channel: string, before?: number): Promise<SpaceOut> {
    const n = await this.ctx.storage.get<number>(`n:${channel}`) ?? 0;
    const last = Math.min(n, (before ?? n + 1) - 1);
    // The page holding `last` and the one before it, so a reply has a full PAGE when there are that many.
    const page = Math.ceil(last / PAGE);
    const got = page < 1 ? [] : [...(await this.ctx.storage.get<Msg[]>(pageKey(channel, page - 1)) ?? []), ...(await this.ctx.storage.get<Msg[]>(pageKey(channel, page)) ?? [])];
    const messages = got.filter((m) => m.id <= last).slice(-PAGE);
    const oldest = messages[0]?.id ?? 0;
    return { t: "history", channel, messages, more: oldest > 1 && Math.ceil((oldest - 1) / PAGE) > Math.max(0, Math.ceil(n / PAGE) - KEEP_PAGES) };
  }

  /** Out of the space: their D1 row goes, their sockets close, and Qlave drops them from every voice channel. */
  private async leave(id: string, why = "left the space") {
    const sid = await this.sid();
    const out = await this.env.DB.prepare("DELETE FROM space_members WHERE space_id = (SELECT id FROM spaces WHERE id = ? AND owner != ?) AND user_id = ? RETURNING user_id")
      .bind(sid, id, id).first<string>("user_id");
    this.close((m) => m.id === id && !m.owner, 4003, why);
    // A kick retires the invite too: the kicked person holds it (everyone joined with it), so a fresh one is minted that only the owner hands out.
    if (out && why !== "left the space") await this.env.DB.prepare("UPDATE spaces SET invite = ? WHERE id = ?").bind(mintCode(), sid).run();
    // The owner can't leave their own space, so nothing goes to Qlave for them.
    if (out) await this.enqueue((await this.voices()).map((v): Order => ({ t: "kick", room: roomOf(sid, v.id), sub: id })));
  }

  /** Someone is no longer seated here (D1 already says so): their sockets close, whoever they were, and Qlave drops them from every voice channel. */
  private async out(id: string, why: string) {
    if (!id) return;
    this.close((m) => m.id === id, 4003, why);
    const sid = await this.sid();
    await this.enqueue((await this.voices()).map((v): Order => ({ t: "kick", room: roomOf(sid, v.id), sub: id })));
  }

  private close(which: (m: Member) => boolean, code: number, why: string) {
    for (const ws of this.sockets.open()) { const m = this.sockets.who(ws); if (m && which(m)) try { ws.close(code, why); } catch { /* closing */ } }
    this.online();
  }

  /** A report on a member: the owner hears of it, and a row goes through the game-report path (reports.ts), filed under the reporter's app. */
  private async report(ws: RoomSocket, me: Member, id: string) {
    if (id === me.id) return this.sockets.send(ws, { t: "refused", why: "you can't report yourself" });
    let said: Msg | undefined;
    for (const ch of await this.channels()) {
      const page = await this.history(ch);
      said = [...(page.t === "history" ? page.messages : [])].reverse().find((m) => m.from.id === id) ?? said;
    }
    const name = (await this.members()).find((m) => m.id === id)?.name ?? said?.from.name;
    if (!name) return this.sockets.send(ws, { t: "refused", why: "no such member" });
    for (const sock of this.sockets.open()) if (this.sockets.who(sock)?.owner) this.sockets.send(sock, { t: "reported", by: me.name, id, name });
    const app = await appOf(this.env, me.app);
    if (!app) return;
    // The issue is public: the reported person is named by the same opaque id as the reporter, and their words stay with the owner (the `reported` frame above).
    const filed = await file(this.env, app, me.id, "", { kind: "bug", title: "Space chat report", body: `A space member was reported in chat.\n\nReported: ${await reporterId(id)}` });
    if (!filed.ok) this.sockets.send(ws, { t: "refused", why: filed.error });
  }

  /** Their account was deleted: their sockets close and every message they wrote goes. */
  private async erase(id: string): Promise<Response> {
    if (!id) return json({ error: "bad" }, 400);
    this.close((m) => m.id === id, 4001, "account deleted");
    for (const [k, page] of await this.ctx.storage.list<Msg[]>({ prefix: "p:" }))
      if (page.some((m) => m.from.id === id)) await this.ctx.storage.put(k, page.filter((m) => m.from.id !== id));
    await this.ctx.storage.put("muted", (await this.ctx.storage.get<string[]>("muted") ?? []).filter((x) => x !== id));
    return json({ ok: true });
  }

  /** The messages one person sent here, every channel, oldest first: their part of a privacy download (privacy.ts). */
  private async mine(id: string): Promise<Response> {
    const out: (Msg & { channel: string })[] = [];
    for (const [k, page] of await this.ctx.storage.list<Msg[]>({ prefix: "p:" }))
      for (const m of page) if (m.from.id === id) out.push({ ...m, channel: k.slice(2, k.lastIndexOf(":")) });
    return json({ messages: out.sort((a, b) => a.at - b.at) });
  }

  /** The space is gone: everyone is out, nothing is kept but the order that ends its voice rooms. */
  private async drop(): Promise<Response> {
    this.close(() => true, 4004, "the space was deleted");
    const sid = await this.sid(), iss = await this.iss(), outbox = await this.ctx.storage.get<Pending[]>("outbox") ?? [];
    for (const k of (await this.ctx.storage.list({})).keys()) await this.ctx.storage.delete(k);
    await this.ctx.storage.put("iss", iss);
    await this.ctx.storage.put("outbox", outbox);
    if (sid) await this.enqueue([{ t: "end", prefix: `space:${sid}:` }]);
    return json({ ok: true });
  }

  /** Qlave says who is in a voice channel. An older word than the one kept, or a channel that is gone, changes nothing. */
  private async roster(r: Of<typeof RosterIn> | null): Promise<Response> {
    if (!r) return json({ error: "bad" }, 400);
    const had = await this.ctx.storage.get<Roster>(`roster:${r.channel}`);
    if ((await this.voices()).some((v) => v.id === r.channel) && !(had && had.at > r.at)) {
      await this.ctx.storage.put(`roster:${r.channel}`, { in: r.in, at: r.at } satisfies Roster);
      await this.online();
    }
    return json({ ok: true });
  }

  /**
   * Who is online, one row a person (two tabs are one name), with the voice channel they are in. Qlave's roster for a
   * channel wins over what a page says, so a crashed tab drops out; a channel Qlave hasn't spoken for goes by the pages.
   */
  private async members(gone?: RoomSocket) {
    const heard = new Map<string, string>(), told = new Set<string>();
    for (const [k, r] of await this.ctx.storage.list<Roster>({ prefix: "roster:" })) {
      const channel = k.slice("roster:".length);
      told.add(channel);
      for (const p of r.in) heard.set(p.sub, channel);
    }
    const seen = new Map<string, { id: string; name: string; voice?: string }>();
    for (const ws of this.sockets.open()) {
      const m = ws === gone ? null : this.sockets.who(ws);
      if (!m) continue;
      const said = m.voice && !told.has(m.voice) ? m.voice : undefined;
      const voice = heard.get(m.id) ?? said ?? seen.get(m.id)?.voice;
      seen.set(m.id, { id: m.id, name: m.name, ...(voice ? { voice } : {}) });
    }
    return [...seen.values()];
  }

  /** Who is online, to everyone. One person in two tabs is one name. */
  private async online(gone?: RoomSocket) { this.sockets.broadcast({ t: "online", members: await this.members(gone) }, gone); }
}

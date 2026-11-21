// One Durable Object a space (Qollab, QOLLAB.md): a group that lasts, with text channels and their history, across every Q app.
// A party is the lobby before one game; a space is where the same people hang out between games, the way a chat server's
// rooms work. Who is in a space is D1's (`spaces`, `space_members`, handle.ts checks it at the door); this object holds the
// channels, the messages and who is online, and nobody reaches it but the Worker:
//   /socket?id=&name=&app=&sid=&space=&owner=&role=&studio=&iss=   a member's live socket (sid is the space's id, space its name,
//                                           owner that they run it, role theirs (SpaceRole), studio the studio that owns it, if one does)
//   /erase?id=                              their account was deleted: their sockets close and their messages go
//   /gone?id=                               they left the studio that owns it: their sockets close
//   /role?id=                               their role in the studio changed: their sockets close and the page reconnects
//   /drop                                   the space was deleted: every socket closes and everything here goes
//   /roster { channel, in, at }             Qlave says who is in a voice channel (handle.ts checked its signature)
// Messages are kept in pages of PAGE under `p:<channel>:<page>`, the last KEEP_PAGES pages a channel, numbered from 1.
// A reply in a thread is a message of its channel like any other, naming the one it answers (`reply`); the message it answers
// counts its replies (`replies`), and `t:<channel>:<id>` keeps the replies' numbers (the last THREAD_MAX), so a thread is read
// without walking the channel. Search walks the channel's kept pages, newest first, a few times a minute a socket.
// Voice channels (QLAVE.md) carry no messages here: a member asks for a one-use Qlave ticket over the socket, Qlave
// carries the audio, and Qlave says who is in each room (QLAVE.md §4); until it has, the page's own word stands. What the owner does
// (mute, kick, deleting a channel or the space) goes to Qlave as an order, through an outbox the alarm retries.
// A private channel (`private` in storage: its name to the ids let in) is seen only by those who run the space and the people
// they let in: its tab, its messages and its history go to nobody else. A guest sees #general and the private channels they are let into.
// Files (#5320): POST /file puts one on R2 (FILES) under `<space>/<channel>/<file id>`, up to FILE_MAX each and FILE_BYTES a space, and
// posts a message carrying it (`file`); GET /file/<id> hands it to a member who sees its channel. `f:<file id>` says where it was posted,
// so deleting the message, its channel, the space or the sender's account takes the file with it, and so does its page ageing out.
//   /file?<as /socket>&channel=&name=&type=   POST the bytes: a message with the file, in that channel
//   /file/<id>?<as /socket>                   GET the file back
import { bool, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { SpaceRole, type SpaceInfo, type SpaceMsg, type SpaceMessage } from "@rustybuns/util/eqosys";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { appOf } from "../listings.ts";
import { ChatGate, SAY_MAX, STUDIO_SAY_MAX, type Said } from "./chat.ts";
import { addMember, removeMember, roleIn, STUDIO_MEMBERS, type Made, type Role } from "../studios.ts";
import { json, type Env } from "../env.ts";
import { flush, Present, queue, roomOf, send, ticket, qlaveUrl, type Order } from "./qlave.ts";
import { file, reporterId } from "../reports.ts";
import { mintCode } from "./party.ts";

export const PAGE = 50, KEEP_PAGES = 200, CHANNELS = 20, SPACES_OWNED = 10, SPACE_MEMBERS = 500;
/** The biggest file one message carries, and every file a space keeps at once, in bytes; and how many files a person posts a minute. */
export const FILE_MAX = 10 * 1024 * 1024, FILE_BYTES = 1024 ** 3, FILES_A_MINUTE = 10;
/** The replies a thread keeps the numbers of, and how many come back with it (the parent is one more). */
export const THREAD_MAX = 1000, THREAD_SHOWN = 99;
/** The longest search, and how often a socket may search: SEARCH_RATE a second with a burst of SEARCH_BURST. */
export const SEARCH_MAX = 100, SEARCH_RATE = 0.2, SEARCH_BURST = 3;
/** A space's invite is copied, never read out, and lets anyone in for good, so it is twice a party code's length: 21^12 codes,
 *  too many to guess even before the door's tries a minute (routes.ts). The longest a room code may be (`codeOf`). */
export const INVITE_LETTERS = 12;
const mintInvite = () => mintCode(INVITE_LETTERS);
export const CHANNEL = str(24, { min: 1, re: /^[a-z0-9-]+$/ });
/** A space's name as its owner typed it. */
export const SPACE_NAME = str(60, { min: 1 });

/** A message as a channel keeps it: its number in the channel, and who said what when. */
type Msg = SpaceMessage;
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), sid: str(64, { min: 1 }), space: str(60), owner: opt(oneOf(["1"])), role: opt(SpaceRole), studio: opt(str(64)), iss: opt(str(300)) });
/** `voice` is the voice channel their page says it is in. */
type Member = { id: string; name: string; app: string; owner: boolean; role: SpaceRole; voice?: string };
/** The private channels, each with the ids of the people let in (those who run the space always are). */
type Locked = Record<string, string[]>;
/** Whether `m` sees channel `ch`: those who run the space see every one, a private one is for the people let in, a guest has #general. */
const sees = (m: Member, ch: string, locked: Locked) => m.owner || (locked[ch] ? locked[ch].includes(m.id) : m.role !== "guest" || ch === "general");
/** A voice channel: its fixed-length id (Qlave's room is `space:<space>:<id>`) and the name the owner gave it. */
type Voice = { id: string; name: string };
/** Who Qlave last said is in a voice channel, and when it said so (its clock). Kept under `roster:<channel id>`. */
type Roster = { in: Of<typeof Present>; at: number };
/** A file as the space keeps it, under `f:<id>`: the message it was posted with, who sent it, and its R2 key. */
type Kept = { channel: string; msg: number; by: string; key: string; size: number };
/** What a file is called, and its type, as the uploader's page says: no slashes or control characters, a plain `type/subtype`. */
const fileName = (v: string | null) => v?.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").trim().slice(0, 200) || "file";
const fileType = (v: string | null) => {
  const t = v?.split(";")[0]!.trim().toLowerCase();
  return t && /^[\w.+-]{1,50}\/[\w.+-]{1,50}$/.test(t) ? t : "application/octet-stream";
};
/** The types a file is served back as; any other comes back as plain bytes, so nothing uploaded runs as a page on eqosys's origin. */
const SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "audio/mpeg", "audio/wav", "video/mp4"]);
const RosterIn = obj({ channel: str(16, { min: 1 }), in: Present, at: int(0, 1e15) });

const SpaceIn = obj({
  t: oneOf(["say", "unsay", "history", "thread", "search", "channel", "drop", "talk", "voice", "mute", "kick", "report", "leave", "allow", "role"]),
  channel: opt(CHANNEL), text: opt(str(STUDIO_SAY_MAX)), before: opt(int(1, 1e12)), id: opt(str(200, { min: 1 })), on: opt(bool()), voice: opt(bool()),
  private: opt(bool()), role: opt(oneOf(["admin", "member", "guest"])),
  reply: opt(int(1, 1e12)), of: opt(int(1, 1e12)), q: opt(str(SEARCH_MAX)),
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

/** A seat in a space, or null when they aren't in it. `runs`: channels, mute and kick are theirs (an owner or an admin, SpaceRole). */
export type Seat = { name: string; studio: string | null; runs: boolean; role: SpaceRole };
/**
 * Someone's role in a space (bind their id as ?2): a studio's space maps the studio's roles (a maker is a member), and anyone else
 * there with a space_members row is a guest, whatever the row says; any other space its owner and space_members rows.
 */
export const ROLE_OF = `CASE WHEN s.studio_id IS NOT NULL THEN CASE WHEN sm.role = 'maker' THEN 'member' WHEN sm.role IS NOT NULL THEN sm.role
    WHEN m.user_id IS NOT NULL THEN 'guest' END
  WHEN s.owner = ?2 THEN 'owner' ELSE m.role END`;
/** A studio's space seats the studio's members and its guests (space_members rows, joined by its invite); any other space its space_members rows. */
export async function seatIn(conf: Pick<Env, "DB">, sid: string, userId: string): Promise<Seat | null> {
  const r = await conf.DB.prepare(`SELECT s.name, s.studio_id AS studio, ${ROLE_OF} AS role
    FROM spaces s LEFT JOIN studio_members sm ON sm.studio_id = s.studio_id AND sm.user_id = ?2
    LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = ?2
    WHERE s.id = ?1 AND (sm.user_id IS NOT NULL OR m.user_id IS NOT NULL)`)
    .bind(sid, userId).first<{ name: string; studio: string | null; role: string }>();
  const role = r && check(SpaceRole, r.role);
  return r && role ? { name: r.name, studio: r.studio, runs: role === "owner" || role === "admin", role } : null;
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
    const invite = mintInvite();
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

/**
 * Puts someone in a studio by email or changes their role (the Studio tab, eq_studio_add), by studios.ts addMember's rules. Whether
 * they run the studio's space is read when their socket opens, so a changed role closes the sockets they have open there with a
 * code the page reconnects on (ROLE_CHANGED): they come back with the new powers, not the old ones.
 */
export async function studioAdd(conf: Pick<Env, "DB" | "SPACE">, studio: string, by: string, email: string, role: Role): Promise<Made> {
  const before = await conf.DB.prepare(`SELECT u.id, m.role FROM "user" u JOIN studio_members m ON m.user_id = u.id AND m.studio_id = ? WHERE lower(u.email) = lower(?)`)
    .bind(studio, email.trim()).first<{ id: string; role: Role }>();
  const r = await addMember(conf, studio, by, email, role);
  // A guest of the studio's space who joins the studio sits there as the studio's from now on: their guest row goes, so leaving the
  // studio later takes them out of the space too.
  const guest = r.ok ? await conf.DB.prepare(`DELETE FROM space_members WHERE space_id IN (SELECT id FROM spaces WHERE studio_id = ?)
    AND user_id IN (SELECT id FROM "user" WHERE lower(email) = lower(?)) RETURNING user_id`).bind(studio, email.trim()).first<string>("user_id") : null;
  const who = guest ?? (before && before.role !== role ? before.id : null);
  const sid = r.ok && who && conf.SPACE && await conf.DB.prepare("SELECT id FROM spaces WHERE studio_id = ?").bind(studio).first<string>("id");
  if (sid && who) await spaceOf(conf.SPACE!, sid).fetch(new Request(`https://space/role?${new URLSearchParams({ id: who })}`)).catch(() => null);
  return r;
}

/** The close a changed studio role sends: under 4000, so the page's socket (eqosys.ts `space`) opens again instead of giving up. */
export const ROLE_CHANGED = 3001;

const pageKey = (channel: string, page: number) => `p:${channel}:${String(page).padStart(8, "0")}`;

export class Space {
  private sockets: Sockets<Member, SpaceOut>;
  private chat = new ChatGate();
  private searches = new ChatGate(SEARCH_RATE, SEARCH_BURST);
  /** The times each person last posted a file, for FILES_A_MINUTE. */
  private posted = new Map<string, number[]>();

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
    // Their role in the studio changed (studioAdd): their sockets close, and the page's reconnect reads the new role at the door.
    if (url.pathname === "/role") { const id = url.searchParams.get("id"); if (id) this.close((m) => m.id === id, ROLE_CHANGED, "your role in the studio changed"); return json({ ok: true }); }
    if (url.pathname === "/mine") return this.mine(url.searchParams.get("id") ?? "");
    // How many people are in it now (two tabs are one), for the eqosys home's list of your spaces.
    if (url.pathname === "/on") return json({ on: (await this.members()).length });
    if (url.pathname === "/roster") return this.roster(check(RosterIn, await req.json().catch(() => null)));
    const who = check(Who, Object.fromEntries(url.searchParams));
    const file = /^\/file(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
    if ((url.pathname !== "/socket" && !file) || !who) return json({ error: "not found" }, 404);
    await this.ctx.storage.put("sid", who.sid);
    await this.ctx.storage.put("name", who.space);
    if (who.studio) await this.ctx.storage.put("studio", who.studio);
    const owner = who.owner === "1", m: Member = { id: who.id, name: who.name, app: who.app, owner, role: who.role ?? (owner ? "owner" : "member") };
    if (file) return file[1] ? this.fileOut(m, file[1]) : this.fileIn(m, req, url.searchParams);
    const { server, response } = this.sockets.upgrade(m);
    this.sockets.send(server, await this.info(m));
    this.online();
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(SpaceIn, frame.value);
    if (!msg || !me) return;
    const channels = await this.channels(), locked = await this.locked();
    const ch = msg.channel ?? "general";
    // A guest in a studio's space leaves it like any space; the studio's own people leave it by leaving the studio.
    if (msg.t === "leave") return await this.studio() && me.role !== "guest" ? this.sockets.send(ws, { t: "refused", why: "a studio's space follows the studio: leave the studio to leave it" }) : this.leave(me.id);
    if (msg.t === "report") return this.report(ws, me, msg.id ?? "");
    if (msg.t === "history") return channels.includes(ch) && sees(me, ch, locked) ? this.sockets.send(ws, await this.history(ch, msg.before)) : undefined;
    if (msg.t === "thread") return channels.includes(ch) && sees(me, ch, locked) && msg.of ? this.sockets.send(ws, await this.thread(ch, msg.of)) : undefined;
    if (msg.t === "search") {
      if (!channels.includes(ch) || !sees(me, ch, locked) || !msg.q?.trim()) return;
      const q = this.searches.line(ws, msg.q, Date.now(), SEARCH_MAX);
      return q ? this.sockets.send(ws, await this.search(ch, q)) : this.sockets.send(ws, { t: "refused", why: "Searching too fast. Try again in a few seconds." });
    }
    if (msg.t === "talk") return me.role === "guest" ? this.sockets.send(ws, { t: "refused", why: "a guest has no voice channels" }) : this.talk(ws, me, msg.channel ?? "");
    if (msg.t === "voice") {
      // The page joined (or left, with no channel) a voice room on Qlave: everyone sees it beside the online list.
      const voice = me.role !== "guest" && msg.channel && (await this.voices()).some((v) => v.id === msg.channel) ? msg.channel : undefined;
      const { voice: _, ...rest } = me;
      this.sockets.attach(ws, { ...rest, ...(voice ? { voice } : {}) });
      return this.online();
    }
    if (msg.t === "say") {
      if (!channels.includes(ch) || !sees(me, ch, locked)) return this.sockets.send(ws, { t: "refused", why: `no channel #${ch}` });
      const text = this.chat.line(ws, msg.text ?? "", Date.now(), await this.studio() ? STUDIO_SAY_MAX : SAY_MAX);
      if (!text || (await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return;
      // A reply to a reply joins the thread it is in: threads are one deep.
      const to = msg.reply ? await this.message(ch, msg.reply) : undefined;
      if (msg.reply && !to) return this.sockets.send(ws, { t: "refused", why: "that message is gone" });
      return this.say(ch, { from: { id: me.id, name: me.name }, text, at: Date.now() }, to && (to.reply ?? to.id));
    }
    if (msg.t === "unsay") {
      const m = channels.includes(ch) && sees(me, ch, locked) && msg.of ? await this.message(ch, msg.of) : undefined;
      if (!m) return this.sockets.send(ws, { t: "refused", why: "that message is gone" });
      if (m.from.id !== me.id && !me.owner) return this.sockets.send(ws, { t: "refused", why: "only its sender, the space's owner or an admin deletes a message" });
      return this.unsay(ch, m);
    }
    // The rest is for those who run it: its owner and admins.
    if (!me.owner) return this.sockets.send(ws, { t: "refused", why: "only the space's owner or an admin can do that" });
    const voices = await this.voices();
    if (msg.t === "channel") {
      if (!msg.channel || (msg.voice ? voices.some((v) => v.name === msg.channel) : channels.includes(msg.channel))) return;
      if (channels.length + voices.length >= CHANNELS) return this.sockets.send(ws, { t: "refused", why: `a space has up to ${CHANNELS} channels` });
      if (msg.voice) await this.ctx.storage.put("voice", [...voices, { id: `v${crypto.randomUUID().slice(0, 8)}`, name: msg.channel }]);
      else {
        if (msg.private) await this.ctx.storage.put("private", { ...locked, [msg.channel]: [] } satisfies Locked);
        await this.ctx.storage.put("channels", [...channels, msg.channel]);
      }
      return this.announce();
    }
    if (msg.t === "drop") return this.dropChannel(ws, msg.channel ?? "");
    const id = msg.id ?? "";
    if (!id || id === me.id) return;
    if (msg.t === "allow") {
      const ids = msg.channel ? locked[msg.channel] : undefined;
      if (!ids || !msg.channel) return this.sockets.send(ws, { t: "refused", why: "that isn't a private channel" });
      const on = msg.on ?? true;
      if (on && ids.length >= (await this.studio() ? STUDIO_MEMBERS : SPACE_MEMBERS)) return;
      await this.ctx.storage.put("private", { ...locked, [msg.channel]: on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id) } satisfies Locked);
      return this.announce();
    }
    if (msg.t === "role") return this.setRole(ws, me, id, msg.role ?? "member");
    // An admin acts on members and guests; only an owner on another admin (or, in a studio, by the studio's own rules).
    const theirs = await this.roleOf(id);
    if (me.role !== "owner" && (theirs === "owner" || theirs === "admin") && msg.t === "mute")
      return this.sockets.send(ws, { t: "refused", why: "only an owner mutes an owner or an admin" });
    if (msg.t === "mute") {
      const muted = new Set(await this.ctx.storage.get<string[]>("muted") ?? []), on = msg.on ?? true;
      if (on) muted.add(id); else muted.delete(id);
      await this.ctx.storage.put("muted", [...muted]);
      // A space mute is a voice mute too, in every voice channel.
      const sid = await this.sid();
      return this.enqueue(voices.map((v): Order => ({ t: "mute", room: roomOf(sid, v.id), sub: id, on })));
    }
    // kick: out of the space's members (D1) and off every socket now; an invite brings them back. In a studio's space a guest goes the
    // same way; one of the studio's own goes out of the studio, by the studio's own rules (an admin can't take out an owner).
    const studio = await this.studio();
    if (!studio && me.role !== "owner" && theirs === "admin") return this.sockets.send(ws, { t: "refused", why: "only the owner takes out an admin" });
    if (!studio || theirs === "guest") return this.leave(id, "removed from the space");
    const r = await removeMember(this.env, studio, me.id, id);
    return r.ok ? this.out(id, "removed from the studio") : this.sockets.send(ws, { t: "refused", why: r.error });
  }

  webSocketClose(ws: RoomSocket) { this.online(ws); }
  webSocketError(ws: RoomSocket) { this.online(ws); }

  private async channels(): Promise<string[]> { return await this.ctx.storage.get<string[]>("channels") ?? ["general"]; }
  private async voices(): Promise<Voice[]> { return await this.ctx.storage.get<Voice[]>("voice") ?? []; }
  private async locked(): Promise<Locked> { return await this.ctx.storage.get<Locked>("private") ?? {}; }

  /** Someone's role here as D1 has it (they may be offline), or null when they aren't in it. */
  private async roleOf(id: string): Promise<SpaceRole | null> {
    return (await seatIn(this.env, await this.sid(), id))?.role ?? null;
  }

  /**
   * The owner of a person's own space makes a member an admin, a member or a guest. A studio's space takes its roles from the
   * studio. Their open pages close with ROLE_CHANGED and come back with the new role, the way a changed studio role does.
   */
  private async setRole(ws: RoomSocket, me: Member, id: string, role: "admin" | "member" | "guest") {
    if (await this.studio()) return this.sockets.send(ws, { t: "refused", why: "a studio's space takes its roles from the studio: change them on the Studio tab" });
    if (me.role !== "owner") return this.sockets.send(ws, { t: "refused", why: "only the space's owner hands out roles" });
    const sid = await this.sid();
    const set = await this.env.DB.prepare("UPDATE space_members SET role = ? WHERE space_id = (SELECT id FROM spaces WHERE id = ? AND owner != ?) AND user_id = ? RETURNING user_id")
      .bind(role, sid, id, id).first<string>("user_id");
    if (!set) return this.sockets.send(ws, { t: "refused", why: "no such member" });
    this.close((m) => m.id === id, ROLE_CHANGED, "your role in the space changed");
  }
  /** The studio that owns this space, if one does. */
  private async studio(): Promise<string | undefined> { return await this.ctx.storage.get<string>("studio"); }
  private async sid(): Promise<string> { return await this.ctx.storage.get<string>("sid") ?? ""; }
  /** eqosys's origin as the Worker saw it, for the tickets' and orders' `iss`. */
  private async iss(): Promise<string> {
    return await this.ctx.storage.get<string>("iss") ?? (this.env.BETTER_AUTH_URL ? new URL(this.env.BETTER_AUTH_URL).origin : "https://eqosys.qntbr.com");
  }

  /** What one member is told of the space: only the channels they see, and (to those who run it) who is let into each private one. */
  private async info(m: Member): Promise<{ t: "space" } & SpaceInfo> {
    const locked = await this.locked(), channels = (await this.channels()).filter((c) => sees(m, c, locked));
    const shut = channels.filter((c) => locked[c]);
    return {
      t: "space", name: await this.ctx.storage.get<string>("name") ?? "", channels, voice: m.role === "guest" ? [] : await this.voices(), owner: m.owner, role: m.role,
      max: await this.studio() ? STUDIO_SAY_MAX : SAY_MAX, ...(shut.length ? { private: shut } : {}),
      ...(m.owner && shut.length ? { allowed: shut.map((c) => ({ channel: c, ids: locked[c]! })) } : {}),
    };
  }

  /** The channels changed, or who is let into a private one: each member hears the list they see. */
  private async announce() {
    for (const sock of this.sockets.open()) { const m = this.sockets.who(sock); if (m) this.sockets.send(sock, await this.info(m)); }
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
        if (m?.voice === v.id) { const { voice: _, ...rest } = m; this.sockets.attach(sock, rest); }
      }
      await this.enqueue([{ t: "end", prefix: roomOf(await this.sid(), v.id) }]);
    } else {
      const channels = await this.channels();
      if (channel === "general" || !channels.includes(channel)) return this.sockets.send(ws, { t: "refused", why: channel === "general" ? "#general stays" : "no such channel" });
      await this.ctx.storage.put("channels", channels.filter((c) => c !== channel));
      const { [channel]: _, ...locked } = await this.locked();
      await this.ctx.storage.put("private", locked);
      for (const pre of [`p:${channel}:`, `t:${channel}:`]) for (const k of (await this.ctx.storage.list({ prefix: pre })).keys()) await this.ctx.storage.delete(k);
      await this.ctx.storage.delete(`n:${channel}`);
      await this.dropFiles((f) => f.channel === channel);
    }
    await this.announce();
    this.online();
  }

  /** Orders for Qlave, kept until it answers: the alarm sends them. */
  private async enqueue(orders: Order[]) {
    if (!orders.length) return;
    await queue(this.ctx.storage, await this.iss(), orders);
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Send what is waiting (qlave.ts `flush`), and wake again when something is left to retry. */
  async alarm() {
    await flush(this.ctx.storage, this.env);
    const next = await this.ctx.storage.get<number>("outboxAt");
    if (next) await this.ctx.storage.setAlarm(next);
  }

  /** A kept message of a channel by its number, or undefined when it never was or its page has gone. */
  private async message(channel: string, id: number): Promise<Msg | undefined> {
    return (await this.ctx.storage.get<Msg[]>(pageKey(channel, Math.ceil(id / PAGE))))?.find((m) => m.id === id);
  }

  /** A new message, the next number in its channel; a reply counts on the message it answers and joins its thread. */
  private async say(channel: string, said: Said & Pick<Msg, "file">, reply?: number): Promise<Msg> {
    const n = (await this.ctx.storage.get<number>(`n:${channel}`) ?? 0) + 1, page = Math.ceil(n / PAGE);
    const m: Msg = { ...said, id: n, ...(reply ? { reply } : {}) };
    await this.ctx.storage.put(pageKey(channel, page), [...(await this.ctx.storage.get<Msg[]>(pageKey(channel, page)) ?? []), m]);
    await this.ctx.storage.put(`n:${channel}`, n);
    if (n % PAGE === 1 && page > KEEP_PAGES) {
      // The oldest page goes, and the threads of the messages on it.
      const old = pageKey(channel, page - KEEP_PAGES);
      const gone = await this.ctx.storage.get<Msg[]>(old) ?? [];
      for (const x of gone) if (x.replies) await this.ctx.storage.delete(`t:${channel}:${x.id}`);
      await this.ctx.storage.delete(old);
      const ids = new Set(gone.filter((x) => x.file).map((x) => x.file!.id));
      if (ids.size) await this.dropFiles((_, id) => ids.has(id));
    }
    if (reply) {
      const key = pageKey(channel, Math.ceil(reply / PAGE)), held = await this.ctx.storage.get<Msg[]>(key) ?? [];
      await this.ctx.storage.put(key, held.map((x) => x.id === reply ? { ...x, replies: (x.replies ?? 0) + 1 } : x));
      await this.ctx.storage.put(`t:${channel}:${reply}`, [...(await this.ctx.storage.get<number[]>(`t:${channel}:${reply}`) ?? []), n].slice(-THREAD_MAX));
    }
    const locked = await this.locked(), out: SpaceOut = { t: "said", channel, ...m };
    for (const sock of this.sockets.open()) { const who = this.sockets.who(sock); if (who && sees(who, channel, locked)) this.sockets.send(sock, out); }
    return m;
  }

  /** A message is deleted: out of its page and its thread, its file off R2, and everyone who sees the channel hears it went. */
  private async unsay(channel: string, m: Msg) {
    const key = pageKey(channel, Math.ceil(m.id / PAGE));
    await this.ctx.storage.put(key, (await this.ctx.storage.get<Msg[]>(key) ?? []).filter((x) => x.id !== m.id));
    if (m.reply) {
      const top = pageKey(channel, Math.ceil(m.reply / PAGE)), held = await this.ctx.storage.get<Msg[]>(top) ?? [];
      await this.ctx.storage.put(top, held.map((x) => x.id !== m.reply ? x : (({ replies: n, ...rest }) => n && n > 1 ? { ...rest, replies: n - 1 } : rest)(x)));
      await this.ctx.storage.put(`t:${channel}:${m.reply}`, (await this.ctx.storage.get<number[]>(`t:${channel}:${m.reply}`) ?? []).filter((x) => x !== m.id));
    }
    if (m.replies) await this.ctx.storage.delete(`t:${channel}:${m.id}`);
    if (m.file) await this.dropFiles((_, id) => id === m.file!.id);
    const locked = await this.locked(), out: SpaceOut = { t: "unsaid", channel, id: m.id };
    for (const sock of this.sockets.open()) { const who = this.sockets.who(sock); if (who && sees(who, channel, locked)) this.sockets.send(sock, out); }
  }

  /** A member posts a file: checked against the channel, a mute, FILES_A_MINUTE, FILE_MAX and FILE_BYTES, put on R2, then said as a message. */
  private async fileIn(me: Member, req: Request, q: URLSearchParams): Promise<Response> {
    if (req.method !== "POST") return json({ error: "POST a file" }, 405);
    const bucket = this.env.FILES;
    if (!bucket) return json({ error: "no file sharing here" }, 503);
    const ch = q.get("channel") ?? "general";
    if (!(await this.channels()).includes(ch) || !sees(me, ch, await this.locked())) return json({ error: `no channel #${ch}` }, 404);
    if ((await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return json({ error: "you're muted here" }, 403);
    const now = Date.now(), recent = (this.posted.get(me.id) ?? []).filter((t) => t > now - 60_000);
    if (recent.length >= FILES_A_MINUTE) return json({ error: `up to ${FILES_A_MINUTE} files a minute; wait a little` }, 429);
    const data = await req.arrayBuffer();
    if (!data.byteLength) return json({ error: "that file is empty" }, 400);
    if (data.byteLength > FILE_MAX) return json({ error: `a file is up to ${FILE_MAX / 1024 / 1024} MB` }, 413);
    const used = await this.ctx.storage.get<number>("fileBytes") ?? 0;
    if (used + data.byteLength > FILE_BYTES) return json({ error: `this space keeps up to ${FILE_BYTES / 1024 ** 3} GB of files: delete some first` }, 507);
    this.posted.set(me.id, [...recent, now]);
    const id = crypto.randomUUID(), name = fileName(q.get("name")), type = fileType(q.get("type")), key = `${await this.sid()}/${ch}/${id}`;
    await bucket.put(key, data, { httpMetadata: { contentType: type } });
    await this.ctx.storage.put("fileBytes", used + data.byteLength);
    const m = await this.say(ch, { from: { id: me.id, name: me.name }, text: name, at: now, file: { id, name, size: data.byteLength, type } });
    await this.ctx.storage.put(`f:${id}`, { channel: ch, msg: m.id, by: me.id, key, size: data.byteLength } satisfies Kept);
    return json({ id, message: m.id });
  }

  /** A file back, to a member who sees the channel it was posted in. Always a download, and only SAFE_TYPES keep their type. */
  private async fileOut(me: Member, id: string): Promise<Response> {
    const f = await this.ctx.storage.get<Kept>(`f:${id}`);
    if (!f || !(await this.channels()).includes(f.channel) || !sees(me, f.channel, await this.locked())) return json({ error: "no such file" }, 404);
    const got = await this.env.FILES?.get(f.key);
    const name = (await this.message(f.channel, f.msg))?.file?.name ?? "file";
    if (!got) return json({ error: "no such file" }, 404);
    const type = got.httpMetadata?.contentType ?? "";
    return new Response(got.body, { headers: {
      "content-type": SAFE_TYPES.has(type) ? type : "application/octet-stream", "content-length": String(got.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "private, no-store",
    } });
  }

  /** The files `which` picks go: off R2, out of the space's count. */
  private async dropFiles(which: (f: Kept, id: string) => boolean) {
    const gone = [...await this.ctx.storage.list<Kept>({ prefix: "f:" })].map(([k, f]) => ({ k, id: k.slice(2), f })).filter((x) => which(x.f, x.id));
    if (!gone.length) return;
    for (let i = 0; i < gone.length; i += 1000) await this.env.FILES?.delete(gone.slice(i, i + 1000).map((x) => x.f.key));
    for (const x of gone) await this.ctx.storage.delete(x.k);
    const left = (await this.ctx.storage.get<number>("fileBytes") ?? 0) - gone.reduce((n, x) => n + x.f.size, 0);
    await this.ctx.storage.put("fileBytes", Math.max(0, left));
  }

  /** A message and its newest THREAD_SHOWN replies, oldest first: each page they sit on is read once. */
  private async thread(channel: string, id: number): Promise<SpaceOut> {
    const ids = [id, ...(await this.ctx.storage.get<number[]>(`t:${channel}:${id}`) ?? []).slice(-THREAD_SHOWN)], want = new Set(ids);
    const pages = new Map<number, Msg[]>();
    for (const p of new Set(ids.map((x) => Math.ceil(x / PAGE)))) pages.set(p, await this.ctx.storage.get<Msg[]>(pageKey(channel, p)) ?? []);
    const messages = [...pages.values()].flat().filter((m) => want.has(m.id)).sort((a, b) => a.id - b.id);
    return { t: "thread", channel, id, messages: messages[0]?.id === id ? messages : [] };
  }

  /** The newest PAGE kept messages of a channel that hold `q`, case aside, oldest first. */
  private async search(channel: string, q: string): Promise<SpaceOut> {
    const want = q.toLowerCase(), hits: Msg[] = [];
    const pages = [...(await this.ctx.storage.list<Msg[]>({ prefix: `p:${channel}:` })).values()].reverse();
    for (const page of pages) {
      for (const m of [...page].reverse()) if (m.text.toLowerCase().includes(want) || m.from.name.toLowerCase().includes(want)) hits.push(m);
      if (hits.length >= PAGE) break;
    }
    return { t: "found", channel, q, messages: hits.slice(0, PAGE).reverse() };
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
    this.close((m) => m.id === id && m.role !== "owner", 4003, why);
    // A kick retires the invite too: the kicked person holds it (everyone joined with it), so a fresh one is minted that only the owner hands out.
    if (out && why !== "left the space") await this.env.DB.prepare("UPDATE spaces SET invite = ? WHERE id = ?").bind(mintInvite(), sid).run();
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
    await this.dropFiles((f) => f.by === id);
    await this.ctx.storage.put("muted", (await this.ctx.storage.get<string[]>("muted") ?? []).filter((x) => x !== id));
    await this.ctx.storage.put("private", Object.fromEntries(Object.entries(await this.locked()).map(([c, ids]) => [c, ids.filter((x) => x !== id)])));
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
    await this.dropFiles(() => true);
    const sid = await this.sid(), iss = await this.iss(), outbox = await this.ctx.storage.get<unknown[]>("outbox") ?? [];
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
    const seen = new Map<string, { id: string; name: string; role: SpaceRole; voice?: string }>();
    for (const ws of this.sockets.open()) {
      const m = ws === gone ? null : this.sockets.who(ws);
      if (!m) continue;
      const said = m.voice && !told.has(m.voice) ? m.voice : undefined;
      const voice = heard.get(m.id) ?? said ?? seen.get(m.id)?.voice;
      seen.set(m.id, { id: m.id, name: m.name, role: m.role, ...(voice ? { voice } : {}) });
    }
    return [...seen.values()];
  }

  /** Who is online, to everyone. One person in two tabs is one name. */
  private async online(gone?: RoomSocket) { this.sockets.broadcast({ t: "online", members: await this.members(gone) }, gone); }
}

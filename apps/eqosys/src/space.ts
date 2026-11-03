// One Durable Object a space (Qollab, QOLLAB.md): a group that lasts, with text channels and their history, across every Q app.
// A party is the lobby before one game; a space is where the same people hang out between games, the way a chat server's
// rooms work. Who is in a space is D1's (`spaces`, `space_members`, handle.ts checks it at the door); this object holds the
// channels, the messages and who is online, and nobody reaches it but the Worker:
//   /socket?id=&name=&app=&sid=&space=&owner=   a member's live socket (sid is the space's id, space its name)
//   /erase?id=                              their account was deleted: their sockets close and their messages go
//   /drop                                   the space was deleted: every socket closes and everything here goes
// Messages are kept in pages of PAGE under `p:<channel>:<page>`, the last KEEP_PAGES pages a channel, numbered from 1.
import { bool, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import type { SpaceMsg, SpaceMessage } from "@rustybuns/util/eqosys";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { appOf } from "./apps.ts";
import { ChatGate, SAY_MAX, type Said } from "./chat.ts";
import { json, type Env } from "./env.ts";
import { file } from "./reports.ts";

export const PAGE = 50, KEEP_PAGES = 200, CHANNELS = 20, SPACES_OWNED = 10, SPACE_MEMBERS = 500;
export const CHANNEL = str(24, { min: 1, re: /^[a-z0-9-]+$/ });
/** A space's name as its owner typed it. */
export const SPACE_NAME = str(60, { min: 1 });

/** A message as a channel keeps it: its number in the channel, and who said what when. */
type Msg = SpaceMessage;
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), sid: str(64, { min: 1 }), space: str(60), owner: opt(oneOf(["1"])) });
type Member = { id: string; name: string; app: string; owner: boolean };

const SpaceIn = obj({
  t: oneOf(["say", "history", "channel", "mute", "kick", "report", "leave"]),
  channel: opt(CHANNEL), text: opt(str(SAY_MAX)), before: opt(int(1, 1e12)), id: opt(str(200, { min: 1 })), on: opt(bool()),
});
/** What a space says to a member: the page's guard is SpaceMsg in @rustybuns/util/eqosys. */
export type SpaceOut = SpaceMsg;

interface Storage {
  get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<boolean>;
  list<T>(o?: { prefix?: string }): Promise<Map<string, T>>;
}
interface SpaceCtx extends RoomCtx { storage: Storage }
interface Stub { fetch(req: Request): Promise<Response> }
/** The SPACE binding: one object a space id. */
export interface Spaces { idFromName(name: string): unknown; get(id: unknown): Stub }
export const spaceOf = (spaces: Spaces, id: string): Stub => spaces.get(spaces.idFromName(id));

const pageKey = (channel: string, page: number) => `p:${channel}:${String(page).padStart(8, "0")}`;

export class Space {
  private sockets: Sockets<Member, SpaceOut>;
  private chat = new ChatGate();

  constructor(private ctx: SpaceCtx, private env: Env) {
    this.sockets = new Sockets<Member, SpaceOut>(ctx, { maxBytes: 2000, rate: 5, burst: 10 });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/drop") return this.drop();
    if (url.pathname === "/erase") return this.erase(url.searchParams.get("id") ?? "");
    const who = check(Who, Object.fromEntries(url.searchParams));
    if (url.pathname !== "/socket" || !who) return json({ error: "not found" }, 404);
    await this.ctx.storage.put("sid", who.sid);
    await this.ctx.storage.put("name", who.space);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name, app: who.app, owner: who.owner === "1" });
    this.sockets.send(server, { t: "space", name: who.space, channels: await this.channels(), owner: who.owner === "1" });
    this.online();
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(SpaceIn, frame.value);
    if (!msg || !me) return;
    const channels = await this.channels();
    const ch = msg.channel ?? "general";
    if (msg.t === "leave") return this.leave(me.id);
    if (msg.t === "report") return this.report(ws, me, msg.id ?? "");
    if (msg.t === "history") return channels.includes(ch) ? this.sockets.send(ws, await this.history(ch, msg.before)) : undefined;
    if (msg.t === "say") {
      if (!channels.includes(ch)) return this.sockets.send(ws, { t: "refused", why: `no channel #${ch}` });
      const text = this.chat.line(ws, msg.text ?? "");
      if (!text || (await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return;
      return this.say(ch, { from: { id: me.id, name: me.name }, text, at: Date.now() });
    }
    // The rest is the owner's.
    if (!me.owner) return this.sockets.send(ws, { t: "refused", why: "only the space's owner can do that" });
    if (msg.t === "channel") {
      if (!msg.channel || channels.includes(msg.channel)) return;
      if (channels.length >= CHANNELS) return this.sockets.send(ws, { t: "refused", why: `a space has up to ${CHANNELS} channels` });
      await this.ctx.storage.put("channels", [...channels, msg.channel]);
      const name = await this.ctx.storage.get<string>("name") ?? "";
      for (const sock of this.sockets.open()) { const m = this.sockets.who(sock); if (m) this.sockets.send(sock, { t: "space", name, channels: [...channels, msg.channel], owner: m.owner }); }
      return;
    }
    const id = msg.id ?? "";
    if (!id || id === me.id) return;
    if (msg.t === "mute") {
      const muted = new Set(await this.ctx.storage.get<string[]>("muted") ?? []);
      if (msg.on ?? true) muted.add(id); else muted.delete(id);
      return this.ctx.storage.put("muted", [...muted]);
    }
    // kick: out of the space's members (D1) and off every socket now; an invite brings them back.
    return this.leave(id, "removed from the space");
  }

  webSocketClose(ws: RoomSocket) { this.online(ws); }
  webSocketError(ws: RoomSocket) { this.online(ws); }

  private async channels(): Promise<string[]> { return await this.ctx.storage.get<string[]>("channels") ?? ["general"]; }

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

  /** Out of the space: their D1 row goes and their sockets close. */
  private async leave(id: string, why = "left the space") {
    await this.env.DB.prepare("DELETE FROM space_members WHERE space_id = (SELECT id FROM spaces WHERE id = ? AND owner != ?) AND user_id = ?")
      .bind(await this.ctx.storage.get<string>("sid") ?? "", id, id).run();
    this.close((m) => m.id === id && !m.owner, 4003, why);
  }

  private close(which: (m: Member) => boolean, code: number, why: string) {
    for (const ws of this.sockets.open()) { const m = this.sockets.who(ws); if (m && which(m)) try { ws.close(code, why); } catch { /* closing */ } }
    this.online();
  }

  /** A report on a member: the owner hears of it, and a row goes through the game-report path (reports.ts), filed under the reporter's app. */
  private async report(ws: RoomSocket, me: Member, id: string) {
    let said: Msg | undefined;
    for (const ch of await this.channels()) {
      const page = await this.history(ch);
      said = [...(page.t === "history" ? page.messages : [])].reverse().find((m) => m.from.id === id) ?? said;
    }
    const name = this.members().find((m) => m.id === id)?.name ?? said?.from.name;
    if (!name) return this.sockets.send(ws, { t: "refused", why: "no such member" });
    for (const sock of this.sockets.open()) if (this.sockets.who(sock)?.owner) this.sockets.send(sock, { t: "reported", by: me.name, id, name });
    const app = appOf(me.app);
    if (!app) return;
    const filed = await file(this.env, app, me.id, "", { kind: "bug", title: "Space chat report", body: `A space member was reported in chat.\n\nReported: ${name} (${id})\nTheir last message: ${said?.text ?? "(none)"}` });
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

  /** The space is gone: everyone is out and nothing is kept. */
  private async drop(): Promise<Response> {
    this.close(() => true, 4004, "the space was deleted");
    for (const k of (await this.ctx.storage.list({})).keys()) await this.ctx.storage.delete(k);
    return json({ ok: true });
  }

  private members(gone?: RoomSocket) {
    const seen = new Map<string, { id: string; name: string }>();
    for (const ws of this.sockets.open()) { const m = ws === gone ? null : this.sockets.who(ws); if (m) seen.set(m.id, { id: m.id, name: m.name }); }
    return [...seen.values()];
  }

  /** Who is online, to everyone. One person in two tabs is one name. */
  private online(gone?: RoomSocket) { this.sockets.broadcast({ t: "online", members: this.members(gone) }, gone); }
}

// One Durable Object a party (Qollab, QOLLAB.md): the lobby a game's players meet in before the game starts its own room.
// Nobody reaches a party directly. The Worker checks the token at /q/party/<code> (handle.ts) and calls it as
//   /socket?id=&name=&app=   a member's live socket: the member list on connect and whenever someone joins or leaves
// A party is made by POST /q/party (handle.ts), belongs to the app of whoever made it, and is good 24 hours:
// an unknown or expired code is a 404 and a member from another app a 403.
// Members are read off the open sockets; storage holds the app, host, ready ids and whether the host has started.
import { check, bool, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { TokenBucket } from "@rustybuns/util/limits";
import { appOf } from "./apps.ts";
import { json, type Env } from "./env.ts";
import { hubAsk } from "./hub.ts";
import { file } from "./reports.ts";

/** Chat: one message's length, how many a party keeps, and each socket's rate (2 a second, a burst of 5). */
export const SAY_MAX = 280, CHAT_KEPT = 200, SAY_RATE = 2, SAY_BURST = 5;
export type Said = { from: { id: string; name: string }; text: string; at: number };

const Member = obj({ id: str(200, { min: 1 }), name: str(200) });
export type Member = Of<typeof Member>;
/** A member as the party shows them: ready, and the host marked. */
export type Seen = Member & { ready: boolean; host: boolean };
/** What a member sends: ready up or stand down, and (the host only) start. */
const PartyIn = obj({
  t: oneOf(["ready", "start", "say", "mute", "report"]), ready: opt(bool()),
  text: opt(str(SAY_MAX)), id: opt(str(200, { min: 1 })), on: opt(bool()),
});
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), code: opt(str(12)) });
export type PartyOut =
  | { t: "members"; app: string; members: Seen[] }
  /** The host started: go to this room, in this seat (0 is the host's, then by name). */
  | { t: "start"; room: string; seat: number }
  | { t: "refused"; why: string }
  /** A chat message, from the live party or the last of its history. */
  | ({ t: "say" } & Said)
  /** To the host: someone reported a member. */
  | { t: "reported"; by: string; id: string; name: string };

interface PartyCtx extends RoomCtx { storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> } }
interface Stub { fetch(req: Request): Promise<Response> }
/** The PARTY binding: one party per room code. */
export interface Parties { idFromName(name: string): unknown; get(id: unknown): Stub }

/** The party a code names. */
export const partyOf = (parties: Parties, code: string): Stub => parties.get(parties.idFromName(code));

const LETTERS = "BCDFGHJKLMNPQRSTVWXYZ";
/** A fresh six-character room code, no vowels. */
export const mintCode = (): string => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => LETTERS[b % LETTERS.length]).join("");
/** How long a party's code is good. */
export const PARTY_LIFE = 24 * 60 * 60 * 1000;

/** A room code as a person types it: letters and digits, case ignored. Null when it can't be one. */
export const codeOf = (raw: string): string | null => /^[A-Za-z0-9]{4,12}$/.test(raw) ? raw.toUpperCase() : null;

export class Party {
  private sockets: Sockets<Member, PartyOut>;

  private chat = new WeakMap<RoomSocket, TokenBucket>();

  constructor(private ctx: PartyCtx, private env: Env) {
    this.sockets = new Sockets<Member, PartyOut>(ctx, { maxBytes: 2000, rate: 5, burst: 10 });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    const who = check(Who, Object.fromEntries(url.searchParams));
    if (url.pathname === "/make") {
      // The Worker minted this code; it is taken if a live party already holds it.
      const held = await this.ctx.storage.get<number>("expires");
      if (held && held > now) return json({ error: "taken" }, 409);
      if (!who) return json({ error: "bad" }, 400);
      await this.ctx.storage.put("app", who.app);
      await this.ctx.storage.put("host", who.id);
      await this.ctx.storage.put("hostName", who.name);
      await this.ctx.storage.put("code", who.code ?? "");
      await this.ctx.storage.put("expires", now + PARTY_LIFE);
      await this.ctx.storage.put("ready", []);
      await this.ctx.storage.put("open", url.searchParams.get("open") === "1");
      await this.ctx.storage.put("started", false);
      return json({ ok: true });
    }
    if (url.pathname !== "/socket" || !who) return json({ error: "not found" }, 404);
    const app = await this.ctx.storage.get<string>("app"), expires = await this.ctx.storage.get<number>("expires");
    if (!app || !expires || expires <= now) return json({ error: "no such party" }, 404);
    if (app !== who.app) return json({ error: "that party is for another app" }, 403);
    // A closed party (the default) admits the host and the host's friends, read off the host's hub.
    const host = await this.ctx.storage.get<string>("host");
    if (who.id !== host && !(await this.ctx.storage.get<boolean>("open")) && !(await this.friendOfHost(host ?? "", app, who.id)))
      return json({ error: "that party is for the host's friends" }, 403);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name });
    // One person in two tabs is one member: the older tab goes.
    this.sockets.replace(server, (m) => m.id === who.id, 4000, "joined from another tab");
    await this.announce(app);
    for (const m of await this.ctx.storage.get<Said[]>("chat") ?? []) this.sockets.send(server, { t: "say", ...m });
    // Someone who arrives after the start is handed the same room.
    if (await this.ctx.storage.get<boolean>("started")) this.sockets.send(server, await this.startFor(who.id, url.searchParams.get("code") ?? ""));
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(PartyIn, frame.value);
    if (!msg || !me) return;
    if (msg.t === "say") return this.say(ws, me, msg.text ?? "");
    if (msg.t === "mute") return this.mute(ws, me, msg.id ?? "", msg.on ?? true);
    if (msg.t === "report") return this.report(ws, me, msg.id ?? "");
    const ready = new Set(await this.ctx.storage.get<string[]>("ready") ?? []);
    if (msg.t === "ready") {
      if (msg.ready ?? true) ready.add(me.id); else ready.delete(me.id);
      await this.ctx.storage.put("ready", [...ready]);
      return this.announce(await this.ctx.storage.get<string>("app") ?? "");
    }
    // start: the host's alone, and only once everyone else is ready.
    const host = await this.ctx.storage.get<string>("host");
    if (me.id !== host) return this.sockets.send(ws, { t: "refused", why: "only the host can start" });
    const members = this.members();
    const waiting = members.filter((m) => m.id !== host && !ready.has(m.id));
    if (waiting.length) return this.sockets.send(ws, { t: "refused", why: `waiting for ${waiting.map((m) => m.name).join(", ")}` });
    await this.ctx.storage.put("started", true);
    const room = (await this.ctx.storage.get<string>("code")) ?? "";
    for (const sock of this.sockets.open()) {
      const m = this.sockets.who(sock);
      if (m) this.sockets.send(sock, await this.startFor(m.id, room));
    }
  }

  private async friendOfHost(host: string, app: string, id: string): Promise<boolean> {
    if (!host || !this.env.HUB) return false;
    // As the host with the name they signed in under, so the hub keeps the name it has.
    const state = await hubAsk(this.env.HUB, { id: host, name: await this.ctx.storage.get<string>("hostName") ?? "", app }, { op: "state" });
    return "friends" in state && state.friends.some((f) => f.id === id);
  }

  /** A message to the party: trimmed, rate-limited per socket, dropped when the sender is muted, kept for the last 200. */
  private async say(ws: RoomSocket, me: Member, text: string) {
    const t = text.trim();
    if (!t) return;
    let b = this.chat.get(ws);
    if (!b) this.chat.set(ws, (b = new TokenBucket(SAY_RATE, SAY_BURST, Date.now())));
    if (!b.take(Date.now())) return;
    if ((await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return;
    const m: Said = { from: me, text: t, at: Date.now() };
    const kept = [...(await this.ctx.storage.get<Said[]>("chat") ?? []), m].slice(-CHAT_KEPT);
    await this.ctx.storage.put("chat", kept);
    this.sockets.broadcast({ t: "say", ...m });
  }

  /** The host quiets a member (or lets them speak again) for the whole party, now. */
  private async mute(ws: RoomSocket, me: Member, id: string, on: boolean) {
    if (me.id !== await this.ctx.storage.get<string>("host")) return this.sockets.send(ws, { t: "refused", why: "only the host can mute" });
    const muted = new Set(await this.ctx.storage.get<string[]>("muted") ?? []);
    if (on && id !== me.id) muted.add(id); else muted.delete(id);
    await this.ctx.storage.put("muted", [...muted]);
  }

  /** A report on a member: the host hears of it, and a row goes through the game-report path (reports.ts). */
  private async report(ws: RoomSocket, me: Member, id: string) {
    const said = [...(await this.ctx.storage.get<Said[]>("chat") ?? [])].reverse().find((m) => m.from.id === id);
    const name = this.members().find((m) => m.id === id)?.name ?? said?.from.name;
    if (!name) return this.sockets.send(ws, { t: "refused", why: "no such member" });
    const host = await this.ctx.storage.get<string>("host");
    for (const sock of this.sockets.open()) if (this.sockets.who(sock)?.id === host) this.sockets.send(sock, { t: "reported", by: me.name, id, name });
    const app = appOf(await this.ctx.storage.get<string>("app"));
    if (!app) return;
    const filed = await file(this.env, app, me.id, "", { kind: "bug", title: "Party chat report", body: `A party member was reported in chat.\n\nReported: ${name} (${id})\nTheir last message: ${said?.text ?? "(none)"}` });
    if (!filed.ok) this.sockets.send(ws, { t: "refused", why: filed.error });
  }

  webSocketClose(ws: RoomSocket) { void this.left(ws); }
  webSocketError(ws: RoomSocket) { void this.left(ws); }

  private async left(ws: RoomSocket) {
    await this.announce(await this.ctx.storage.get<string>("app") ?? "", ws);
  }

  /** The room a start points at: the party's own code, so everyone lands in the same world. */
  private async startFor(id: string, room: string): Promise<PartyOut> {
    const host = await this.ctx.storage.get<string>("host");
    const order = [...this.members()].sort((a, b) => (a.id === host ? -1 : b.id === host ? 1 : a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
    return { t: "start", room, seat: Math.max(0, order.findIndex((m) => m.id === id)) };
  }

  private members(gone?: RoomSocket): Member[] {
    const seen = new Map<string, Member>();
    for (const ws of this.sockets.open()) {
      const m = ws === gone ? null : this.sockets.who(ws);
      if (m) seen.set(m.id, m);
    }
    return [...seen.values()];
  }

  /** The member list with ready flags, to everyone in the party. `gone` is a socket that is closing and no longer counts. */
  private async announce(app: string, gone?: RoomSocket) {
    const ready = new Set(await this.ctx.storage.get<string[]>("ready") ?? []), host = await this.ctx.storage.get<string>("host");
    const members = this.members(gone).map((m): Seen => ({ ...m, ready: ready.has(m.id), host: m.id === host }));
    this.sockets.broadcast({ t: "members", app, members }, gone);
  }
}

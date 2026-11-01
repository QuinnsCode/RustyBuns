// One Durable Object a party (Qollab, QOLLAB.md): the lobby a game's players meet in before the game starts its own room.
// Nobody reaches a party directly. The Worker checks the token at /q/party/<code> (handle.ts) and calls it as
//   /socket?id=&name=&app=   a member's live socket: the member list on connect and whenever someone joins or leaves
// A party is made by POST /q/party (handle.ts), belongs to the app of whoever made it, and is good 24 hours:
// an unknown or expired code is a 404 and a member from another app a 403.
// Members are read off the open sockets; storage holds the app, host, ready ids and whether the host has started.
import { check, bool, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { json } from "./env.ts";

const Member = obj({ id: str(200, { min: 1 }), name: str(200) });
export type Member = Of<typeof Member>;
/** A member as the party shows them: ready, and the host marked. */
export type Seen = Member & { ready: boolean; host: boolean };
/** What a member sends: ready up or stand down, and (the host only) start. */
const PartyIn = obj({ t: oneOf(["ready", "start"]), ready: opt(bool()) });
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), code: opt(str(12)) });
export type PartyOut =
  | { t: "members"; app: string; members: Seen[] }
  /** The host started: go to this room, in this seat (0 is the host's, then by name). */
  | { t: "start"; room: string; seat: number }
  | { t: "refused"; why: string };

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

  constructor(private ctx: PartyCtx, _env: unknown) {
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
      await this.ctx.storage.put("code", who.code ?? "");
      await this.ctx.storage.put("expires", now + PARTY_LIFE);
      await this.ctx.storage.put("ready", []);
      await this.ctx.storage.put("started", false);
      return json({ ok: true });
    }
    if (url.pathname !== "/socket" || !who) return json({ error: "not found" }, 404);
    const app = await this.ctx.storage.get<string>("app"), expires = await this.ctx.storage.get<number>("expires");
    if (!app || !expires || expires <= now) return json({ error: "no such party" }, 404);
    if (app !== who.app) return json({ error: "that party is for another app" }, 403);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name });
    // One person in two tabs is one member: the older tab goes.
    this.sockets.replace(server, (m) => m.id === who.id, 4000, "joined from another tab");
    await this.announce(app);
    // Someone who arrives after the start is handed the same room.
    if (await this.ctx.storage.get<boolean>("started")) this.sockets.send(server, await this.startFor(who.id, url.searchParams.get("code") ?? ""));
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(PartyIn, frame.value);
    if (!msg || !me) return;
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

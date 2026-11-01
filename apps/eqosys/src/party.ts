// One Durable Object a party (Qollab, QOLLAB.md): the lobby a game's players meet in before the game starts its own room.
// Nobody reaches a party directly. The Worker checks the token at /q/party/<code> (handle.ts) and calls it as
//   /socket?id=&name=&app=   a member's live socket: the member list on connect and whenever someone joins or leaves
// A party is made by POST /q/party (handle.ts), belongs to the app of whoever made it, and is good 24 hours:
// an unknown or expired code is a 404 and a member from another app a 403.
// The member list is read off the open sockets, so nothing is stored but the app, and a party nobody is in costs nothing.
import { arr, check, obj, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { json } from "./env.ts";

const Member = obj({ id: str(200, { min: 1 }), name: str(200) });
export type Member = Of<typeof Member>;
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }) });
export type PartyOut = { t: "members"; app: string; members: Member[] };

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
    if (url.pathname === "/make") {
      // The Worker minted this code; it is taken if a live party already holds it.
      const held = await this.ctx.storage.get<number>("expires");
      if (held && held > now) return json({ error: "taken" }, 409);
      const who = check(Who, Object.fromEntries(url.searchParams));
      if (!who) return json({ error: "bad" }, 400);
      await this.ctx.storage.put("app", who.app);
      await this.ctx.storage.put("expires", now + PARTY_LIFE);
      return json({ ok: true });
    }
    const who = url.pathname === "/socket" && check(Who, Object.fromEntries(url.searchParams));
    if (!who) return json({ error: "not found" }, 404);
    const app = await this.ctx.storage.get<string>("app"), expires = await this.ctx.storage.get<number>("expires");
    if (!app || !expires || expires <= now) return json({ error: "no such party" }, 404);
    if (app !== who.app) return json({ error: "that party is for another app" }, 403);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name });
    // One person in two tabs is one member: the older tab goes.
    this.sockets.replace(server, (m) => m.id === who.id, 4000, "joined from another tab");
    this.announce(who.app);
    return response;
  }

  webSocketClose(ws: RoomSocket) { void this.left(ws); }
  webSocketError(ws: RoomSocket) { void this.left(ws); }

  private async left(ws: RoomSocket) {
    this.announce(await this.ctx.storage.get<string>("app") ?? "", ws);
  }

  /** The member list, to everyone in the party. `gone` is a socket that is closing and no longer counts. */
  private announce(app: string, gone?: RoomSocket) {
    const seen = new Map<string, Member>();
    for (const ws of this.sockets.open()) {
      const m = ws === gone ? null : this.sockets.who(ws);
      if (m) seen.set(m.id, m);
    }
    const members = check(arr(Member, 1000), [...seen.values()]) ?? [];
    this.sockets.broadcast({ t: "members", app, members }, gone);
  }
}

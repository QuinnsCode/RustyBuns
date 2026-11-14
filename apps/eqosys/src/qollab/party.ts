// One Durable Object a party (Qollab, QOLLAB.md): the lobby a game's players meet in before the game starts its own room.
// Nobody reaches a party directly. The Worker checks the token at /q/party/<code> (handle.ts) and calls it as
//   /socket?id=&name=&app=&iss=   a member's live socket: the member list on connect and whenever someone joins or leaves
// A party is made by POST /q/party (handle.ts), belongs to the app of whoever made it, and is good 24 hours (the host's `hours` rule):
// an unknown or expired code is a 404 and a member from another app a 403.
// Members are read off the open sockets; storage holds the app, host, ready ids and whether the host has started.
// The host's rules (@rustybuns/util/party-rules, #3881) decide who gets in, how many, whether late, what start needs and
// who may talk, mute, report and invite (with "the host", a link carries a key the door checks, #3908), and how long the party lives; the host also kicks, blocks (their list: refused at
// the door, or let in hidden from the host by the `block` rule) and hands the party to someone else.
// Voice (#4463, QLAVE.md): a member asks for a one-use Qlave ticket over the socket (`talk`), into one room a party
// (`party:<code>:<8 hex>`, kept under `voice` once someone first talks). A party mute and the host's kick or block reach
// Qlave as orders through the same outbox a space keeps; the party ending (its age, the host shortening it, the host's
// account deleted) ends the room. Who is in voice is each page's word (`{ t: "voice", on }`), shown on the member list.
import { arr, check, bool, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { refuseSocket, Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { sign, START_S, startAud } from "@rustybuns/util/token";
import { b64url } from "@rustybuns/util/bytes";
import { defaultRules, LIVES, may, PartyRules, readyEnough } from "@rustybuns/util/party-rules";
import { ChatGate, SAY_MAX, type Said } from "./chat.ts";
import { HOME } from "../apps.ts";
import { appOf } from "../listings.ts";
import { json, type Env } from "../env.ts";
import { hubAsk } from "./hub.ts";
import { file, reporterId } from "../reports.ts";
import { flush, partyRoom, qlaveUrl, queue, send, ticket, type Order, type OutboxStorage } from "./qlave.ts";

/** What a non-friend hears on a closed party's door. */
const FRIENDS_ONLY = "Only the host's friends can join with the code alone: ask someone in the party for its link.";
/** The door's other refusals, each with its close code, so the page can say why and stop trying. */
const DOOR = {
  friendsOfMembers: { code: 4403, why: "Only friends of someone in the party can join with the code alone: ask one of them for its link." },
  blocked: { code: 4405, why: "The host has blocked you from this party." },
  late: { code: 4408, why: "This party has started and isn't taking late joiners." },
  full: { code: 4407, why: "This party is full." },
  uninvited: { code: 4410, why: "Only the host can invite people to this party: ask them for a fresh link." },
} as const;
/** A member the host took out: closed with this, free to come back unless blocked too. */
const CLOSE_KICKED = 4406;
/** Everyone, when the host shortened the party past its age. */
const CLOSE_ENDED = 4409;

/** Chat: how many messages a party keeps (length and rate are chat.ts's). */
export const CHAT_KEPT = 200;

const Member = obj({ id: str(200, { min: 1 }), name: str(200) });
export type Member = Of<typeof Member>;
/** A member's socket: who, and whether their page says it is in the party's voice room. */
type Sock = Member & { voice?: boolean };
/** A member as the party shows them: ready, the host marked, and in voice when they are. */
export type Seen = Sock & { ready: boolean; host: boolean };
/** What `/peek` answers: the party someone is in right now (its room code, game, seats and who is ready), or null. */
export const PartyPeek = obj({ party: nul(obj({ code: str(12), app: str(64), size: num(1, 1000), members: arr(obj({ id: str(200, { min: 1 }), name: str(200), ready: bool(), host: bool() }), 1000) })) });
export type PartyPeek = Of<typeof PartyPeek>;
/** What a member sends: ready up or stand down, and (the host only) start. */
const PartyIn = obj({
  t: oneOf(["ready", "start", "say", "mute", "report", "rules", "kick", "block", "host", "relink", "talk", "voice"]), ready: opt(bool()),
  text: opt(str(SAY_MAX)), id: opt(str(200, { min: 1 })), on: opt(bool()), rules: opt(PartyRules),
});
const Who = obj({ id: str(200, { min: 1 }), name: str(200), app: str(64, { min: 1 }), code: opt(str(12)), iss: opt(str(200)), invite: opt(str(64)) });
export type PartyOut =
  | { t: "members"; app: string; members: Seen[] }
  /** The host started: go to this room, in this seat (0 is the host's, then by name). `ticket` is eqosys's word on both,
   *  for the game's Worker to check (`startTicket` in @rustybuns/util/token); absent with no signing key. */
  | { t: "start"; room: string; seat: number; ticket?: string }
  | { t: "refused"; why: string }
  /** The party's rules, on joining and whenever the host changes them; `blocked` (the host's list) goes to the host alone,
   *  `invite` (the key a link carries) to whoever the `invite` rule lets hand one out. */
  | { t: "rules"; rules: PartyRules; blocked?: Member[]; invite?: string }
  /** A chat message, from the live party or the last of its history. */
  | ({ t: "say" } & Said)
  /** To the host: someone reported a member. */
  | { t: "reported"; by: string; id: string; name: string }
  /** To the asker alone: a one-use ticket into the party's voice room on Qlave at `url`. */
  | { t: "ticket"; url: string; ticket: string };

interface PartyCtx extends RoomCtx { storage: OutboxStorage & { setAlarm(at: number): Promise<void> } }
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
/** The longest a party can live (the `hours` rule's top choice): how long a seat is remembered. */
export const PARTY_LIFE_MAX = Math.max(...LIVES) * 60 * 60 * 1000;

/** A fresh invite key: what a party link carries so that, with the `invite` rule at "host", the door knows the host handed it out. */
const mintKey = (): string => b64url(crypto.getRandomValues(new Uint8Array(12)));

/** A room code as a person types it: letters and digits, case ignored. Null when it can't be one. */
export const codeOf = (raw: string): string | null => /^[A-Za-z0-9]{4,12}$/.test(raw) ? raw.toUpperCase() : null;

export class Party {
  private sockets: Sockets<Sock, PartyOut>;

  private chat = new ChatGate();

  constructor(private ctx: PartyCtx, private env: Env) {
    this.sockets = new Sockets<Sock, PartyOut>(ctx, { maxBytes: 2000, rate: 5, burst: 10 });
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
      // The expired party this code held had a voice room its alarm didn't end: end it now.
      await this.endVoice();
      await this.ctx.storage.put("app", who.app);
      await this.ctx.storage.put("host", who.id);
      await this.ctx.storage.put("hostName", who.name);
      await this.ctx.storage.put("code", who.code ?? "");
      await this.ctx.storage.put("made", now);
      await this.ctx.storage.put("expires", now + PARTY_LIFE);
      await this.ctx.storage.put("ready", []);
      await this.ctx.storage.put("open", url.searchParams.get("open") === "1");
      await this.ctx.storage.put("rules", defaultRules(url.searchParams.get("open") === "1"));
      await this.ctx.storage.put("blocked", []);
      await this.ctx.storage.put("invite", mintKey());
      await this.ctx.storage.put("admitted", []);
      await this.ctx.storage.put("startedWith", []);
      await this.ctx.storage.put("started", false);
      // A code comes round again once its party expired: nothing of the old one (its chat, its mutes) reaches the new one's members.
      await this.ctx.storage.put("chat", []);
      await this.ctx.storage.put("muted", []);
      return json({ ok: true });
    }
    if (url.pathname === "/erase") return this.erase(url.searchParams.get("id") ?? "");
    if (url.pathname === "/peek") return json(await this.peek(url.searchParams.get("id") ?? "", now));
    // Signed out (members.ts closeSockets): the person's socket here closes if their cut tokens were this party's app's. They stay a member and may come back.
    if (url.pathname === "/out") {
      const id = url.searchParams.get("id"), app = url.searchParams.get("app") ?? "*";
      if (id && (app === "*" || app === await this.ctx.storage.get<string>("app")))
        for (const ws of this.sockets.open()) if (this.sockets.who(ws)?.id === id) try { ws.close(4003, "signed out"); } catch { /* closing */ }
      return json({ ok: true });
    }
    if (url.pathname !== "/socket" || !who) return json({ error: "not found" }, 404);
    const app = await this.ctx.storage.get<string>("app"), expires = await this.ctx.storage.get<number>("expires");
    if (!app || !expires || expires <= now) return json({ error: "no such party" }, 404);
    if (app !== who.app) return json({ error: "that party is for another app" }, 403);
    // The door, by the host's rules. A refusal is let in and closed with its code (a refused upgrade shows the page
    // nothing, so it would read as a code that doesn't exist).
    const no = await this.door(who, app);
    if (no) return refuseSocket(JSON.stringify({ t: "refused", why: no.why }), no.code, "refused");
    // The issuer a start ticket is signed as: the origin this party is reached at, as the Worker saw it.
    if (who.iss) await this.ctx.storage.put("iss", who.iss);
    const { server, response } = this.sockets.upgrade({ id: who.id, name: who.name });
    // One person in two tabs is one member: the older tab goes.
    this.sockets.replace(server, (m) => m.id === who.id, 4000, "joined from another tab");
    await this.announce(app);
    this.sockets.send(server, await this.rulesFor(who.id));
    const apart = await this.apart();
    for (const m of await this.ctx.storage.get<Said[]>("chat") ?? []) if (!apart(who.id, m.from.id)) this.sockets.send(server, { t: "say", ...m });
    // Someone who arrives after the start is handed the same room.
    if (await this.ctx.storage.get<boolean>("started")) this.sockets.send(server, await this.startFor(who, url.searchParams.get("code") ?? ""));
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const msg = frame && check(PartyIn, frame.value);
    if (!msg || !me) return;
    if (msg.t === "say") return this.say(ws, me, msg.text ?? "");
    if (msg.t === "mute") return this.mute(ws, me, msg.id ?? "", msg.on ?? true);
    if (msg.t === "report") return this.report(ws, me, msg.id ?? "");
    if (msg.t === "talk") return this.talk(ws, me);
    if (msg.t === "voice") {
      // The page joined (or left) the voice room on Qlave: everyone sees it on the member list.
      this.sockets.attach(ws, { id: me.id, name: me.name, ...(msg.on ? { voice: true } : {}) });
      return this.announce(await this.ctx.storage.get<string>("app") ?? "");
    }
    if (msg.t === "rules" || msg.t === "kick" || msg.t === "block" || msg.t === "host" || msg.t === "relink") return this.hostDoes(ws, me, msg);
    const ready = new Set(await this.ctx.storage.get<string[]>("ready") ?? []);
    if (msg.t === "ready") {
      if (msg.ready ?? true) ready.add(me.id); else ready.delete(me.id);
      await this.ctx.storage.put("ready", [...ready]);
      return this.announce(await this.ctx.storage.get<string>("app") ?? "");
    }
    // start: the host's alone, once the ready rule is met.
    const host = await this.ctx.storage.get<string>("host");
    if (me.id !== host) return this.sockets.send(ws, { t: "refused", why: "only the host can start" });
    const members = this.members(), others = members.filter((m) => m.id !== host);
    const waiting = others.filter((m) => !ready.has(m.id));
    if (!readyEnough((await this.rules()).ready, others.length, others.length - waiting.length)) return this.sockets.send(ws, { t: "refused", why: `waiting for ${waiting.map((m) => m.name).join(", ")}` });
    await this.ctx.storage.put("started", true);
    await this.ctx.storage.put("startedWith", members.map((m) => m.id));
    const room = (await this.ctx.storage.get<string>("code")) ?? "";
    for (const sock of this.sockets.open()) {
      const m = this.sockets.who(sock);
      if (m) this.sockets.send(sock, await this.startFor(m, room));
    }
  }

  /** The party as the eqosys home shows it beside your friends: only while `id` is in it now, and only the members they may see. */
  private async peek(id: string, now: number): Promise<PartyPeek> {
    const app = await this.ctx.storage.get<string>("app"), expires = await this.ctx.storage.get<number>("expires");
    if (!app || !expires || expires <= now || !this.members().some((m) => m.id === id)) return { party: null };
    const ready = new Set(await this.ctx.storage.get<string[]>("ready") ?? []), host = await this.ctx.storage.get<string>("host"), apart = await this.apart();
    const members = this.members().filter((m) => !apart(id, m.id)).map((m): Seen => ({ ...m, ready: ready.has(m.id), host: m.id === host }));
    return { party: { code: await this.ctx.storage.get<string>("code") ?? "", app, size: (await this.rules()).size, members } };
  }

  /** The party's rules: what the host set, over how a party made before rules (or before a rule) behaves. */
  private async rules(): Promise<PartyRules> {
    return { ...defaultRules(!!(await this.ctx.storage.get<boolean>("open"))), ...await this.ctx.storage.get<Partial<PartyRules>>("rules") };
  }

  /** Whether two members are kept from each other: with blocked people let in hidden, the host and anyone on their list. */
  private async apart(): Promise<(a: string, b: string) => boolean> {
    if ((await this.rules()).block !== "hidden") return () => false;
    const host = await this.ctx.storage.get<string>("host"), blocked = new Set((await this.ctx.storage.get<Member[]>("blocked") ?? []).map((b) => b.id));
    return (a, b) => (a === host && blocked.has(b)) || (b === host && blocked.has(a));
  }

  /** Every socket of a blocked person, closed: when blocked people are kept out. */
  private async shutOut() {
    const blocked = new Set((await this.ctx.storage.get<Member[]>("blocked") ?? []).map((b) => b.id));
    for (const sock of this.sockets.open()) if (blocked.has(this.sockets.who(sock)?.id ?? "")) {
      this.sockets.send(sock, { t: "refused", why: DOOR.blocked.why });
      try { sock.close(DOOR.blocked.code, "blocked by the host"); } catch { /* closing */ }
    }
  }

  private async rulesFor(id: string): Promise<PartyOut> {
    const host = id === await this.ctx.storage.get<string>("host"), rules = await this.rules(), invite = may(rules.invite, host) && await this.inviteKey();
    return { t: "rules", rules, ...(host && { blocked: await this.ctx.storage.get<Member[]>("blocked") ?? [] }), ...(invite && { invite }) };
  }

  /** The key party links carry; a party made before keys gets one now. */
  private async inviteKey(): Promise<string> {
    const key = await this.ctx.storage.get<string>("invite");
    if (key) return key;
    const fresh = mintKey();
    await this.ctx.storage.put("invite", fresh);
    return fresh;
  }

  /** Why `who` may not come in, or null; let in, they are remembered, so coming back (a reload, after a start) needs no link. */
  private async door(who: Member & { invite?: string }, app: string): Promise<{ code: number; why: string } | null> {
    const no = await this.doorRules(who, app);
    if (!no) {
      const admitted = await this.ctx.storage.get<string[]>("admitted") ?? [];
      if (!admitted.includes(who.id)) await this.ctx.storage.put("admitted", [...admitted, who.id].slice(-500));
    }
    return no;
  }

  /** The door's rules. The host always may; someone already in (another tab) is never counted twice. With the `invite`
   *  rule at "host", a newcomer needs the key from a link the host handed out. */
  private async doorRules(who: Member & { invite?: string }, app: string): Promise<{ code: number; why: string } | null> {
    const host = await this.ctx.storage.get<string>("host") ?? "";
    if (who.id === host) return null;
    const rules = await this.rules(), members = this.members(), here = members.some((m) => m.id === who.id);
    if (rules.block === "out" && (await this.ctx.storage.get<Member[]>("blocked") ?? []).some((b) => b.id === who.id)) return DOOR.blocked;
    if (!here && members.length >= rules.size) return DOOR.full;
    if (!rules.late && await this.ctx.storage.get<boolean>("started") && !(await this.ctx.storage.get<string[]>("startedWith") ?? []).includes(who.id)) return DOOR.late;
    // A party link is an invitation: whoever holds its key comes in, a friend or not, with or without an account before today,
    // and (remembered in `admitted`) comes back without it. `join` is for someone who only has the code.
    const invited = here || who.invite === await this.inviteKey() || (await this.ctx.storage.get<string[]>("admitted") ?? []).includes(who.id);
    if (rules.invite === "host" && !invited) return DOOR.uninvited;
    if (invited || rules.join === "anyone" || await this.friendOf(host, await this.ctx.storage.get<string>("hostName") ?? "", app, who.id)) return null;
    if (rules.join === "friends" || rules.invite === "host") return { code: 4403, why: FRIENDS_ONLY };
    for (const m of members) if (m.id !== host && await this.friendOf(m.id, m.name, app, who.id)) return null;
    return DOOR.friendsOfMembers;
  }

  private async friendOf(of: string, name: string, app: string, id: string): Promise<boolean> {
    if (!of || !this.env.HUB) return false;
    // As them with the name they signed in under, so the hub keeps the name it has.
    const state = await hubAsk(this.env.HUB, { id: of, name, app }, { op: "state" });
    return "friends" in state && state.friends.some((f) => f.id === id);
  }

  /** The host's own moves: change the rules, take a member out, block or unblock someone, or hand the party over. */
  private async hostDoes(ws: RoomSocket, me: Member, msg: { t: string; id?: string; on?: boolean; rules?: PartyRules }) {
    const host = await this.ctx.storage.get<string>("host"), app = await this.ctx.storage.get<string>("app") ?? "";
    if (me.id !== host) return this.sockets.send(ws, { t: "refused", why: "only the host can do that" });
    const tell = async () => { for (const sock of this.sockets.open()) { const m = this.sockets.who(sock); if (m) this.sockets.send(sock, await this.rulesFor(m.id)); } };
    // A new link: the key every link out there carries stops working.
    if (msg.t === "relink") { await this.ctx.storage.put("invite", mintKey()); return tell(); }
    if (msg.t === "rules") {
      if (!msg.rules) return;
      // Inviting turns the host's: links others handed out stop working.
      if (msg.rules.invite === "host" && (await this.rules()).invite !== "host") await this.ctx.storage.put("invite", mintKey());
      await this.ctx.storage.put("rules", msg.rules);
      // The lifetime counts from when the party was made; shortened past its age, the party ends now.
      const made = await this.ctx.storage.get<number>("made") ?? (await this.ctx.storage.get<number>("expires") ?? 0) - PARTY_LIFE;
      const expires = made + msg.rules.hours * 60 * 60 * 1000;
      await this.ctx.storage.put("expires", expires);
      if (expires <= Date.now()) {
        for (const sock of this.sockets.open()) try { sock.close(CLOSE_ENDED, "the host ended the party"); } catch { /* closing */ }
        return this.endVoice();
      }
      await this.schedule();
      if (msg.rules.block === "out") await this.shutOut();
      await this.announce(app);
      return tell();
    }
    const id = msg.id ?? "";
    if (!id || id === me.id) return this.sockets.send(ws, { t: "refused", why: "pick someone else" });
    const them = this.members().find((m) => m.id === id);
    const out = (reason: string) => {
      for (const sock of this.sockets.open()) if (this.sockets.who(sock)?.id === id) try { sock.close(CLOSE_KICKED, reason); } catch { /* closing */ }
      // Out of the voice room too: they need a fresh ticket, and the door decides whether they get back in.
      return this.toVoice((room) => [{ t: "kick", room, sub: id }]);
    };
    if (msg.t === "host") {
      if (!them) return this.sockets.send(ws, { t: "refused", why: "they aren't in the party" });
      await this.ctx.storage.put("host", them.id);
      await this.ctx.storage.put("hostName", them.name);
      // The old host may not invite any more: their links stop working too.
      if ((await this.rules()).invite === "host") await this.ctx.storage.put("invite", mintKey());
      await this.announce(app);
      return tell();
    }
    if (msg.t === "kick") return out("taken out by the host");
    // block: on the host's list (names kept so the host can find them again) and out now; off lets them back.
    const blocked = (await this.ctx.storage.get<Member[]>("blocked") ?? []).filter((b) => b.id !== id);
    const name = them?.name ?? [...(await this.ctx.storage.get<Said[]>("chat") ?? [])].reverse().find((m) => m.from.id === id)?.from.name ?? "someone";
    if (msg.on ?? true) blocked.push({ id, name });
    await this.ctx.storage.put("blocked", blocked);
    // Kept out: out now. Let in hidden: they stay, and the host and they drop off each other's list.
    if ((msg.on ?? true) && (await this.rules()).block === "out") await out("blocked by the host");
    else await this.announce(app);
    this.sockets.send(ws, await this.rulesFor(me.id));
  }

  /** A message to the party: trimmed, rate-limited per socket, dropped when the sender is muted, kept for the last 200. */
  private async say(ws: RoomSocket, me: Member, text: string) {
    const t = this.chat.line(ws, text);
    if (!t) return;
    if ((await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id)) return;
    const chat = (await this.rules()).chat;
    if (chat === "off" || (chat === "host" && me.id !== await this.ctx.storage.get<string>("host")))
      return this.sockets.send(ws, { t: "refused", why: chat === "off" ? "chat is off in this party" : "only the host talks in this party" });
    const m: Said = { from: me, text: t, at: Date.now() };
    const kept = [...(await this.ctx.storage.get<Said[]>("chat") ?? []), m].slice(-CHAT_KEPT);
    await this.ctx.storage.put("chat", kept);
    const apart = await this.apart();
    this.sockets.broadcast({ t: "say", ...m }, undefined, (to) => !apart(to.id, me.id));
  }

  /** The person's account was deleted: close their sockets, and forget their ready flag, mute and messages. A party they hosted ends. */
  private async erase(id: string): Promise<Response> {
    if (!id) return json({ error: "bad" }, 400);
    const app = await this.ctx.storage.get<string>("app") ?? "";
    const hosted = id === await this.ctx.storage.get<string>("host");
    if (hosted) {
      await this.ctx.storage.put("expires", 0);
      for (const ws of this.sockets.open()) try { ws.close(4001, "the host's account was deleted"); } catch { /* closing */ }
      await this.ctx.storage.put("chat", []);
      await this.endVoice();
      return json({ ok: true });
    }
    for (const ws of this.sockets.open()) if (this.sockets.who(ws)?.id === id) try { ws.close(4001, "account deleted"); } catch { /* closing */ }
    for (const key of ["ready", "muted", "startedWith", "admitted"]) await this.ctx.storage.put(key, (await this.ctx.storage.get<string[]>(key) ?? []).filter((x) => x !== id));
    await this.ctx.storage.put("blocked", (await this.ctx.storage.get<Member[]>("blocked") ?? []).filter((b) => b.id !== id));
    await this.ctx.storage.put("chat", (await this.ctx.storage.get<Said[]>("chat") ?? []).filter((m) => m.from.id !== id));
    await this.announce(app);
    return json({ ok: true });
  }

  /** Someone the `mute` rule allows (the host, by default) quiets a member (or lets them speak again) for the whole party, now. */
  private async mute(ws: RoomSocket, me: Member, id: string, on: boolean) {
    const rule = (await this.rules()).mute;
    if (!may(rule, me.id === await this.ctx.storage.get<string>("host")))
      return this.sockets.send(ws, { t: "refused", why: rule === "host" ? "only the host can mute" : "nobody can mute in this party" });
    const muted = new Set(await this.ctx.storage.get<string[]>("muted") ?? []);
    if (on && id !== me.id) muted.add(id); else muted.delete(id);
    await this.ctx.storage.put("muted", [...muted]);
    // A party mute is a voice mute too.
    await this.toVoice((room) => [{ t: "mute", room, sub: id, on: muted.has(id) }]);
  }

  /** The party's voice room, minted the first time someone talks; null before that. */
  private async voiceRoom(make = false): Promise<string | null> {
    const room = await this.ctx.storage.get<string>("voice");
    if (room || !make) return room ?? null;
    const fresh = partyRoom(await this.ctx.storage.get<string>("code") ?? "");
    await this.ctx.storage.put("voice", fresh);
    await this.schedule();
    return fresh;
  }

  private async iss(): Promise<string> {
    return await this.ctx.storage.get<string>("iss") ?? (this.env.BETTER_AUTH_URL ? new URL(this.env.BETTER_AUTH_URL).origin : "https://eqosys.qntbr.com");
  }

  /**
   * A ticket into the party's voice room, to the asker only. The `chat` rule says who may talk, in voice as in text. A
   * muted member's mute reaches Qlave before they do, so their first word is already silent; if Qlave can't take it now, no ticket.
   */
  private async talk(ws: RoomSocket, me: Member) {
    const chat = (await this.rules()).chat;
    if (chat === "off" || (chat === "host" && me.id !== await this.ctx.storage.get<string>("host")))
      return this.sockets.send(ws, { t: "refused", why: chat === "off" ? "talking is off in this party" : "only the host talks in this party" });
    const iss = await this.iss(), room = (await this.voiceRoom(true))!;
    if ((await this.ctx.storage.get<string[]>("muted") ?? []).includes(me.id) && await send(this.env, iss, { t: "mute", room, sub: me.id, on: true }) !== "done")
      return this.sockets.send(ws, { t: "refused", why: "Voice is busy. Try again in a minute." });
    const t = await ticket(this.env, iss, me, room);
    if (!t) return this.sockets.send(ws, { t: "refused", why: "voice isn't set up here" });
    this.sockets.send(ws, { t: "ticket", url: qlaveUrl(this.env), ticket: t });
  }

  /** Orders about the voice room, when there is one. */
  private async toVoice(orders: (room: string) => Order[]) {
    const room = await this.voiceRoom();
    if (!room) return;
    await queue(this.ctx.storage, await this.iss(), orders(room));
    await this.schedule();
  }

  /** The party is over: its voice room ends on Qlave and is forgotten here. */
  private async endVoice() {
    const room = await this.voiceRoom();
    if (!room) return;
    await queue(this.ctx.storage, await this.iss(), [{ t: "end", prefix: room }]);
    await this.ctx.storage.delete("voice");
    await this.schedule();
  }

  /** One alarm for both: orders waiting for Qlave, and a voice room's party running out of time. */
  private async schedule() {
    const at = [await this.ctx.storage.get<number>("outboxAt"), await this.voiceRoom() ? await this.ctx.storage.get<number>("expires") : undefined];
    const next = at.filter((n): n is number => typeof n === "number");
    if (next.length) await this.ctx.storage.setAlarm(Math.max(Date.now(), Math.min(...next)));
  }

  async alarm() {
    const expires = await this.ctx.storage.get<number>("expires") ?? 0;
    // Out of time: the code stops letting people in (fetch), and the voice room ends.
    if (expires <= Date.now()) await this.endVoice();
    await flush(this.ctx.storage, this.env);
    await this.schedule();
  }

  /** A report on a member: the host hears of it, and a row goes through the game-report path (reports.ts). */
  private async report(ws: RoomSocket, me: Member, id: string) {
    // A report files a public issue under the app's name, so it is about someone else: not a way to file issues at will.
    if (id === me.id) return this.sockets.send(ws, { t: "refused", why: "you can't report yourself" });
    const host = await this.ctx.storage.get<string>("host"), rule = (await this.rules()).report;
    if (!may(rule, me.id === host)) return this.sockets.send(ws, { t: "refused", why: rule === "host" ? "only the host can report" : "reports are off in this party" });
    const said = [...(await this.ctx.storage.get<Said[]>("chat") ?? [])].reverse().find((m) => m.from.id === id);
    const name = this.members().find((m) => m.id === id)?.name ?? said?.from.name;
    if (!name) return this.sockets.send(ws, { t: "refused", why: "no such member" });
    for (const sock of this.sockets.open()) if (this.sockets.who(sock)?.id === host) this.sockets.send(sock, { t: "reported", by: me.name, id, name });
    const app = await appOf(this.env, await this.ctx.storage.get<string>("app"));
    if (!app) return;
    // The issue is public: the reported person is named by the same opaque id as the reporter, and their words stay with the host (the `reported` frame above).
    const filed = await file(this.env, app, me.id, "", { kind: "bug", title: "Party chat report", body: `A party member was reported in chat.\n\nReported: ${await reporterId(id)}` });
    if (!filed.ok) this.sockets.send(ws, { t: "refused", why: filed.error });
  }

  webSocketClose(ws: RoomSocket) { void this.left(ws); }
  webSocketError(ws: RoomSocket) { void this.left(ws); }

  private async left(ws: RoomSocket) {
    await this.announce(await this.ctx.storage.get<string>("app") ?? "", ws);
  }

  /** The room a start points at: the party's own code, so everyone lands in the same world. With it, `who`'s start ticket. */
  private async startFor(who: Member, room: string): Promise<PartyOut> {
    const host = await this.ctx.storage.get<string>("host"), app = await this.ctx.storage.get<string>("app") ?? "";
    const order = [...this.members()].sort((a, b) => (a.id === host ? -1 : b.id === host ? 1 : a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
    const seat = Math.max(0, order.findIndex((m) => m.id === who.id)), iss = await this.ctx.storage.get<string>("iss");
    const ticket = iss && await sign(this.env, iss, { user: { id: who.id, email: "", name: who.name }, app: startAud(app), source: HOME, access: [] }, Date.now(), { room, seat }, START_S);
    return { t: "start", room, seat, ...(ticket && { ticket }) };
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
    const members = this.members(gone).map((m): Seen => ({ ...m, ready: ready.has(m.id), host: m.id === host })), apart = await this.apart();
    for (const ws of this.sockets.open()) {
      const to = ws === gone ? null : this.sockets.who(ws);
      if (to) this.sockets.send(ws, { t: "members", app, members: members.filter((m) => !apart(to.id, m.id)) });
    }
  }
}

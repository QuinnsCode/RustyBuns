// Who is coming to an event (QOLLAB.md "Events"): RSVPs, the host's CSV, each person's signed tickets and the door that scans
// them. The pages call these with the signed-in person (../event-pages.ts). The guest list stays the record of who is in
// (`events.guests`, @rustybuns/util/guests); `event_rsvps` holds the answers and is where the cap is counted, inside the insert.
import { Answers, type Event, type Scanned } from "@rustybuns/util/events";
import { check } from "@rustybuns/util/guard";
import { act, can, GuestList, isIn, LIMITS, nameOf } from "@rustybuns/util/guests";
import { unb64url } from "@rustybuns/util/bytes";
import { b64url, type Env } from "../env.ts";
import { eventRow } from "./events.ts";

type Rsvp = { user_id: string; plus: number; answers: string; at: number };
const NO_CAP = 1e9;

/** Change an event's guest list without losing someone else's change: written only over the list it was read from. */
async function relist(conf: Env, id: string, change: (e: Event) => GuestList | string): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const found = await eventRow(conf, id);
    if (!found) return "gone";
    const next = change(found.event);
    if (typeof next === "string") return next;
    if (next === found.event.guests) return null;
    if (await conf.DB.prepare("UPDATE events SET guests = ? WHERE id = ? AND guests = ? RETURNING id").bind(JSON.stringify(next), id, found.row.guests).first("id")) return null;
  }
  return "busy";
}

// ---------- RSVP ----------

export const rsvpOf = async (conf: Env, id: string, userId: string): Promise<Answers | null> => {
  const r = await conf.DB.prepare("SELECT answers FROM event_rsvps WHERE event_id = ? AND user_id = ?").bind(id, userId).first<string>("answers");
  return r ? check(Answers, JSON.parse(r)) : null;
};
/** How many places are taken: everyone who RSVPed, and their plus-ones. */
export const taken = async (conf: Env, id: string) =>
  (await conf.DB.prepare("SELECT COALESCE(SUM(1 + plus), 0) AS n FROM event_rsvps WHERE event_id = ?").bind(id).first<number>("n")) ?? 0;

/** Whether this invite code still lets someone new on, and with which role. */
export function inviteRole(l: GuestList, code: string, now = Date.now()): string | null {
  const i = l.invites.find((x) => x.code === code);
  return i && (i.until === undefined || i.until > now) && i.left !== 0 ? i.role : null;
}

/** Put someone on the list: by their invite, or (where no invite is needed) as a guest. Someone already on it stays as they are. */
function joined(e: Event, who: { id: string; name: string }, code: string, now: number): GuestList | string {
  const l = e.guests;
  if (l.blocked[who.id]) return "blocked";
  if (isIn(l, who.id)) return l;
  const name = who.name.slice(0, 60) || "Someone";
  if (code && inviteRole(l, code, now)) {
    const r = act(l, who.id, { t: "join", code, name }, now);
    return r.ok ? r.list : "list";
  }
  if (e.who.access === "invite") return "invite";
  if (Object.keys(l.guests).length >= LIMITS.guests) return "list";
  return { ...l, guests: { ...l.guests, [who.id]: { name, role: "guest", by: l.owner, at: now } }, log: [...l.log, { at: now, by: who.id, act: "join" as const, who: who.id, name }].slice(-LIMITS.log) };
}

/** RSVP, or change your answers: null when you're on the list, else why not (a key of the pages' words). */
export async function rsvp(conf: Env, id: string, who: { id: string; name: string }, said: Answers, code = "", now = Date.now()): Promise<string | null> {
  const e = (await eventRow(conf, id))?.event;
  if (!e) return "gone";
  const first = joined(e, who, code, now);
  if (typeof first === "string") return first;
  // Only what the event asks is kept.
  const asks = e.there.asks, answers: Answers = { plus: asks.includes("plus-one") && said.plus, food: asks.includes("food-needs") ? said.food.trim() : "", song: asks.includes("song") ? said.song.trim() : "" };
  const had = await conf.DB.prepare("SELECT plus, answers FROM event_rsvps WHERE event_id = ? AND user_id = ?").bind(id, who.id).first<{ plus: number; answers: string }>();
  const places = answers.plus ? 2 : 1;
  // The cap is counted inside the write, so a crowd pressing at once can't get past it.
  const kept = await conf.DB.prepare(`INSERT INTO event_rsvps (event_id, user_id, plus, answers, at) SELECT ?1, ?2, ?3, ?4, ?5
    WHERE (SELECT COALESCE(SUM(1 + plus), 0) FROM event_rsvps WHERE event_id = ?1 AND user_id <> ?2) + ?6 <= ?7
    ON CONFLICT (event_id, user_id) DO UPDATE SET plus = excluded.plus, answers = excluded.answers RETURNING user_id`)
    .bind(id, who.id, places - 1, JSON.stringify(answers), now, places, e.who.cap ?? NO_CAP).first("user_id");
  // A change that asks for a plus-one there is no room for leaves the RSVP as it was.
  if (!kept) return places === 2 && (had || await taken(conf, id) < (e.who.cap ?? NO_CAP)) ? "noplus" : "full";
  const why = await relist(conf, id, (fresh) => joined(fresh, who, code, now));
  if (why && !had) await conf.DB.prepare("DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?").bind(id, who.id).run();
  return why;
}

/** "I can't make it": the RSVP goes, and a plain guest leaves the list (the crew stay on it). */
export async function cancel(conf: Env, id: string, userId: string, now = Date.now()) {
  await conf.DB.prepare("DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?").bind(id, userId).run();
  // At an invite-only event their place on the list is the invitation, so it stays.
  return relist(conf, id, (e) => {
    if (e.who.access === "invite" || e.guests.guests[userId]?.role !== "guest") return e.guests;
    const r = act(e.guests, userId, { t: "leave" }, now);
    return r.ok ? r.list : e.guests;
  });
}

/** Join the crew by an invite that hands out more than a guest's role: no RSVP, no place taken. */
export const joinCrew = (conf: Env, id: string, who: { id: string; name: string }, code: string, now = Date.now()) =>
  relist(conf, id, (e) => {
    if (!inviteRole(e.guests, code, now)) return "invite";
    const r = act(e.guests, who.id, { t: "join", code, name: who.name.slice(0, 60) || "Someone" }, now);
    return r.ok ? r.list : "list";
  });

/** A new invite link's code for `role`, by someone who may hand that role out. */
export async function invite(conf: Env, id: string, by: string, role: string, now = Date.now()): Promise<{ code: string } | { why: string }> {
  const code = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const why = await relist(conf, id, (e) => {
    const r = act(e.guests, by, { t: "invite", role }, now, code);
    return r.ok ? r.list : "cantinvite";
  });
  return why ? { why } : { code };
}

/** Take a deleted account off every list: their place, the invites they made, and their name in the log. */
export async function leaveLists(conf: Env, userId: string) {
  const { results } = await conf.DB.prepare("SELECT id FROM events WHERE owner_id <> ?1 AND instr(guests, ?2) > 0").bind(userId, JSON.stringify(userId)).all<{ id: string }>();
  for (const { id } of results) {
    const why = await relist(conf, id, ({ guests: l }) => {
      const { [userId]: _, ...guests } = l.guests, { [userId]: __, ...blocked } = l.blocked;
      const owned = <T extends { by: string }>(x: T): T => x.by === userId ? { ...x, by: l.owner } : x;
      return {
        ...l, blocked: Object.fromEntries(Object.entries(blocked).map(([k, v]) => [k, owned(v)])),
        guests: Object.fromEntries(Object.entries(guests).map(([k, v]) => [k, owned(v)])),
        invites: l.invites.filter((i) => i.by !== userId), log: l.log.filter((x) => x.by !== userId && x.who !== userId),
      };
    });
    if (why && why !== "gone") throw new Error(`couldn't leave an event's list (${why})`);
  }
}

// ---------- the host's CSV ----------

/** One CSV cell, quoted; a leading `=`, `+`, `-` or `@` gets an apostrophe so a spreadsheet never runs a guest's words. */
const cell = (v: string | number) => `"${String(v).replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;

/** The guest list as CSV: everyone on it but the owner, with their answers to what the event asks. */
export async function guestCsv(conf: Env, e: Event): Promise<string> {
  const { results } = await conf.DB.prepare("SELECT user_id, plus, answers, at FROM event_rsvps WHERE event_id = ?").bind(e.id).all<Rsvp>();
  const scans = await conf.DB.prepare("SELECT user_id, COUNT(*) AS n FROM event_scans WHERE event_id = ? GROUP BY user_id").bind(e.id).all<{ user_id: string; n: number }>();
  const byWho = new Map(results.map((r) => [r.user_id, r])), came = new Map(scans.results.map((r) => [r.user_id, r.n]));
  const asked = e.there.asks.map((a) => ({ "plus-one": ["Plus-one", "plus"], "food-needs": ["Food needs", "food"], song: ["Song", "song"] } as const)[a]);
  const people = [...new Set([...Object.keys(e.guests.guests), ...byWho.keys()])].filter((id) => !e.guests.blocked[id]);
  const lines = people.map((id) => {
    const r = byWho.get(id), a = r ? check(Answers, JSON.parse(r.answers)) : null;
    return [nameOf(e.guests, id), e.guests.guests[id]?.role ?? "owner", r ? "yes" : "no", ...asked.map(([, k]) => k === "plus" ? (a ? a.plus ? "yes" : "no" : "") : a?.[k] ?? ""), came.get(id) ?? 0];
  });
  return [["Name", "Role", "RSVP", ...asked.map(([head]) => head), "Scanned in"], ...lines].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------- tickets and the door ----------

/** A ticket is `<event>.<person>.<seat>.<signature>`: one person's, signed with eqosys's own secret, so none can be made up. */
async function signed(conf: Env, body: string) {
  if (!conf.BETTER_AUTH_SECRET) throw new Error("no secret to sign tickets with");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(conf.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return { key, data: new TextEncoder().encode(`event-ticket:${body}`) };
}
async function ticket(conf: Env, id: string, userId: string, seat: 1 | 2) {
  const body = `${id}.${userId}.${seat}`, { key, data } = await signed(conf, body);
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, data)))}`;
}
/** Your tickets: one for you, and one for your plus-one. */
export async function ticketsOf(conf: Env, id: string, userId: string): Promise<string[]> {
  const a = await rsvpOf(conf, id, userId);
  return a ? Promise.all((a.plus ? [1, 2] as const : [1] as const).map((seat) => ticket(conf, id, userId, seat))) : [];
}

async function readTicket(conf: Env, said: string): Promise<{ id: string; userId: string; seat: number } | null> {
  // A scanned QR is the door's link with the ticket in `t`; a typed or pasted one may be the ticket alone.
  const raw = URL.canParse(said) ? new URL(said).searchParams.get("t") ?? "" : said.trim();
  const m = /^([\w-]{1,40})\.([\w-]{1,80})\.([12])\.([\w-]{43})$/.exec(raw);
  if (!m) return null;
  const [id, userId, seat] = [m[1]!, m[2]!, m[3] === "2" ? 2 : 1] as const;
  const { key, data } = await signed(conf, `${id}.${userId}.${seat}`);
  // verify compares in constant time.
  return await crypto.subtle.verify("HMAC", key, unb64url(m[4]!), data) ? { id, userId, seat } : null;
}

export const countIn = async (conf: Env, id: string) =>
  (await conf.DB.prepare("SELECT COUNT(*) AS n FROM event_scans WHERE event_id = ?").bind(id).first<number>("n")) ?? 0;

export type Look =
  | { state: "bad" | "cancelled"; who: string }
  | { state: "ok" | "used"; who: string; userId: string; seat: number };
/** What a ticket is, without using it up. */
export async function look(conf: Env, e: Event, said: string): Promise<Look> {
  const t = await readTicket(conf, said);
  if (!t || t.id !== e.id) return { state: "bad", who: "" };
  const a = await rsvpOf(conf, e.id, t.userId);
  if (!a || !isIn(e.guests, t.userId) || (t.seat === 2 && !a.plus)) return { state: "cancelled", who: "" };
  const who = `${nameOf(e.guests, t.userId)}${t.seat === 2 ? "'s plus-one" : ""}`;
  const used = await conf.DB.prepare("SELECT 1 AS y FROM event_scans WHERE event_id = ? AND user_id = ? AND seat = ?").bind(e.id, t.userId, t.seat).first("y");
  return { state: used ? "used" : "ok", who, userId: t.userId, seat: t.seat };
}

/** The door's words for each answer, said the same on the page and to the scanner. */
export const DOOR_SAYS = {
  in: "Let in.", used: "Already scanned: this ticket was used. Turn them away.", bad: "That isn't a ticket for this event.",
  cancelled: "That ticket was cancelled. Turn them away.", full: "The room is full: the cap is reached.",
} as const;
export type DoorSaid = keyof typeof DOOR_SAYS;

/** Scan a ticket at the door, by someone whose role has `door`: it lets one person in once, and never past the cap. */
export async function scan(conf: Env, e: Event, by: string, said: string, now = Date.now()): Promise<{ said: DoorSaid; reply: Scanned }> {
  if (!can(e.guests, by, "door")) throw new Error("not on the door");
  const t = await look(conf, e, said);
  const answer = async (key: DoorSaid) => ({
    said: key,
    reply: { ok: key === "in", words: `${DOOR_SAYS[key]}${t.who ? ` ${t.who}` : ""}`, in: await countIn(conf, e.id), ...(e.who.cap ? { cap: e.who.cap } : {}) },
  });
  if (t.state !== "ok") return answer(t.state);
  // One insert, so two phones scanning the same ticket at once let one person in.
  const let_in = await conf.DB.prepare(`INSERT INTO event_scans (event_id, user_id, seat, at, by_id) SELECT ?1, ?2, ?3, ?4, ?5
    WHERE (SELECT COUNT(*) FROM event_scans WHERE event_id = ?1) < ?6 ON CONFLICT DO NOTHING RETURNING seat`)
    .bind(e.id, t.userId, t.seat, now, by, e.who.cap ?? NO_CAP).first("seat");
  if (let_in) return answer("in");
  return answer((await look(conf, e, said)).state === "used" ? "used" : "full");
}

// Qollab Events (QOLLAB.md "Events", #6052): an event belongs to the eqosys account that made it, apart from any one app, so a
// token from any Q app (or eqosys's own pages) opens it. Never live, so plain D1 and HTTP: GET /q/events lists yours, POST makes
// one, and GET, PUT and DELETE /q/events/<id> read, change and delete it. Its owner and its crew (roles on its guest list with
// `edit`) change it; only the owner deletes it. The public page, RSVPs, tickets and the door are on the same row
// (rsvp.ts, ../event-pages.ts).
import { draftOf, EVENT_ROLES, EventDoor, EventDraft, EventEdit, EventList, EventMade, EVENTS_OWNED, NewEvent, type Event } from "@rustybuns/util/events";
import { check } from "@rustybuns/util/guard";
import { can, guestList, GuestList, isIn } from "@rustybuns/util/guests";
import { bearerOf, cors, tokenOf } from "../door.ts";
import { json, type Env } from "../env.ts";

/** The paths this file answers. */
export const isEvents = (pathname: string) => /^\/q\/events(?:\/[\w-]{1,40}(?:\/door)?)?$/.test(pathname);
const DOOR = /^\/q\/events\/([\w-]{1,40})\/door$/;

export type Row = { id: string; body: string; guests: string; at: number; edited: number };
const SELECT = "SELECT id, body, guests, at, edited FROM events";

/** One event's row, and the event it reads as. */
export async function eventRow(conf: Env, id: string): Promise<{ row: Row; event: Event } | null> {
  const row = await conf.DB.prepare(`${SELECT} WHERE id = ?`).bind(id).first<Row>();
  const event = row && toEvent(row);
  return row && event ? { row, event } : null;
}

/** The list as `me` may read it. Anyone may RSVP their way onto it, so a plain guest sees only their own line: never the
 *  other guests, and never an invite code (a crew one would put them on the door). Those who `revoke` run the whole list,
 *  those who `edit` see who is on it, and everyone else sees only the invites they made. */
function seenBy(l: GuestList, me: string): GuestList {
  if (can(l, me, "revoke")) return l;
  const mine = l.guests[me];
  return { ...l, guests: can(l, me, "edit") ? l.guests : mine ? { [me]: mine } : {}, invites: l.invites.filter((i) => i.by === me), blocked: {}, log: [] };
}

/** A kept row as an event, or null if it no longer reads as one (so nothing half-read ever reaches a page). */
export function toEvent(r: Row): Event | null {
  const draft = check(EventDraft, JSON.parse(r.body)), guests = check(GuestList, JSON.parse(r.guests));
  return draft && guests ? { id: r.id, ...draft, guests, at: r.at, edited: r.edited } : null;
}

/** An event's door (#6428): who it lets in and whether that's the caller, for a guest who isn't on its list and so can't
 *  read it. A token is optional: at an `anyone` event a signed-out guest is in; anywhere else only someone on the list is. */
async function eventDoor(req: Request, conf: Env, id: string, head: Record<string, string>): Promise<Response> {
  if (req.method !== "GET") return json({ error: "GET an event's door" }, 405, head);
  const e = (await eventRow(conf, id))?.event;
  if (!e) return json({ error: "there's no event with that id" }, 404, head);
  const bearer = bearerOf(req), t = bearer ? await tokenOf(req, conf, bearer, { home: true }) : null;
  const me = t?.who.id;
  const ok = e.who.access === "anyone" ? !(me && e.guests.blocked[me]) : !!me && isIn(e.guests, me);
  return json({ access: e.who.access, in: ok } satisfies EventDoor, 200, { ...head, "cache-control": "private, no-store" });
}

export async function events(req: Request, conf: Env): Promise<Response> {
  const { pathname } = new URL(req.url), now = Date.now();
  const head = { ...await cors(req, conf), "access-control-allow-methods": "GET, POST, PUT, DELETE" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
  const door = DOOR.exec(pathname)?.[1];
  if (door) return eventDoor(req, conf, door, head);
  const t = await tokenOf(req, conf, bearerOf(req), { home: true });
  if (!t) return json({ error: "send the token /api/exchange gave you" }, 401, head);
  const me = t.who.id;
  const made = (e: Event) => json({ event: e } satisfies EventMade, 200, { ...head, "cache-control": "private, no-store" });

  if (pathname === "/q/events") {
    if (req.method === "GET") {
      const { results } = await conf.DB.prepare(`${SELECT} WHERE owner_id = ? ORDER BY start IS NULL, start, at`).bind(me).all<Row>();
      const events = results.map(toEvent).filter((e) => e !== null);
      return json({ events } satisfies EventList, 200, { ...head, "cache-control": "private, no-store" });
    }
    if (req.method !== "POST") return json({ error: "GET your events or POST one" }, 405, head);
    const asked = check(NewEvent, await req.json().catch(() => null));
    const draft = asked && check(EventDraft, draftOf(asked));
    if (!draft) return json({ error: "send { kind, name } and any of line, when, where, who, there" }, 400, head);
    const owned = await conf.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE owner_id = ?").bind(me).first<number>("n");
    if ((owned ?? 0) >= EVENTS_OWNED) return json({ error: `that's ${EVENTS_OWNED} events on your account; delete an old one first` }, 409, head);
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16), guests = guestList(me, t.who.name, EVENT_ROLES);
    await conf.DB.prepare("INSERT INTO events (id, owner_id, start, body, guests, at, edited) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, me, draft.when.start ?? null, JSON.stringify(draft), JSON.stringify(guests), now, now).run();
    return made({ id, ...draft, guests, at: now, edited: now });
  }

  const id = pathname.slice("/q/events/".length);
  const e = (await eventRow(conf, id))?.event;
  // Someone not on its list hears the same as for an event that isn't there.
  if (!e || !isIn(e.guests, me)) return json({ error: "no event of yours has that id" }, 404, head);
  if (req.method === "GET") return made({ ...e, guests: seenBy(e.guests, me) });
  if (req.method === "PUT") {
    if (!can(e.guests, me, "edit")) return json({ error: "your role on this event can't change it" }, 403, head);
    const asked = check(EventEdit, await req.json().catch(() => null));
    const { id: _id, guests, at, edited: was, ...before } = e;
    const draft = asked && check(EventDraft, { ...before, ...asked, ...(asked.name ? { name: asked.name.trim() } : {}), ...(asked.line !== undefined ? { line: asked.line.trim() } : {}) });
    if (!draft) return json({ error: "send any of kind, name, line, when, where, who, there" }, 400, head);
    // A second later than before at least: the calendar file's SEQUENCE is `edited` in whole seconds.
    const edited = Math.max(now, was + 1000);
    await conf.DB.prepare("UPDATE events SET start = ?, body = ?, edited = ? WHERE id = ?").bind(draft.when.start ?? null, JSON.stringify(draft), edited, id).run();
    return made({ id, ...draft, guests: seenBy(guests, me), at, edited });
  }
  if (req.method === "DELETE") {
    if (e.guests.owner !== me) return json({ error: "only its owner deletes an event" }, 403, head);
    await conf.DB.batch(["event_rsvps WHERE event_id", "event_scans WHERE event_id", "events WHERE id"].map((t) => conf.DB.prepare(`DELETE FROM ${t} = ?`).bind(id)));
    return json({ ok: true }, 200, head);
  }
  return json({ error: "GET, PUT or DELETE an event" }, 405, head);
}

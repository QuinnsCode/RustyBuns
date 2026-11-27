// Qollab Events (apps/eqosys/QOLLAB.md, "Events"): an event on an eqosys account. What, when, where, who and what's there, in
// the order the host answers them, plus the event's guest list (./guests.ts), where the crew sit as roles. Qollab keeps the
// record and does the coordinating; Qollab Studio (apps/fm-daw) picks an event up for its CAD and sound, and Qollab keeps only
// the link to that plan (`where.plan`), never the plan. Never live, so plain HTTP: the guards below are what the routes answer
// (apps/eqosys/src/qollab/events.ts writes `x satisfies ...`), and `events()` is a page's side.
import { arr, bool, check, int, num, obj, oneOf, opt, or, str, type Guard, type Of } from "./guard.ts";
import { GuestList, type Role } from "./guests.ts";

/** The kinds of event. The kind only sets the defaults for the rest (`kindDefaults`); every kind is first-class. */
export const KINDS = ["club", "gig", "wedding", "party", "festival", "other"] as const;
export type Kind = (typeof KINDS)[number];
/** Who may come: anyone (just turn up), anyone who RSVPs, or only those invited. */
export const ACCESS = ["anyone", "rsvp", "invite"] as const;
/** What's on offer at the place. */
export const OFFERS = ["bar", "food", "merch", "step-free"] as const;
/** The questions an RSVP may ask. */
export const ASKS = ["plus-one", "food-needs", "song"] as const;
/** How many events one account owns at once, and the most people an event is for. */
export const EVENTS_OWNED = 50, CAP_MAX = 100_000;

const AT = int(0, Number.MAX_SAFE_INTEGER);
/** Qollab Studio's plan of the place: a link, kept as given. */
const LINK = str(300, { re: /^https:\/\/\S+$/ });

export const When = obj({
  doors: opt(AT), start: opt(AT), curfew: opt(AT),
  /** The line-up's set times: who plays from when, until when. */
  sets: or(arr(obj({ who: str(80, { min: 1 }), at: AT, until: opt(AT) }), 40), []),
  /** The crew's day: load-in, soundcheck and load-out. */
  loadIn: opt(AT), soundcheck: opt(AT), loadOut: opt(AT),
});
export type When = Of<typeof When>;
export const Where = obj({
  address: or(str(200, { min: 0 }), ""),
  pin: opt(obj({ lat: num(-90, 90), lng: num(-180, 180) })),
  plan: opt(LINK),
});
export type Where = Of<typeof Where>;
export const Who = obj({ cap: opt(int(1, CAP_MAX)), access: oneOf(ACCESS), ages: opt(str(40)) });
export type Who = Of<typeof Who>;
export const There = obj({ lineup: or(arr(str(80, { min: 1 }), 40), []), offers: or(arr(oneOf(OFFERS), OFFERS.length), []), asks: or(arr(oneOf(ASKS), ASKS.length), []) });
export type There = Of<typeof There>;

/** What a host answers: every part of an event but its id, owner and list. */
const DRAFT = { kind: oneOf(KINDS), name: str(80, { min: 1 }), line: or(str(160, { min: 0 }), ""), when: When, where: Where, who: Who, there: There };
export const EventDraft = obj(DRAFT);
export type EventDraft = Of<typeof EventDraft>;

/** A new event: a kind and a name, and any parts the host has answered already (the kind fills in the rest). */
export const NewEvent = obj({ kind: oneOf(KINDS), name: str(80, { min: 1 }), line: opt(str(160, { min: 0 })), when: opt(When), where: opt(Where), who: opt(Who), there: opt(There) });
export type NewEvent = Of<typeof NewEvent>;
/** A change: the parts given replace those parts whole; the rest stay as they are. */
export const EventEdit = obj({ kind: opt(oneOf(KINDS)), name: opt(str(80, { min: 1 })), line: opt(str(160, { min: 0 })), when: opt(When), where: opt(Where), who: opt(Who), there: opt(There) });
export type EventEdit = Of<typeof EventEdit>;

/** One event, as its owner and crew read it. `edited` moves on every change, so a calendar file can follow it. */
export const Event = obj({ id: str(40), ...DRAFT, guests: GuestList, at: AT, edited: AT });
export type Event = Of<typeof Event>;
export const EventList = obj({ events: arr(Event, EVENTS_OWNED) });
export type EventList = Of<typeof EventList>;
export const EventMade = obj({ event: Event });
export type EventMade = Of<typeof EventMade>;
/** GET /q/events/<id>/door, with the caller's own token or none: who the event lets in, and whether that's the caller.
 *  Nothing else about the event, so an event's room (Qollab Studio's World) asks it for each guest at its door (#6428).
 *  `in` is true for anyone at an `anyone` event who isn't blocked on its list, else only for someone on the list. */
export const EventDoor = obj({ access: oneOf(ACCESS), in: bool() });
export type EventDoor = Of<typeof EventDoor>;

/** An event's crew, as roles on its guest list. The same person can be the producer, the DJ and the promoter: the owner is all
 *  of them, and hands the rest out. `edit` lets someone change the event; the list's own perms run the list. */
export const EVENT_ROLES: Role[] = [
  { id: "promoter", name: "Promoter", rank: 60, perms: ["invite", "revoke", "block", "roles", "edit"] },
  { id: "crew", name: "Crew", rank: 40, perms: ["edit", "door"] },
  { id: "artist", name: "Artist", rank: 30, perms: ["invite"] },
  { id: "guest", name: "Guest", rank: 0, perms: [] },
];

/** What a kind starts with: who may come, how many, and what the RSVP asks. The host changes any of it. */
export function kindDefaults(kind: Kind): Pick<EventDraft, "who" | "there"> {
  const there = (asks: There["asks"], offers: There["offers"] = []): There => ({ lineup: [], offers, asks });
  switch (kind) {
    case "club": return { who: { access: "anyone", ages: "18+" }, there: there([], ["bar"]) };
    case "gig": return { who: { access: "rsvp" }, there: there(["plus-one"], ["bar", "merch"]) };
    case "wedding": return { who: { access: "invite" }, there: there(["plus-one", "food-needs", "song"], ["bar", "food"]) };
    case "party": return { who: { access: "invite" }, there: there(["plus-one"]) };
    case "festival": return { who: { access: "rsvp" }, there: there([], ["bar", "food", "merch", "step-free"]) };
    case "other": return { who: { access: "rsvp" }, there: there([]) };
  }
}

/** A new event's whole draft: its kind's defaults under whatever the host sent. */
export const draftOf = (n: NewEvent): EventDraft => ({
  kind: n.kind, name: n.name.trim(), line: n.line?.trim() ?? "",
  when: n.when ?? { sets: [] }, where: n.where ?? { address: "" }, ...kindDefaults(n.kind),
  ...(n.who ? { who: n.who } : {}), ...(n.there ? { there: n.there } : {}),
});

// ---------- a page's side ----------

const Refused = obj({ error: str(500) });
/** What one call answers: the event(s), or why not in words a person can read. */
export type Said<T> = { ok: true; value: T } | { ok: false; error: string };

/** The page's side of Qollab Events, on any Q app's token (an event is the account's, not an app's). */
export function events({ url, token }: { url: () => string; token: () => string | null }) {
  async function ask<T>(path: string, guard: Guard<T>, method = "GET", body?: unknown): Promise<Said<T>> {
    const t = token();
    if (!t) return { ok: false, error: "Sign in with eqosys first." };
    const headers: Record<string, string> = { authorization: `Bearer ${t}`, ...(body === undefined ? {} : { "content-type": "application/json" }) };
    const res = await fetch(`${url()}${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, error: "eqosys can't be reached." };
    const v: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: check(Refused, v)?.error ?? "eqosys said no." };
    const value = check(guard, v);
    return value === null ? { ok: false, error: "eqosys answered something odd." } : { ok: true, value };
  }
  const one = async (r: Promise<Said<EventMade>>): Promise<Said<Event>> => { const s = await r; return s.ok ? { ok: true, value: s.value.event } : s; };
  return {
    /** Your events, soonest first (those with no date yet last). */
    list: async (): Promise<Said<Event[]>> => { const r = await ask("/q/events", EventList); return r.ok ? { ok: true, value: r.value.events } : r; },
    /** Make one: a kind and a name are enough. */
    make: (e: NewEvent) => one(ask("/q/events", EventMade, "POST", e)),
    get: (id: string) => one(ask(`/q/events/${encodeURIComponent(id)}`, EventMade)),
    /** Change some parts (each part given is replaced whole): the owner, or crew whose role has `edit`. */
    edit: (id: string, e: EventEdit) => one(ask(`/q/events/${encodeURIComponent(id)}`, EventMade, "PUT", e)),
    remove: async (id: string): Promise<Said<true>> => { const r = await ask(`/q/events/${encodeURIComponent(id)}`, obj({ ok: bool() }), "DELETE"); return r.ok ? { ok: true, value: true } : r; },
  };
}

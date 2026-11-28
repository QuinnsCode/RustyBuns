// An event's public page and door (QOLLAB.md "Events"), the parts that aren't HTML (the pages are app/events.tsx): what each
// page shows, the calendar file, the CSV and what the forms post. These are eqosys's own pages, so the signed-in person is the
// session cookie's; reading the page and the calendar file takes no account.
import { Answers, type Event } from "@rustybuns/util/events";
import { can, isIn, rankOf } from "@rustybuns/util/guests";
import { qrSvg } from "@rustybuns/util/qr";
import { authOn, meOf, type Me } from "./auth.ts";
import { issuer } from "./door.ts";
import { crossSite, json, type Env } from "./env.ts";
import { icsOf } from "./ics.ts";
import { eventRow } from "./qollab/events.ts";
import { cancel, countIn, guestCsv, invite, inviteRole, joinCrew, look, rsvp, rsvpOf, scan, taken, ticketsOf } from "./qollab/rsvp.ts";

const PATH = /^\/e\/([\w-]{1,40})(?:\/(event\.ics|list\.csv|signin|rsvp|cancel|join|invite|scan))?$/;

/** The event this browser was RSVPing to, kept half an hour while its person signs in or makes an account. */
const BACK = "eqosys.event";
const backCookie = (req: Request, value: string, age: number) =>
  `${BACK}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
/** Where someone who just signed in goes back to, when they came from an event's page. */
export function eventBack(req: Request): string | null {
  const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)eqosys\.event=([\w-]{1,40}(?:\.[\w-]{4,40})?)(?:;|$)/);
  if (!m) return null;
  const [id, code] = m[1]!.split(".");
  return `/e/${id}${code ? `?invite=${code}` : ""}`;
}

/** What a public page may show: never the guest list, the plan's link or the crew's day. */
export async function eventView(req: Request, conf: Env, id: string) {
  const e = (await eventRow(conf, id))?.event;
  if (!e) return null;
  const me = await meOf(req, conf), url = `${issuer(req, conf)}/e/${e.id}`, q = new URL(req.url).searchParams;
  const code = q.get("invite")?.match(/^[\w-]{4,40}$/)?.[0] ?? "";
  const role = code ? inviteRole(e.guests, code) : null;
  const on = !!me && isIn(e.guests, me.id), mine = me ? await rsvpOf(conf, id, me.id) : null;
  const may = (perm: string) => !!me && can(e.guests, me.id, perm);
  const roles = me && may("invite") ? e.guests.roles.filter((r) => r.rank < rankOf(e.guests, me.id)) : [];
  const tickets = me ? await Promise.all((await ticketsOf(conf, id, me.id)).map(async (t) => qrSvg(`${url}/door?t=${t}`))) : [];
  return {
    event: {
      id: e.id, kind: e.kind, name: e.name, line: e.line, where: { address: e.where.address, pin: e.where.pin }, who: e.who, there: e.there, host: e.guests.ownerName,
      when: { doors: e.when.doors, start: e.when.start, curfew: e.when.curfew, sets: e.when.sets },
    },
    url, qr: qrSvg(url), dated: (e.when.start ?? e.when.doors) !== undefined, taken: await taken(conf, id),
    me: me ? { name: me.name } : null, said: q.get("said") ?? "", answers: mine, tickets,
    /** The invite this link carries, and whether it hands out a place on the crew. */
    code: role ? code : "", crewRole: role && role !== "guest" && !on ? e.guests.roles.find((r) => r.id === role)?.name ?? null : null,
    mayRsvp: e.who.access !== "invite" || on || !!role,
    host: {
      owner: !!me && e.guests.owner === me.id, door: may("door"), roles: roles.map((r) => ({ id: r.id, name: r.name })),
      links: may("invite") ? e.guests.invites.filter((i) => i.by === me!.id).map((i) => ({ role: e.guests.roles.find((r) => r.id === i.role)?.name ?? i.role, url: `${url}?invite=${i.code}` })) : [],
    },
  };
}
export type EventView = NonNullable<Awaited<ReturnType<typeof eventView>>>;

/** Door mode, for crew whose role has `door`: who is in, and the ticket the phone's camera opened it with, not yet used. */
export async function doorView(req: Request, conf: Env, id: string) {
  const e = (await eventRow(conf, id))?.event;
  if (!e) return null;
  const me = await meOf(req, conf), q = new URL(req.url).searchParams, t = q.get("t") ?? "";
  if (!me || !can(e.guests, me.id, "door")) return { id, name: e.name, allowed: false as const, signedIn: !!me, ticket: t };
  const seen = t ? await look(conf, e, t) : null;
  return { id, name: e.name, allowed: true as const, in: await countIn(conf, id), cap: e.who.cap, said: q.get("said") ?? "", who: q.get("who") ?? "", ticket: t, seen: seen && { state: seen.state, who: seen.who } };
}
export type DoorView = NonNullable<Awaited<ReturnType<typeof doorView>>>;

const text = (body: string, type: string, file: string) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="${file}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
const to = (location: string, cookie?: string) => new Response(null, { status: 303, headers: { location, ...(cookie ? { "set-cookie": cookie } : {}) } });

/** An event's paths that aren't a page, or null. */
export async function eventPaths(req: Request, conf: Env): Promise<Response | null> {
  const url = new URL(req.url), m = PATH.exec(url.pathname);
  if (!m || !m[2]) return null;
  const id = m[1]!, what = m[2], page = `/e/${id}`;
  const post = !["event.ics", "list.csv", "signin"].includes(what);
  if (req.method !== (post ? "POST" : "GET")) return json({ error: post ? "POST" : "GET" }, 405);
  if (post && crossSite(req, conf)) return json({ error: "cross-site request refused" }, 403);
  const e: Event | undefined = (await eventRow(conf, id))?.event;
  if (!e) return json({ error: "there's no event with that id" }, 404);
  if (what === "event.ics") {
    const file = icsOf(e, `${issuer(req, conf)}${page}`);
    return file ? text(file, "text/calendar", "event.ics") : json({ error: "this event has no date yet" }, 404);
  }
  if (!authOn(conf)) return json({ error: "accounts off" }, 503);
  if (what === "signin") {
    const code = url.searchParams.get("invite")?.match(/^[\w-]{4,40}$/)?.[0];
    return to("/login", backCookie(req, code ? `${id}.${code}` : id, 1800));
  }
  const me: Me | null = await meOf(req, conf);
  const wantsJson = !!req.headers.get("accept")?.includes("application/json");
  if (!me) return wantsJson ? json({ error: "sign in first" }, 401) : to(`${page}/signin`);
  if (what === "list.csv")
    return e.guests.owner === me.id ? text(await guestCsv(conf, e), "text/csv", "guests.csv") : json({ error: "only the host downloads the guest list" }, 403);
  const form = await req.formData().catch(() => new FormData());
  const field = (k: string) => String(form.get(k) ?? "");
  const code = field("invite").match(/^[\w-]{4,40}$/)?.[0] ?? "";
  const back = (said: string) => to(`${page}?said=${said}${code ? `&invite=${code}` : ""}`);
  if (what === "rsvp") {
    const answers = Answers({ plus: field("plus") === "yes", food: field("food").slice(0, 200), song: field("song").slice(0, 120) });
    return back(await rsvp(conf, id, me, answers, code) ?? "coming");
  }
  if (what === "cancel") return back(await cancel(conf, id, me.id) ?? "cancelled");
  if (what === "join") return to(`${page}?said=${await joinCrew(conf, id, me, code) ?? "joined"}`);
  if (what === "invite") {
    const made = await invite(conf, id, me.id, field("role"));
    return to(`${page}?said=${"why" in made ? made.why : "invited"}#host`);
  }
  if (!can(e.guests, me.id, "door")) return json({ error: "your role on this event doesn't work the door" }, 403);
  const done = await scan(conf, e, me.id, field("ticket").slice(0, 600));
  if (wantsJson) return json(done.reply);
  return to(`${page}/door?said=${done.said}`);
}

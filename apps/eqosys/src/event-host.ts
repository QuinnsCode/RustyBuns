// A host's side of an event (QOLLAB.md "Events"), the parts that aren't HTML (the pages are app/event-host.tsx): your events
// (/events), the page that changes one and manages its guests (/e/<id>/host), its picture, and what their forms post. The same
// signed-in person as the public page (event-pages.ts), and the same functions as the API (qollab/events.ts).
import { type Event } from "@rustybuns/util/events";
import { check } from "@rustybuns/util/guard";
import { can, GuestAct, nameOf, powers } from "@rustybuns/util/guests";
import { meOf } from "./auth.ts";
import type { Env } from "./env.ts";
import { editEvent, eventRow, eventsOf, makeEvent } from "./qollab/events.ts";
import { hostAct } from "./qollab/rsvp.ts";

// ---------- the picture ----------

/** The biggest picture kept: the page's script shrinks a phone's photo under this before it is sent (app/event-forms.client.ts).
 *  One an event and 50 events an account, so 25 MB of D1 an account at the very most. */
export const PICTURE_MAX = 500_000;

/** What these bytes are, by how they start: only the three a page can show and that carry no script. */
export function pictureType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const starts = (sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8) ? "image/webp" : null;
}

/** The picture's address on the event's pages, new whenever the picture is, or null with none. */
export async function pictureUrl(conf: Env, id: string): Promise<string | null> {
  const at = await conf.DB.prepare("SELECT at FROM event_pictures WHERE event_id = ?").bind(id).first<number>("at");
  return at === null ? null : `/e/${id}/picture?v=${at}`;
}

/** GET /e/<id>/picture: public, as the event's page is. */
export async function pictureFile(conf: Env, id: string): Promise<Response | null> {
  // D1 hands a blob back as an array of bytes; the Bun D1 as the bytes themselves.
  const r = await conf.DB.prepare("SELECT type, data FROM event_pictures WHERE event_id = ?").bind(id).first<{ type: string; data: ArrayBuffer | number[] }>();
  return r && new Response(new Uint8Array(r.data), { headers: { "content-type": r.type, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" } });
}

/** Put the form's picture on the event, or take it off: the word the host's page says back. The caller checked who may. */
export async function setPicture(req: Request, conf: Env, id: string, now = Date.now()): Promise<string> {
  // Refused before it is read into memory: the file plus the form around it.
  if (Number(req.headers.get("content-length") ?? 0) > PICTURE_MAX + 5_000) return "bigpicture";
  const form = await req.formData().catch(() => new FormData());
  if (form.get("remove")) {
    await conf.DB.prepare("DELETE FROM event_pictures WHERE event_id = ?").bind(id).run();
    return "unpictured";
  }
  const file = form.get("picture");
  if (!(file instanceof Blob) || !file.size) return "badpicture";
  if (file.size > PICTURE_MAX) return "bigpicture";
  const data = new Uint8Array(await file.arrayBuffer()), type = pictureType(data);
  if (!type) return "badpicture";
  await conf.DB.prepare("INSERT INTO event_pictures (event_id, type, data, at) VALUES (?, ?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET type = excluded.type, data = excluded.data, at = excluded.at")
    .bind(id, type, data, now).run();
  return "pictured";
}

// ---------- the forms ----------

const field = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
/** A time from a form: the page's script sends the instant (`<name>_at`); with no script the clock typed is UTC, as labelled. */
const timeOf = (at: string, clock: string): number | undefined => !clock ? undefined : /^\d+$/.test(at) ? Number(at) : Date.parse(`${clock}Z`);
const time = (form: FormData, k: string) => timeOf(field(form, `${k}_at`), field(form, k));

/** The host page's form as an EventEdit for `editEvent` to check: each part whole, keeping what the form doesn't ask. */
export function editOf(e: Event, form: FormData): unknown {
  const all = (k: string) => form.getAll(k).map((v) => String(v).trim());
  const who = all("set_who"), clocks = all("set_clock"), ats = all("set_clock_at"), untils = all("set_until");
  const lat = field(form, "lat"), lng = field(form, "lng"), cap = field(form, "cap");
  return {
    kind: field(form, "kind"), name: field(form, "name"), line: field(form, "line"),
    when: {
      ...e.when, ...Object.fromEntries(["doors", "start", "curfew", "loadIn", "soundcheck", "loadOut"].map((k) => [k, time(form, k)])),
      sets: who.flatMap((name, i) => !name && !clocks[i] ? [] : [{ who: name, at: timeOf(ats[i] ?? "", clocks[i] ?? "") ?? NaN, ...(untils[i] ? { until: Number(untils[i]) } : {}) }]),
    },
    where: { address: field(form, "address"), pin: lat || lng ? { lat: lat ? Number(lat) : NaN, lng: lng ? Number(lng) : NaN } : undefined, plan: field(form, "plan") || undefined },
    who: { access: field(form, "access"), cap: cap ? Number(cap) : undefined, ages: field(form, "ages") || undefined },
    there: { lineup: field(form, "lineup").split("\n").map((l) => l.trim()).filter(Boolean), offers: all("offer"), asks: all("ask") },
  };
}

const to = (location: string) => new Response(null, { status: 303, headers: { location } });

/** POST /events: make one from the form, then go and fill in the rest. */
export async function newEvent(req: Request, conf: Env, me: { id: string; name: string }): Promise<Response> {
  const form = await req.formData().catch(() => new FormData());
  const start = time(form, "start");
  const e = await makeEvent(conf, me, { kind: field(form, "kind"), name: field(form, "name"), ...(start === undefined ? {} : { when: { start, sets: [] } }) });
  return to("error" in e ? `/events?said=${e.status === 409 ? "many" : "badform"}` : `/e/${e.id}/host?said=made`);
}

/** The host page's posts (`edit`, `picture`, `guest`), by someone signed in. */
export async function hostPost(req: Request, conf: Env, e: Event, what: "edit" | "picture" | "guest", me: string): Promise<Response> {
  const page = `/e/${e.id}`, host = (said: string) => to(`${page}/host?said=${said}`);
  const refused = () => new Response("your role on this event can't do that", { status: 403 });
  if (what !== "guest") {
    if (!can(e.guests, me, "edit")) return refused();
    if (what === "picture") return host(await setPicture(req, conf, e.id));
    return host(await editEvent(conf, e, editOf(e, await req.formData().catch(() => new FormData()))) ? "saved" : "badform");
  }
  const form = await req.formData().catch(() => new FormData());
  const a = check(GuestAct, { t: field(form, "t"), who: field(form, "who") || undefined, code: field(form, "code") || undefined });
  if (!a || (a.t !== "revoke" && a.t !== "block" && a.t !== "unblock" && a.t !== "uninvite")) return refused();
  // Who may is the guest list's own rules, in the act.
  const why = await hostAct(conf, e.id, me, a);
  if (a.t === "uninvite") return to(`${page}?said=${why ? "cantuninvite" : "uninvited"}#host`);
  return host(why ? "cant" : { revoke: "removed", block: "blockedthem", unblock: "unblocked" }[a.t]);
}

// ---------- what the pages show ----------

/** Guests a page of the host's list shows: an event may have thousands. */
export const GUESTS_PAGE = 100;

/** The guests as the host reads them: those on the list (the crew) on the first page, then the plain RSVPs, oldest first. */
async function guestsOf(conf: Env, e: Event, me: string, find: string, page: number) {
  const l = e.guests, listed = JSON.stringify(Object.keys(l.guests)), q = find.toLowerCase();
  type R = { user_id: string; name: string; plus: number };
  const plain = (await conf.DB.prepare(`SELECT user_id, name, plus FROM event_rsvps WHERE event_id = ?1 AND user_id NOT IN (SELECT value FROM json_each(?2))
    AND (?3 = '' OR instr(lower(name), ?3) > 0) ORDER BY at, user_id LIMIT ?4 OFFSET ?5`)
    .bind(e.id, listed, q, GUESTS_PAGE + 1, page * GUESTS_PAGE).all<R>()).results;
  const crew = page ? [] : Object.keys(l.guests).filter((id) => !l.blocked[id] && nameOf(l, id).toLowerCase().includes(q));
  const answered = new Map((await conf.DB.prepare("SELECT user_id, plus FROM event_rsvps WHERE event_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))")
    .bind(e.id, listed).all<{ user_id: string; plus: number }>()).results.map((r) => [r.user_id, r.plus]));
  const coming = (plus: number | undefined) => plus === undefined ? "" : plus ? "coming, with a plus-one" : "coming";
  return {
    people: [
      ...crew.map((id) => {
        const p = powers(l, me, id);
        return { id, name: nameOf(l, id), role: l.roles.find((r) => r.id === l.guests[id]!.role)?.name ?? "Guest", coming: coming(answered.get(id)), remove: p.revoke, block: p.block };
      }),
      ...plain.slice(0, GUESTS_PAGE).map((r) => ({ id: r.user_id, name: r.name || "Someone", role: "Guest", coming: coming(r.plus), remove: can(l, me, "revoke"), block: can(l, me, "block") })),
    ].filter((p) => p.id !== me),
    more: plain.length > GUESTS_PAGE,
  };
}

/** The host's page for one event: its form for a role with `edit`, its guests for one that removes or blocks. */
export async function hostView(req: Request, conf: Env, id: string) {
  const e = (await eventRow(conf, id))?.event;
  if (!e) return null;
  const me = await meOf(req, conf), q = new URL(req.url).searchParams;
  const may = (perm: string) => !!me && can(e.guests, me.id, perm);
  const edit = may("edit"), manage = may("revoke") || may("block");
  if (!me || (!edit && !manage)) return { id, name: e.name, allowed: false as const, signedIn: !!me };
  const find = (q.get("q") ?? "").slice(0, 60), page = Math.max(0, Math.min(10_000, Math.trunc(Number(q.get("page")) || 0)));
  return {
    id, name: e.name, allowed: true as const, said: q.get("said") ?? "", find, page,
    event: edit ? { kind: e.kind, name: e.name, line: e.line, when: e.when, where: e.where, who: e.who, there: e.there } : null,
    picture: edit ? await pictureUrl(conf, id) : null,
    guests: manage ? await guestsOf(conf, e, me.id, find, page) : null,
    blocked: may("block") ? Object.entries(e.guests.blocked).map(([who, b]) => ({ id: who, name: b.name })) : [],
  };
}
export type HostView = NonNullable<Awaited<ReturnType<typeof hostView>>>;

/** /events: the events you own, for someone signed in. */
export async function mineView(req: Request, conf: Env) {
  const me = await meOf(req, conf);
  if (!me) return null;
  return { said: new URL(req.url).searchParams.get("said") ?? "", events: (await eventsOf(conf, me.id)).map((e) => ({ id: e.id, name: e.name, kind: e.kind, at: e.when.start ?? e.when.doors })) };
}
export type MineView = NonNullable<Awaited<ReturnType<typeof mineView>>>;

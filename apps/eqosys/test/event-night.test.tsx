// Qollab Events, "come to my event" (#6533): a host makes a gig, a stranger reads its page signed out, the date moves and both
// the page and the calendar file follow, guests RSVP up to the cap and the next is turned away with words, the host downloads
// the CSV, and the crew scan a ticket twice: once in, then turned away. Then who may not: strangers at an invite-only event,
// a plain guest reading the list, and a deleted account stays on no list.
import { expect, setDefaultTimeout, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EventMade, Scanned } from "@rustybuns/util/events";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { DoorPage, EventPage } from "../src/app/events.tsx";
import { doorView, eventView } from "../src/event-pages.ts";
import { handle } from "../src/handle.ts";
import { ticketsOf } from "../src/qollab/rsvp.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(60_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK), email = `${name.toLowerCase()}@example.com`;
  const up = await call("/do/signup", { form: { ...a.form, name, email, password: PASSWORD } });
  const token = check(obj({ token: str(4000) }), await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json())!.token;
  return { name, email, token, cookie: up.cookie };
}
type Person = Awaited<ReturnType<typeof signUp>>;
const api = async (method: string, path: string, who: Person, body?: unknown) =>
  (await handle(new Request(ORIGIN + path, { method, headers: { origin: PARK, authorization: `Bearer ${who.token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), conf))!;
const made = async (r: Response) => check(EventMade, await r.json())!.event;
const req = (path: string, who?: Person) => new Request(ORIGIN + path, { headers: who ? { cookie: who.cookie } : {} });
const get = async (path: string, who?: Person) => (await handle(req(path, who), conf))!;
const post = (path: string, who: Person, form: Record<string, string> = {}, origin = ORIGIN) => call(path, { form: { ...form, _: "1" }, cookie: who.cookie, origin });
const page = async (id: string, who?: Person, query = "") => renderToStaticMarkup(<EventPage v={(await eventView(req(`/e/${id}${query}`, who), conf, id))!} />);
const idOf = async (who: Person) => (await conf.DB.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(who.email).first<string>("id"))!;

const JUNE = Date.UTC(2027, 5, 12, 19), JULY = Date.UTC(2027, 6, 3, 20);

test("page, calendar file, RSVP to the cap, CSV, and a ticket that scans once", async () => {
  const [ada, bo, cy, dee] = [await signUp("Ada"), await signUp("Bo"), await signUp("Cy"), await signUp("Dee")];
  const e = await made(await api("POST", "/q/events", ada, { kind: "gig", name: "Low End, Live", when: { start: JUNE }, where: { address: "The Old Mill; Leeds", plan: "https://studio.example/secret-plan" }, who: { access: "rsvp", cap: 3 }, there: { asks: ["plus-one", "food-needs"] } }));

  // Signed out: the page, its QR and its calendar file. The plan's link stays the host's.
  const before = await page(e.id);
  expect(before).toContain("Low End, Live");
  expect(before).toContain("12 Jun 2027");
  expect(before).toContain('aria-label="QR code for this page"');
  expect(before).toContain("Sign in to RSVP");
  expect(before).toContain("A picture goes here");
  expect(before).not.toContain("secret-plan");
  const ics = async () => (await get(`/e/${e.id}/event.ics`)).text();
  const first = await ics(), sequence = (f: string) => Number(/SEQUENCE:(\d+)/.exec(f)![1]);
  expect(first).toContain("DTSTART:20270612T190000Z");
  expect(first).toContain("SUMMARY:Low End\\, Live");
  expect(first).toContain(String.raw`LOCATION:The Old Mill\; Leeds`);

  // The date moves: the page and the file show the new one, and the file's SEQUENCE is higher.
  expect((await api("PUT", `/q/events/${e.id}`, ada, { when: { start: JULY } })).status).toBe(200);
  expect(await page(e.id)).toContain("3 Jul 2027");
  const second = await ics();
  expect(second).toContain("DTSTART:20270703T200000Z");
  expect(sequence(second)).toBeGreaterThan(sequence(first));
  expect(second).toContain(`UID:${e.id}@eqosys`);

  // Signing in from the page comes back to it.
  const signin = await get(`/e/${e.id}/signin`);
  expect(signin.headers.get("location")).toBe("/login");
  const back = await call("/do/signin", { form: { email: bo.email, password: PASSWORD }, cookie: signin.headers.get("set-cookie")!.split(";")[0] });
  expect(back.to).toBe(`/e/${e.id}`);

  // Bo and a plus-one, then Cy: that is the cap. Dee is turned away with words, and so is another site's form.
  expect((await post(`/e/${e.id}/rsvp`, bo, { plus: "yes", food: "=no nuts" })).to).toBe(`/e/${e.id}?said=coming`);
  expect((await post(`/e/${e.id}/rsvp`, cy, { plus: "yes" })).to).toBe(`/e/${e.id}?said=noplus`);
  expect((await post(`/e/${e.id}/rsvp`, cy, {})).to).toBe(`/e/${e.id}?said=coming`);
  expect((await post(`/e/${e.id}/rsvp`, dee, {})).to).toBe(`/e/${e.id}?said=full`);
  expect(await page(e.id, dee, "?said=full")).toContain("this event is full");
  expect((await post(`/e/${e.id}/rsvp`, dee, {}, "https://elsewhere.example")).res.status).toBe(403);
  expect((await page(e.id, bo)).match(/aria-label="Ticket \d"/g)).toHaveLength(2);

  // The host's CSV has the answers (a spreadsheet won't run them); nobody else gets it.
  const csv = await (await get(`/e/${e.id}/list.csv`, ada)).text();
  expect(csv).toContain('"Name","Role","RSVP","Plus-one","Food needs","Scanned in"');
  expect(csv).toContain(`"Bo","guest","yes","yes","'=no nuts","0"`);
  expect(csv).toContain('"Cy","guest","yes","no","","0"');
  expect((await get(`/e/${e.id}/list.csv`, bo)).status).toBe(403);

  // A guest reads the event but not who else is coming.
  const seen = await made(await api("GET", `/q/events/${e.id}`, bo));
  expect(Object.keys(seen.guests.guests)).toEqual([await idOf(bo)]);

  // Dee joins the crew by the host's invite link, and works the door; a guest can't.
  expect((await post(`/e/${e.id}/invite`, ada, { role: "crew" })).to).toContain("said=invited");
  const link = (await eventView(req(`/e/${e.id}`, ada), conf, e.id))!.host.links[0]!.url, code = new URL(link).searchParams.get("invite")!;
  expect(await page(e.id, dee, `?invite=${code}`)).toContain("Join the crew as Crew");
  expect((await post(`/e/${e.id}/join`, dee, { invite: code })).to).toBe(`/e/${e.id}?said=joined`);
  const [ticket] = await ticketsOf(conf, e.id, await idOf(bo)), qr = `${ORIGIN}/e/${e.id}/door?t=${ticket}`;
  expect((await post(`/e/${e.id}/scan`, cy, { ticket: ticket! })).res.status).toBe(403);
  const door = async (who: Person, query = "") => renderToStaticMarkup(<DoorPage v={(await doorView(req(`/e/${e.id}/door${query}`, who), conf, e.id))!} />);
  expect(await door(cy)).toContain("doesn&#x27;t work the door");
  expect(await door(dee, `?t=${ticket}`)).toContain("Let them in");

  // The scanner's own request: in once, then turned away, and the count holds.
  const scan = async (said: string) => check(Scanned, await (await handle(new Request(`${ORIGIN}/e/${e.id}/scan`, { method: "POST", headers: { origin: ORIGIN, cookie: dee.cookie, accept: "application/json" }, body: new URLSearchParams({ ticket: said }) }), conf))!.json())!;
  expect(await scan(qr)).toEqual({ ok: true, words: "Let in. Bo", in: 1, cap: 3 });
  expect(await scan(qr)).toMatchObject({ ok: false, words: expect.stringContaining("Already scanned"), in: 1 });
  expect(await scan(`${ticket!.slice(0, -4)}AAAA`)).toMatchObject({ ok: false, words: expect.stringContaining("isn't a ticket"), in: 1 });
  expect((await post(`/e/${e.id}/scan`, dee, { ticket: ticket! })).to).toBe(`/e/${e.id}/door?said=used`);

  // Cy can't make it: the ticket they had no longer lets anyone in, and the place is free again.
  const [cys] = await ticketsOf(conf, e.id, await idOf(cy));
  expect((await post(`/e/${e.id}/cancel`, cy)).to).toBe(`/e/${e.id}?said=cancelled`);
  expect(await scan(cys!)).toMatchObject({ ok: false, words: expect.stringContaining("cancelled") });

  // Deleting an account takes that person off the lists they joined.
  const boId = await idOf(bo);
  await call("/do/delete", { form: { confirm: bo.email }, cookie: bo.cookie });
  const left = await conf.DB.prepare("SELECT guests FROM events WHERE id = ?").bind(e.id).first<string>("guests");
  expect(left).not.toContain(boId);
  expect(left).not.toContain('"Bo"');
  expect(await conf.DB.prepare("SELECT COUNT(*) AS n FROM event_rsvps WHERE user_id = ?").bind(boId).first<number>("n")).toBe(0);
});

test("an invite-only event turns away a stranger and takes someone with the link", async () => {
  const eve = await signUp("Eve"), fay = await signUp("Fay");
  const e = await made(await api("POST", "/q/events", eve, { kind: "wedding", name: "Eve & Gil" }));
  expect(await page(e.id, fay)).toContain("invite only");
  expect((await post(`/e/${e.id}/rsvp`, fay, {})).to).toBe(`/e/${e.id}?said=invite`);
  await post(`/e/${e.id}/invite`, eve, { role: "guest" });
  const code = new URL((await eventView(req(`/e/${e.id}`, eve), conf, e.id))!.host.links[0]!.url).searchParams.get("invite")!;
  expect((await post(`/e/${e.id}/rsvp`, fay, { invite: code, song: "September" })).to).toBe(`/e/${e.id}?said=coming&invite=${code}`);
  // A guest on the list sees no invite codes.
  expect((await made(await api("GET", `/q/events/${e.id}`, fay))).guests.invites).toEqual([]);
  // The host deleting the event takes its RSVPs.
  expect((await api("DELETE", `/q/events/${e.id}`, eve)).status).toBe(200);
  expect(await conf.DB.prepare("SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id = ?").bind(e.id).first<number>("n")).toBe(0);
});

// A host's evening from the pages alone (#6544): make an event on /events, change it with the form, put a picture on it, then
// more people RSVP than the guest list's 500, and the host removes one, blocks them and cancels an invite link.
import { expect, setDefaultTimeout, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { HostPage, MyEvents } from "../src/app/event-host.tsx";
import { EventPage } from "../src/app/events.tsx";
import { hostView, mineView, PICTURE_MAX } from "../src/event-host.ts";
import { eventView } from "../src/event-pages.ts";
import { handle } from "../src/handle.ts";
import { eventRow } from "../src/qollab/events.ts";
import { look, rsvp, ticketsOf } from "../src/qollab/rsvp.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(60_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const token = check(obj({ token: str(4000) }), await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json())!.token;
  return { name, token, cookie: up.cookie };
}
type Person = Awaited<ReturnType<typeof signUp>>;
const req = (path: string, who?: Person) => new Request(ORIGIN + path, { headers: who ? { cookie: who.cookie } : {} });
/** What a browser's form sends: urlencoded, or multipart when there is a file. */
const send = async (path: string, who: Person, form: Record<string, string | string[] | File>, origin = ORIGIN) => {
  const multi = Object.values(form).some((v) => v instanceof File), body = multi ? new FormData() : new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const one of Array.isArray(v) ? v : [v]) body.append(k, one as string);
  const res = (await handle(new Request(ORIGIN + path, { method: "POST", headers: { origin, cookie: who.cookie }, body }), conf))!;
  return { status: res.status, to: res.headers.get("location") ?? "" };
};
const page = async (id: string, who?: Person) => renderToStaticMarkup(<EventPage v={(await eventView(req(`/e/${id}`, who), conf, id))!} />);
const host = async (id: string, who: Person, query = "") => renderToStaticMarkup(<HostPage v={(await hostView(req(`/e/${id}/host${query}`, who), conf, id))!} />);

test("make and change an event, picture it, take 600 RSVPs, then remove, block and cancel a link", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo");

  const made = await send("/events", ada, { kind: "gig", name: "Low End", start: "2027-06-12T19:00", start_at: "" });
  const id = /^\/e\/([\w-]+)\/host\?said=made$/.exec(made.to)![1]!;
  expect(renderToStaticMarkup(<MyEvents v={(await mineView(req("/events", ada), conf))!} />)).toContain("Low End");
  const event = async () => (await eventRow(conf, id))!.event;
  // With no script the clock typed is UTC; with it, the instant the script sends wins.
  expect((await event()).when.start).toBe(Date.UTC(2027, 5, 12, 19));

  const form = {
    kind: "gig", name: "Low End, Live", line: "Bass all night", doors: "2027-06-12T18:00", doors_at: String(Date.UTC(2027, 5, 12, 17)),
    start: "2027-06-12T19:00", start_at: "", curfew: "", loadIn: "2027-06-12T12:00", address: "The Old Mill", lat: "53.8", lng: "-1.55",
    plan: "https://studio.example/plan", access: "rsvp", cap: "1000", ages: "18+", lineup: "Ada\n\n The Others ",
    offer: ["bar", "food"], ask: ["plus-one"], set_who: ["Ada", ""], set_clock: ["2027-06-12T20:00", ""], set_clock_at: ["", ""], set_until: ["", ""],
  };
  expect((await send(`/e/${id}/edit`, ada, form)).to).toBe(`/e/${id}/host?said=saved`);
  expect(await event()).toMatchObject({
    name: "Low End, Live", line: "Bass all night", where: { address: "The Old Mill", pin: { lat: 53.8, lng: -1.55 }, plan: "https://studio.example/plan" },
    when: { doors: Date.UTC(2027, 5, 12, 17), start: Date.UTC(2027, 5, 12, 19), loadIn: Date.UTC(2027, 5, 12, 12), sets: [{ who: "Ada", at: Date.UTC(2027, 5, 12, 20) }] },
    who: { access: "rsvp", cap: 1000, ages: "18+" }, there: { lineup: ["Ada", "The Others"], offers: ["bar", "food"], asks: ["plus-one"] },
  });
  expect(await host(id, ada)).toContain('value="The Old Mill"');
  expect((await send(`/e/${id}/edit`, ada, { ...form, plan: "javascript:alert(1)" })).to).toContain("said=badform");
  expect((await send(`/e/${id}/edit`, bo, form)).status).toBe(403);
  expect((await send(`/e/${id}/edit`, ada, form, "https://elsewhere.example")).status).toBe(403);

  // The picture: a JPEG goes on the page; something else, or one too big, doesn't; it can be taken off.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), file = (bytes: Uint8Array) => new File([bytes as BlobPart], "p.jpg", { type: "image/jpeg" });
  expect((await send(`/e/${id}/picture`, bo, { picture: file(jpeg) })).status).toBe(403);
  expect((await send(`/e/${id}/picture`, ada, { picture: file(new TextEncoder().encode("<svg onload=alert(1)>")) })).to).toContain("said=badpicture");
  expect((await send(`/e/${id}/picture`, ada, { picture: file(new Uint8Array(PICTURE_MAX + 1).fill(0xff)) })).to).toContain("said=bigpicture");
  expect((await send(`/e/${id}/picture`, ada, { picture: file(jpeg) })).to).toContain("said=pictured");
  const src = /<img src="(\/e\/[^"]+picture\?v=\d+)"/.exec(await page(id))![1]!;
  const got = (await handle(req(src), conf))!;
  expect(got.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg);
  expect((await send(`/e/${id}/picture`, ada, { remove: "1" })).to).toContain("said=unpictured");
  expect(await page(id)).not.toContain("<img");

  // More than the guest list's 500 can come: 600 RSVPs (the form's own call, without 600 sign-ups), then one who signs in.
  for (let i = 0; i < 600; i++) expect(await rsvp(conf, id, { id: `u${i}`, name: `Guest ${i}` }, { plus: false, food: "", song: "" })).toBeNull();
  expect((await send(`/e/${id}/rsvp`, bo, { plus: "yes" })).to).toContain("said=coming");
  expect(await page(id)).toContain("398 of 1000 places left");
  expect((await page(id, bo)).match(/aria-label="Ticket \d"/g)).toHaveLength(2);
  const csv = await (await handle(req(`/e/${id}/list.csv`, ada), conf))!.text();
  expect(csv).toContain('"Guest 599","guest","yes","no","0"');
  expect(csv.trim().split("\r\n")).toHaveLength(602);
  // A guest past the list reads the event, and only their own line.
  const read = (await handle(new Request(`${ORIGIN}/q/events/${id}`, { headers: { authorization: `Bearer ${bo.token}` } }), conf))!;
  expect(read.status).toBe(200);
  expect(JSON.stringify(await read.json())).not.toContain("Guest 1");

  // The host's list pages through them and finds one by name.
  expect(await host(id, ada)).toContain(">More</a>");
  expect(await host(id, ada, "?q=guest+599")).toContain('aria-label="Remove Guest 599"');
  expect(await host(id, bo)).toContain("doesn&#x27;t run it");

  const boId = (await conf.DB.prepare(`SELECT id FROM "user" WHERE name = 'Bo'`).first<string>("id"))!;
  const [ticket] = await ticketsOf(conf, id, boId);
  // Removed: the ticket stops working and the places are free, but they may RSVP again.
  expect((await send(`/e/${id}/guest`, bo, { t: "revoke", who: "u1" })).to).toContain("said=cant");
  expect((await send(`/e/${id}/guest`, ada, { t: "revoke", who: boId })).to).toBe(`/e/${id}/host?said=removed`);
  expect(await look(conf, await event(), ticket!)).toMatchObject({ state: "cancelled" });
  expect(await page(id)).toContain("400 of 1000 places left");
  expect((await send(`/e/${id}/rsvp`, bo, {})).to).toContain("said=coming");
  // Blocked: they may not, until unblocked.
  expect((await send(`/e/${id}/guest`, ada, { t: "block", who: boId })).to).toContain("said=blockedthem");
  expect((await send(`/e/${id}/rsvp`, bo, {})).to).toContain("said=blocked");
  expect(await host(id, ada)).toContain('aria-label="Unblock Bo"');
  expect((await send(`/e/${id}/guest`, ada, { t: "unblock", who: boId })).to).toContain("said=unblocked");

  // An invite link cancelled lets nobody else in.
  await send(`/e/${id}/edit`, ada, { ...form, access: "invite" });
  await send(`/e/${id}/invite`, ada, { role: "guest" });
  const links = async () => (await eventView(req(`/e/${id}`, ada), conf, id))!.host.links;
  const [first] = await links();
  expect(await page(id, ada)).toContain("Cancel link");
  expect((await send(`/e/${id}/guest`, ada, { t: "uninvite", code: first!.code })).to).toBe(`/e/${id}?said=uninvited#host`);
  expect((await send(`/e/${id}/rsvp`, bo, { invite: first!.code })).to).toContain("said=invite");
  // At an invite-only event, someone who can't make it keeps their invitation.
  await send(`/e/${id}/invite`, ada, { role: "guest" });
  expect((await send(`/e/${id}/rsvp`, bo, { invite: (await links())[0]!.code })).to).toContain("said=coming");
  await send(`/e/${id}/cancel`, bo, {});
  expect((await send(`/e/${id}/rsvp`, bo, {})).to).toContain("said=coming");

  // Deleting the event takes its picture.
  await send(`/e/${id}/picture`, ada, { picture: file(jpeg) });
  await handle(new Request(`${ORIGIN}/q/events/${id}`, { method: "DELETE", headers: { origin: PARK, authorization: `Bearer ${ada.token}` } }), conf);
  expect(await conf.DB.prepare("SELECT COUNT(*) AS n FROM event_pictures").first<number>("n")).toBe(0);
});

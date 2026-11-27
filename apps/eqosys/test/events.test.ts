// Qollab Events, the everyday walk: a host signs in from a game, makes a wedding with just a kind and a name (the kind fills in
// who may come and what the RSVP asks), sets its date, moves it, and finds it on their account, soonest first. Someone else can't
// read or change it, a wrong shape is refused, and deleting the account takes its events with it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { EventList, EventMade } from "@rustybuns/util/events";
import { bool, check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const token = check(obj({ token: str(4000) }), await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json())!.token;
  return { token, cookie: up.cookie };
}
const ask = (method: string, path: string, token?: string, body?: unknown) =>
  handle(new Request(`${ORIGIN}${path}`, { method, headers: { origin: PARK, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), conf).then((r) => r!);
const read = async <T>(r: Response, g: (v: unknown) => T) => { expect(r.status).toBe(200); return check(g, await r.json())!; };

const JUNE = Date.UTC(2027, 5, 12, 15), JULY = Date.UTC(2027, 6, 3, 15), MAY = Date.UTC(2027, 4, 1, 21);

test("make an event, change its date, list it on the account; nobody else reads or changes it", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo");
  expect((await ask("POST", "/q/events", undefined, { kind: "gig", name: "x" })).status).toBe(401);

  // A kind and a name are enough: a wedding is invite only and asks about plus-ones, food and a song.
  const { event: wedding } = await read(await ask("POST", "/q/events", ada.token, { kind: "wedding", name: "  Ada & Cy  " }), EventMade);
  expect(wedding).toMatchObject({ kind: "wedding", name: "Ada & Cy", line: "", who: { access: "invite" }, there: { asks: ["plus-one", "food-needs", "song"] } });
  expect(wedding.guests).toMatchObject({ owner: wedding.guests.owner, ownerName: "Ada", guests: {} });
  expect(wedding.guests.roles.map((r) => r.id)).toEqual(["promoter", "crew", "artist", "guest"]);

  // When, then where: each part sent replaces that part; the rest stay.
  const set = await read(await ask("PUT", `/q/events/${wedding.id}`, ada.token, { when: { doors: JUNE - 3_600_000, start: JUNE, loadIn: JUNE - 6 * 3_600_000 }, where: { address: "The Old Mill, Leeds" } }), EventMade);
  expect(set.event).toMatchObject({ name: "Ada & Cy", when: { start: JUNE, sets: [] }, where: { address: "The Old Mill, Leeds" }, who: { access: "invite" } });
  const moved = await read(await ask("PUT", `/q/events/${wedding.id}`, ada.token, { when: { start: JULY } }), EventMade);
  expect(moved.event.when).toEqual({ start: JULY, sets: [] });
  expect(moved.event.edited).toBeGreaterThan(set.event.edited);

  // A club night with an earlier date lists first; one with no date yet lists last.
  const { event: club } = await read(await ask("POST", "/q/events", ada.token, { kind: "club", name: "Low End Theory", when: { start: MAY } }), EventMade);
  const { event: later } = await read(await ask("POST", "/q/events", ada.token, { kind: "other", name: "Someday" }), EventMade);
  const mine = await read(await ask("GET", "/q/events", ada.token), EventList);
  expect(mine.events.map((e) => e.id)).toEqual([club.id, wedding.id, later.id]);
  expect(mine.events[1]!.when.start).toBe(JULY);
  expect(club.who).toEqual({ access: "anyone", ages: "18+" });

  // Bo has none, and Ada's are not his to read, change or delete.
  expect((await read(await ask("GET", "/q/events", bo.token), EventList)).events).toEqual([]);
  for (const [m, body] of [["GET"], ["PUT", { name: "mine now" }], ["DELETE"]] as const)
    expect((await ask(m, `/q/events/${wedding.id}`, bo.token, body)).status).toBe(404);

  // A wrong shape is refused with words: no kind, a kind that isn't one, a cap of nobody, a plan that isn't a link.
  for (const bad of [{ name: "x" }, { kind: "rave", name: "x" }, { kind: "gig", name: "x", who: { access: "rsvp", cap: 0 } }, { kind: "gig", name: "x", where: { address: "", plan: "javascript:alert(1)" } }]) {
    const r = await ask("POST", "/q/events", ada.token, bad);
    expect(r.status).toBe(400);
    expect(check(obj({ error: str(500) }), await r.json())?.error).toContain("kind, name");
  }
  expect((await ask("PUT", `/q/events/${wedding.id}`, ada.token, { who: { access: "everyone" } })).status).toBe(400);

  // An event's door (#6428), for its room: who it lets in and whether that's you, and nothing else about it.
  const door = obj({ access: str(10), in: bool() }), doorOf = async (id: string, token?: string) => read(await ask("GET", `/q/events/${id}/door`, token), door);
  expect(await doorOf(wedding.id, bo.token)).toEqual({ access: "invite", in: false });
  expect(await doorOf(wedding.id)).toEqual({ access: "invite", in: false });
  expect(await doorOf(wedding.id, ada.token)).toEqual({ access: "invite", in: true });
  expect(await doorOf(club.id)).toEqual({ access: "anyone", in: true });
  expect((await ask("GET", "/q/events/nope/door", bo.token)).status).toBe(404);

  // The owner deletes one; deleting the account takes the rest.
  expect((await ask("DELETE", `/q/events/${later.id}`, ada.token)).status).toBe(200);
  expect((await ask("GET", `/q/events/${later.id}`, ada.token)).status).toBe(404);
  await call("/do/delete", { form: { confirm: "ada@example.com" }, cookie: ada.cookie });
  expect(await conf.DB.prepare("SELECT COUNT(*) AS n FROM events").first<number>("n")).toBe(0);
});

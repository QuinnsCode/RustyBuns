// An event's room (#6428): the maker's page names the Qollab event (?event= on its socket, from the Event Planner's link),
// and everyone else comes in only if eqosys says the event lets them in, asked with their own token. A fake eqosys
// answers GET /q/events/<id>/door the way apps/eqosys/src/qollab/events.ts does.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { setup, useWorld } from "./world-kit.ts";
import { CLOSE_FULL } from "../packages/desktop/world.ts";
import type { EventDoor } from "@rustybuns/util/events";

useWorld();
const EQ = "https://eq.test", MAKER = "m".repeat(32);
/** The fake eqosys's events: who each lets in, and who is on its list (by token). null: eqosys is down. */
let events: Record<string, { access: EventDoor["access"]; list: string[] }> | null = {};
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!events) throw new Error("eqosys is down");
    const id = /\/q\/events\/([\w-]+)\/door$/.exec(String(input))?.[1] ?? "";
    const e = events[id], token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
    if (!e) return Response.json({ error: "there's no event with that id" }, { status: 404 });
    return Response.json({ access: e.access, in: e.access === "anyone" ? !e.list.includes(`blocked:${token}`) : e.list.includes(token) } satisfies EventDoor);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test("an event's room lets in whom the event lets in, and only the maker names the event", async () => {
  events = { gig: { access: "rsvp", list: ["ada"] }, wedding: { access: "invite", list: ["cy"] }, club: { access: "anyone", list: ["blocked:dee"] } };
  const room = await setup({ EQOSYS_URL: EQ }, "event-gig");
  const knock = async (token?: string, query = "") => (await room.join(token ? { "X-Eqosys-Token": token } : {}, "", query)).ws;

  // no event named yet: a plain room, anyone with the link comes in
  expect((await knock()).closed).toBeNull();
  // a guest can't name the room's event; the maker can
  await knock(undefined, "event=wedding");
  expect((await knock()).closed).toBeNull();
  expect((await room.join({}, MAKER, "event=gig")).ws.closed).toBeNull();

  for (const [token, why] of [[undefined, "rsvp"], ["bo", "rsvp"], ["ada", null]] as const) {
    const ws = await knock(token);
    expect(ws.closed).toBe(why ? CLOSE_FULL : null);
    if (why) expect(ws.sent).toEqual([{ t: "full", why }]);
  }
  expect((await room.join({}, MAKER)).ws.closed).toBeNull();   // the maker never asks

  // the maker ties the room to another event: its door follows that one
  await room.join({}, MAKER, "event=wedding");
  expect((await knock("ada")).sent).toEqual([{ t: "full", why: "invite" }]);
  expect((await knock("cy")).closed).toBeNull();
  await room.join({}, MAKER, "event=club");
  expect((await knock()).closed).toBeNull();
  expect((await knock("dee")).sent).toEqual([{ t: "full", why: "blocked" }]);

  // eqosys out of reach: the door stays shut rather than open to anyone
  events = null;
  expect((await knock("cy")).sent).toEqual([{ t: "full", why: "unchecked" }]);
  // the event was deleted: its room is a room again
  events = {};
  expect((await knock()).closed).toBeNull();
});

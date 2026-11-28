// An event's room (#6428): the maker's page names the Qollab event (?event= on its socket, from the Event Planner's link),
// and everyone else comes in only if eqosys says the event lets them in, asked with their own token. A fake eqosys
// answers GET /q/events/<id>/door the way apps/eqosys/src/qollab/events.ts does.
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { heard, setup, useWorld, type Sock } from "./world-kit.ts";
import { CLOSE_FULL, type WorldEnv } from "../packages/desktop/world.ts";
import Lobby, { EVENT_MS, EVENT_REST_MS } from "../src/lobby.ts";
import type { EventDoor } from "@rustybuns/util/events";

useWorld();
const EQ = "https://eq.test", MAKER = "m".repeat(32);
/** The fake eqosys's events: who each lets in, and who is on its list (by token). null: eqosys is down. */
let events: Record<string, { access: EventDoor["access"]; list: string[]; roles?: Record<string, string> }> | null = {};
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!events) throw new Error("eqosys is down");
    const id = /\/q\/events\/([\w-]+)\/door$/.exec(String(input))?.[1] ?? "";
    const e = events[id], token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
    if (!e) return Response.json({ error: "there's no event with that id" }, { status: 404 });
    return Response.json({ access: e.access, in: e.access === "anyone" ? !e.list.includes(`blocked:${token}`) : e.list.includes(token), role: e.roles?.[token] } satisfies EventDoor);
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

test("an event's artist walks in able to play, the room closes at its time, and one event is open at a time", async () => {
  events = { gig: { access: "anyone", list: [], roles: { art: "artist" } }, after: { access: "anyone", list: [] } };
  const lobby = await edgeLobby(), env = { EQOSYS_URL: EQ, LOBBY: lobby };
  const room = await setup(env, "event-gig"), said = (ws: Sock, m: unknown) => room.world.webSocketMessage(ws, JSON.stringify(m));
  const hello = async (ws: Sock, k: string) => { said(ws, { t: "hello", key: k.repeat(48), name: k }); await heard(ws, "chat"); return heard(ws, "chat").then((m) => m.you as string); };
  const maker = (await room.join({}, MAKER, "event=gig")).ws;
  await hello(maker, "a");
  const artist = (await room.join({ "X-Eqosys-Token": "art" })).ws, guest = (await room.join({ "X-Eqosys-Token": "bo" })).ws;
  const art = await hello(artist, "b");
  await hello(guest, "c");
  await heard(artist, "guests");

  // the artist's note is heard with nobody granting a thing; the guest's goes nowhere
  const note = (midi: number) => ({ t: "live", e: { t: "on", track: 0, midi, vel: 0.8 } });
  await until(() => maker.sent.some((m) => m.t === "grants" && m.grants.who[art]));
  maker.sent = [];
  said(artist, note(60));
  said(guest, note(72));
  expect(maker.sent.filter((m) => m.t === "live").map((m) => m.e.midi)).toEqual([60]);

  // the maker's second event, in another room, waits for this one
  const other = await setup(env, "event-after");
  await other.join({}, MAKER, "event=after");
  expect((await other.join()).ws.sent).toEqual([{ t: "full", why: "busy" }]);

  // four hours after the first guest, everyone but the maker is sent out, and stays out
  const start = Date.now();
  await room.world.alarm();                              // the save that was due; after it, the alarm is the event's end
  expect(room.ctx.alarmAt).toBeGreaterThan(start + EVENT_MS - 60_000);
  try {
    setSystemTime(new Date(start + EVENT_MS + 1000));
    await room.world.alarm();
    for (const ws of [artist, guest]) { expect(ws.sent.at(-1)).toEqual({ t: "full", why: "over" }); expect(ws.closed).toBe(CLOSE_FULL); }
    expect(maker.closed).toBeNull();
    expect((await room.join({ "X-Eqosys-Token": "art" })).ws.sent).toEqual([{ t: "full", why: "over" }]);
    expect((await other.join()).ws.closed).toBeNull();
    // a day after it began, the event can run again
    setSystemTime(new Date(start + EVENT_REST_MS + 1000));
    expect((await room.join({ "X-Eqosys-Token": "art" })).ws.closed).toBeNull();
  } finally { setSystemTime(); }
});

/** The edge's real Lobby on a fake platform, as every room reaches it. */
async function edgeLobby(): Promise<NonNullable<WorldEnv["LOBBY"]>> {
  const store = new Map<string, unknown>();
  let gate: Promise<unknown> = Promise.resolve();
  const lobby = new Lobby({
    storage: {
      get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); }, delete: async (k) => store.delete(k),
      list: async <T>() => new Map<string, T>(),
    },
    blockConcurrencyWhile: (f) => { gate = f(); },
  }, {});
  await gate;
  return { idFromName: () => "lobby", get: () => ({ fetch: (url, init) => lobby.fetch(new Request(url, init)) }) };
}

async function until(done: () => boolean) {
  for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 2));
  expect(done()).toBe(true);
}

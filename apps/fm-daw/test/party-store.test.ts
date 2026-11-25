// Qevent's parties on the owner's account (#5932): the builder on one device saves them, another device reads them back,
// and anyone with the join link sees only the live party's scene on stage and its room.
import { expect, test } from "bun:test";
import Profile from "../src/profile.ts";
import worker from "../src/worker.ts";
import { partyOwner } from "../src/party-store.ts";
import { addScene, EMPTY, goLive, LiveParty, makeParty, PartiesReply, partyRoom, switchScene, type Parties } from "../src/studio/party.ts";
import { ROOM_LIST } from "../src/studio/rooms/index.ts";
import { check } from "@rustybuns/util/guard";

test("one device saves a party and goes live; another reads it back; the join link sees the scene on stage", async () => {
  const kept = new Map<string, unknown>();
  const p = new Profile({ storage: { get: async (k) => kept.get(k), put: async (k, v) => { kept.set(k, v); } } });
  const owner = await partyOwner("eq:someone");
  const ask = (path: string, init: RequestInit = {}) => p.fetch(new Request(`https://profile${path}`, { ...init, headers: { "X-Party-Owner": owner } }));

  // a fresh account has no parties, and nothing is live
  expect(check(PartiesReply, await (await ask("/parties")).json())).toEqual({ owner, store: EMPTY });
  expect((await ask("/live")).status).toBe(404);

  // the laptop makes a party with two performers and goes live with the first on stage
  const steps = [
    (s: Parties) => makeParty(s, "Saturday night", Date.UTC(2026, 11, 5, 21), ROOM_LIST[0]!, "Ana"),
    (s: Parties) => addScene(s, "Bo", ROOM_LIST[1]!),
    (s: Parties) => switchScene(s, "s1"),
    (s: Parties) => goLive(s, "saturday-night"),
  ];
  let store: Parties = EMPTY;
  for (const f of steps) { const d = f(store); expect(d.ok).toBe(true); store = d.store; }
  expect((await ask("/parties", { method: "PUT", body: JSON.stringify(store) })).status).toBe(200);

  // the phone reads the same store back
  expect(check(PartiesReply, await (await ask("/parties")).json())?.store).toEqual(JSON.parse(JSON.stringify(store)));
  // the join link's room is the live party's own, with the first performer's room on stage and its start time
  const live = check(LiveParty, await (await ask("/live")).json());
  expect(live).toMatchObject({ name: "Saturday night", when: Date.UTC(2026, 11, 5, 21), room: partyRoom(owner, "saturday-night"), performer: "Ana" });
  expect(live?.studio.id).toBe(ROOM_LIST[0]!.id);

  // a store that isn't one is refused and the kept one stays
  expect((await ask("/parties", { method: "PUT", body: JSON.stringify({ parties: [{ id: "x" }] }) })).status).toBe(400);
  expect((await ask("/parties", { method: "PUT", body: "{nope" })).status).toBe(400);
  expect(check(PartiesReply, await (await ask("/parties")).json())?.store.parties).toHaveLength(1);
});

test("the Worker keeps parties only for someone signed in", async () => {
  const env = {} as Parameters<typeof worker.fetch>[1];
  expect((await worker.fetch(new Request("https://fm-daw.test/parties?uid=a-guest"), env)).status).toBe(401);
});

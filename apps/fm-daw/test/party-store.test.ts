// Qevent's parties on the owner's account (#5932): the builder on one device saves them, another device reads them back,
// and anyone with the join link sees only the live party's scene on stage and its room.
import { expect, test } from "bun:test";
import Profile from "../src/profile.ts";
import worker from "../src/worker.ts";
import { partyOwner } from "../src/party-store.ts";
import { addScene, EMPTY, goLive, invitedWords, LiveParty, makeParty, PartiesReply, partyFollow, partyFrom, partyRoom, switchScene, whenWords, type Parties } from "../src/studio/party.ts";
import { fromBuilt } from "../src/studio/builder.ts";
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

test("a guest in the live party follows the owner's scene switch, and the join page says when it starts", async () => {
  const kept = new Map<string, unknown>();
  const p = new Profile({ storage: { get: async (k) => kept.get(k), put: async (k, v) => { kept.set(k, v); } } });
  const owner = await partyOwner("eq:host");
  const ask = (path: string, init: RequestInit = {}) => p.fetch(new Request(`https://profile${path}`, { ...init, headers: { "X-Party-Owner": owner } }));
  const save = async (s: Parties) => expect((await ask("/parties", { method: "PUT", body: JSON.stringify(s) })).status).toBe(200);
  const live = async () => check(LiveParty, await (await ask("/live")).json());
  const starts = Date.UTC(2026, 11, 5, 21);

  let store = makeParty(EMPTY, "Saturday night", starts, ROOM_LIST[0]!, "Ana").store;
  store = addScene(store, "Bo", ROOM_LIST[1]!).store;
  store = switchScene(store, "s1").store;
  store = goLive(store, "saturday-night").store;
  await save(store);

  // the guest's page stands in Ana's setup, from the join link the owner copied
  const first = await live();
  const join = `https://fm-daw.test/jam.html?room=${first!.room}&studio=yours&built=${encodeURIComponent(JSON.stringify(first!.studio))}&party=${owner}`;
  expect(partyFrom(new URL(join).search)).toBe(owner);
  const standing = fromBuilt(new URL(join).search)!;
  expect(partyFollow(join, first, standing)).toBeNull();
  expect(invitedWords(first!, starts - 3_600_000, "en-GB")).toBe(`You're invited to Saturday night. Ana is on. It starts ${whenWords(starts, "en-GB")}.`);
  expect(invitedWords(first!, starts + 60_000)).toBe("You're invited to Saturday night. Ana is on.");

  // the owner puts Bo on: the guest's next look walks them into Bo's setup, in the same room
  store = switchScene(store, store.parties[0]!.scenes[1]!.id).store;
  await save(store);
  const to = partyFollow(join, await live(), standing);
  expect(to).not.toBeNull();
  const next = new URL(to!);
  expect(next.searchParams.get("room")).toBe(first!.room);
  expect(fromBuilt(next.search)?.id).toBe(ROOM_LIST[1]!.id);
  expect(partyFollow(to!, await live(), fromBuilt(next.search)!)).toBeNull();

  // the owner takes it off live: the guests stay where they are
  await save(goLive(store, null).store);
  expect((await ask("/live")).status).toBe(404);
  expect(partyFollow(to!, null, fromBuilt(next.search)!)).toBeNull();
});

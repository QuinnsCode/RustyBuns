// A real venue as a party's room (#5933): a ShareSplat capture laid round every scene, carried in the join link's
// studio, and only from ShareSplat (a join link is anyone's to make, so it can't point guests' pages at any host).
import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { builtLink, fromBuilt, Studio, venueSrc } from "../src/studio/builder.ts";
import { addScene, EMPTY, makeParty, setVenue, type Parties } from "../src/studio/party.ts";
import { ROOM_LIST } from "../src/studio/rooms/index.ts";

const HOST = "https://sharesplat.notryanquinn.workers.dev", ID = "0123456789abcdef0123";
const SRC = `${HOST}/s/${ID}.spz`;

test("every link ShareSplat hands out finds the capture; anything else is refused", () => {
  const rows: [string, string | null][] = [
    [SRC, SRC],
    [`${HOST}/p/${ID}`, SRC],
    [`${HOST}/?embed=1&src=${encodeURIComponent(`/s/${ID}.spz`)}`, SRC],
    [`${HOST}/?embed=1&src=${encodeURIComponent(SRC)}`, SRC],
    [`  ${HOST}/p/${ID}  `, SRC],
    [`https://elsewhere.example/s/${ID}.spz`, null],
    [`${HOST}/?embed=1&src=${encodeURIComponent(`https://elsewhere.example/s/${ID}.spz`)}`, null],
    [`${HOST}/p/not-an-id`, null],
    ["a venue", null],
  ];
  for (const [link, want] of rows) expect([link, venueSrc(link)]).toEqual([link, want]);
});

test("a party's venue goes round every scene, rides the join link, and comes off again", () => {
  let store: Parties = EMPTY;
  for (const f of [
    (s: Parties) => makeParty(s, "Warehouse night", null, ROOM_LIST[0]!, "Ana"),
    (s: Parties) => addScene(s, "Bo", ROOM_LIST[1]!),
    (s: Parties) => setVenue(s, { src: SRC, scale: 1.5, at: [0, -0.2, 1], yaw: Math.PI / 2 }),
  ]) { const d = f(store); expect(d.ok).toBe(true); store = d.store; }
  const scenes = store.parties[0]!.scenes;
  expect(scenes.map((s) => s.studio.venue?.src)).toEqual([SRC, SRC]);
  // each performer keeps their own seats in it
  expect(scenes.map((s) => s.studio.spots.length)).toEqual([ROOM_LIST[0]!.spots.length, ROOM_LIST[1]!.spots.length]);

  // the join link carries the studio, venue and all
  const link = new URL(builtLink("https://studio.example", scenes[1]!.studio));
  expect(fromBuilt(link.search)?.venue).toEqual({ src: SRC, scale: 1.5, at: [0, -0.2, 1], yaw: Math.PI / 2 });

  // a studio pointing at another host doesn't check out, so no page loads it
  expect(check(Studio, { ...scenes[0]!.studio, venue: { src: `https://elsewhere.example/s/${ID}.spz`, scale: 1, at: [0, 0, 0], yaw: 0 } })).toBeNull();

  const off = setVenue(store, null);
  expect(off.ok && off.store.parties[0]!.scenes.every((s) => !s.studio.venue)).toBe(true);
});

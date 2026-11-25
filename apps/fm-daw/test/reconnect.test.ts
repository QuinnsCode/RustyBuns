// A socket drop mid-set isn't a stop: the World holds a page that named itself (?tab=, src/ui/net.ts) for
// LEAVE_GRACE_MS, gives it its peer number back when it reconnects, and the rest of the room never hears it go. So
// nobody's page runs its "gone" (the PA call hung up, the YouTube deck stopped, the figure dropped), and the music on
// every tab plays on through it. Gone for good, the room hears it once the grace runs out.
import { expect, test } from "bun:test";
import { heard, setup, useWorld, type Sock } from "./world-kit.ts";
import { CLOSE_RESUMED } from "../packages/desktop/world.ts";
import { tubeSayOf } from "../src/dj/booth.ts";
import { decodeServer } from "../src/project.ts";
import { body, gone, hear, newJam } from "../src/studio/jam.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";

useWorld();

const DJ_TAB = "d".repeat(32), FAN_TAB = "f".repeat(32);
const peerOf = (ws: Sock) => (ws.att as { peer: number }).peer;
const goneFrom = (ws: Sock) => ws.sent.filter((m) => m.t === "gone").map((m) => m.from);

async function midSet(graceMs: string) {
  const kit = await setup({ LEAVE_GRACE_MS: graceMs }, "night-set");
  const say = (ws: Sock, m: object) => kit.world.webSocketMessage(ws, JSON.stringify(m));
  const dj = (await kit.join({}, "a".repeat(32), `tab=${DJ_TAB}`)).ws;
  say(dj, { t: "hello", key: "a".repeat(48), name: "DJ" });
  await heard(dj, "chat");
  const fan = (await kit.join({}, "", `tab=${FAN_TAB}`)).ws;
  say(fan, { t: "hello", key: "b".repeat(48), name: "Fan" });
  await heard(fan, "chat");
  // the DJ is on: a YouTube deck playing and the PA carrying the set, and the fan's page hears both
  const tube = tubeSayOf(0, { id: "M7lc1UVf-VE", name: "A video", len: 200, pos: 10, cue: 0, playing: true, rate: 1, vol: 90 }, 0);
  say(dj, { t: "live", e: body(newJam(LIVE_ROOM)) });
  say(dj, { t: "live", e: { t: "pa", on: true, name: "DJ" } });
  say(dj, { t: "live", e: tube });
  // the fan's page as main.ts runs it: the room's people, and the music it plays for them
  const page = { jam: newJam(LIVE_ROOM), paOn: new Set<number>(), tube: new Set<number>() };
  const read = (ws: Sock) => {
    for (const m of ws.sent.splice(0)) {
      const d = decodeServer(m);
      if (d?.t === "live") { hear(page.jam, d.from, d.e); if (d.e.t === "pa") page.paOn.add(d.from); if (d.e.t === "deck" && d.e.playing) page.tube.add(d.from); }
      if (d?.t === "gone") { gone(page.jam, d.from); page.paOn.delete(d.from); page.tube.delete(d.from); }
    }
  };
  read(fan);
  expect([...page.paOn, ...page.tube]).toEqual([peerOf(dj), peerOf(dj)]);
  expect(page.jam.others.has(peerOf(dj))).toBe(true);
  return { ...kit, say, dj, fan, page, read, tube };
}

test("the fan's socket drops mid-set and comes back: same peer, nobody heard it go, the DJ's set never stopped there", async () => {
  const { join, leave, dj, fan, page, read } = await midSet("60000");
  const was = peerOf(fan);
  dj.sent = [];
  leave(fan);
  const back = (await join({}, "", `tab=${FAN_TAB}`)).ws;
  expect(peerOf(back)).toBe(was);
  expect(goneFrom(dj)).toEqual([]);                                  // the DJ's PA never hung up the fan's call
  read(back);
  expect(page.paOn.has(peerOf(dj)) && page.tube.has(peerOf(dj))).toBe(true);
});

test("the DJ's socket drops and comes back: the room keeps the DJ, the decks stay theirs, the PA and the video play on", async () => {
  const { world, join, leave, say, dj, fan, page, read, tube } = await midSet("60000");
  const was = peerOf(dj);
  leave(dj);
  // a reconnect the World hasn't seen close yet: the old socket closes without a word, and doesn't count against the seats
  const back = (await join({}, "a".repeat(32), `tab=${DJ_TAB}`)).ws;
  const again = (await join({}, "a".repeat(32), `tab=${DJ_TAB}`)).ws;
  expect(back.closed).toBe(CLOSE_RESUMED);
  expect([peerOf(back), peerOf(again)]).toEqual([was, was]);
  // the platform tells the World the old one closed: still nobody leaves
  world.webSocketClose(back);
  say(again, { t: "hello", key: "a".repeat(48), name: "DJ" });
  await heard(again, "chat");
  read(fan);
  expect(page.jam.others.has(was)).toBe(true);
  expect([...page.paOn, ...page.tube]).toEqual([was, was]);
  // still the DJ's deck: their next say goes through to the room
  say(again, { t: "live", e: { ...tube, pos: 40 } });
  expect(fan.sent.some((m) => m.t === "live" && m.e.t === "deck" && m.e.pos === 40)).toBe(true);
});

test("a page that doesn't come back is gone once the grace runs out, and its seat is free", async () => {
  const { leave, dj, fan, page, read } = await midSet("20");
  const was = peerOf(dj);
  leave(dj);
  expect(goneFrom(fan)).toEqual([]);
  for (let i = 0; i < 500 && !goneFrom(fan).length; i++) await new Promise((r) => setTimeout(r, 2));
  read(fan);
  expect(page.jam.others.has(was)).toBe(false);
  expect(page.paOn.size + page.tube.size).toBe(0);
});

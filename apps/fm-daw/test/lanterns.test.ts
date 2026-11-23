// Desert Gathering's lanterns through the real World: two people in the room, one takes a lantern off the deck table,
// the other sees it go with them and can't take it, it is set down far out in the desert, and a reload (and a World
// woken cold from its storage) still finds it there. A carrier who leaves drops theirs where they stood.
import { expect, test } from "bun:test";
import World from "../packages/desktop/world.ts";
import { setup, useWorld, type Sock } from "./world-kit.ts";
import { decodeLanternServer } from "../src/lanterns.ts";
import { decodeServer } from "../src/project.ts";
import { DESERT_GATHERING } from "../src/studio/rooms/desert-gathering.ts";
import { LanternsHere } from "../src/studio/lanterns.ts";
import { body, gone, hear, newJam, walkTo } from "../src/studio/jam.ts";

useWorld();

test("a lantern taken off the deck table goes with its carrier for everyone, stays where it's set down, and drops where a leaver stood", async () => {
  const { ctx, store, world, join, leave } = await setup({}, "dusty-moon-fox");
  /** The jam room's page on a socket: its people from the live line, its lanterns from the World. */
  const page = async () => {
    const ws: Sock = (await join()).ws, jam = newJam(DESERT_GATHERING);
    const lit = new LanternsHere(DESERT_GATHERING, (m) => world.webSocketMessage(ws, JSON.stringify(m)));
    let read = 0;
    const pump = () => {
      for (; read < ws.sent.length; read++) {
        const l = decodeLanternServer(ws.sent[read]), m = l ? null : decodeServer(ws.sent[read]);
        if (l) lit.heard(l);
        else if (m?.t === "live") hear(jam, m.from, m.e);
        else if (m?.t === "gone") gone(jam, m.from);
      }
    };
    const go = (x: number, z: number) => { walkTo(jam, x, z); world.webSocketMessage(ws, JSON.stringify({ t: "live", e: body(jam) })); };
    return { ws, jam, lit, pump, go };
  };
  const amy = await page(), ben = await page();
  const table = DESERT_GATHERING.outdoor!.lanterns!;
  expect(table).toHaveLength(6);
  // both walk up to the left end of the deck table, in front of it on the stage
  amy.go(-1.3, -6.9); ben.go(-1.2, -6.8);
  amy.pump(); ben.pump();
  expect(amy.lit.hint(amy.jam)).toContain("pick up");
  const first = amy.lit.near(amy.jam)!;
  expect(first).not.toBeNull();
  expect(amy.lit.use(amy.jam, first).ok).toBe(true);
  amy.pump(); ben.pump();
  expect(amy.lit.mine()).toBe(first);
  // ben sees it in amy's hand, and his grab for that one is turned down
  const seen = () => ben.lit.places(ben.jam)[first]!;
  expect(seen().by).toBe(amy.lit.me!);
  expect(ben.lit.use(ben.jam, first)).toEqual({ ok: false, why: "Someone else has that lantern" });
  // reaching past his page (two at once): the World gives it to whoever was first
  world.webSocketMessage(ben.ws, JSON.stringify({ t: "lantern", room: DESERT_GATHERING.id, i: first, take: true }));
  ben.pump(); amy.pump();
  expect(seen().by).toBe(amy.lit.me!);
  // she walks it far out into the desert; it moves with her on his screen, and she sets it down there
  amy.go(15, 2);
  ben.pump();
  expect(Math.hypot(seen().x - 15, seen().z - 2)).toBeLessThan(0.6);
  amy.jam.me.yaw = 0;
  expect(amy.lit.use(amy.jam).ok).toBe(true);
  amy.pump(); ben.pump();
  expect(amy.lit.mine()).toBeNull();
  expect(seen()).toMatchObject({ by: null, y: 0 });
  expect(Math.hypot(seen().x - 15, seen().z - 1.4)).toBeLessThan(0.1);
  // ben reloads: the lantern is still out there, and the rest still stand on the table
  leave(ben.ws);
  const ben2 = await page();
  ben2.pump();
  const out = ben2.lit.places(ben2.jam);
  expect(Math.hypot(out[first]!.x - 15, out[first]!.z - 1.4)).toBeLessThan(0.1);
  expect(out.filter((p) => p.i !== first).map((p) => [p.x, p.y, p.z])).toEqual(table.filter((_, i) => i !== first));
  // amy takes a second one and leaves with it in her hand: it drops on the sand where she last stood
  amy.go(1.3, -6.9);
  const second = amy.lit.near(amy.jam)!;
  expect(amy.lit.use(amy.jam).ok).toBe(true);
  amy.go(5, 3);
  leave(amy.ws);
  ben2.pump();
  const dropped = ben2.lit.places(ben2.jam)[second]!;
  expect(dropped).toMatchObject({ y: 0, by: null });
  expect(Math.hypot(dropped.x - 5, dropped.z - 3)).toBeLessThan(0.1);
  // the World saves, and one woken cold from its storage still has both where they were left
  await world.alarm();
  expect(store.has("lanterns")).toBe(true);
  const cold = new World(ctx, {});
  await ctx.gate;
  await cold.fetch(new Request("http://x/ws", { headers: { Upgrade: "websocket", "X-User-Id": "u", "X-Room": "dusty-moon-fox" } }));
  const ws = ctx.sockets.at(-1)!;
  const back = decodeLanternServer(ws.sent.find((m) => m.t === "lanterns"))!;
  expect(back.lanterns.moved[first]).toEqual(ben2.ws.sent.findLast((m) => m.t === "lanterns").lanterns.moved[first]);
  expect(back.lanterns.moved[second]).toEqual({ at: [dropped.x, 0, dropped.z] });
});

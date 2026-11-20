// The gear wall in a studio (#5393), as two friends in a sesh use it: Amy walks the live room to its gear wall, lifts
// the lead amp off the rack onto the cab (the ghost says where it will land before she lets go), cables her guitar
// through two pedals into the amp and the amp into the cab, and cables a compressor between the desk's aux 2 send and
// return. Ben, in the same sesh on his own page, gets every step: his guitar plays through her chain from where the
// cab stands, and his desk's aux 2 return plays the compressor. Through the real World, on its fake platform.
import { expect, test } from "bun:test";
import { setup, useWorld } from "./world-kit.ts";
import { decodeServer } from "../src/project.ts";
import { decodeStudioServer } from "../src/studio.ts";
import { auxGear } from "../src/room/room.ts";
import { GearHands } from "../src/studio/gear-hands.ts";
import { gearPlace, toStudio } from "../src/studio/gear-wall.ts";
import { hear, newJam, walkTo } from "../src/studio/jam.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";

useWorld();

test("cable guitar, two pedals, amp and cab at the live room's gear wall, and a pedal on the desk's aux 2: a friend in the sesh hears both", async () => {
  const { world, join } = await setup();
  /** A jam room page on a socket, as src/studio/main.ts keeps it: its gear wall in step with what the World sends. */
  const page = async () => {
    const ws = (await join()).ws, jam = newJam(LIVE_ROOM);
    const hands = new GearHands(LIVE_ROOM, (op) => world.webSocketMessage(ws, JSON.stringify({ t: "studio", op })));
    let read = 0;
    const pump = () => {
      for (; read < ws.sent.length; read++) {
        const s = decodeStudioServer(ws.sent[read]), m = s ? null : decodeServer(ws.sent[read]);
        if (s) hands.onStudio(s); else if (m?.t === "live") hear(jam, m.from, m.e);
      }
    };
    world.webSocketMessage(ws, JSON.stringify({ t: "studio", op: { t: "drop" } }));   // online: ask for the gear, and which hand is yours
    pump();
    return { jam, hands, pump };
  };
  const amy = await page();
  // nobody had set the gear out in this sesh: her page puts the wall in as it starts, for everyone
  expect(amy.hands.state(amy.jam).items.length).toBeGreaterThan(10);
  const ben = await page();
  expect(ben.hands.state(ben.jam).items).toEqual(amy.hands.state(amy.jam).items);

  const g = gearPlace(LIVE_ROOM), { jam, hands } = amy;
  /** Walk to a point of the gear wall's own frame (x across the rack, z out from it), along the studio's floor. */
  const go = (...pts: [number, number][]) => { for (const [x, z] of pts) walkTo(jam, ...toStudio(g, x, z)); };
  const click = (id: string, part?: string) => { hands.lookAt(jam, id, part); return hands.click(jam); };

  // From the door the rack is out of reach; in front of it, the lead amp on its top shelf comes down into her hands.
  expect(click("lead")).toEqual({ ok: false, why: "nothing in reach" });
  go([0, -1.9]);
  expect(click("lead")).toEqual({ ok: true });

  // Over to the cab. Looking down at the floor it would land there; held level with the cab's top, on the cab.
  go([1.0, -0.95], [1.8, -0.95]);
  jam.me.yaw = g.yaw; jam.me.pitch = -1.0;
  expect(hands.state(jam).lands?.on).toBe("the floor");
  jam.me.pitch = -0.35;
  expect(hands.state(jam).lands?.on).toBe("2x12 cab");
  expect(hands.click(jam)).toEqual({ ok: true });

  // Guitar out, into Q Drive, Q Drive into Q Fuzz (with a cable in her hand, the free inputs light up), into the amp.
  go([1.8, 0.6], [-0.6, 0.6]);
  expect(click("guitar", "out")).toEqual({ ok: true });
  expect(hands.state(jam).open).toContainEqual(["drive", "in"]);
  expect(hands.state(jam).open).not.toContainEqual(["drive", "out"]);
  go([-0.7, -1.9]);
  expect(click("drive", "in")).toEqual({ ok: true });
  expect(click("drive", "out")).toEqual({ ok: true });
  expect(click("fuzz", "in")).toEqual({ ok: true });
  expect(click("fuzz", "out")).toEqual({ ok: true });
  go([1.0, -0.9], [1.6, -0.85]);
  expect(click("lead", "in")).toEqual({ ok: true });
  // round the cab to the amp's back: its speaker out into the cab
  go([2.5, -0.9], [2.1, -2.2]);
  expect(click("lead", "speaker")).toEqual({ ok: true });
  expect(click("cab", "in")).toEqual({ ok: true });

  // The desk's aux 2: its send into Q Comp off the pedal wall, Q Comp back into its return.
  go([2.5, -0.9], [0.2, 0.6]);
  expect(click("desk", "aux-send-2")).toEqual({ ok: true });
  go([-0.7, -1.2]);
  expect(click("comp", "in")).toEqual({ ok: true });
  expect(click("comp", "out")).toEqual({ ok: true });
  go([0.2, 0.6]);
  expect(click("desk", "aux-return-2")).toEqual({ ok: true });

  // Ben's page took every step: his guitar plays through Amy's chain, heard from the cab where it stands in the room.
  ben.pump();
  const hers = hands.rig(), his = ben.hands.rig();
  expect(his?.chain).toEqual(["guitar", "drive", "fuzz", "lead", "cab"]);
  expect(his).toEqual(hers);
  expect(his?.settings).toMatchObject({ amp: "lead", board: [{ pedal: "drive" }, { pedal: "fuzz" }], bypass: false });
  expect(his?.at ?? null).toEqual(ben.hands.at("cab"));
  // and a track's aux 2 send goes through Q Comp, as his desk's return plays it
  expect(auxGear(ben.hands.room.studio.patch, 2).settings).toMatchObject({ direct: true, board: [{ pedal: "comp" }] });
});

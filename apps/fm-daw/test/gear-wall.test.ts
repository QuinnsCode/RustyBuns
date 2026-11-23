// The gear wall in a studio (#5393), as two friends in a sesh use it: Amy walks the live room to its gear wall, lifts
// the lead amp off the rack onto the cab (the ghost says where it will land before she lets go), cables her guitar
// through two pedals into the amp and the amp into the cab, and cables a compressor between the desk's aux 2 send and
// return. Ben, in the same sesh on his own page, gets every step: his guitar plays through her chain from where the
// cab stands, and his desk's aux 2 return plays the compressor. Then the sound wall (#5688): Amy patches a voice in
// its case and brings a module, and Ben's page runs the same wall, its sequencer on the same step on the sesh's beat.
// Through the real World, on its fake platform.
import { expect, setDefaultTimeout, test } from "bun:test";
import { setup, useWorld } from "./world-kit.ts";
import { decodeServer } from "../src/project.ts";
import { decodeStudioServer } from "../src/studio.ts";
import { auxGear } from "../src/room/room.ts";
import { GearHands } from "../src/studio/gear-hands.ts";
import { gearPlace, toStudio } from "../src/studio/gear-wall.ts";
import { hear, newJam, walkTo } from "../src/studio/jam.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { Wall } from "../src/wall/wall.ts";

setDefaultTimeout(30_000);
useWorld();

/** Two jam room pages on sockets, as src/studio/main.ts keeps them: each gear wall in step with what the World sends. */
async function sesh() {
  const { world, join } = await setup();
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
  return { amy, ben: await page() };
}

test("cable guitar, two pedals, amp and cab at the live room's gear wall, and a pedal on the desk's aux 2: a friend in the sesh hears both", async () => {
  const { amy, ben } = await sesh();
  // nobody had set the gear out in this sesh: her page puts the wall in as it starts, for everyone
  expect(amy.hands.state(amy.jam).items.length).toBeGreaterThan(10);
  ben.pump();
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

test("patch a voice at the gear wall's sound wall and bring a module: a friend's page plays the same wall, on the same step on the beat", async () => {
  const { amy, ben } = await sesh();
  const g = gearPlace(LIVE_ROOM), { jam, hands } = amy;
  const go = (...pts: [number, number][]) => { for (const [x, z] of pts) walkTo(jam, ...toStudio(g, x, z)); };
  const cable = (a: string, ja: string, b: string, jb: string) => { hands.lookAt(jam, a, ja); const one = hands.click(jam); hands.lookAt(jam, b, jb); return [one, hands.click(jam)]; };
  expect(hands.wall()).toMatchObject({ playing: false });

  // Round the cab to the case right of the rack, then the first voice: Q Steps into Q Saw, through Q Filter and Q Level to Q Out.
  go([2.5, 0.5], [2.5, -2.0], [1.84, -2.15]);
  for (const [a, ja, b, jb] of [
    ["wall-seq", "cv", "wall-vco", "voct"], ["wall-vco", "saw", "wall-vcf", "in"], ["wall-vcf", "lp", "wall-vca", "in"],
    ["wall-seq", "gate", "wall-env", "gate"], ["wall-env", "out", "wall-vca", "cv"],
    ["wall-vca", "out", "wall-mix", "in-1"], ["wall-mix", "main", "wall-out", "in-l"],
  ]) expect(cable(a, ja, b, jb)).toEqual([{ ok: true }, { ok: true }]);
  // K brings another Q Saw to her hands; held level in front of the case, it goes into the top row
  expect(hands.bring(jam, "vco")).toEqual({ ok: true });
  jam.me.yaw = g.yaw; jam.me.pitch = 0;
  expect(hands.click(jam)).toEqual({ ok: true });

  // Ben's page took every step: the same modules, cables and knobs, heard from the same Q Out on the studio's floor.
  ben.pump();
  const hers = hands.wall(), his = ben.hands.wall();
  expect(his).toMatchObject({ playing: true, problems: [] });
  expect(his.spec.modules.map((m) => m.id)).toContain("vco-1");
  expect(his).toEqual(hers);
  expect(his.at?.[0]).toBeCloseTo(ben.hands.at("wall-out")?.[0] ?? NaN, 5);

  // Each page runs its own wall, and Ben's started a third of a second later. Each is told the sesh's tempo (120 bpm)
  // and the band's beat as it starts, then counts on its own: a few beats on, each Q Steps is on the same step, its
  // gate in the same place.
  const rate = 48000, bpm = 120, seq = (w: Wall) => w.state().find((m) => m.id === "wall-seq");
  const run = (w: Wall, from: number, to: number, beat: boolean) => {
    const l = new Float32Array(128), r = new Float32Array(128);
    if (beat) w.tempo(bpm, 1000 + (from / rate) * (bpm / 60));
    for (let f = from; f < to; f += 128) w.process(l, r, 128);
  };
  const [a, b, c, d] = [0, 1, 2, 3].map(() => new Wall(rate));
  for (const w of [a, c]) w.set(hers.spec);
  for (const w of [b, d]) w.set(his.spec);
  run(a, 0, 4 * rate, true); run(b, 16000, 4 * rate, true);
  expect(seq(b)?.read.step).toBe(seq(a)?.read.step);
  expect(seq(b)?.outs.gate).toBe(seq(a)?.outs.gate);
  // off the beat (the gear room alone), each counts from when it started, so the two sit on different steps
  run(c, 0, 4 * rate, false); run(d, 16000, 4 * rate, false);
  expect(seq(d)?.read.step).not.toBe(seq(c)?.read.step);
});

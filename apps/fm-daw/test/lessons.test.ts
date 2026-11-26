// The jam room's setup lessons (#5861), as a beginner walks each one at the live room's gear wall with their hands:
// the same Lessons the page shows at the top left and qjam.lesson() reads, on the sesh's patch through the real World
// (its fake platform). Each journey makes one mistake first and gets the reason in plain words, then puts it right; at
// the end the lesson is done and the rig plays on as the room's own.
import { expect, setDefaultTimeout, test } from "bun:test";
import { setup, useWorld } from "./world-kit.ts";
import { decodeServer } from "../src/project.ts";
import { decodeStudioServer } from "../src/studio.ts";
import { gearOf, listen } from "../src/room/room.ts";
import { GearHands } from "../src/studio/gear-hands.ts";
import { gearPlace, toStudio } from "../src/studio/gear-wall.ts";
import { hear, newJam, walkTo } from "../src/studio/jam.ts";
import { Lessons } from "../src/studio/lessons.ts";
import { classOf, lessonLine } from "../src/studio/class.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";

setDefaultTimeout(30_000);
useWorld();

/** One jam room page in a sesh, its gear wall in step with the World, and its lessons. */
async function walkIn() {
  const { world, join } = await setup();
  const ws = (await join()).ws, jam = newJam(LIVE_ROOM);
  const hands = new GearHands(LIVE_ROOM, (op) => world.webSocketMessage(ws, JSON.stringify({ t: "studio", op })));
  let read = 0;
  const pump = () => {
    for (; read < ws.sent.length; read++) {
      const s = decodeStudioServer(ws.sent[read]), m = s ? null : decodeServer(ws.sent[read]);
      if (s) hands.onStudio(s); else if (m?.t === "live") hear(jam, m.from, m.e);
    }
  };
  world.webSocketMessage(ws, JSON.stringify({ t: "studio", op: { t: "drop" } }));
  pump();
  const g = gearPlace(LIVE_ROOM), lessons = new Lessons(hands);
  /** Walk to points of the gear wall's own frame, along the studio's floor. */
  const go = (...pts: [number, number][]) => { for (const [x, z] of pts) walkTo(jam, ...toStudio(g, x, z)); };
  const click = (id: string, part?: string) => { hands.lookAt(jam, id, part); return hands.click(jam); };
  /** Look at a knob, hold the click and drag: up turns it up (a pixel is 0.004). */
  const turn = (id: string, knob: string, by: number) => { expect(click(id, knob)).toEqual({ ok: true }); hands.drag(-by / 0.004); hands.turning = null; };
  const now = () => lessons.state()!;
  /** What this page says on the live line about its lesson (main.ts does it a few times a second). */
  const sayLesson = () => world.webSocketMessage(ws, JSON.stringify({ t: "live", e: lessonLine(lessons.state(), lessons.finished) }));
  return { jam, hands, lessons, g, go, click, turn, now, join, sayLesson };
}

test("plug a guitar through a pedal into an amp: straight into the amp is caught, then a gain too hot", async () => {
  const { lessons, jam, hands, g, go, click, turn, now } = await walkIn();
  expect(lessons.start("guitar", jam)).toEqual({ ok: true });
  expect(now()).toMatchObject({ id: "guitar", next: 0, done: false });

  // an amp on the rack faces out, its back to the wall: lift Q Lead 50 down onto the cab, where you can get round it
  go([0, -1.9]);
  expect(click("lead")).toEqual({ ok: true });
  go([1.0, -0.95], [1.8, -0.95]);
  jam.me.yaw = g.yaw; jam.me.pitch = -0.35;
  expect(hands.click(jam)).toEqual({ ok: true });

  // the guitar's cable straight into the amp's In: the first step says why that isn't it
  go([1.8, 0.6], [-0.6, 0.6]);
  expect(click("guitar", "out")).toEqual({ ok: true });
  go([1.0, -0.9], [1.6, -0.85]);
  expect(click("lead", "in")).toEqual({ ok: true });
  expect(now().steps[0]).toMatchObject({ done: false });
  expect(now().steps[0].why).toContain("straight into Q Lead 50");

  // pull it out of the amp, into Q Drive; Q Drive's Out into the amp
  expect(click("lead", "in")).toEqual({ ok: true });
  go([1.0, -0.9], [-0.7, -1.9]);
  expect(click("drive", "in")).toEqual({ ok: true });
  expect(click("drive", "out")).toEqual({ ok: true });
  go([1.0, -0.9], [1.6, -0.85]);
  expect(click("lead", "in")).toEqual({ ok: true });
  expect(now()).toMatchObject({ next: 2 });

  // round the cab to the amp's back: its Speaker out into the cab
  go([2.5, -0.9], [2.1, -2.2]);
  expect(click("lead", "speaker")).toEqual({ ok: true });
  expect(click("cab", "in")).toEqual({ ok: true });
  // Q Lead 50 stands at 7: not too hot, so that's the lesson done
  expect(now()).toMatchObject({ done: true });

  // the gain right up: too hot, and the card says what that does
  go([2.5, -0.9], [1.6, -0.85]);
  turn("lead", "gain", 0.2);
  expect(now().steps[3].why).toMatch(/Gain too hot \(9 of 10\).*fizz/);
  turn("lead", "gain", -0.3);
  expect(now()).toMatchObject({ done: true, next: -1 });

  // what you built stays: the room plays the guitar through it, and leaving the lesson takes nothing away
  lessons.leave();
  expect(lessons.state()).toBeNull();
  expect(lessons.finished.has("guitar")).toBe(true);
  expect(listen(hands.room.studio.patch, 2).chain).toEqual(["guitar", "drive", "lead", "cab"]);
});

test("patch a sound wall voice: VCO into the filter's CV is caught, then a shut VCA", async () => {
  const { lessons, jam, hands, go, turn, now } = await walkIn();
  const cable = (a: string, ja: string, b: string, jb: string) => { hands.lookAt(jam, a, ja); const one = hands.click(jam); hands.lookAt(jam, b, jb); return [one, hands.click(jam)]; };
  expect(lessons.start("voice", jam)).toEqual({ ok: true });
  go([2.5, 0.5], [2.5, -2.0], [1.84, -2.15]);

  // Q Saw into Q Filter's CV: that moves the cutoff, it doesn't carry the sound
  expect(cable("wall-vco", "saw", "wall-vcf", "cv")).toEqual([{ ok: true }, { ok: true }]);
  expect(now().steps[0].why).toContain("moves the filter's cutoff");
  hands.lookAt(jam, "wall-vcf", "cv"); hands.click(jam); hands.letGo();

  for (const [a, ja, b, jb] of [["wall-vco", "saw", "wall-vcf", "in"], ["wall-vcf", "lp", "wall-vca", "in"], ["wall-vca", "out", "wall-out", "in-l"]]) {
    expect(cable(a, ja, b, jb)).toEqual([{ ok: true }, { ok: true }]);
  }
  // all cabled, but Q Level's Level is at 0 with nothing in its CV: shut
  expect(now()).toMatchObject({ next: 3 });
  expect(now().steps[3].why).toContain("Q Level is shut");
  turn("wall-vca", "level", 0.6);
  expect(now()).toMatchObject({ done: true });
  expect(hands.wall()).toMatchObject({ playing: true });
});

test("set up a PA for a small room: placed, aimed, cabled, and a thump from the wrong switch-on order", async () => {
  const { lessons, jam, hands, g, go, click, now } = await walkIn();
  // into the room's middle, facing the back wall: the kit lands on the floor in front of you
  const b = hands.room.bounds!, mid = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  go([mid.x, mid.z + 1.5]);
  jam.me.yaw = g.yaw; jam.me.pitch = -0.6;
  expect(lessons.start("pa", jam)).toEqual({ ok: true });
  const items = hands.state(jam).items.map((i) => i.id);
  expect(items).toEqual(expect.arrayContaining(["pa-mic", "pa-mixer", "pa-top-1", "pa-top-2"]));

  // the speakers came in side by side: too close together
  expect(now().steps[0].why).toContain("Spread them 2 m or more apart");

  /** Carry a speaker to (x, z) of the gear frame and set it down facing the middle of the room (or, `away`, its back to it). */
  const place = (id: string, x: number, z: number, away = false) => {
    const at = hands.at(id)!;
    walkTo(jam, at[0], at[1]);
    expect(click(id)).toEqual({ ok: true });
    go([x, z]);
    // look away from the middle, then Q and E turn the box in your hands until its front faces you (or, `away`, its back)
    const here = hands.reach(jam).you;
    jam.me.yaw = Math.atan2(mid.x - here.x, mid.z - here.z) + g.yaw; jam.me.pitch = -1.0;
    const off = () => { const a = hands.room.heldTurn - (away ? Math.PI : 0); return Math.atan2(Math.sin(a), Math.cos(a)); };
    for (let i = 0; i < 24 && Math.abs(off()) > 0.14; i++) hands.turn(off() > 0 ? -1 : 1);
    expect(hands.click(jam)).toEqual({ ok: true });
  };
  place("pa-top-1", mid.x - 1.4, mid.z - 1.2, true);
  place("pa-top-2", mid.x + 1.4, mid.z - 1.2);
  expect(now().steps[0]).toMatchObject({ done: true });
  expect(now().steps[1].why).toContain("The first speaker faces the wall");
  place("pa-top-1", mid.x - 1.4, mid.z - 1.2);
  expect(now().steps[1]).toMatchObject({ done: true });

  /** Walk round to the side of a box its jack or knob is on, an arm's length out, look at it and click. */
  const reach = (id: string, part: string) => {
    const p = hands.room.studio.patch.placed.find((x) => x.id === id)!, gd = gearOf(p)!;
    const s = [...gd.jacks, ...gd.knobs].find((x) => x.name === part)!.face === "back" ? -1 : 1;
    go([p.at[0] + s * Math.sin(p.turn) * 0.7, p.at[2] + s * Math.cos(p.turn) * 0.7]);
    return click(id, part);
  };
  // mic into the mixer, the mixer's two outs into the speakers
  const cable = (a: string, ja: string, b2: string, jb: string) => { expect(reach(a, ja)).toEqual({ ok: true }); expect(reach(b2, jb)).toEqual({ ok: true }); };
  cable("pa-mic", "xlr-out", "pa-mixer", "xlr-in-1");
  cable("pa-mixer", "xlr-out-1", "pa-top-1", "xlr-in");
  cable("pa-mixer", "xlr-out-2", "pa-top-2", "xlr-in");
  expect(now()).toMatchObject({ next: 4 });

  // a speaker on before the mixer: when the mixer goes on, it thumps
  const power = (id: string, on: boolean) => { expect(reach(id, "power")).toEqual({ ok: true }); hands.drag(on ? -250 : 250); hands.turning = null; lessons.state(); };
  power("pa-top-1", true);
  expect(now().steps[4].why).toContain("A speaker is on before the mixer");
  power("pa-mixer", true);
  power("pa-top-2", true);
  expect(now().steps[4].why).toContain("thump");
  // put right: the speakers off, then on again after the mixer
  power("pa-top-1", false); power("pa-top-2", false);
  power("pa-top-1", true); power("pa-top-2", true);
  expect(now()).toMatchObject({ done: true });
});

test("know your plugs: an XLR out into an out is refused with why, then mic to mixer, mixer to input A, thru to the next box", async () => {
  const { lessons, jam, hands, g, go, click, now } = await walkIn();
  const b = hands.room.bounds!, mid = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  go([mid.x, mid.z + 1.5]);
  jam.me.yaw = g.yaw; jam.me.pitch = -0.6;
  expect(lessons.start("plugs", jam)).toEqual({ ok: true });
  // the first step reads the XLR's pins off the shared connector list
  expect(now().steps[0].job).toContain("pin 1 ground, pin 2 hot, pin 3 cold");

  const reach = (id: string, part: string) => {
    const p = hands.room.studio.patch.placed.find((x) => x.id === id)!, gd = gearOf(p)!;
    const s = gd.jacks.find((x) => x.name === part)!.face === "back" ? -1 : 1;
    go([p.at[0] + s * Math.sin(p.turn) * 0.7, p.at[2] + s * Math.cos(p.turn) * 0.7]);
    return click(id, part);
  };
  // the mic's XLR out to the mixer's out: two males, and the room says so
  expect(reach("pa-mic", "xlr-out")).toEqual({ ok: true });
  const wrong = reach("pa-mixer", "xlr-out-1");
  expect(wrong.ok).toBe(false);
  expect(wrong.ok ? "" : wrong.why).toContain("an XLR out is male, an XLR in is female");
  expect(reach("pa-mixer", "xlr-in-1")).toEqual({ ok: true });
  expect(now().steps[0]).toMatchObject({ done: true });

  const cable = (a: string, ja: string, b2: string, jb: string) => { expect(reach(a, ja)).toEqual({ ok: true }); expect(reach(b2, jb)).toEqual({ ok: true }); };
  cable("pa-mixer", "xlr-out-1", "pa-top-1", "xlr-in");
  cable("pa-top-1", "xlr-out", "pa-top-2", "xlr-in");
  expect(now()).toMatchObject({ done: true });
});

test("a teacher's class card: a second page in the sesh sees the student's lesson, where they're stuck and why, and when they finish", async () => {
  const { lessons, jam, hands, go, turn, join, sayLesson } = await walkIn();
  const cable = (a: string, ja: string, b: string, jb: string) => { hands.lookAt(jam, a, ja); hands.click(jam); hands.lookAt(jam, b, jb); hands.click(jam); };
  // the teacher comes in on the room's link, as anyone does: nothing to make, nothing to sign in to
  const teacher = (await join()).ws, room = newJam(LIVE_ROOM);
  let read = 0;
  const look = async () => {
    await sayLesson();
    for (; read < teacher.sent.length; read++) { const m = decodeServer(teacher.sent[read]); if (m?.t === "live") hear(room, m.from, m.e); }
    return classOf(room, lessonLine(null, [])).find((p) => p.who !== "me")!;
  };

  expect(lessons.start("voice", jam)).toEqual({ ok: true });
  expect(await look()).toMatchObject({ lesson: "Patch a synth voice", done: 0, of: 4, why: null });

  go([2.5, 0.5], [2.5, -2.0], [1.84, -2.15]);
  cable("wall-vco", "saw", "wall-vcf", "cv");
  const stuck = await look();
  expect(stuck.why).toContain("moves the filter's cutoff");
  // stuck comes first on the card, ahead of the teacher's own row
  expect(classOf(room, lessonLine(null, []))[0]).toMatchObject({ who: stuck.who });

  hands.lookAt(jam, "wall-vcf", "cv"); hands.click(jam); hands.letGo();
  for (const [a, ja, b, jb] of [["wall-vco", "saw", "wall-vcf", "in"], ["wall-vcf", "lp", "wall-vca", "in"], ["wall-vca", "out", "wall-out", "in-l"]]) cable(a, ja, b, jb);
  expect(await look()).toMatchObject({ done: 3, of: 4 });
  turn("wall-vca", "level", 0.6);
  expect(await look()).toMatchObject({ done: 4, of: 4, next: null, why: null, finished: ["Patch a synth voice"] });
  // they leave the lesson: the card still shows what they finished
  lessons.leave();
  expect(await look()).toMatchObject({ lesson: null, finished: ["Patch a synth voice"] });
});

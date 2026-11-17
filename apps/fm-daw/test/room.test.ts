// Q Studio's room as a player walks it: to the rack, the amp down onto the cab, the guitar through a pedal into the
// amp and the amp into the cab by looking and clicking, a knob turned, and a cable pulled out again.
import { expect, test } from "bun:test";
import { aimed, benchIn, gearOf, item, lead, listen, lookAt, newRoom, pickUp, plug, putDown, setKnob, snapshot, use, walkTo, type Room } from "../src/room/room.ts";
import { bench } from "../src/circuit/bench.ts";
import board from "../circuits/bench-drive.circuit.json";

const click = (r: Room, id: string, part?: string) => { lookAt(r, id, part); return use(r); };

test("walk the room, set the amp on the cab, cable guitar, pedal, amp and cab, and hear only that chain", () => {
  const r = newRoom();
  expect(listen(r.studio.patch)).toMatchObject({ playing: false, problems: ["nothing plugged into 2x12 cab"] });

  // The lead amp is on the rack's top shelf: from the door it is out of reach.
  expect(click(r, "lead")).toEqual({ ok: false, why: "nothing in reach" });
  expect(walkTo(r, 0, -1.9)).toBeGreaterThan(0);
  lookAt(r, "lead");
  expect(aimed(r)).toEqual({ t: "item", id: "lead" });
  expect(use(r)).toEqual({ ok: true });

  // Carry it over to the cab and set it down on top.
  walkTo(r, 1.4, -0.05);
  r.you.yaw = 0; r.you.pitch = -0.35; // face the back wall, looking down at the cab
  expect(use(r)).toEqual({ ok: true });
  const lead = item(r, "lead")!, cab = item(r, "cab")!;
  expect(lead.at[1]).toBeCloseTo(0.55, 2);
  expect(Math.hypot(lead.at[0] - cab.at[0], lead.at[2] - cab.at[2])).toBeLessThan(0.35);

  // Guitar out -> Q Fuzz in, fuzz out -> amp in, amp speaker -> cab in.
  walkTo(r, -1.2, 0.9);
  expect(click(r, "guitar", "out")).toEqual({ ok: true });
  walkTo(r, -0.9, -2.1);
  expect(click(r, "fuzz", "out")).toEqual({ ok: false, why: "two outputs: Guitar's out and Q Fuzz's out" });
  expect(click(r, "fuzz", "in")).toEqual({ ok: true });
  expect(click(r, "fuzz", "out")).toEqual({ ok: true });
  walkTo(r, 1.2, 0.5);
  expect(click(r, "lead", "in")).toEqual({ ok: true });
  expect(listen(r.studio.patch)).toMatchObject({ playing: false, problems: ["nothing plugged into 2x12 cab"] });
  // Round the cab to the amp's back: its speaker out into the cab.
  walkTo(r, 2.3, 0.3); walkTo(r, 1.7, -1.3);
  expect(click(r, "lead", "speaker")).toEqual({ ok: true });
  expect(click(r, "cab", "in")).toEqual({ ok: true });

  const heard = listen(r.studio.patch);
  expect(heard).toMatchObject({ playing: true, chain: ["guitar", "fuzz", "lead", "cab"], running: ["fuzz", "lead"], problems: [] });
  expect(heard.settings).toMatchObject({ amp: "lead", pedal: "fuzz", drive: 7, bypass: false });

  // Back at the front, look at the gain knob and turn it down.
  walkTo(r, 2.3, 0.3); walkTo(r, 1.2, 0.2);
  lookAt(r, "lead", "gain");
  expect(aimed(r)).toEqual({ t: "knob", id: "lead", knob: "gain" });
  setKnob(r, "lead", "gain", 0.2);
  expect(listen(r.studio.patch).settings?.knobs.gain).toBeCloseTo(2);

  // Pull the pedal's cable out of the amp: its far end stays in Q Fuzz, the near end is in your hand, and it is silent.
  expect(click(r, "lead", "in")).toEqual({ ok: true });
  expect(snapshot(r).holding).toEqual({ lead: ["fuzz", "out"] });
  expect(listen(r.studio.patch)).toMatchObject({ playing: false, running: [] });
});

test("a board off the bench stands on the floor, its knobs turn, and cabled in it plays its netlist", () => {
  const b = bench(board, { name: "Bench Drive" });
  if (!b.ok) throw new Error(b.why.join("; "));
  const r = newRoom();
  // From the door, looking at the rack: it stands a step in front of you, on the floor, sized from its board.
  const put = benchIn(r, b.pedal);
  expect(put).toEqual({ ok: true, id: "bench-1" });
  const p = item(r, "bench-1")!;
  expect(p.at[1]).toBe(0);
  expect(gearOf(p)).toMatchObject({ name: "Bench Drive", kind: "pedal", size: [0.072, 0.05, 0.057], knobs: [{ name: "drive" }, { name: "level" }] });

  // Its knobs are on its lid within reach: look down at Drive and turn it up.
  lookAt(r, "bench-1", "drive");
  expect(aimed(r)).toEqual({ t: "knob", id: "bench-1", knob: "drive" });
  expect(setKnob(r, "bench-1", "drive", 0.9)).toEqual({ ok: true });

  // Guitar into the bench pedal, the pedal into the lead amp, the amp into the cab.
  for (const [a, z] of [[["guitar", "out"], ["bench-1", "in"]], [["bench-1", "out"], ["lead", "in"]], [["lead", "speaker"], ["cab", "in"]]] as const) {
    expect(lead(r, [...a])).toEqual({ ok: true });
    expect(plug(r, [...z])).toEqual({ ok: true });
  }
  const heard = listen(r.studio.patch);
  expect(heard).toMatchObject({ playing: true, chain: ["guitar", "bench-1", "lead", "cab"], running: ["bench-1", "lead"], problems: [] });
  expect(heard.settings).toMatchObject({ pedal: "bench", drive: 0 });
  // What the worklet runs is the board at the knobs as the room has them: Drive at 9, Level centred.
  expect(heard.settings?.bench).toEqual(b.pedal.net({ DRIVE: 0.9, LEVEL: 0.5 }));

  // Hands full, no second pedal; free again, a second one gets its own id.
  expect(pickUp(r, "bench-1")).toEqual({ ok: true });
  expect(benchIn(r, b.pedal)).toEqual({ ok: false, why: "your hands are full" });
  putDown(r);
  expect(benchIn(r, b.pedal)).toMatchObject({ ok: true, id: "bench-2" });
});

// Qollab Studio's gear room as a player walks it: to the rack, the amp down onto the cab, the guitar through a pedal into the
// amp and the amp into the cab by looking and clicking, a knob turned, and a cable pulled out again; then gear
// cabled into the desk's track inserts (#4902); then two pedals off the pedal wall, in a row and then side by side on Q Split.
import { expect, test } from "bun:test";
import { applySettings } from "../src/amp/live.ts";
import { aimed, benchIn, drop, gearOf, item, lead, listen, lookAt, newRoom, pickUp, plug, putDown, setKnob, snapshot, unplug, use, walkTo, type Room } from "../src/room/room.ts";
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
  // The pedals hang on the pedal wall.
  walkTo(r, -2.4, 0.9); walkTo(r, -2.7, -1.35);
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
  expect(heard.settings).toMatchObject({ amp: "lead", board: [{ pedal: "fuzz", drive: 7 }], bypass: false });

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

test("cable gear into the desk's track inserts: Q Tape on track 1, Q Squeeze into an amp's line out with Q Spring in its loop on track 2", () => {
  const r = newRoom();
  const cable = (a: string, aj: string, b: string, bj: string) => { expect(lead(r, [a, aj])).toEqual({ ok: true }); expect(plug(r, [b, bj])).toEqual({ ok: true }); };
  const play = (h: ReturnType<typeof listen>) => {
    const live = applySettings(h.settings!, null, 48000), n = 48000, x = new Float32Array(n), y = new Float32Array(n);
    for (let i = 0; i < 2400; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 48000);
    live.rig.process(x, y, n);
    const out = Array.from(y, (v) => v / live.scale);
    return { peak: Math.max(...out.map(Math.abs)), tail: Math.max(...out.slice(12000).map(Math.abs)), misses: live.rig.misses };
  };

  // Track 1: send into the tape echo, the tape back into the return. Played straight into the desk: no amp, no cab.
  cable("desk", "send-1", "tape", "in");
  // The insert's problem comes first, then the cab's (nothing in it yet).
  expect(listen(r.studio.patch, 2)).toMatchObject({ playing: false, problems: ["nothing plugged into FM DAW desk's return-1", "nothing plugged into 2x12 cab"] });
  cable("tape", "out", "desk", "return-1");
  const tape = listen(r.studio.patch, 2);
  expect(tape).toMatchObject({ playing: true, chain: ["desk", "tape", "desk"], running: ["tape"], problems: [] });
  expect(tape.settings).toMatchObject({ direct: true, pedal: null, loop: [{ kind: "tape", time: 4, repeats: 4, mix: 4 }] });
  // A short note, then its echoes after it has stopped: finite, under the limiter, and the tape didn't stall.
  const heard = play(tape);
  expect(heard.peak).toBeLessThan(5);
  expect(heard.tail).toBeGreaterThan(1e-3);
  expect(heard.misses).toBe(0);

  // Track 2: the compressor into the lead amp, its line out (the cab and mic, as a load box) into the return.
  cable("desk", "send-2", "comp", "in");
  cable("comp", "out", "lead", "in");
  cable("lead", "speaker", "desk", "return-2");
  expect(listen(r.studio.patch).inserts[1]).toMatchObject({ track: 2, whole: false, problems: ["FM DAW desk's return-2 goes to Q Lead 50's speaker"] });
  unplug(r, ["desk", "return-2"]); drop(r);
  cable("lead", "line", "desk", "return-2");
  // The spring in the amp's loop: send out to the tank, the tank back into the return.
  cable("lead", "send", "spring", "in");
  cable("spring", "out", "lead", "return");
  expect(listen(r.studio.patch).inserts[1]).toMatchObject({ track: 2, whole: true, chain: ["desk", "comp", "lead", "spring", "desk"] });

  // Track 1 plays while it is whole; pull its return and track 2 plays.
  unplug(r, ["desk", "return-1"]); drop(r);
  const amp = listen(r.studio.patch, 2);
  expect(amp).toMatchObject({ playing: true, chain: ["desk", "comp", "lead", "spring", "desk"], running: ["comp", "lead", "spring"] });
  expect(amp.settings).toMatchObject({ amp: "lead", board: [{ pedal: "comp" }], loop: [{ kind: "spring" }] });
  expect(amp.settings?.direct).toBeUndefined();
  expect(play(amp).misses).toBe(0);

  // Pull the cable out of the tank's input: the return still has the tank in it, so the loop is open and it goes quiet.
  unplug(r, ["spring", "in"]); drop(r);
  const open = listen(r.studio.patch);
  expect(open.playing).toBe(false);
  expect(open.inserts[1].problems).toEqual([expect.stringContaining("Q Lead 50's loop is open")]);
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
  // What the worklet runs is the board at the knobs as the room has them: Drive at 9, Level centred.
  expect(heard.settings?.board).toEqual([{ pedal: "bench", drive: 0, bench: b.pedal.net({ DRIVE: 0.9, LEVEL: 0.5 }) }]);

  // Hands full, no second pedal; free again, a second one gets its own id.
  expect(pickUp(r, "bench-1")).toEqual({ ok: true });
  expect(benchIn(r, b.pedal)).toEqual({ ok: false, why: "your hands are full" });
  putDown(r);
  expect(benchIn(r, b.pedal)).toMatchObject({ ok: true, id: "bench-2" });
});

test("two pedals off the pedal wall: in a row, reordered while it plays, then side by side on Q Split, and each sounds different", () => {
  const r = newRoom();
  const cable = (a: string, aj: string, b: string, bj: string) => { expect(lead(r, [a, aj])).toEqual({ ok: true }); expect(plug(r, [b, bj])).toEqual({ ok: true }); };
  const pull = (id: string, jack: string) => { unplug(r, [id, jack]); drop(r); };
  // A plucked note into the rig; `live` carries on from the last settings, as the audio thread does.
  const n = 9600, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.exp(-i / 4000) * Math.sin((2 * Math.PI * 110 * i) / 48000);
  let live: ReturnType<typeof applySettings> | null = null;
  const play = () => {
    const h = listen(r.studio.patch, 2);
    expect(h.problems).toEqual([]);
    live = applySettings(h.settings!, live, 48000);
    const y = new Float32Array(n);
    live.rig.process(x, y, n);
    const out = Array.from(y, (v) => v / live!.scale);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(5);
    expect(live.rig.misses).toBe(0);
    return { heard: h, out };
  };
  const apart = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

  // Take Q Drive, Q Fuzz and Q Split down off the wall and set each on the floor, a step apart.
  const takeDown = (id: string, yaw: number) => {
    expect(item(r, id)!.at[1]).toBe(1);
    expect(pickUp(r, id)).toEqual({ ok: true });
    r.you.yaw = yaw; r.you.pitch = -0.8;
    expect(putDown(r)).toEqual({ ok: true });
    expect(item(r, id)!.at[1]).toBe(0);
  };
  walkTo(r, -2.4, 0.9); walkTo(r, -2.7, -1.0);
  takeDown("drive", 0);
  takeDown("fuzz", -1.2);

  // In a row: guitar, Q Drive, Q Fuzz, the lead amp, the cab.
  cable("guitar", "out", "drive", "in");
  cable("drive", "out", "fuzz", "in");
  cable("fuzz", "out", "lead", "in");
  cable("lead", "speaker", "cab", "in");
  const series = play();
  expect(series.heard).toMatchObject({ chain: ["guitar", "drive", "fuzz", "lead", "cab"], running: ["drive", "fuzz", "lead"] });
  expect(series.heard.settings?.board).toEqual([{ pedal: "drive", drive: 3 }, { pedal: "fuzz", drive: 7 }]);

  // Swap them while it plays: Q Fuzz first, then Q Drive. Same rig, its two pedals swapped in place.
  for (const [id, jack] of [["guitar", "out"], ["drive", "out"], ["fuzz", "out"]] as const) pull(id, jack);
  cable("guitar", "out", "fuzz", "in");
  cable("fuzz", "out", "drive", "in");
  cable("drive", "out", "lead", "in");
  const rig = live!.rig, swapped = play();
  expect(live!.rig).toBe(rig);
  expect(swapped.heard.chain).toEqual(["guitar", "fuzz", "drive", "lead", "cab"]);

  // Side by side: the guitar into Q Split, Q Drive on side A, Q Fuzz on side B, the split into the amp.
  for (const [id, jack] of [["guitar", "out"], ["fuzz", "out"], ["drive", "out"]] as const) pull(id, jack);
  takeDown("split", -2.4);
  cable("guitar", "out", "split", "in");
  cable("split", "send-a", "drive", "in");
  cable("drive", "out", "split", "return-a");
  cable("split", "send-b", "fuzz", "in");
  cable("split", "out", "lead", "in");
  expect(listen(r.studio.patch).problems).toEqual(["nothing plugged into Q Split's return-b"]);
  cable("fuzz", "out", "split", "return-b");
  const parallel = play();
  expect(parallel.heard).toMatchObject({ chain: ["guitar", "split", "drive", "fuzz", "lead", "cab"], running: ["split", "drive", "fuzz", "lead"] });
  expect(parallel.heard.settings?.board).toEqual([{ split: [[{ pedal: "drive", drive: 3 }], [{ pedal: "fuzz", drive: 7 }]], mix: [0.5, 0.5] }]);

  // Three different sounds out of the same two pedals.
  expect(apart(series.out, parallel.out)).toBeGreaterThan(0.1);
  expect(apart(swapped.out, parallel.out)).toBeGreaterThan(0.1);
  expect(apart(series.out, swapped.out)).toBeGreaterThan(0.1);

  // Blend all the way to side A: just Q Drive is heard. A machine on a side is a problem, and silent.
  setKnob(r, "split", "blend", 0);
  expect(listen(r.studio.patch).settings?.board).toMatchObject([{ mix: [1, 0] }]);
  pull("split", "send-b");
  cable("split", "send-b", "tape", "in");
  pull("fuzz", "out");
  cable("tape", "out", "split", "return-b");
  expect(listen(r.studio.patch)).toMatchObject({ playing: false, problems: ["Q Tape is on Q Split's side B: a split's sides take pedals"] });
});

// Q Studio's room as a player walks it: to the rack, the amp down onto the cab, the guitar through a pedal into the
// amp and the amp into the cab by looking and clicking, a knob turned, and a cable pulled out again; then gear
// cabled into the desk's track inserts (#4902).
import { expect, test } from "bun:test";
import { applySettings } from "../src/amp/live.ts";
import { aimed, drop, item, lead, listen, lookAt, newRoom, plug, setKnob, snapshot, unplug, use, walkTo, type Room } from "../src/room/room.ts";

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
  expect(amp.settings).toMatchObject({ amp: "lead", pedal: "comp", loop: [{ kind: "spring" }] });
  expect(amp.settings?.direct).toBeUndefined();
  expect(play(amp).misses).toBe(0);

  // Pull the cable out of the tank's input: the return still has the tank in it, so the loop is open and it goes quiet.
  unplug(r, ["spring", "in"]); drop(r);
  const open = listen(r.studio.patch);
  expect(open.playing).toBe(false);
  expect(open.inserts[1].problems).toEqual([expect.stringContaining("Q Lead 50's loop is open")]);
});

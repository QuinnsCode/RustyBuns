// Q Studio's room as a player walks it: to the rack, the amp down onto the cab, the guitar through a pedal into the
// amp and the amp into the cab by looking and clicking, a knob turned, and a cable pulled out again.
import { expect, test } from "bun:test";
import { aimed, item, listen, lookAt, newRoom, setKnob, snapshot, use, walkTo, type Room } from "../src/room/room.ts";

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

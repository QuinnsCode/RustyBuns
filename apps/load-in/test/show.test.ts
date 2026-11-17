// The show from the desk, as a front-of-house tech plays it: bring the vocal up in the house, answer "more me" with the
// send, hear it ring and notch it out, walk the spare guitar up for a broken string, swap the bass cable, push the
// solo, and the crowd ends the set happy. Then the same set played by nobody: the crowd sours.
import { expect, test } from "bun:test";
import { BAND, SET_SECONDS, SHOW, atDesk, fixOnStage, mix, newDesk, newShow, notch, nudge, ring, showState, startShow, stepShow } from "../src/venues/show.ts";
import { newWorld, walkTo } from "../src/sim.ts";
import { aim } from "../src/venues/dive-bar.ts";
import { setDial } from "../src/assists.ts";

const run = (w: ReturnType<typeof newWorld>, d: ReturnType<typeof newDesk>, s: ReturnType<typeof newShow>, until: number) => {
  while (s.on && s.t < until) stepShow(w, d, s, 0.1);
};

test("a set worked from the desk: more me rings and is notched, the string and the cable fixed on stage, the solo pushed", () => {
  setDial("crew");
  try {
    const w = newWorld(SHOW), d = newDesk(), s = newShow();
    expect(atDesk(w)).toBe(false);
    walkTo(w, 0, 10.9);
    expect(atDesk(w)).toBe(true);
    // As line check left it, the vocal sits under the band; bring it up to where the song wants it.
    expect(mix(d, s).vocal.ok).toBe(false);
    nudge(d, "vocal", { fader: 4 });
    expect(Object.values(mix(d, s)).every((m) => m.ok)).toBe(true);
    expect(ring(w, d).ringing).toEqual([]);

    expect(startShow(s)).toEqual({ ok: true });
    run(w, d, s, 21);
    expect(showState(w, d, s).open).toEqual(["more-me"]);
    // More me: four more dB in the wedge rings at the mic's presence peak, the crowd winces, and a notch there stops it.
    nudge(d, "vocal", { send: 4 });
    expect(ring(w, d).ringing).toEqual([5000]);
    const before = s.crowd;
    run(w, d, s, 23);
    expect(s.crowd).toBeLessThan(before);
    expect(s.fixed).toEqual(["more-me"]);
    expect(notch(d, "vocal", 5000)).toEqual({ ok: true });
    expect(ring(w, d).ringing).toEqual([]);

    // The broken string: the guitar drops out of the mix until the spare goes up to the guitarist.
    run(w, d, s, 96);
    expect(mix(d, s).guitar.dead).toBe(true);
    expect(fixOnStage(w, s, "broken-string")).toEqual({ ok: false, why: "the guitarist is out of reach" });
    walkTo(w, -1.8, 4.5);
    walkTo(w, BAND.guitarist.x + 0.6, 2.2);
    expect(fixOnStage(w, s, "broken-string")).toEqual({ ok: true });
    walkTo(w, -0.9, 10.9);
    walkTo(w, 0, 10.9);

    // The solo in the second song: push the guitar for it, and back down after.
    run(w, d, s, 70 + 41);
    expect(showState(w, d, s).solo).toBe(true);
    expect(mix(d, s).guitar.ok).toBe(false);
    nudge(d, "guitar", { fader: 5 });
    run(w, d, s, 70 + 59);
    nudge(d, "guitar", { fader: -5 });

    // The dying bass cable: swapped at the bass rig.
    run(w, d, s, 161);
    expect(mix(d, s).bass.dead).toBe(true);
    walkTo(w, 1.8, 4.5);
    walkTo(w, BAND.bassist.x - 0.6, 2.2);
    expect(fixOnStage(w, s, "dying-cable")).toEqual({ ok: true });

    run(w, d, s, SET_SECONDS + 1);
    expect(s.done).toBe(true);
    expect(s.fixed).toEqual(["more-me", "broken-string", "dying-cable"]);
    expect(s.missed).toEqual([]);
    expect(s.crowd).toBeGreaterThan(90);
  } finally { setDial("sim"); }
});

test("turning the wedge off the mic stops the ring too, and a set nobody works sours the crowd", () => {
  const w = newWorld(SHOW), d = newDesk();
  nudge(d, "vocal", { send: 4 });
  expect(ring(w, d).ringing).toEqual([5000]);
  walkTo(w, 1.2, 8);
  walkTo(w, 0, 4);
  expect(aim(w, "wedge-vox", { turn: 0.6 })).toEqual({ ok: true });
  expect(ring(w, d).ringing).toEqual([]);

  const idle = newShow(), d2 = newDesk(), w2 = newWorld(SHOW);
  startShow(idle);
  run(w2, d2, idle, SET_SECONDS + 1);
  expect(idle.missed).toEqual(["more-me", "broken-string", "dying-cable"]);
  expect(idle.crowd).toBeLessThan(30);
});

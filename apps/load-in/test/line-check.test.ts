// The band's inputs as a roadie does them: carry the stage box out to the stage (the snake pays out behind it), run an
// XLR from each mic and the DI into its channel and the bass into the DI, then line check from the desk. A clean night
// comes up clean; on a night with a dead cable and a humming DI, line check finds the silent channel, the trace says
// it is patched right (so it's the cable), a spare goes in, the DI's ground is lifted, and it comes up clean.
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown, type World } from "../src/sim.ts";
import { type Cables, dropEnd, grabEnd, jacks, newCables, plug, takeCable, unplug, walkWith } from "../src/cables/cables.ts";
import { setDial } from "../src/assists.ts";
import { LINE_CHECK, type Show, lift, newShow, runCheck, snakeRun, trace } from "../src/band/line-check.ts";

type Jack = readonly [string, string];
const CASE = [-1.4, 3.4] as const;
/** The open lane along the front of the stage, clear of the mic stands. */
const LANE = 3.8;
// Crew: a cable dropped with neither end in a jack lies where it fell (Cozy would coil the dead one back in the case).
setDial("crew");

function crew(w: World, c: Cables) {
  const goTo = ([owner, jack]: Jack) => {
    const j = jacks(w).find((x) => x.owner === owner && x.jack === jack)!;
    walkWith(w, c, j.at.x, LANE);
    walkWith(w, c, j.at.x, j.at.z);
  };
  const toCase = () => { walkWith(w, c, w.you.x, LANE); walkWith(w, c, ...CASE); };
  /** A cable out of the case: one end into `from`, back for the other, into `to`. */
  const run = (kind: "xlr" | "instrument", from: Jack, to: Jack) => {
    toCase();
    expect(takeCable(w, c, kind)).toEqual({ ok: true });
    const key = c.runs.find((r) => "hand" in r.a)!.key;
    goTo(from);
    expect(plug(w, c, ...from)).toEqual({ ok: true });
    toCase();
    expect(grabEnd(w, c, key, "b")).toEqual({ ok: true });
    goTo(to);
    expect(plug(w, c, ...to)).toEqual({ ok: true });
    return key;
  };
  /** Pull a cable out at both ends and leave it lying. */
  const pull = (a: Jack, b: Jack) => {
    for (const end of [a, b]) {
      goTo(end);
      expect(unplug(w, c, ...end)).toEqual({ ok: true });
      dropEnd(c);
    }
  };
  const toDesk = () => { walkWith(w, c, w.you.x, LANE); walkWith(w, c, 1.3, 10.8); };
  return { goTo, run, pull, toDesk };
}

/** The night from the desk to cabled: the snake run, five inputs in, the bass into its DI. */
function cable(show: Show) {
  const w = newWorld(LINE_CHECK), c = newCables(w), k = crew(w, c);
  // The stage box starts at the desk; carried out, its multicore pays out behind it to the front of the stage.
  expect(pickUp(w, "stage-box")).toEqual({ ok: true });
  walkWith(w, c, -3.2, 3.6);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  expect(snakeRun(w)).toBe(true);

  const box = (n: number): Jack => ["stage-box", `xlr-in-${n}`];
  const keys = {
    kick: k.run("xlr", ["kick-mic", "xlr-out"], box(1)),
    snare: k.run("xlr", ["snare-mic", "xlr-out"], box(2)),
    bass: k.run("xlr", ["bass-di", "xlr-out"], box(3)),
    guitar: k.run("xlr", ["gtr-mic", "xlr-out"], box(4)),
    vocal: k.run("xlr", ["vox-mic", "xlr-out"], box(5)),
    lead: k.run("instrument", ["bass", "line-out"], ["bass-di", "inst-in"]),
  };
  // Line check is heard at the desk, not from the stage.
  expect(runCheck(w, c, show)).toEqual({ ok: false, why: "line check is heard at the desk" });
  k.toDesk();
  return { w, c, k, keys, check: () => runCheck(w, c, show) };
}

const results = (r: ReturnType<typeof runCheck>) => (r.ok ? Object.fromEntries(r.rows.map((x) => [x.name, x.result])) : r.why);

test("a clean night: snake out, every input to its channel, line check comes up clean", () => {
  const { check } = cable(newShow("clean"));
  expect(results(check())).toEqual({ Kick: "ok", Snare: "ok", "Bass DI": "ok", "Guitar amp": "ok", Vocal: "ok" });
  expect(check()).toMatchObject({ ok: true, clean: true });
});

test("a dead cable and a humming DI: line check finds both, the trace says swap it, the lift kills the hum", () => {
  const show = newShow("clean");
  show.dead.add("xlr-2");
  show.hum.add("bass-di");
  const { w, c, k, keys, check } = cable(show);
  expect(keys.snare).toBe("xlr-2");
  expect(results(check())).toEqual({ Kick: "ok", Snare: "silent", "Bass DI": "hum", "Guitar amp": "ok", Vocal: "ok" });

  // Trace the snare: its cable goes to channel 2 as the list says, so the patch is right and the cable is bad.
  k.goTo(["snare-mic", "xlr-out"]);
  expect(trace(w, c, "snare-mic")).toEqual({ ok: true, path: ["snare-mic xlr-out", "xlr-2, 10 m", "stage-box xlr-in-2", "the snake to desk ch 2"] });

  // Swap it for a spare, and lift the DI's ground on the way past.
  k.pull(["snare-mic", "xlr-out"], ["stage-box", "xlr-in-2"]);
  expect(k.run("xlr", ["snare-mic", "xlr-out"], ["stage-box", "xlr-in-2"])).toBe("xlr-6");
  k.goTo(["bass-di", "xlr-out"]);
  expect(lift(w, show, "bass-di")).toEqual({ ok: true });

  k.toDesk();
  expect(check()).toMatchObject({ ok: true, clean: true });
});

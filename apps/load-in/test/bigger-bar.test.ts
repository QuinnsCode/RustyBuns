// The bigger bar as a crew does it: cable the rig with the amp rack on the bar's circuit, hear it trip at show level and
// take the cooler with it, walk to the panel, reset it, move the rack's plug to a stage circuit, and every speaker is fed.
import { expect, test } from "bun:test";
import type { Cable, CableKind } from "@rustybuns/gear";
import { BIGGER_BAR, judge, newPanel, resetBreaker } from "../src/venues/bigger-bar.ts";
import { newWorld, walkTo } from "../src/sim.ts";
import { setDial } from "../src/assists.ts";
import { hasSwitch } from "../src/audio/hear.ts";

const c = (kind: CableKind, from: string, to: string, lengthM = 5): Cable => {
  const end = (s: string) => {
    const [id = "", jack = ""] = s.split(" ");
    return [id, jack] as const;
  };
  return { kind, lengthM, from: end(from), to: end(to) };
};

const rig = (rackOn: string): Cable[] => [
  c("power", "stage-1 power-out-1", "distro power-in"),
  c("power", "distro power-out-1", "mixer power-in"),
  c("power", "distro power-out-2", "wedge-1 power-in"),
  c("power", "distro power-out-3", "wedge-2 power-in"),
  c("power", rackOn, "rack power-in", 10),
  c("xlr", "mixer xlr-out-1", "rack xlr-in-1", 15),
  c("xlr", "mixer xlr-out-2", "rack xlr-in-2", 15),
  c("xlr", "mixer xlr-out-3", "rack xlr-in-3", 15),
  c("xlr", "mixer xlr-out-4", "wedge-1 xlr-in", 15),
  c("xlr", "wedge-1 xlr-out", "wedge-2 xlr-in", 3),
  c("speaker", "rack speaker-out-1", "top-l speaker-in", 20),
  c("speaker", "rack speaker-out-2", "top-r speaker-in", 5),
  c("speaker", "rack speaker-out-3", "sub-l speaker-in", 3),
  c("speaker", "sub-l speaker-out", "sub-r speaker-in", 1),
];

test("cable the rig, trip the bar's breaker, reset it at the panel, move the plug: every speaker fed", () => {
  const w = newWorld(BIGGER_BAR);
  const placed = w.items.map((i) => ({ id: i.key, gear: i.gear }));
  const panel = newPanel();
  const speakers = ["top-l", "top-r", "sub-l", "sub-r", "wedge-1", "wedge-2"];
  const fed = (r: ReturnType<typeof judge>) => speakers.filter((s) => r.fed.get(s));

  // The rack on the cooler's 15 A circuit: 1500 W plus the cooler's 450 trips it, and the cooler goes off with the mains.
  const tripped = judge(w, placed, rig("bar-1 power-out-2"), panel);
  expect(tripped.justTripped).toEqual(["3"]);
  expect(tripped.circuits.find((x) => x.circuit === "3")).toEqual({ circuit: "3", amps: 15, tripped: true, over: false });
  expect(fed(tripped)).toEqual(["wedge-1", "wedge-2"]);
  expect(tripped.problems.map((p) => `${p.kind} ${p.items[0]}`)).toEqual(["no-power cooler", "no-power rack"]);

  // The panel is across the room; reset it there, and with the rack still on that circuit it trips again.
  expect(resetBreaker(w, panel)).toEqual({ ok: false, why: "the breaker panel is out of reach" });
  walkTo(w, 3.3, 14.5);
  walkTo(w, 3.3, 4);
  expect(resetBreaker(w, panel)).toEqual({ ok: true });
  expect(judge(w, placed, rig("bar-1 power-out-2"), panel).justTripped).toEqual(["3"]);

  // Move the rack to a 20 A stage circuit and reset: nothing trips, the cooler runs, every speaker is fed.
  expect(resetBreaker(w, panel, "3")).toEqual({ ok: true });
  const fixed = judge(w, placed, rig("stage-2 power-out-1"), panel);
  expect(fixed.justTripped).toEqual([]);
  expect(fixed.problems).toEqual([]);
  expect(fed(fixed)).toEqual(speakers);
  expect(fixed.circuits.every((x) => !x.tripped)).toBe(true);

  // The 20 m run to the left top loses over half a dB in 16 AWG; the short ones barely anything.
  expect(fixed.lossDb["top-l"]).toBeGreaterThan(0.5);
  expect(fixed.lossDb["sub-r"]).toBeLessThan(0.05);
});

test("both subs and both tops on one rack channel is 2 ohms in parallel at best: four is fine, five shuts it down", () => {
  const w = newWorld(BIGGER_BAR);
  const placed = [...w.items.map((i) => ({ id: i.key, gear: i.gear })), { id: "top-x", gear: "top-15-passive" }];
  const chain = ["top-l", "top-r", "sub-l", "sub-r", "top-x"];
  const cables = (n: number) => [
    c("power", "stage-2 power-out-1", "rack power-in"),
    c("power", "stage-1 power-out-1", "mixer power-in"),
    c("xlr", "mixer xlr-out-1", "rack xlr-in-1"),
    c("speaker", "rack speaker-out-1", `${chain[0]} speaker-in`),
    ...chain.slice(1, n).map((k, i) => c("speaker", `${chain[i]} speaker-out`, `${k} speaker-in`, 1)),
  ];
  const low = (n: number) => judge(w, placed, cables(n), newPanel()).problems.filter((p) => p.kind === "low-load").map((p) => p.items.length);
  expect(low(4)).toEqual([]);
  expect(low(5)).toEqual([6]);
});

test("on Cozy the same overload warns instead of tripping: circuit 3 is marked over and everything plays", () => {
  setDial("cozy");
  try {
    const w = newWorld(BIGGER_BAR), panel = newPanel();
    const r = judge(w, w.items.map((i) => ({ id: i.key, gear: i.gear })), rig("bar-1 power-out-2"), panel);
    expect(r.justTripped).toEqual([]);
    expect(r.circuits.find((x) => x.circuit === "3")).toEqual({ circuit: "3", amps: 15, tripped: false, over: true });
    expect(["top-l", "top-r", "sub-l", "sub-r"].every((s) => r.fed.get(s))).toBe(true);
  } finally { setDial("sim"); }
});

test("where the cables decide what plays, only gear that draws power offers a switch", () => {
  const switches = Object.fromEntries(BIGGER_BAR.items.map((i) => [i.gear, hasSwitch(i.gear, true)]));
  expect(switches).toMatchObject({ "top-15-passive": false, "sub-18": false, "wedge-12": true, "amp-rack-4u": true, "mixer-small": true });
  expect(hasSwitch("top-15-passive")).toBe(true);
});

// Patches a roadie actually lays out, each with what it should feed and what it should complain about.
import { expect, test } from "bun:test";
import { CIRCUIT_15A, CIRCUIT_20A, compile, thumps, type Cable, type CableKind, type Outlet, type Placed } from "../src/index.ts";

const c = (kind: CableKind, from: string, to: string): Cable => {
  const end = (s: string) => {
    const [id = "", jack = ""] = s.split(" ");
    return [id, jack] as const;
  };
  return { kind, lengthM: 5, from: end(from), to: end(to) };
};
const wall = (amps: 15 | 20, circuit = "a"): Outlet => ({ id: "wall", circuit, breaker: amps === 15 ? CIRCUIT_15A : CIRCUIT_20A });

const garage: Placed[] = [
  { id: "head", gear: "amp-head" },
  { id: "cab", gear: "cab-4x12" },
  { id: "gtr", gear: "guitar" },
];
const garageCables = [c("power", "wall power-out-1", "head power-in"), c("instrument", "gtr line-out", "head inst-in"), c("speaker", "head speaker-out-1", "cab speaker-in")];

const bar: Placed[] = [
  { id: "desk", gear: "mixer-small" },
  { id: "topL", gear: "top-12-powered" },
  { id: "topR", gear: "top-12-powered" },
  { id: "sub", gear: "sub-18" },
  { id: "distro", gear: "distro-box" },
];
const barCables = [
  c("power", "wall power-out-1", "distro power-in"),
  ...["desk", "topL", "topR", "sub"].map((id, i) => c("power", `distro power-out-${i + 1}`, `${id} power-in`)),
  c("xlr", "desk xlr-out-1", "topL xlr-in"),
  c("xlr", "topR xlr-in", "desk xlr-out-2"), // laid from the far end: still runs desk -> top
  c("xlr", "topL xlr-out", "sub xlr-in"), // the sub is powered (#6011): mains and the left top's thru
];

const chain = (n: number): Placed[] => [...garage.slice(0, 1), garage[2]!, ...Array.from({ length: n }, (_, i) => ({ id: `box${i + 1}`, gear: "top-15-passive" }))];
const chainCables = (n: number) => [
  garageCables[0]!,
  garageCables[1]!,
  c("speaker", "head speaker-out-1", "box1 speaker-in"),
  ...Array.from({ length: n - 1 }, (_, i) => c("speaker", `box${i + 1} speaker-out`, `box${i + 2} speaker-in`)),
];

// The stage: the guitar through a DI, its thru to the amp, its XLR to the desk, the desk to a top. Amp and desk on the wall.
const stage = (lift: boolean): Placed[] => [...garage, { id: "di", gear: "di-box", lift }, bar[0]!, bar[1]!];
const stageCables = [
  c("power", "wall power-out-1", "head power-in"),
  c("power", "wall power-out-2", "desk power-in"),
  c("power", "wall power-out-3", "topL power-in"),
  c("instrument", "gtr line-out", "di inst-in"),
  c("instrument", "di line-out", "head inst-in"),
  c("speaker", "head speaker-out-1", "cab speaker-in"),
  c("xlr", "di xlr-out", "desk xlr-in-1"),
  c("xlr", "desk xlr-out-1", "topL xlr-in"),
];
const stageWall: Outlet = { ...wall(20), jacks: 3 };

// The first gig: a condenser into the desk, the desk's aux to the amp rack, the rack to a passive wedge.
const gig = (phantom: boolean): Placed[] => [{ id: "mic", gear: "mic-condenser" }, { id: "desk", gear: "mixer-small", phantom }, { id: "rack", gear: "amp-rack-4u" }, { id: "wedge", gear: "wedge-12-passive" }];
const gigCables = [
  c("power", "wall power-out-1", "rack power-in"),
  c("power", "wall power-out-2", "desk power-in"),
  c("xlr", "mic xlr-out", "desk xlr-in-1"),
  c("xlr", "desk xlr-out-1", "rack xlr-in-1"),
  c("speaker", "rack speaker-out-1", "wedge speaker-in"),
];

// The triple 21 (three 8 ohm 21"s on one 8-pin input, 8/3 ohms) off the rack: one box a channel, or linked on to a second.
const subs = (n: number): Placed[] => [...gig(true).slice(0, 3), ...Array.from({ length: n }, (_, i) => ({ id: `sub${i + 1}`, gear: "triple-21-sub" }))];
const subCables = (n: number) => [
  ...gigCables.slice(0, 4),
  c("speaker", "rack speaker-out-1", "sub1 speaker-in"),
  ...Array.from({ length: n - 1 }, (_, i) => c("speaker", `sub${i + 1} speaker-out`, `sub${i + 2} speaker-in`)),
];

const cases: { name: string; placed: Placed[]; cables: Cable[]; outlets: Outlet[]; fed: Record<string, boolean>; problems: string[] }[] = [
  { name: "the garage: guitar, head, cab", placed: garage, cables: garageCables, outlets: [wall(15)], fed: { cab: true }, problems: [] },
  { name: "the garage with the head unplugged", placed: garage, cables: garageCables.slice(1), outlets: [wall(15)], fed: { cab: false }, problems: ["no-power head"] },
  { name: "the dive bar: two tops off the desk, the powered sub off the left top's thru, on a 15 A circuit", placed: bar, cables: barCables, outlets: [wall(15)], fed: { topL: true, topR: true, sub: true }, problems: [] },
  { name: "the dive bar's sub with no mains is silent", placed: bar, cables: barCables.filter((x) => x.to[0] !== "sub" || x.kind !== "power"), outlets: [wall(15)], fed: { topL: true, topR: true, sub: false }, problems: ["no-power sub"] },
  { name: "two 8 ohm boxes on a 4 ohm minimum head are fine", placed: chain(2), cables: chainCables(2), outlets: [wall(15)], fed: { box1: true, box2: true }, problems: [] },
  { name: "three are 2.67 ohms and not", placed: chain(3), cables: chainCables(3), outlets: [wall(15)], fed: { box1: false, box2: false, box3: false }, problems: ["low-load head,box1,box2,box3"] },
  { name: "a triple 21 alone on a 2 ohm rack channel is fed", placed: subs(1), cables: subCables(1), outlets: [wall(20)], fed: { sub1: true }, problems: [] },
  { name: "two triple 21s linked on one channel are 1.33 ohms and not", placed: subs(2), cables: subCables(2), outlets: [wall(20)], fed: { sub1: false, sub2: false }, problems: ["low-load rack,sub1,sub2"] },
  {
    name: "a speaker cable in a power jack",
    placed: garage,
    cables: [c("speaker", "wall power-out-1", "head power-in"), ...garageCables.slice(1)],
    outlets: [wall(15)],
    fed: { cab: false },
    problems: ["wrong-cable wall", "wrong-cable head", "no-power head"],
  },
  {
    name: "two cables in one jack, laid either way",
    placed: garage,
    cables: [...garageCables, c("speaker", "head speaker-out-1", "cab speaker-in"), c("instrument", "head inst-in", "gtr line-out")],
    outlets: [wall(15)],
    fed: { cab: true },
    problems: ["jack-twice head", "jack-twice cab", "jack-twice head", "jack-twice gtr"],
  },
  {
    name: "a top's thru patched back into the desk is a feedback loop",
    placed: bar.slice(0, 2),
    cables: [c("power", "wall power-out-1", "desk power-in"), c("power", "wall power-out-2", "topL power-in"), c("xlr", "desk xlr-out-1", "topL xlr-in"), c("xlr", "topL xlr-out", "desk xlr-in-1")],
    outlets: [wall(15)],
    fed: { topL: true },
    problems: ["loop desk,topL"],
  },
  { name: "the stage: a DI's thru to the amp and XLR to the desk hums", placed: stage(false), cables: stageCables, outlets: [stageWall], fed: { cab: true, topL: true }, problems: ["hum di,head,desk"] },
  { name: "the stage with the DI's ground lifted is quiet", placed: stage(true), cables: stageCables, outlets: [stageWall], fed: { cab: true, topL: true }, problems: [] },
  { name: "the first gig: a condenser on 48 V through the desk and rack to a wedge", placed: gig(true), cables: gigCables, outlets: [wall(20)], fed: { wedge: true }, problems: [] },
  { name: "the first gig with 48 V off: the condenser is silent, and so is the desk it is patched into", placed: gig(false), cables: gigCables, outlets: [wall(20)], fed: { wedge: false }, problems: ["no-phantom mic,desk"] },
  {
    name: "an outlet that isn't there, and a jack the box doesn't have",
    placed: garage,
    cables: [c("power", "street power-out-1", "head power-in"), c("speaker", "head speaker-out-9", "cab speaker-in"), garageCables[1]!],
    outlets: [wall(15)],
    fed: { cab: false },
    problems: ["no-jack street", "no-jack head", "no-power head"],
  },
];

test.each(cases)("$name", ({ placed, cables, outlets, fed, problems }) => {
  const got = compile(placed, cables, { outlets });
  expect(Object.fromEntries(got.fed)).toEqual(fed);
  expect(got.problems.map((p) => `${p.kind} ${p.items.join(",")}`)).toEqual(problems);
  for (const p of got.problems) expect(p.message).toContain(p.items[0]!);
});

test("a generator feeds the outdoor rig through a distro", () => {
  const placed: Placed[] = [{ id: "gen", gear: "generator-7kva" }, { id: "distro", gear: "distro-box" }, ...bar.slice(0, 3)];
  const cables = [
    c("power", "gen power-out-1", "distro power-in"),
    ...["desk", "topL", "topR"].map((id, i) => c("power", `distro power-out-${i + 1}`, `${id} power-in`)),
    c("xlr", "desk xlr-out-1", "topL xlr-in"),
    c("xlr", "desk xlr-out-2", "topR xlr-in"),
  ];
  const got = compile(placed, cables);
  expect(Object.fromEntries(got.fed)).toEqual({ topL: true, topR: true });
  expect(got.problems).toEqual([]);
});

test("amps on last and off first: anything switched upstream of an amp that is on thumps", () => {
  const right = [{ id: "desk", on: true }, { id: "rack", on: true }, { id: "rack", on: false }, { id: "desk", on: false }];
  expect(thumps(gig(true), gigCables, right)).toEqual([]);
  const wrong = [{ id: "rack", on: true }, { id: "desk", on: true }, { id: "desk", on: false }, { id: "rack", on: false }];
  expect(thumps(gig(true), gigCables, wrong).map((p) => `${p.kind} ${p.items.join(",")}`)).toEqual(["thump desk,rack", "thump desk,rack"]);
});

test("the spider box: a 12U rack on one 20 A duplex trips that leg; on the L6-30 it holds, and the desk rides a duplex", () => {
  const placed: Placed[] = [{ id: "gen", gear: "generator-100kva" }, { id: "spider", gear: "distro-box" }, { id: "rack", gear: "amp-rack-12u" }, { id: "desk", gear: "mixer-small" }];
  const run = (rackOn: string) => compile(placed, [
    c("power", "gen power-out-1", "spider power-in"),
    c("power", `spider ${rackOn}`, "rack power-in"),
    c("power", "spider power-out-2", "desk power-in"),
  ]).problems.filter((p) => p.kind === "breaker");
  const tripped = run("power-out-1");
  expect(tripped.map((p) => [p.circuit, p.items])).toEqual([["spider power-out-1", ["spider", "rack"]]]);
  expect(tripped[0]!.message).toContain("20 A 120 V leg");
  expect(run("power-out-7")).toEqual([]);
});

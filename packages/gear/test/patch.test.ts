// Patches a roadie actually lays out, each with what it should feed and what it should complain about.
import { expect, test } from "bun:test";
import { CIRCUIT_15A, CIRCUIT_20A, compile, type Cable, type CableKind, type Outlet, type Placed } from "../src/index.ts";

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
  { id: "rack", gear: "amp-rack-4u" },
  { id: "sub", gear: "sub-18" },
  { id: "distro", gear: "distro-box" },
];
const barCables = [
  c("power", "wall power-out-1", "distro power-in"),
  ...["desk", "topL", "topR", "rack"].map((id, i) => c("power", `distro power-out-${i + 1}`, `${id} power-in`)),
  c("xlr", "desk xlr-out-1", "topL xlr-in"),
  c("xlr", "topR xlr-in", "desk xlr-out-2"), // laid from the far end: still runs desk -> top
  c("xlr", "topL xlr-out", "rack xlr-in-1"),
  c("speaker", "rack speaker-out-1", "sub speaker-in"),
];

const chain = (n: number): Placed[] => [...garage.slice(0, 1), garage[2]!, ...Array.from({ length: n }, (_, i) => ({ id: `box${i + 1}`, gear: "top-15-passive" }))];
const chainCables = (n: number) => [
  garageCables[0]!,
  garageCables[1]!,
  c("speaker", "head speaker-out-1", "box1 speaker-in"),
  ...Array.from({ length: n - 1 }, (_, i) => c("speaker", `box${i + 1} speaker-out`, `box${i + 2} speaker-in`)),
];

const cases: { name: string; placed: Placed[]; cables: Cable[]; outlets: Outlet[]; fed: Record<string, boolean>; problems: string[] }[] = [
  { name: "the garage: guitar, head, cab", placed: garage, cables: garageCables, outlets: [wall(15)], fed: { cab: true }, problems: [] },
  { name: "the garage with the head unplugged", placed: garage, cables: garageCables.slice(1), outlets: [wall(15)], fed: { cab: false }, problems: ["no-power head"] },
  { name: "the dive bar: two tops off the desk, the sub off the rack, all on a 20 A circuit", placed: bar, cables: barCables, outlets: [wall(20)], fed: { topL: true, topR: true, sub: true }, problems: [] },
  { name: "the dive bar on a 15 A circuit trips", placed: bar, cables: barCables, outlets: [wall(15)], fed: { topL: true, topR: true, sub: true }, problems: ["breaker desk,topL,topR,rack"] },
  { name: "two 8 ohm boxes on a 4 ohm minimum head are fine", placed: chain(2), cables: chainCables(2), outlets: [wall(15)], fed: { box1: true, box2: true }, problems: [] },
  { name: "three are 2.67 ohms and not", placed: chain(3), cables: chainCables(3), outlets: [wall(15)], fed: { box1: false, box2: false, box3: false }, problems: ["low-load head,box1,box2,box3"] },
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

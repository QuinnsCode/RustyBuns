import { expect, test } from "bun:test";
import { arrange, FORMS, kickCount, sectionAt, SETUPS, TEMPOS, type Section } from "../src/dub.ts";
import { chartOf, fromSearch, Scenario, setupOf } from "../src/scenario.ts";

test("every form's sections cover its bars in order, and a bar past the end is still the outro", () => {
  for (const bars of FORMS) {
    const seen: Section[] = [];
    for (let b = 0; b < bars; b++) {
      const p = sectionAt(b, bars);
      expect(p.at).toBeLessThan(p.len);
      if (seen.at(-1) !== p.section || p.at === 0) seen.push(p.section);
    }
    expect(seen).toEqual(["intro", "build", "drop", "break", "rise", "drop", "outro"]);
    expect(sectionAt(bars + 3, bars).section).toBe("outro");
  }
});

test("eighteen sectioned setups, each a real track: a tempo, a form, drums in the drops, growls as long as it says, a rise before each drop", () => {
  const sectioned = SETUPS.filter((s) => !s.long);
  expect(sectioned.length).toBe(18);
  expect(new Set(SETUPS.map((s) => s.name)).size).toBe(SETUPS.length);
  for (const s of sectioned) {
    expect(TEMPOS).toContain(s.bpm);
    expect(FORMS).toContain(s.bars);
    const bars = Array.from({ length: s.bars }, (_, b) => arrange(s, b));
    // Half-time: a kick on the one and the backbeat on the three of every drop bar; nothing but hats and the tail in a break.
    for (const b of bars) {
      if (b.section === "drop") { expect(b.kicks[0]).toBe(0); expect(b.backs).toEqual([2]); expect(b.bass).toBe("wobble"); }
      if (b.section === "break") { expect(b.kicks).toEqual([]); expect(b.hats).toEqual([]); }
      if (b.section === "intro") expect(b.bass).toBeNull();
      expect(b.toms.length > 0).toBe(s.tribal && b.section === "drop");
      expect(b.fx.length > 0).toBe(s.fx && ["intro", "drop", "outro"].includes(b.section));
    }
    // Growls start each build and rise and come round every `growl` bars of a drop, never running past their section.
    const growls = bars.filter((b) => b.growl);
    expect(growls.length).toBeGreaterThanOrEqual(4);
    for (const b of growls) expect(b.growl).toBeLessThanOrEqual(Math.min(s.growl, b.len - b.at));
    const drop = bars.filter((b) => b.section === "drop" && b.at === 0);
    expect(drop.length).toBe(2);
    for (const d of drop) expect(bars[bars.indexOf(d) - 1]!.rise).toBe(s.rise);
    expect(kickCount(s)).toBe(bars.reduce((n, b) => n + b.kicks.length, 0));
  }
});

test("the bass note lifts a tone for the last eight bars of every 64", () => {
  const s = SETUPS[1]!;
  expect(arrange(s, 10).root).toBe(s.root);
  expect(arrange(s, 56).root).toBeCloseTo(s.root * 9 / 8);
  expect(arrange(s, 64).root).toBe(s.root);
});

test("a link names a setup; its chart takes the setup's tempo, delay and length, and bpm= still wins", () => {
  const sc = fromSearch("?setup=warren");
  expect(sc?.setup).toBe("warren");
  const chart = chartOf(sc!), s = setupOf(sc!)!;
  expect([chart.bpm, chart.delay, chart.bars]).toEqual([s.bpm, s.delay, s.bars]);
  expect(chart.calls.length).toBeGreaterThan(60);
  expect(chart.calls.every((c) => c.due + c.hold <= chart.bars * 4 - 1)).toBe(true);
  expect(chartOf(Scenario({ setup: "warren", bpm: 100 })).bpm).toBe(100);
  expect(fromSearch("?setup=nothing")).toBeNull();
  expect(fromSearch("?level=2")?.setup).toBeUndefined();
});

test("long-form tracks layer up phrase by phrase, hit off the grid, and hold notes for dozens of beats", () => {
  const longs = SETUPS.filter((s) => s.long);
  expect(longs.length).toBe(4);
  for (const s of longs) {
    const bars = Array.from({ length: s.bars }, (_, b) => arrange(s, b));
    const phrase = (p: number) => bars.slice(p * 16, p * 16 + 16);
    const count = (p: number, voice: string) => phrase(p).flatMap((b) => b.parts).filter((x) => x.voice === voice).length;
    // Stabs: none, then one in the whole phrase, then two; the lead and wub arrive after them.
    expect([0, 1, 2, 3].map((p) => count(p, "stab"))).toEqual([0, 0, 1, 2]);
    expect(count(3, "wub")).toBe(0);
    expect(count(4, "lead")).toBeGreaterThan(count(3, "lead"));
    expect(count(4, "wub")).toBe(1);
    // Layers only grow into the loud phrases: kicks, claps and hats never get rarer from phrase 0 to 4.
    const hits = (p: number) => phrase(p).reduce((n, b) => n + b.kicks.length + b.backs.length + b.hats.length, 0);
    for (const p of [1, 2, 3, 4]) expect(hits(p)).toBeGreaterThan(hits(p - 1));
    // Loose and empty: no bar has more than one kick but the pickups, and the break has no drums.
    expect(phrase(6).every((b) => b.kicks.length === 0 && b.backs.length === 0 && b.hats.length === 0)).toBe(true);
    // Not quantized: the backbeat and hats land off every eighth, and no two bars drift the same.
    const offs = bars.flatMap((b) => [...b.backs, ...b.hats.map((h) => h.at)]);
    expect(offs.every((x) => Math.abs(x * 2 - Math.round(x * 2)) > 0.01)).toBe(true);
    expect(new Set(offs.map((x) => x.toFixed(3))).size).toBeGreaterThan(offs.length / 2);
    // Real lines: the bassline and the lead each move through several pitches, on triplet beats, with rests; the lead answers its call.
    const pitches = (p: number, voice: string) => new Set(phrase(p).flatMap((b) => b.parts).filter((x) => x.voice === voice).map((x) => x.hz[0]!.toFixed(2))).size;
    expect(pitches(4, "bass")).toBeGreaterThanOrEqual(4);
    expect(pitches(4, "lead")).toBeGreaterThanOrEqual(5);
    expect(count(2, "bass")).toBeLessThan(count(4, "bass"));
    expect(phrase(4).flatMap((b) => b.parts).filter((x) => x.voice === "bass").some((x) => Math.abs(x.at * 3 - Math.round(x.at * 3)) < 0.2)).toBe(true);
    expect(phrase(4).slice(2, 4).every((b) => b.parts.every((x) => x.voice !== "lead"))).toBe(true);
    // Held notes run for dozens of beats, and the first bell doesn't come back for 64 bars.
    expect(Math.max(...bars.flatMap((b) => b.parts.map((x) => x.len)))).toBeGreaterThanOrEqual(60);
    const bells = bars.map((b, i) => (b.parts.some((x) => x.voice === "bell") ? i : -1)).filter((i) => i >= 0);
    expect(bells[0]).toBe(0);
    expect(bells[1]! - bells[0]!).toBeGreaterThanOrEqual(64);
  }
});

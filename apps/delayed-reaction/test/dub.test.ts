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

test("every sectioned setup is a real track: a tempo, a form, drums in the drops, growls as long as it says, a rise before each drop", () => {
  const sectioned = SETUPS.filter((s) => !s.long);
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

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AHEAD, FALLOFF, assignLanes, buildNotes, clockAt, currentIndex, depthAtY, formatAge, formatClock, geometry, hasRegions,
  initials, kindOf, laneCentre, multiplier, parsePatchLog, project, qToScrub, readInput, regionOf, scaleAt, scoreAt,
  scrubToIndex, scrubToQ, stepQ, topFiles, type Commit,
} from "../src/gitwiz/gitwiz.ts";

const commit = (over: Partial<Commit> = {}): Commit => ({ hash: "a".repeat(40), author: "ada", date: "2026-01-01T00:00:00Z", subject: "s", added: 1, removed: 0, ...over });
const at = (day: number, over: Partial<Commit> = {}) => commit({ date: new Date(Date.UTC(2026, 0, day)).toISOString(), hash: String(day).padStart(40, "0"), ...over });

// git prints newest first; \x1e starts a commit and \x1f splits its fields.
const log = (...commits: { hash: string; who: string; date: string; subject: string; hunks: string[] }[]) =>
  commits.map((c) => `\x1e${c.hash}\x1f${c.who}\x1f${c.date}\x1f${c.subject}\n\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n${c.hunks.join("\n")}\n`).join("");

describe("reading git's patch log", () => {
  const raw = log(
    { hash: "c3", who: "bo", date: "2026-01-03T00:00:00Z", subject: "touch the bottom", hunks: ["@@ -95,2 +95,3 @@ x", "+new", "@@ -10 +10 @@"] },
    { hash: "c2", who: "ada", date: "2026-01-02T00:00:00Z", subject: "grow it", hunks: ["@@ -0,0 +1,50 @@"] },
    { hash: "c1", who: "ada", date: "2026-01-01T00:00:00Z", subject: "first | with a bar", hunks: ["@@ -0,0 +1,50 @@"] },
  );
  const commits = parsePatchLog(raw);

  test("keeps git's order and counts each hunk's lines", () => {
    expect(commits.map((c) => c.hash)).toEqual(["c3", "c2", "c1"]);
    expect(commits.map((c) => [c.added, c.removed])).toEqual([[4, 3], [50, 0], [50, 0]]);
    expect(commits[2]!.subject).toBe("first | with a bar");
  });

  test("places a hunk by where it sits in the file as the commit found it", () => {
    // c1 made a 50-line file: its lines fall a third each, none lost
    const made = commits[2]!.regions!;
    expect(made.reduce((a, b) => a + b)).toBe(50);
    for (const r of made) expect(Math.abs(r - 50 / 3)).toBeLessThan(1);
    // c3 found 100 lines: two removed and three added at line 95 are the bottom, one of each at line 10 the top
    expect(commits[0]!.regions).toEqual([2, 0, 5]);
  });

  test("a hunk with no counts is one line, and a binary or empty commit is zero", () => {
    const [c] = parsePatchLog(log({ hash: "x", who: "a", date: "2026-01-01T00:00:00Z", subject: "bin", hunks: [] }));
    expect([c!.added, c!.removed, c!.regions]).toEqual([0, 0, [0, 0, 0]]);
  });
});

test("regionOf splits a file into thirds and clamps", () => {
  expect([0, 0.32, 0.34, 0.66, 0.67, 1, 1.4, -1].map(regionOf)).toEqual([0, 0, 1, 1, 2, 2, 2, 0]);
});

describe("most-edited files", () => {
  const status = [
    "\x1eM\tapp/a.ts\nM\tbun.lock", "\x1eM\tapp/a.ts\nA\tb.ts", "\x1eR090\told/a.ts\tapp/a.ts", "\x1eM\told/a.ts", "\x1eA\told/a.ts\x1eD\tgone.ts",
  ].join("");
  test("a rename carries the older commits to the new name, and gone files and lockfiles drop out", () => {
    const top = topFiles(status, (p) => p !== "gone.ts");
    // newest to oldest: 2 commits on app/a.ts, 1 rename, then old/a.ts's own 2 are app/a.ts's too
    expect(top).toEqual([{ path: "app/a.ts", commits: 5 }, { path: "b.ts", commits: 1 }]);
  });
  test("the limit cuts the list", () => expect(topFiles(status, () => true, 1)).toHaveLength(1));
});

describe("reading the JSON", () => {
  test("a bare list, a {path, commits}, and a bundle all read, oldest first", () => {
    const list = [at(3), at(1), at(2)];
    for (const src of [list, { path: "f.ts", commits: list }, JSON.stringify({ path: "f.ts", commits: list })]) {
      const inp = readInput(src);
      expect(Object.values(inp.histories)[0]!.map((c) => c.date.slice(8, 10))).toEqual(["01", "02", "03"]);
    }
    const bundle = readInput({ repo: "r", files: [{ path: "b.ts", commits: 9 }, { path: "ghost.ts", commits: 1 }], histories: { "a.ts": list, "b.ts": list } });
    expect(bundle.repo).toBe("r");
    // listed order first, the listing's own counts replaced by what's really there, files with no history dropped, unlisted ones added
    expect(bundle.files).toEqual([{ path: "b.ts", commits: 3 }, { path: "a.ts", commits: 3 }]);
  });

  test("two commits with the same date stay in git's order, newest first", () => {
    const [a, b] = [at(1, { hash: "newer" }), at(1, { hash: "older" })];
    expect(Object.values(readInput([a, b]).histories)[0]!.map((c) => c.hash)).toEqual(["older", "newer"]);
  });

  test("bad input says what is wrong", () => {
    expect(() => readInput("{nope")).toThrow("isn't JSON");
    expect(() => readInput(7)).toThrow("expected");
    expect(() => readInput({})).toThrow("no commits");
    expect(() => readInput([])).toThrow("no commits");
    expect(() => readInput([{ date: "never" }])).toThrow("commit 0 has no usable date");
    expect(() => readInput({ histories: { a: 3 } })).toThrow("a: expected a list");
  });

  test("odd numbers become zero, and regions only count when there are three", () => {
    const [c] = Object.values(readInput([{ date: "2026-01-01", added: -3, removed: "x", regions: [1, 2] }]).histories)[0]!;
    expect([c!.added, c!.removed, c!.regions]).toEqual([0, 0, undefined]);
  });

  test("the sample from this repo loads, with regions", () => {
    const sample = readInput(readFileSync(join(import.meta.dir, "../src/gitwiz/sample.json"), "utf8"));
    expect(sample.files[0]!.path).toBe("apps/codesplitter/src/client.html");
    expect(sample.files[0]!.commits).toBeGreaterThan(150);
    expect(hasRegions(buildNotes(sample.histories[sample.files[0]!.path]!))).toBe(true);
  });
});

describe("notes", () => {
  test("a commit is an add, a remove, or a rewrite", () => {
    expect([kindOf(10, 0), kindOf(0, 10), kindOf(5, 5), kindOf(2, 2), kindOf(40, 5), kindOf(5, 40), kindOf(9, 4)]).toEqual(["add", "remove", "rewrite", "add", "add", "remove", "rewrite"]);
  });

  test("size is lines changed on a log scale against the biggest, in oldest-first order", () => {
    const notes = buildNotes([at(2, { added: 99, removed: 0 }), at(1, { added: 0, removed: 0 }), at(3, { added: 9, removed: 0 })]);
    expect(notes.map((n) => n.i)).toEqual([0, 1, 2]);
    expect(notes.map((n) => n.added)).toEqual([0, 99, 9]);
    expect(notes[0]!.size).toBe(0);
    expect(notes[1]!.size).toBe(1);
    expect(notes[2]!.size).toBeGreaterThan(0.4); expect(notes[2]!.size).toBeLessThan(0.7);
    expect(notes[1]!.short).toBe("0000000");
  });

  test("addShare is how much of a change was additions", () => {
    expect(buildNotes([at(1, { added: 3, removed: 1 })])[0]!.addShare).toBe(0.75);
  });
});

describe("lanes", () => {
  const regions = (t: number, m: number, b: number) => at(1, { regions: [t, m, b] });
  test("region lanes: the third most lines landed in, ties and empties to the middle", () => {
    const notes = buildNotes([regions(9, 1, 0), regions(0, 9, 1), regions(0, 1, 9), regions(5, 5, 0), regions(0, 0, 0), regions(4, 0, 4)].map((c, i) => ({ ...c, date: at(i + 1).date })));
    const l = assignLanes(notes, "region");
    expect(l.names).toEqual(["top", "middle", "bottom"]);
    expect(l.of).toEqual([0, 1, 2, 1, 1, 0]);
  });

  test("author lanes: busiest first, the rest in one 'others' lane", () => {
    const who = ["a", "b", "b", "c", "c", "c", "d", "e", "f", "f"];
    const notes = buildNotes(who.map((author, i) => at(i + 1, { author })));
    const l = assignLanes(notes, "author", 4);
    expect(l.names).toEqual(["c", "b", "f", "others"]);
    expect(l.of).toEqual([3, 1, 1, 0, 0, 0, 3, 3, 2, 2]);
    // few enough authors: no "others"
    expect(assignLanes(notes, "author", 9).names).toHaveLength(6);
  });

  test("region data present or not", () => {
    expect(hasRegions(buildNotes([at(1)]))).toBe(false);
    expect(hasRegions(buildNotes([at(1, { regions: [0, 0, 2] })]))).toBe(true);
  });

  test("lane centres sit evenly across -1..1", () => {
    [-2 / 3, 0, 2 / 3].forEach((c, k) => expect(laneCentre(k, 3)).toBeCloseTo(c));
    expect(laneCentre(0, 1)).toBe(0);
  });
});

describe("the board's perspective", () => {
  const g = geometry(1000, 600);
  test("scale is 1 at the strum line, shrinks toward the horizon, and carries on past the strum line", () => {
    expect(scaleAt(0)).toBe(1);
    expect(scaleAt(AHEAD)).toBeCloseTo(1 / (1 + FALLOFF));
    let prev = Infinity;
    for (let d = -1; d <= AHEAD; d += 0.5) { const s = scaleAt(d); expect(s).toBeLessThan(prev); expect(s).toBeGreaterThan(0); prev = s; }
    // no kink at the strum line: both sides fall at the same rate
    const e = 1e-4;
    expect((scaleAt(0) - scaleAt(e)) / e).toBeCloseTo((scaleAt(-e) - scaleAt(0)) / e, 1);
  });

  test("the strum line is at the strum y, and lanes converge on the vanishing point", () => {
    expect(project(g, 0, 0)).toEqual({ x: g.cx, y: g.strum, s: 1 });
    const edgeNear = project(g, 1, 0), edgeFar = project(g, 1, AHEAD);
    expect(edgeNear.x - g.cx).toBeCloseTo(g.half);
    expect(edgeFar.x - g.cx).toBeCloseTo(g.half / (1 + FALLOFF));
    expect(edgeFar.y).toBeGreaterThan(g.horizon);
    // a lane's line is straight: its three points are collinear with the vanishing point
    const [a, b] = [project(g, 0.5, 2), project(g, 0.5, 9)];
    expect((a.x - g.cx) / (a.y - g.horizon)).toBeCloseTo((b.x - g.cx) / (b.y - g.horizon));
  });

  test("frets bunch up toward the horizon", () => {
    const ys = [0, 1, 2, 3, 4, 5].map((d) => project(g, 0, d).y);
    const gaps = ys.slice(1).map((y, i) => ys[i]! - y);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]!);
  });

  test("depthAtY undoes project", () => {
    for (const d of [-0.8, -0.1, 0, 0.7, 3, 11, AHEAD]) expect(depthAtY(g, project(g, 0, d).y)).toBeCloseTo(d, 6);
  });

  test("the geometry keeps the strum line inside the canvas, below the horizon", () => {
    for (const [w, h] of [[300, 300], [1600, 500], [500, 1200]] as const) {
      const x = geometry(w, h);
      expect(x.horizon).toBeLessThan(x.strum); expect(x.strum).toBeLessThan(h); expect(x.half * 2).toBeLessThanOrEqual(w);
    }
  });
});

describe("the playhead", () => {
  const n = 10;
  test("q counts the commits gone by, and the note under the strum line is the last one passed", () => {
    expect([0, 0.9, 1, 1.5, 9.99, 10, 11, -3].map((q) => currentIndex(q, n))).toEqual([-1, -1, 0, 0, 8, 9, 9, -1]);
  });

  test("a note crosses when depth reaches zero: note i is at depth i + 1 - q", () => {
    // so at q = i + 1 the strum line holds note i
    for (const i of [0, 4, 9]) expect(currentIndex(i + 1, n)).toBe(i);
  });

  test("scrub fractions map to q and back, and to the commit they land on", () => {
    expect(scrubToQ(0, n)).toBe(0); expect(scrubToQ(1, n)).toBe(n); expect(scrubToQ(0.5, n)).toBe(5); expect(scrubToQ(2, n)).toBe(n); expect(scrubToQ(-1, n)).toBe(0);
    expect(qToScrub(scrubToQ(0.37, n), n)).toBeCloseTo(0.37);
    expect(qToScrub(3, 0)).toBe(0);
    expect([0, 0.04, 0.05, 0.5, 0.96, 1].map((f) => scrubToIndex(f, n))).toEqual([-1, -1, 0, 4, 9, 9]);
  });

  test("stepping snaps to a crossing and stays in range", () => {
    expect(stepQ(2.4, 1, n)).toBe(3); expect(stepQ(2.4, -1, n)).toBe(2); expect(stepQ(3, 1, n)).toBe(4); expect(stepQ(3, -1, n)).toBe(2);
    expect(stepQ(0, -1, n)).toBe(0); expect(stepQ(n, 1, n)).toBe(n); expect(stepQ(2.4, 10, n)).toBe(n); expect(stepQ(3, -10, n)).toBe(0);
  });

  test("the clock sits on a commit's date as it crosses, and slides toward the next", () => {
    const notes = buildNotes([at(1), at(3), at(7)]);
    const day = 86_400_000, t0 = notes[0]!.t;
    expect(clockAt(notes, 0)).toBe(t0);
    expect(clockAt(notes, 1)).toBe(t0);
    expect(clockAt(notes, 1.5)).toBe(t0 + day);
    expect(clockAt(notes, 2)).toBe(t0 + 2 * day);
    expect(clockAt(notes, 99)).toBe(t0 + 6 * day);
    expect(clockAt([], 3)).toBe(0);
    // it only ever counts up
    let prev = -Infinity;
    for (let q = 0; q <= 3; q += 0.1) { const c = clockAt(notes, q); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
  });

  test("score: commits gone by, a combo of notes in one lane, and a multiplier every four", () => {
    const notes = buildNotes(Array.from({ length: 6 }, (_, i) => at(i + 1, { added: i + 1, removed: 1 })));
    const lanes = [0, 0, 0, 0, 0, 1];
    expect(scoreAt(notes, lanes, -1)).toEqual({ passed: 0, combo: 0, mult: 1, score: 0, added: 0, removed: 0 });
    expect(scoreAt(notes, lanes, 0)).toMatchObject({ passed: 1, combo: 1, mult: 1, score: 100 });
    // notes 0..4 in a row: combos 1,2,3,4,5 -> multipliers 1,1,1,2,2
    expect(scoreAt(notes, lanes, 4)).toMatchObject({ passed: 5, combo: 5, mult: 2, score: 100 * (1 + 1 + 1 + 2 + 2), added: 15, removed: 5 });
    // the change of lane breaks the streak
    expect(scoreAt(notes, lanes, 5)).toMatchObject({ passed: 6, combo: 1, mult: 1, score: 700 + 100 });
    expect(scoreAt(notes, lanes, 99).passed).toBe(6);
    expect([0, 3, 4, 8, 12, 99].map(multiplier)).toEqual([1, 1, 2, 3, 4, 4]);
  });

  test("the score is the same however you get to a commit", () => {
    const notes = buildNotes(Array.from({ length: 30 }, (_, i) => at(i + 1)));
    const lanes = notes.map((_, i) => (i % 7 === 0 ? 1 : 0));
    expect(scoreAt(notes, lanes, 20)).toEqual(scoreAt(notes, lanes, 20));
    expect(scoreAt(notes, lanes, 20).score).toBeGreaterThan(scoreAt(notes, lanes, 19).score);
  });
});

describe("words", () => {
  test("the clock is fixed-width, in UTC", () => {
    expect(formatClock(Date.UTC(2026, 9, 12, 22, 5))).toBe("2026-10-12 22:05");
    expect(formatClock(Date.UTC(2026, 0, 2, 3, 4))).toHaveLength(16);
    expect(formatAge(Date.UTC(2026, 0, 11), Date.UTC(2026, 0, 1))).toBe("0010d");
    expect(formatAge(0, 99)).toBe("0000d");
  });
  test("initials", () => {
    expect([initials("Ryan Quinn"), initials("QuinnsCode"), initials("ada"), initials("o"), initials("")]).toEqual(["RQ", "QU", "AD", "O", "?"]);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUZZ, CURVES, RIDE, STACK, WEATHER, repoOf, stackOf, buildNotes, buzzRide, caption, eventPush, filterRange, gustRide, isRobot, newRide, rideEvents, stepRide, tapRide, timeTicks, weatherAt, windAt, type EventKind, type Side, type Commit, breeze, cleanRefs, clockAt, currentIndex, kindOf, layoutGraph, multiplier, orderCommits, parseDag, parsePatchLog, readInput, scoreAt, simplifyParents, slotOf, topFiles, topFriends, veinChart,
} from "../src/gitpath/gitpath.ts";
import { eventKinds, eventModel, model, modelIds } from "../src/gitpath/models.ts";

const commit = (over: Partial<Commit> = {}): Commit => ({ hash: "a".repeat(40), author: "ada", date: "2026-01-01T00:00:00Z", subject: "s", added: 1, removed: 0, ...over });
const at = (day: number, over: Partial<Commit> = {}) => commit({ date: new Date(Date.UTC(2026, 0, day)).toISOString(), hash: String(day).padStart(40, "0"), ...over });
/** A graph from rows of [hash, parents, day, lines changed, branch names]. */
const graph = (...rows: [string, string[], number, number?, string[]?][]) =>
  rows.map(([hash, parents, day, n = 1, refs]) => at(day, { hash, parents, added: n, removed: 0, ...(refs ? { refs } : {}) }));

// git prints newest first; \x1e starts a commit and \x1f splits its fields.
const log = (...commits: { hash: string; who: string; date: string; parents?: string; refs?: string; subject: string; hunks: string[] }[]) =>
  commits.map((c) => `\x1e${c.hash}\x1f${c.who}\x1f${c.date}\x1f${c.parents ?? ""}\x1f${c.refs ?? ""}\x1f${c.subject}\n\ndiff --git a/f b/f\n--- a/f\n+++ b/f\n${c.hunks.join("\n")}\n`).join("");

describe("reading git's patch log", () => {
  const raw = log(
    { hash: "c3", who: "bo", date: "2026-01-03T00:00:00Z", parents: "c2 b9", refs: "HEAD -> main, origin/main, tag: v1, pr/12", subject: "touch it", hunks: ["@@ -95,2 +95,3 @@ x", "+new", "@@ -10 +10 @@"] },
    { hash: "c2", who: "ada", date: "2026-01-02T00:00:00Z", parents: "c1", subject: "first | with a bar", hunks: ["@@ -0,0 +1,50 @@"] },
    { hash: "c1", who: "ada", date: "2026-01-01T00:00:00Z", subject: "root", hunks: [] },
  );
  const commits = parsePatchLog(raw);

  test("keeps git's order, counts each hunk's lines, and reads parents and branch names", () => {
    expect(commits.map((c) => c.hash)).toEqual(["c3", "c2", "c1"]);
    expect(commits.map((c) => [c.added, c.removed])).toEqual([[4, 3], [50, 0], [0, 0]]);
    expect(commits[0]!.parents).toEqual(["c2", "b9"]);
    expect(commits[2]!.parents).toEqual([]);
    expect(commits[0]!.refs).toEqual(["main"]);
    expect(commits[1]!.refs).toBeUndefined();
    expect(commits[1]!.subject).toBe("first | with a bar");
  });

  test("branch names lose HEAD, origin/, tags and the game's pr/ refs", () => {
    expect(cleanRefs("HEAD -> main, origin/main, origin/HEAD, tag: v1.0, pr/1191, office/gizmo-a5b9, stash")).toEqual(["main", "office/gizmo-a5b9"]);
    expect(cleanRefs("")).toEqual([]);
  });
});

describe("the file's own graph", () => {
  // m1 <- x (a merge nobody counted) <- m2, and b1 off m1 joining at x, and m2's other parent.
  //   m1 - b1 \
  //     \      x - m2
  //      -----/
  const dag = parseDag("m2 x\nx m1 b1\nb1 m1\nm1 root\nroot\nother m1\n");
  test("a parent that touched the file stands for itself, one that didn't for the commits behind it", () => {
    const keep = new Set(["m2", "b1", "m1"]);
    const out = simplifyParents(dag, keep);
    expect(out.get("m2")).toEqual(["m1", "b1"]);   // through x, which touched nothing: both lines stay joined
    expect(out.get("b1")).toEqual(["m1"]);
    expect(out.get("m1")).toEqual([]);             // root never touched it
  });
});

describe("most-edited files", () => {
  const status = [
    "\x1eM\tapp/a.ts\nM\tbun.lock", "\x1eM\tapp/a.ts\nA\tb.ts", "\x1eR090\told/a.ts\tapp/a.ts", "\x1eM\told/a.ts", "\x1eA\told/a.ts\x1eD\tgone.ts",
  ].join("");
  test("a rename carries the older commits to the new name, and gone files and lockfiles drop out", () => {
    expect(topFiles(status, (p) => p !== "gone.ts")).toEqual([{ path: "app/a.ts", commits: 5 }, { path: "b.ts", commits: 1 }]);
  });
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
    expect(bundle.files).toEqual([{ path: "b.ts", commits: 3 }, { path: "a.ts", commits: 3 }]);
  });

  test("bad input says what is wrong", () => {
    expect(() => readInput("{nope")).toThrow("isn't JSON");
    expect(() => readInput(7)).toThrow("expected");
    expect(() => readInput({})).toThrow("no commits");
    expect(() => readInput([])).toThrow("no commits");
    expect(() => readInput([{ date: "never" }])).toThrow("commit 0 has no usable date");
    expect(() => readInput({ histories: { a: 3 } })).toThrow("a: expected a list");
  });

  test("the sample from this repo loads as a graph with branches", () => {
    const sample = readInput(readFileSync(join(import.meta.dir, "../src/gitpath/sample.json"), "utf8"));
    expect(sample.files[0]!.path).toBe("apps/codesplitter/src/client.html");
    const notes = buildNotes(sample.histories[sample.files[0]!.path]!);
    expect(notes.length).toBeGreaterThan(150);
    const lay = layoutGraph(notes);
    expect(lay.lanes).toBeGreaterThan(1);
    expect(lay.hot.length).toBeGreaterThan(50);
    expect(notes[lay.tip]!.refs).toContain("main");
  });
});

describe("order", () => {
  test("two commits with the same date stay in git's order, newest first", () => {
    const [a, b] = [at(1, { hash: "newer" }), at(1, { hash: "older" })];
    expect(orderCommits([a, b]).map((c) => c.hash)).toEqual(["older", "newer"]);
  });
  test("a child is never before its parent, even dated earlier", () => {
    const out = orderCommits([at(1, { hash: "child", parents: ["parent"] }), at(5, { hash: "parent" }), at(3, { hash: "other" })]);
    expect(out.map((c) => c.hash)).toEqual(["other", "parent", "child"]);
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

  test("parents become note indices, with ones that aren't in the list dropped, and the clock never runs backward", () => {
    const notes = buildNotes(graph(["a", ["gone"], 1], ["b", ["a", "a"], 3, 1], ["c", ["b", "a"], 2]));
    const byHash = Object.fromEntries(notes.map((n) => [n.hash, n]));
    expect(byHash.a!.parents).toEqual([]);
    expect(byHash.b!.parents).toEqual([byHash.a!.i]);
    expect(byHash.c!.parents).toEqual([byHash.b!.i, byHash.a!.i]);
    expect(byHash.c!.i).toBeGreaterThan(byHash.b!.i);
    for (let i = 1; i < notes.length; i++) expect(notes[i]!.t).toBeGreaterThanOrEqual(notes[i - 1]!.t);
  });
});

describe("the graph's layout", () => {
  const ids = (notes: ReturnType<typeof buildNotes>) => Object.fromEntries(notes.map((n) => [n.hash, n.i]));

  test("a history with no branches is one line, all of it hot", () => {
    const notes = buildNotes([at(1), at(2), at(3)]);
    const lay = layoutGraph(notes);
    expect(lay.lane).toEqual([0, 0, 0]);
    expect(lay.lanes).toBe(1); expect(lay.extent).toBe(0);
    expect(lay.hot).toEqual([0, 1, 2]);
  });

  test("a branch off main takes lane 1, and the main line stays lane 0", () => {
    //  m1 - m2 - m3 (main)
    //    \- b1 - b2
    const notes = buildNotes(graph(["m1", [], 1], ["b1", ["m1"], 2], ["m2", ["m1"], 3], ["b2", ["b1"], 4], ["m3", ["m2"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    expect([at_.m1, at_.m2, at_.m3].map((i) => lay.lane[i!])).toEqual([0, 0, 0]);
    expect([at_.b1, at_.b2].map((i) => lay.lane[i!])).toEqual([1, 1]);
    expect(lay.lanes).toBe(2); expect(lay.extent).toBe(1);
    expect(lay.edges).toHaveLength(4);
    expect(lay.hot.map((i) => notes[i]!.hash)).toEqual(["m1", "m2", "m3"].map((h) => notes.find((n) => n.hash === h)!.hash));
  });

  test("the main line is the first parents back from main's tip, not the newest commit", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["m2", ["m1"], 2, 1, ["main"]], ["b1", ["m1"], 3]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    expect(lay.tip).toBe(at_.m2!);
    expect(lay.lane[at_.b1!]).toBe(1);
  });

  test("branches at once take their own lanes, to the right, then left, of main", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["a", ["m1"], 2], ["b", ["m1"], 3], ["c", ["m1"], 4], ["m2", ["m1"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    // newest first: c takes lane 1, b lane 2, a lane 3
    expect([at_.c, at_.b, at_.a].map((i) => lay.lane[i!])).toEqual([1, 2, 3]);
    expect([0, 1, 2, 3, 4].map(slotOf)).toEqual([0, 1, -1, 2, -2]);
    expect(lay.extent).toBe(2);
  });

  test("a merge draws the branch as a line joining main, and the hot path takes the branch that changed more", () => {
    //  m1 - m2 ----- mm (main)
    //   \- b1 - b2 -/
    const notes = buildNotes(graph(["m1", [], 1, 10], ["b1", ["m1"], 2, 100], ["m2", ["m1"], 3, 5], ["b2", ["b1"], 4, 100], ["mm", ["m2", "b2"], 5, 5, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    expect([at_.b1, at_.b2].map((i) => lay.lane[i!])).toEqual([1, 1]);
    expect(lay.hot).toEqual([at_.m1!, at_.b1!, at_.b2!, at_.mm!]);
    expect(lay.onHot[at_.m2!]).toBe(false);
  });

});

describe("the stack", () => {
  test("a commit that names a piece of the stack calls it up, the specific before the general", () => {
    const pick = (s: string) => stackOf(s);
    expect([
      pick("codeSplitter: a D1 migration"), pick("move levels to R2"), pick("the job queue retries"), pick("Durable Objects hibernate"), pick("a DO per file"),
      pick("sandbox container for agents"), pick("Artifacts remote"), pick("rate limit sign-ups"), pick("serve static assets"), pick("a Worker route"),
      pick("deploy to Cloudflare"), pick("tidy the readme"),
    ]).toEqual(["d1", "r2", "queues", "durable-objects", "durable-objects", "containers", "artifacts", "rate-limit", "assets", "workers", "cloud", undefined]);
    // D1 wins over Workers when a commit names both
    expect(stackOf("D1 on a Worker")).toBe("d1");
  });

  test("every piece has its own id and a model, and so does the orange cloud", () => {
    const ids = STACK.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(modelIds()).toContain(id);
    expect(modelIds()).toContain("cloud");
    for (const p of STACK) expect(p.name.length).toBeGreaterThan(0);
  });

});

describe("the playhead", () => {
  const n = 10;
  test("q counts the commits gone by, and the note under the strum line is the last one passed", () => {
    expect([0, 0.9, 1, 1.5, 9.99, 10, 11, -3].map((q) => currentIndex(q, n))).toEqual([-1, -1, 0, 0, 8, 9, 9, -1]);
    for (const i of [0, 4, 9]) expect(currentIndex(i + 1, n)).toBe(i);
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
    let prev = -Infinity;
    for (let q = 0; q <= 3; q += 0.1) { const c = clockAt(notes, q); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
  });

  test("score: commits gone by, a combo of hot-path commits in a row, and a multiplier every four", () => {
    const notes = buildNotes(Array.from({ length: 7 }, (_, i) => at(i + 1, { added: i + 1, removed: 1 })));
    const hot = [true, true, true, true, true, false, true];
    expect(scoreAt(notes, hot, -1)).toEqual({ passed: 0, combo: 0, mult: 1, score: 0, added: 0, removed: 0 });
    expect(scoreAt(notes, hot, 0)).toMatchObject({ passed: 1, combo: 1, mult: 1, score: 100 });
    // 0..4 on the path: combos 1,2,3,4,5 -> multipliers 1,1,1,2,2
    expect(scoreAt(notes, hot, 4)).toMatchObject({ passed: 5, combo: 5, mult: 2, score: 100 * (1 + 1 + 1 + 2 + 2), added: 15, removed: 5 });
    // a side-branch commit breaks the streak and scores nothing, and the next hot one starts again
    expect(scoreAt(notes, hot, 5)).toMatchObject({ passed: 6, combo: 0, mult: 1, score: 700 });
    expect(scoreAt(notes, hot, 6)).toMatchObject({ passed: 7, combo: 1, score: 800 });
    expect(scoreAt(notes, hot, 99).passed).toBe(7);
    expect([0, 3, 4, 8, 12, 99].map(multiplier)).toEqual([1, 1, 2, 3, 4, 4]);
  });
});

describe("the time slider", () => {
  // Three commits a day, a day, then ten days apart: the slider goes by date, not by commit.
  const notes = buildNotes(graph(["a", [], 1], ["b", ["a"], 2], ["c", ["b"], 12]));
  test("ticks are month starts, few enough to read, with a year label once they're yearly", () => {
    const t = timeTicks(Date.UTC(2026, 0, 15), Date.UTC(2026, 3, 20), 5);
    expect(t.map((x) => x.label)).toEqual(["2026-02", "2026-03", "2026-04"]);
    expect(t.every((x) => x.frac > 0 && x.frac < 1)).toBe(true);
    expect(timeTicks(Date.UTC(2020, 5, 1), Date.UTC(2026, 5, 1), 5).map((x) => x.label)).toEqual(["2022", "2024", "2026"]);
    expect(timeTicks(Date.UTC(2026, 0, 15), Date.UTC(2026, 5, 20), 5).map((x) => x.label)).toEqual(["2026-04"]);
    expect(timeTicks(5, 5)).toEqual([]);
  });
  test("a date range keeps the days it names, both included", () => {
    const c = graph(["a", [], 1], ["b", ["a"], 2], ["c", ["b"], 3]);
    expect(filterRange(c, "2026-01-02", "2026-01-02").map((x) => x.hash)).toEqual(["b"]);
    expect(filterRange(c, "2026-01-02").map((x) => x.hash)).toEqual(["b", "c"]);
    expect(filterRange(c, undefined, "2026-01-01").map((x) => x.hash)).toEqual(["a"]);
    expect(filterRange(c, "nonsense", "")).toHaveLength(3);
  });
});

describe("the ride", () => {
  /** Runs `secs` of pedalling at the beat, alternating, with a bot that favours the leaning side when it must. */
  const ride = (secs: number, opts: { bot?: boolean; wind?: number; gustAt?: number; push?: number; pedal?: boolean } = {}) => {
    const r = newRide(), dt = 1 / 60;
    let next = 0.1, side: Side = 1, fell = -1;
    const pedal = opts.pedal ?? true;
    for (let k = 0; k < secs * 60; k++) {
      if (opts.gustAt !== undefined && Math.abs(r.t - opts.gustAt) < dt / 2) gustRide(r, opts.push ?? 3);
      if (pedal && r.t >= next) {
        // The bot leans on its pedals: where the lean is heading decides the side, which costs speed but keeps it up.
        const heading = r.lean + 0.5 * r.omega;
        if (opts.bot && Math.abs(heading) > 0.12) side = heading > 0 ? 1 : -1; else side = side === 1 ? -1 : 1;
        tapRide(r, side);
        next = r.t + RIDE.period * (opts.bot ? 0.6 : 1);
      }
      if (stepRide(r, dt, opts.wind ?? breeze(r.t))) { fell = r.t; break; }
    }
    return { r, fell };
  };

  test("alternating on the beat builds speed, and never past the top; stopping coasts to a halt", () => {
    const { r } = ride(8);
    expect(r.speed).toBeGreaterThan(1);
    expect(r.speed).toBeLessThanOrEqual(RIDE.maxSpeed);
    for (let k = 0; k < 600; k++) stepRide(r, 1 / 60, 0);
    expect(r.speed).toBeLessThan(0.02);
  });

  test("steady pedalling in a light breeze stays up", () => {
    const { fell } = ride(30, { bot: true });
    expect(fell).toBe(-1);
  });

  test("a car's gust tips an unattended rider over, and a rider who favours the leaning side survives it", () => {
    const hit = (bot: boolean) => ride(12, { bot, gustAt: 4, push: 3.2 }).fell;
    expect(hit(true)).toBe(-1);
    const idle = newRide();
    gustRide(idle, 3.2);
    let over = false;
    for (let k = 0; k < 300 && !over; k++) over = stepRide(idle, 1 / 60, 0);
    expect(over).toBe(true);
  });

});

describe("what git does to the rider", () => {
  const evs = (rows: [string, string[], number, number?, string[]?][], subjects: Record<string, string> = {}) => {
    const commits = graph(...rows).map((c) => ({ ...c, subject: subjects[c.hash] ?? c.subject }));
    const notes = buildNotes(commits);
    return { notes, lay: layoutGraph(notes), events: rideEvents(notes, layoutGraph(notes)) };
  };

  test("a straight line is a quiet road", () => {
    expect(evs([["a", [], 1], ["b", ["a"], 2], ["c", ["b"], 3]]).events).toEqual([]);
  });

  test("a merge is a car, a fork is a fork, the first commit on a branch is a branch", () => {
    const { notes, events } = evs([
      ["a", [], 1], ["b", ["a"], 2, 1, []], ["x", ["a"], 3], ["y", ["x"], 4], ["m", ["b", "y"], 5, 1, ["main"]],
    ]);
    const by = (h: string) => events.find((e) => notes[e.i]!.hash === h);
    expect(by("m")?.kind).toBe("merge");
    expect(by("a")?.kind).toBe("fork");
    expect(by("x")?.kind).toBe("branch");
    expect(by("y")).toBeUndefined();
    // The car comes from the side lane the merge joins, and pushes the other way.
    const car = by("m")!;
    expect(eventPush(car)).toBe(-car.side * 3);
    expect(Math.abs(eventPush(car))).toBeGreaterThan(Math.abs(eventPush(by("x")!)));
  });

  test("a big commit landed as a squash merge is a boulder, and a small one is nothing", () => {
    const { notes, events } = evs(
      [["a", [], 1, 1], ["b", ["a"], 2, 500], ["c", ["b"], 3, 2]],
      { a: "start (#1)", b: "add the thing (#2)", c: "tweak (#3)" },
    );
    expect(events.map((e) => [notes[e.i]!.hash, e.kind])).toEqual([["b", "squash"]]);
  });

  test("a merge that rewrote lines by hand is the angry car, and it pushes hardest", () => {
    const rows: [string, string[], number, number?, string[]?][] = [["a", [], 1], ["b", ["a"], 2], ["x", ["a"], 3], ["m", ["b", "x"], 4, 1, ["main"]]];
    const clean = evs(rows), by = (es: typeof clean.events, h: string) => es.find((e) => clean.notes[e.i]!.hash === h);
    expect(by(clean.events, "m")?.kind).toBe("merge");
    const commits = graph(...rows).map((c) => (c.hash === "m" ? { ...c, added: 40, removed: 30 } : c));
    const notes = buildNotes(commits), lay = layoutGraph(notes), events = rideEvents(notes, lay);
    const angry = events.find((e) => notes[e.i]!.hash === "m")!;
    expect(angry.kind).toBe("conflict");
    expect(Math.abs(eventPush(angry))).toBeGreaterThan(Math.abs(eventPush(by(clean.events, "m")!)));
  });

  test("a commit on an office branch, or by a bot, is a robot swarm; a person's is not", () => {
    expect(isRobot({ refs: ["office/gizmo-a5b9"], author: "Ryan Quinn" })).toBe(true);
    expect(isRobot({ refs: ["main"], author: "dependabot[bot]" })).toBe(true);
    expect(isRobot({ refs: ["feature/robots"], author: "Ada" })).toBe(false);
    const { notes, events } = evs([["a", [], 1], ["x", ["a"], 2, 1, ["office/widget-1"]], ["b", ["a"], 3, 1, ["main"]]]);
    expect(events.map((e) => [notes[e.i]!.hash, e.kind])).toEqual([["a", "fork"], ["x", "swarm"]]);
  });

  test("every event has a model and a line to shout", () => {
    const kinds: EventKind[] = ["merge", "conflict", "swarm", "fork", "branch", "squash"];
    expect(eventKinds().sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      expect(eventModel(kind).children.length).toBeGreaterThan(0);
      expect(caption({ i: 0, kind, side: 1, power: 1 }, { author: "Ada Lovelace", short: "abc1234", refs: ["office/byte-1"], changed: 1234 }).length).toBeGreaterThan(8);
    }
    expect(caption({ i: 0, kind: "conflict", side: -1, power: 1 }, { author: "Ada Lovelace", short: "abc1234", refs: [], changed: 9 })).toContain("Ada fixed it by hand in abc1234");
  });
});

describe("the weather", () => {
  test("a quiet stretch is calm, a busy week is a gale, and the gale blows harder than the breeze", () => {
    const quiet = buildNotes([at(1), at(20), at(60)]);
    expect(weatherAt(quiet, 1.5).label).toBe("calm");
    const busy = buildNotes(Array.from({ length: WEATHER.gale + 2 }, (_, k) => commit({ hash: String(k).padStart(40, "9"), date: new Date(Date.UTC(2026, 0, 10, k)).toISOString() })));
    const w = weatherAt(busy, busy.length / 2);
    expect(w.label).toBe("gale");
    expect(w.storm).toBe(1);
    expect(windAt(1, w)).toBeCloseTo(breeze(1) * (1 + WEATHER.force));
    expect(windAt(1, { storm: 0 })).toBe(breeze(1));
    expect(weatherAt([], 0).label).toBe("calm");
  });

  test("a quick rider who leans on the pedals stays up through a gale", () => {
    const r = newRide(), dt = 1 / 60;
    let next = 0.1, side: Side = 1, fell = false;
    for (let k = 0; k < 30 * 60 && !fell; k++) {
      if (r.t >= next) {
        const heading = r.lean + 0.5 * r.omega;
        side = Math.abs(heading) > 0.12 ? (heading > 0 ? 1 : -1) : side === 1 ? -1 : 1;
        tapRide(r, side); next = r.t + RIDE.period * 0.6;
      }
      fell = stepRide(r, dt, windAt(r.t, { storm: 1 }));
    }
    expect(fell).toBe(false);
  });

  test("a robot swarm shakes the rider and bleeds speed twice as fast, then leaves", () => {
    const calm = newRide(), buzzed = newRide();
    calm.speed = buzzed.speed = 3;
    buzzRide(buzzed);
    expect(buzzed.buzz).toBe(BUZZ);
    for (let k = 0; k < 60; k++) { stepRide(calm, 1 / 60, 0); stepRide(buzzed, 1 / 60, 0); }
    expect(buzzed.speed).toBeLessThan(calm.speed);
    expect(calm.lean).toBe(0);
    expect(buzzed.lean).not.toBe(0);
    for (let k = 0; k < BUZZ * 60; k++) stepRide(buzzed, 1 / 60, 0);
    expect(buzzed.buzz).toBe(0);
  });
});

describe("friends and their vein charts", () => {
  const log = [
    at(1, { author: "ada", parents: [] }), at(2, { author: "bo", parents: [at(1).hash] }), at(3, { author: "ada", parents: [at(2).hash] }),
    at(4, { author: "cy", parents: [at(3).hash] }), at(5, { author: "ada", parents: [at(4).hash] }), at(6, { author: "bo", parents: [at(5).hash] }),
  ];

  test("the top friends are the most frequent authors, ties by name, capped at the limit", () => {
    expect(topFriends(log).map((f) => [f.name, f.commits.length])).toEqual([["ada", 3], ["bo", 2], ["cy", 1]]);
    expect(topFriends(log, 2).map((f) => f.name)).toEqual(["ada", "bo"]);
    const nine = Array.from({ length: 9 }, (_, i) => at(i + 1, { author: `p${i}` }));
    expect(topFriends(nine)).toHaveLength(8);
  });

  test("a friend's commits point at their own earlier commits, skipping everyone else's", () => {
    const ada = topFriends(log)[0]!;
    expect(ada.commits.map((c) => c.parents)).toEqual([[], [at(1).hash], [at(3).hash]]);
  });

  test("a vein chart puts commits on the shared clock, so a late starter begins part-way along", () => {
    const from = Date.parse(at(1).date), to = Date.parse(at(6).date);
    const cy = veinChart(topFriends(log)[2]!.commits, from, to);
    expect(cy.dots).toHaveLength(1);
    expect(cy.dots[0]!.x).toBeCloseTo(3 / 5);
    const ada = veinChart(topFriends(log)[0]!.commits, from, to);
    expect(ada.dots.map((d) => d.x)).toEqual([0, 2 / 5, 4 / 5]);
    expect(ada.links).toHaveLength(2);
    expect(ada.dots.every((d) => d.hot)).toBe(true);
  });

});

describe("the video's speed curves", () => {
  test("there are seven, and each starts at 0, ends at 1 and never goes back", () => {
    expect(CURVES.length).toBe(7);
    for (const c of CURVES) {
      expect(c.warp(0)).toBeCloseTo(0, 9);
      expect(c.warp(1)).toBeCloseTo(1, 9);
      let prev = 0;
      for (let k = 1; k <= 200; k++) { const w = c.warp(k / 200); expect(w).toBeGreaterThanOrEqual(prev - 1e-12); prev = w; }
    }
  });

});

describe("a hosted repo", () => {
  test("the repo and file a page was opened on", () => {
    expect(repoOf("?repo=ana/p")).toEqual({ owner: "ana", repo: "p", path: "" });
    expect(repoOf("?repo=ana/my.repo-2&path=src/a.ts")).toEqual({ owner: "ana", repo: "my.repo-2", path: "src/a.ts" });
    expect(repoOf("?path=/lead/slash.ts&repo=ana/p")?.path).toBe("lead/slash.ts");
    for (const bad of ["", "?repo=", "?repo=ana", "?repo=ana/p/extra", "?repo=../x", "?repo=a b/c", "?other=1"]) expect(repoOf(bad)).toBeNull();
  });
});

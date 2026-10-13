import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import {
  AHEAD, FOV, LANE_W, SPACING, STACK, TILT, boardHalf, buildNotes, cleanRefs, clockAt, currentIndex, edgeSamples, edgeSlotAt, fitDistance,
  formatAge, formatClock, keptAncestors, kindOf, layoutGraph, multiplier, orderCommits, paceAt, parseDag, parsePatchLog, pathSlotAt,
  qToScrub, readInput, runnerOffset, scoreAt, scrubToIndex, scrubToQ, simplifyParents, slotOf, stackOf, stepQ, strideRate, topFiles,
  worldX, worldZ, type Commit,
} from "../src/gitwiz/gitwiz.ts";
import { COLORS, model, modelIds, pose, runner, setFace } from "../src/gitwiz/models.ts";

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
  test("keptAncestors finds the nearest kept commits from any commit", () => {
    const near = keptAncestors(dag, new Set(["m1"]));
    expect(near("m2")).toEqual(["m1"]);
    expect(near("m1")).toEqual(["m1"]);
    expect(near("root")).toEqual([]);
    expect(near("unknown")).toEqual([]);
  });
  test("a long chain of untouched commits doesn't overflow the stack", () => {
    const long = new Map<string, string[]>([["n0", []]]);
    for (let i = 1; i < 20000; i++) long.set(`n${i}`, [`n${i - 1}`]);
    expect(keptAncestors(long, new Set(["n0"]))("n19999")).toEqual(["n0"]);
  });
});

describe("most-edited files", () => {
  const status = [
    "\x1eM\tapp/a.ts\nM\tbun.lock", "\x1eM\tapp/a.ts\nA\tb.ts", "\x1eR090\told/a.ts\tapp/a.ts", "\x1eM\told/a.ts", "\x1eA\told/a.ts\x1eD\tgone.ts",
  ].join("");
  test("a rename carries the older commits to the new name, and gone files and lockfiles drop out", () => {
    expect(topFiles(status, (p) => p !== "gone.ts")).toEqual([{ path: "app/a.ts", commits: 5 }, { path: "b.ts", commits: 1 }]);
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
    expect(bundle.files).toEqual([{ path: "b.ts", commits: 3 }, { path: "a.ts", commits: 3 }]);
  });

  test("parents and branch names come through, and a history with none is still fine", () => {
    const [c] = Object.values(readInput([{ date: "2026-01-01", parents: ["p", 3], refs: ["main"] }]).histories)[0]!;
    expect([c!.parents, c!.refs]).toEqual([["p"], ["main"]]);
    const [d] = Object.values(readInput([{ date: "2026-01-01" }]).histories)[0]!;
    expect([d!.parents, d!.refs]).toEqual([undefined, undefined]);
  });

  test("bad input says what is wrong", () => {
    expect(() => readInput("{nope")).toThrow("isn't JSON");
    expect(() => readInput(7)).toThrow("expected");
    expect(() => readInput({})).toThrow("no commits");
    expect(() => readInput([])).toThrow("no commits");
    expect(() => readInput([{ date: "never" }])).toThrow("commit 0 has no usable date");
    expect(() => readInput({ histories: { a: 3 } })).toThrow("a: expected a list");
  });

  test("odd numbers become zero", () => {
    const [c] = Object.values(readInput([{ date: "2026-01-01", added: -3, removed: "x" }]).histories)[0]!;
    expect([c!.added, c!.removed]).toEqual([0, 0]);
  });

  test("the sample from this repo loads as a graph with branches", () => {
    const sample = readInput(readFileSync(join(import.meta.dir, "../src/gitwiz/sample.json"), "utf8"));
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
  test("parents that loop don't lose a commit", () => {
    const out = orderCommits([at(1, { hash: "a", parents: ["b"] }), at(2, { hash: "b", parents: ["a"] })]);
    expect(out.map((c) => c.hash).sort()).toEqual(["a", "b"]);
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

  test("a branch that has ended gives its lane back", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["x1", ["m1"], 2], ["m2", ["m1"], 3], ["y1", ["m2"], 4], ["m3", ["m2"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    expect([at_.x1, at_.y1].map((i) => lay.lane[i!])).toEqual([1, 1]);
    expect(lay.lanes).toBe(2);
  });

  test("branches at once take their own lanes, to the right, then left, of main", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["a", ["m1"], 2], ["b", ["m1"], 3], ["c", ["m1"], 4], ["m2", ["m1"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    // newest first: c takes lane 1, b lane 2, a lane 3
    expect([at_.c, at_.b, at_.a].map((i) => lay.lane[i!])).toEqual([1, 2, 3]);
    expect([0, 1, 2, 3, 4].map(slotOf)).toEqual([0, 1, -1, 2, -2]);
    expect(lay.extent).toBe(2);
  });

  test("too many branches share the last lane instead of running off the board", () => {
    const rows: [string, string[], number, number?, string[]?][] = [["m1", [], 1]];
    for (let k = 0; k < 6; k++) rows.push([`b${k}`, ["m1"], 2 + k]);
    rows.push(["m2", ["m1"], 9, 1, ["main"]]);
    const lay = layoutGraph(buildNotes(graph(...rows)), 3);
    expect(Math.max(...lay.lane)).toBe(2);
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

  test("an empty history lays out as nothing", () => {
    const lay = layoutGraph([]);
    expect([lay.lanes, lay.hot, lay.edges]).toEqual([1, [], []]);
  });

  test("the lines bend only near the end where they meet, and stay in their lane between", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["b1", ["m1"], 2], ["b2", ["b1"], 3], ["m2", ["m1"], 4], ["mm", ["m2", "b2"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    const fork = { lo: at_.m1!, hi: at_.b1! }, join = { lo: at_.b2!, hi: at_.mm! };
    expect(edgeSlotAt(lay, fork, fork.lo)).toBe(0);
    expect(edgeSlotAt(lay, fork, fork.hi)).toBe(1);
    expect(edgeSlotAt(lay, fork, fork.lo + 0.25)).toBeGreaterThan(0);
    expect(edgeSlotAt(lay, fork, fork.lo + 0.25)).toBeLessThan(1);
    expect(edgeSlotAt(lay, join, join.lo)).toBe(1);
    expect(edgeSlotAt(lay, join, join.hi)).toBe(0);
    // a long edge: flat in the branch's lane for most of it
    const long = { lo: 0, hi: 20 };
    const l2 = { ...lay, slot: Object.assign([0, ...Array(19).fill(0), 1], {}), lane: Object.assign([0, ...Array(19).fill(0), 1], {}) };
    expect(edgeSlotAt(l2, long, 10)).toBe(1);
    expect(edgeSlotAt(l2, long, 0)).toBe(0);
    // never leaves the span between its two lanes
    for (let t = 0; t <= 1; t += 0.05) { const s = edgeSlotAt(lay, fork, t); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(1); }
  });

  test("the runner's place on the path follows the hot path across a fork", () => {
    const notes = buildNotes(graph(["m1", [], 1, 10], ["b1", ["m1"], 2, 100], ["b2", ["b1"], 3, 100], ["m2", ["m1"], 4, 5], ["mm", ["m2", "b2"], 5, 5, ["main"]]));
    const lay = layoutGraph(notes), at_ = ids(notes);
    expect(lay.hot).toEqual([at_.m1!, at_.b1!, at_.b2!, at_.mm!]);
    expect(pathSlotAt(lay, -5)).toBe(0);
    expect(pathSlotAt(lay, at_.b1!)).toBe(1);
    expect(pathSlotAt(lay, at_.b2!)).toBe(1);
    expect(pathSlotAt(lay, at_.mm!)).toBe(0);
    expect(pathSlotAt(lay, 99)).toBe(0);
    expect(pathSlotAt(layoutGraph([]), 3)).toBe(0);
    expect(pathSlotAt(layoutGraph(buildNotes([at(1)])), 3)).toBe(0);
  });

});

describe("the 3D board", () => {
  test("slots map across the board with the outer lanes inside its rails, and notes go down it one commit apart", () => {
    expect(worldX(0)).toBe(0); expect(worldX(2)).toBe(2 * LANE_W); expect(worldX(-1)).toBe(-LANE_W);
    expect(worldZ(0) - worldZ(1)).toBeCloseTo(SPACING);
    expect(worldZ(-1)).toBeCloseTo(0);   // the note just before the first sits on the strum line
    for (const extent of [0, 1, 4]) expect(worldX(extent) + LANE_W / 2).toBeLessThan(boardHalf(extent));
  });

  test("an edge is sampled only where it bends", () => {
    const notes = buildNotes(graph(["m1", [], 1], ["b1", ["m1"], 2], ["b2", ["b1"], 3], ["m2", ["m1"], 4], ["mm", ["m2", "b2"], 5, 1, ["main"]]));
    const lay = layoutGraph(notes);
    const byHash = Object.fromEntries(notes.map((n) => [n.hash, n.i]));
    const straight = edgeSamples(lay, { lo: byHash.b1!, hi: byHash.b2! });
    expect(straight).toEqual([byHash.b1!, byHash.b2!]);
    const fork = edgeSamples(lay, { lo: byHash.m1!, hi: byHash.b1! });
    expect(fork.length).toBeGreaterThan(3);
    expect(fork[0]).toBe(byHash.m1); expect(fork[fork.length - 1]).toBe(byHash.b1);
    expect([...fork].sort((a, b) => a - b)).toEqual(fork);
    // the samples trace the same curve edgeSlotAt gives, and stay between the two lanes
    for (const t of fork) { const x = edgeSlotAt(lay, { lo: byHash.m1!, hi: byHash.b1! }, t); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
  });

  test("the camera fits the board's width at the strum line for any shape of canvas", () => {
    for (const extent of [0, 2, 4]) for (const aspect of [0.6, 1, 1.6, 2.4]) {
      const half = boardHalf(extent), d = fitDistance(half, aspect);
      const cam = new PerspectiveCamera(FOV, aspect, 0.1, 200);
      cam.position.set(0, d * Math.sin((TILT * Math.PI) / 180), d * Math.cos((TILT * Math.PI) / 180));
      cam.lookAt(0, 0.6, -AHEAD * SPACING * 0.3);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const right = new Vector3(half, 0, 0).project(cam), left = new Vector3(-half, 0, 0).project(cam);
      // fitDistance stops at 60, which only an extreme shape reaches
      if (d < 60 && d > 9) { expect(right.x).toBeLessThanOrEqual(1); expect(left.x).toBeGreaterThanOrEqual(-1); }
    }
    expect(fitDistance(boardHalf(4), 1)).toBeGreaterThan(fitDistance(boardHalf(0), 1));
    expect(fitDistance(boardHalf(2), 0.6)).toBeGreaterThan(fitDistance(boardHalf(2), 2));
    expect(fitDistance(1, 3)).toBe(9);
  });

  test("the board rises and narrows toward the horizon", () => {
    const half = boardHalf(2), d = fitDistance(half, 1.6);
    const cam = new PerspectiveCamera(FOV, 1.6, 0.1, 200);
    cam.position.set(0, d * Math.sin((TILT * Math.PI) / 180), d * Math.cos((TILT * Math.PI) / 180));
    cam.lookAt(0, 0.6, -AHEAD * SPACING * 0.3);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const at = (x: number, depth: number) => new Vector3(x, 0, -depth * SPACING).project(cam);
    let prevY = -Infinity, prevHalf = Infinity;
    for (let depth = 0; depth <= AHEAD; depth += 2) {
      const l = at(-half, depth), r = at(half, depth);
      expect(l.y).toBeGreaterThan(prevY); prevY = l.y;   // farther is higher up the screen
      expect(r.x - l.x).toBeLessThan(prevHalf); prevHalf = r.x - l.x;
    }
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

  test("each model is a group of meshes about a unit across, centred", () => {
    for (const id of modelIds()) {
      const g = model(id);
      let meshes = 0;
      g.traverse((o: { isMesh?: boolean }) => { if (o.isMesh) meshes++; });
      expect(meshes).toBeGreaterThan(0);
      const box = new Box3().setFromObject(g);
      const size = box.getSize(new Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.5);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(2);
      const centre = box.getCenter(new Vector3());
      expect(Math.hypot(centre.x, centre.y, centre.z)).toBeLessThan(0.4);
    }
    expect(() => model("nope")).toThrow("no model for nope");
  });

  test("each call makes a new model, so two coins don't share one", () => {
    expect(model("d1")).not.toBe(model("d1"));
  });
});

describe("the runner model", () => {
  test("it stands on the ground, about as tall as it should be, in orange and black", () => {
    const r = runner();
    const box = new Box3().setFromObject(r.group);
    expect(box.min.y).toBeGreaterThan(-0.3); expect(box.min.y).toBeLessThan(0.1);
    expect(box.max.y).toBeGreaterThan(2.2); expect(box.max.y).toBeLessThan(2.8);
    const colours = new Set<number>();
    r.group.traverse((o: { material?: { color?: { getHex(): number } } }) => { if (o.material?.color) colours.add(o.material.color.getHex()); });
    expect(colours.has(COLORS.orange)).toBe(true); expect(colours.has(COLORS.ink)).toBe(true);
  });

  test("it swings its limbs against each other while running and stands still otherwise", () => {
    const r = runner();
    pose(r, Math.PI / 2, true);
    expect(r.legs[0].rotation.x).toBeCloseTo(-r.legs[1].rotation.x);
    expect(r.arms[0].rotation.x).toBeCloseTo(-r.legs[0].rotation.x);
    expect(Math.abs(r.legs[0].rotation.x)).toBeGreaterThan(0.5);
    pose(r, Math.PI / 2, false);
    expect([r.legs[0].rotation.x, r.arms[1].rotation.x, r.body.position.y]).toEqual([0, 0, 0]);
  });

  test("a picture replaces the face and taking it away brings the face back", () => {
    const r = runner();
    const eyes = () => r.face.parent.children.filter((c: { position: { z: number }; visible: boolean }) => c !== r.face && c.position.z > 0.3);
    expect(r.face.visible).toBe(false);
    setFace(r, {});
    expect(r.face.visible).toBe(true); expect(eyes().every((c: { visible: boolean }) => !c.visible)).toBe(true);
    setFace(r, null);
    expect(r.face.visible).toBe(false); expect(eyes().every((c: { visible: boolean }) => c.visible)).toBe(true);
  });
});

describe("the playhead", () => {
  const n = 10;
  test("q counts the commits gone by, and the note under the strum line is the last one passed", () => {
    expect([0, 0.9, 1, 1.5, 9.99, 10, 11, -3].map((q) => currentIndex(q, n))).toEqual([-1, -1, 0, 0, 8, 9, 9, -1]);
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

describe("the runner", () => {
  // Five hot-path commits: three small, then two big.
  const notes = buildNotes([1, 2, 3, 4, 5].map((d) => at(d, { added: [1, 1, 1, 90, 90][d - 1]! })));
  const hot = [0, 1, 2, 3, 4];
  test("pace is cold in a quiet stretch and hot in a busy one, between -1 and 1", () => {
    expect(paceAt(notes, hot, 2)).toBe(-1);
    expect(paceAt(notes, hot, 4)).toBeGreaterThan(0);
    for (let i = -1; i < 8; i++) { const p = paceAt(notes, hot, i); expect(p).toBeGreaterThanOrEqual(-1); expect(p).toBeLessThanOrEqual(1); }
    expect(paceAt(notes, hot, -1)).toBe(0);
    expect(paceAt(notes, [], 3)).toBe(0);
  });
  test("it pulls ahead when hot and falls back when cold, never behind the board's near edge", () => {
    expect(runnerOffset(1)).toBeGreaterThan(runnerOffset(0));
    expect(runnerOffset(0)).toBeGreaterThan(runnerOffset(-1));
    expect(runnerOffset(-1)).toBeGreaterThanOrEqual(-0.5);
    expect(runnerOffset(-99)).toBe(-0.5);
    expect(runnerOffset(1)).toBeLessThan(AHEAD);
  });
  test("it strides faster when hot", () => {
    expect(strideRate(1)).toBeGreaterThan(strideRate(-1));
    expect(strideRate(-1)).toBeGreaterThan(0);
    expect(strideRate(9)).toBe(strideRate(1));
  });
});

describe("words", () => {
  test("the clock is fixed-width, in UTC", () => {
    expect(formatClock(Date.UTC(2026, 9, 12, 22, 5))).toBe("2026-10-12 22:05");
    expect(formatClock(Date.UTC(2026, 0, 2, 3, 4))).toHaveLength(16);
    expect(formatAge(Date.UTC(2026, 0, 11), Date.UTC(2026, 0, 1))).toBe("0010d");
    expect(formatAge(0, 99)).toBe("0000d");
  });
});

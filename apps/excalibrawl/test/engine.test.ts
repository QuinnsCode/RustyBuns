import { describe, expect, test } from "bun:test";
import { actionsFor, clefRequest, decide, gridFor, sample, toOps, type Decision, type TurnInput } from "../src/engine/brain.ts";
import { finished, newMatch, playTurn, regionOf, scenesAt, type TurnDeps } from "../src/engine/match.ts";
import { encodePng, rasterize, snapshot } from "../src/engine/raster.ts";
import type { SkeletonEl } from "../src/engine/types.ts";

const region = { x: 350, y: 0, w: 350, h: 700 };
const blank = (over: Partial<TurnInput> = {}): TurnInput => ({ prompt: "a very long cat", turn: 1, turns: 20, scene: [], region, image: "data:image/png;base64,AA", ...over });
const head: SkeletonEl = { id: "1-1", type: "ellipse", x: 450, y: 100, width: 150, height: 120, backgroundColor: "#f08c00", strokeColor: "#1e1e1e", fillStyle: "solid" };
const ear: SkeletonEl = { id: "1-2", type: "line", x: 480, y: 110, points: [[0, 0], [20, -40], [40, 0], [0, 0]], backgroundColor: "#f08c00", fillStyle: "solid" };

/** Clef's reply that puts all its weight on these picks. */
function answers(pick: Record<string, string>, size = 2) {
  const choice = (k: string) => ({ type: "choice", choice: pick[k], probabilities: { [pick[k]!]: 1 } });
  return { answers: { ...Object.fromEntries(Object.keys(pick).map((k) => [k, choice(k)])), size: { type: "score", score: size } } };
}

describe("the picture Clef sees", () => {
  test("a PNG with the right size that inflates back to the pixels", async () => {
    const px = rasterize([head], region, 192, 384);
    const png = await encodePng(px, 192, 384);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([192, 384]);
    const idatLen = dv.getUint32(33);
    const idat = png.subarray(41, 41 + idatLen);
    const raw = new Uint8Array(await new Response(new Blob([idat as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    expect(raw.length).toBe(384 * (192 * 3 + 1));
  });

  test("fills inside, outlines the edge, leaves the rest white", () => {
    const s = 192 / 350;
    const px = rasterize([head], region, 192, 384);
    const at = (x: number, y: number) => [...px.subarray((Math.floor(y * s) * 192 + Math.floor((x - 350) * s)) * 3, (Math.floor(y * s) * 192 + Math.floor((x - 350) * s)) * 3 + 3)];
    expect(at(525, 160)).toEqual([0xf0, 0x8c, 0x00]); // the head's middle
    expect(at(451, 160)).toEqual([0x1e, 0x1e, 0x1e]); // its left edge
    expect(at(400, 600)).toEqual([255, 255, 255]);
  });

  test("a closed, filled line is a polygon", () => {
    const px = rasterize([ear], { x: 0, y: 0, w: 700, h: 700 }, 700, 700);
    const i = (90 * 700 + 500) * 3; // inside the ear
    expect([...px.subarray(i, i + 3)]).toEqual([0xf0, 0x8c, 0x00]);
  });

  test("a duel half is 192×384: about 75 of Clef's 32 px patches", async () => {
    const url = await snapshot([head, ear], region);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const png = Uint8Array.from(atob(url.split(",")[1]!), (c) => c.charCodeAt(0));
    const dv = new DataView(png.buffer);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([192, 384]);
  });
});

describe("the questions", () => {
  test("fit Clef's schema: 2–255 options a choice, 2–10 levels a score, the image attached", () => {
    const req = clefRequest("clef", blank({ scene: [head, ear], turn: 2 }));
    expect(req.model).toBe("clef");
    expect(req.images).toEqual(["data:image/png;base64,AA"]);
    expect(Object.keys(req.questions).length).toBeLessThanOrEqual(64);
    for (const q of Object.values(req.questions) as { type: string; criteria: unknown }[]) {
      const n = q.type === "score" ? (q.criteria as unknown[]).length : Object.keys(q.criteria as object).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(q.type === "score" ? 10 : 255);
    }
    expect(req.state).toContain("a very long cat");
    expect(req.state).toContain("1-1: large orange ellipse at col 4 row 3");
  });

  test("a blank canvas only adds, so there's no action or target question", () => {
    const req = clefRequest("clef", blank());
    expect(req.questions.action).toBeUndefined();
    expect(req.questions.target).toBeUndefined();
  });

  test("starting over is offered early with a few shapes down, never late", () => {
    const three = [head, ear, { ...head, id: "1-3" }];
    expect(actionsFor({ scene: three, turn: 5, turns: 20 })).toContain("restart");
    expect(actionsFor({ scene: three, turn: 15, turns: 20 })).not.toContain("restart");
    expect(actionsFor({ scene: [head], turn: 2, turns: 20 })).not.toContain("restart");
  });

  test("a duel half is a 6 × 12 grid", () => {
    expect(gridFor(region)).toEqual({ cols: 6, rows: 12 });
    expect(gridFor({ x: 0, y: 0, w: 700, h: 700 })).toEqual({ cols: 12, rows: 12 });
  });
});

describe("answers into ops", () => {
  const base: Decision = { action: "add", shape: "ellipse", color: "blue", col: 3, row: 6, size: 2, aspect: "square" };
  let n = 0;
  const id = () => `1-${++n}`;

  test("decide reads the answers", () => {
    const d = decide(answers({ shape: "dot", color: "black", col: "c2", row: "r3", aspect: "wide" }, 0.5), blank(), 0);
    expect(d).toEqual({ action: "add", target: undefined, shape: "dot", color: "black", col: 2, row: 3, size: 0.5, aspect: "wide" });
  });

  test("decide throws on answers that don't fit", () => {
    expect(() => decide(answers({ shape: "spaceship", color: "black", col: "c2", row: "r3", aspect: "wide" }), blank(), 0)).toThrow();
    expect(() => decide({}, blank())).toThrow("no answers");
  });

  test("sampling follows the probabilities, and temperature 0 takes the top pick", () => {
    const a = { choice: "a", probabilities: { a: 0.6, b: 0.4 } };
    expect(sample(a, ["a", "b"], 0, () => 0.99)).toBe("a");
    expect(sample(a, ["a", "b"], 1, () => 0.99)).toBe("b");
    expect(sample(a, ["a", "b"], 1, () => 0.1)).toBe("a");
  });

  test("add places the centre in its grid cell", () => {
    const [op] = toOps(base, [], region, id);
    expect(op!.op).toBe("add");
    const el = (op as { element: SkeletonEl & { width: number; height: number } }).element;
    expect(el.x + el.width / 2).toBeCloseTo(350 + (2.5 / 6) * 350);
    expect(el.y + el.height / 2).toBeCloseTo((5.5 / 12) * 700);
    expect(el.backgroundColor).toBe("#1971c2");
  });

  test("move, recolour, resize and delete act on the target", () => {
    expect(toOps({ ...base, action: "delete", target: "1-1" }, [head], region, id)).toEqual([{ op: "delete", id: "1-1" }]);
    expect(toOps({ ...base, action: "recolor", target: "1-1", color: "red" }, [head], region, id)).toEqual([{ op: "update", id: "1-1", patch: { backgroundColor: "#e03131" } }]);
    const [mv] = toOps({ ...base, action: "move", target: "1-1" }, [head], region, id);
    expect(mv).toMatchObject({ op: "update", id: "1-1" });
    const [rs] = toOps({ ...base, action: "resize", target: "1-2", size: 4 }, [ear], region, id);
    expect((rs as { patch: { points: number[][] } }).patch.points.length).toBe(4);
  });

  test("an edit with no target adds instead; restart deletes everything", () => {
    expect(toOps({ ...base, action: "move" }, [head], region, id)[0]!.op).toBe("add");
    expect(toOps({ ...base, action: "restart" }, [head, ear], region, id)).toEqual([{ op: "delete", id: "1-1" }, { op: "delete", id: "1-2" }]);
  });
});

describe("a fight", () => {
  const fake = (pick: Record<string, string>, budget = Infinity): TurnDeps & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return { calls, run: async (_m, input) => (calls.push(input), answers(pick)), take: async () => calls.length < budget, temperature: 0 };
  };

  test("plays every turn for both fighters, and the log replays to the same canvases", async () => {
    const m = newMatch("m-1", "a very long cat", [{ model: "clef", name: "Clef" }, { model: "clef-flash", name: "Clef Flash" }], 4, 0);
    const deps = fake({ action: "add", target: "none", shape: "rectangle", color: "green", col: "c3", row: "r4", aspect: "wide" });
    while (!finished(m)) await playTurn(m, deps);
    expect(deps.calls.length).toBe(8);
    expect(m.scenes.map((s) => s.length)).toEqual([4, 4]);
    expect(scenesAt(m)).toEqual(m.scenes);
    expect(scenesAt(m, 2).map((s) => s.length)).toEqual([2, 2]);
    // each side stays in its half
    for (const el of m.scenes[1]!) expect(el.x).toBeGreaterThanOrEqual(regionOf(m, 1).x);
  });

  test("past the budget a fighter sits out the turn, and a bad answer costs only that turn", async () => {
    const m = newMatch("m-2", "x", [{ model: "clef", name: "Clef" }], 3, 0);
    const deps = fake({ shape: "dot", color: "black", col: "c1", row: "r1", aspect: "square" }, 1);
    await playTurn(m, deps);
    const [spent] = await playTurn(m, deps);
    expect(spent!.error).toBe("daily budget spent");
    const [bad] = await playTurn(m, { ...deps, take: async () => true, run: async () => ({ answers: {} }) });
    expect(bad!.error).toBeTruthy();
    expect(m.scenes[0]!.length).toBe(1);
    expect(finished(m)).toBe(true);
  });
});

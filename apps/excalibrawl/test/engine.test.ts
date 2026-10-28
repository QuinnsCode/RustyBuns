import { describe, expect, test } from "bun:test";
import { actionsFor, clefRequest, decide, gridFor, sample, toOps, type Decision, type TurnInput } from "../src/engine/brain.ts";
import { JUDGE, winnerOf } from "../src/engine/judge.ts";
import { MODELS, PEN_EVERY, finished, judgeMatch, newMatch, playTurn, regionOf, scenesAt, type TurnDeps } from "../src/engine/match.ts";
import { parsePlan } from "../src/engine/plan.ts";
import { penTurn } from "../src/engine/pen.ts";
import { encodePng, rasterize, snapshot } from "../src/engine/raster.ts";
import { applyOps } from "../src/engine/ops.ts";
import type { Op, SkeletonEl } from "../src/engine/types.ts";

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

  test("a t line draws glyphs, not one filled rectangle (#1001)", () => {
    // fontSize 50 at 1:1 is a 5 px unit: "HI" sits at x 0-60, its glyph rows at y 7.5-42.5.
    const title = penTurn("t title 30 25 50 HI", new Map(), { x: 0, y: 0, w: 200, h: 100 }, "1").scene.get("1title")!;
    if (title.type !== "text") throw new Error(`"t" drew a ${title.type}, not text`);
    const px = rasterize([{ ...title, x: 0, y: 0 }], { x: 0, y: 0, w: 200, h: 100 }, 200, 100);
    const inked = (x: number, y: number) => px[(y * 200 + x) * 3] !== 255;
    const ink = Array.from({ length: 100 }, (_, y) => Array.from({ length: 200 }, (_, x) => inked(x, y)));
    const count = ink.flat().filter(Boolean).length;
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(60 * 35 * 0.6);
    expect(inked(2, 25)).toBe(true); // H's left stem
    expect(inked(12, 12)).toBe(false); // the gap above H's crossbar
    expect(inked(12, 25)).toBe(true); // the crossbar
    expect(inked(42, 12)).toBe(true); // I's stem
    expect(inked(32, 25)).toBe(false); // between H and I's stem
    // Lower case reads the same as upper case.
    const lower = rasterize([{ ...title, x: 0, y: 0, text: "hi" }], { x: 0, y: 0, w: 200, h: 100 }, 200, 100);
    expect(lower).toEqual(px);
  });

  test("text stays legible when shrunk below 2 px a unit", () => {
    const px = rasterize([{ id: "t", type: "text", x: 0, y: 0, text: "HELLO", fontSize: 10 }], { x: 0, y: 0, w: 40, h: 12 }, 40, 12);
    const count = [...Array(40 * 12).keys()].filter((i) => px[i * 3] !== 255).length;
    expect(count).toBeGreaterThan(40);
    expect(count).toBeLessThan(30 * 7);
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

  test("no deleting or calling it done while the plan has parts left, or with little on the canvas", () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ ...head, id: `1-${n}` }));
    const plan = [{ part: "body", shape: "ellipse" as const, color: "orange" as const, where: "center" as const, size: 3, aspect: "wide" as const }];
    expect(actionsFor({ scene: five, turn: 20, turns: 36, plan, done: 0 })).not.toContain("delete");
    expect(actionsFor({ scene: five, turn: 20, turns: 36, plan, done: 0 })).not.toContain("pass");
    expect(actionsFor({ scene: five, turn: 20, turns: 36, plan, done: 1 })).toEqual(expect.arrayContaining(["delete", "pass"]));
    expect(actionsFor({ scene: five.slice(0, 3), turn: 20, turns: 36 })).toEqual(["add", "move", "recolor", "resize", "pass"]);
    expect(toOps({ action: "pass", shape: "dot", color: "black", col: 1, row: 1, size: 0, aspect: "square" }, five, region, () => "x")).toEqual([]);
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

describe("pen fighters in the arena", () => {
  const pens = [{ model: "gpt-oss-20b" as const, name: "GPT-OSS 20B" }, { model: "scout" as const, name: "Llama 4 Scout" }];

  test(`play every ${PEN_EVERY}rd turn in one conversation, sit out after done, and replay to the same canvases`, async () => {
    const m = newMatch("m-4", "a box", pens, 9, 0);
    const seen: { model: string; messages: unknown[] }[] = [];
    const replies: Record<string, string[]> = {
      [MODELS["gpt-oss-20b"].id]: ["b a 50 50 40 40 red", "mv a 500 0\nb b a.bottom 20 20 blue", "done"],
      [MODELS.scout.id]: ["o a 100 100 60 60 green\ndone"],
    };
    let plans = 0;
    const deps: TurnDeps = {
      run: async (model, input) => {
        const { messages } = input as { messages: unknown[] };
        seen.push({ model, messages: structuredClone(messages) });
        return { response: replies[model]!.shift() ?? "" };
      },
      take: async () => true,
      plan: async () => (plans++, []),
    };
    while (!finished(m)) await playTurn(m, deps);
    expect(plans).toBe(0);
    expect(m.log.map((e) => `${e.turn}:${e.side}`)).toEqual(["1:0", "1:1", "4:0", "7:0"]);
    expect(m.log[1]!.pen).toEqual({ lines: 1, skipped: 0, done: true });
    expect(seen.filter((s) => s.model === MODELS.scout.id).length).toBe(1);
    // its third call carries both earlier turns, and the card names its half of the canvas
    const third = seen.filter((s) => s.model === MODELS["gpt-oss-20b"].id)[2]!.messages;
    expect(third.length).toBe(6);
    expect(JSON.stringify(third[0])).toContain("canvas 350×700");
    expect(JSON.stringify(third[1])).toContain("Turn 1 of 3");
    // mv was clamped into the left half, and the log records where it landed
    expect(m.scenes[0]!.map((e) => e.id)).toEqual(["0-a", "0-b"]);
    expect(m.scenes[0]![0]!.x + (m.scenes[0]![0] as { width: number }).width).toBeLessThanOrEqual(350);
    expect(scenesAt(m)).toEqual(m.scenes);
    expect(m.scenes[1]![0]!.x).toBeGreaterThanOrEqual(350);
  });

  test("a failed pen call costs that turn, keeping what's drawn", async () => {
    const m = newMatch("m-5", "a box", [pens[0]!], 6, 0);
    let n = 0;
    const deps: TurnDeps = { run: async () => { if (n++ === 1) throw new Error("timeout"); return { response: "b a 50 50 40 40 red" }; }, take: async () => true };
    while (!finished(m)) await playTurn(m, deps);
    expect(m.log.map((e) => e.error ?? e.pen?.lines)).toEqual([1, "timeout"]);
    expect(m.scenes[0]!.length).toBe(1);
  });

  test("a Clef can fight a pen fighter: only the Clef plans, and both play their turns", async () => {
    const m = newMatch("m-6", "a box", [{ model: "clef", name: "Clef" }, pens[0]!], 3, 0);
    let plans = 0;
    const deps: TurnDeps = {
      run: async (_m, input) => ((input as { messages?: unknown }).messages ? { response: "b a 50 50 40 40 red" } : answers({ shape: "dot", color: "black", col: "c1", row: "r1", aspect: "square" })),
      take: async () => true,
      plan: async () => (plans++, []),
      temperature: 0,
    };
    while (!finished(m)) await playTurn(m, deps);
    expect(plans).toBe(1);
    expect(m.log.filter((e) => e.side === 0).length).toBe(3);
    expect(m.log.filter((e) => e.side === 1).length).toBe(1);
  });
});

describe("Clef the referee", () => {
  test("scores each side once from its own half, and names the winner", async () => {
    const m = newMatch("m-7", "a very long cat", [{ model: "clef", name: "Clef" }, { model: "clef-flash", name: "Clef Flash" }], 1, 0);
    m.scenes = [[head], [{ ...head, id: "1-1", x: 450 }]];
    const calls: { model: string; input: { state: string; images: string[] } }[] = [];
    // Both sides are judged at once, so score by whose half the picture shows, not by call order.
    const halves = await Promise.all(m.scenes.map((scene, side) => snapshot(scene, regionOf(m, side))));
    expect(halves[0]).not.toBe(halves[1]);
    const deps = {
      run: async (model: string, input: unknown) => {
        const call = { model, input: input as (typeof calls)[number]["input"] };
        calls.push(call);
        return { answers: { likeness: { score: [1, 3][halves.indexOf(call.input.images[0]!)] }, craft: { score: 2 } } };
      },
      take: async () => true,
    };
    await judgeMatch(m, deps);
    await judgeMatch(m, deps); // a retry doesn't judge again
    expect(calls.length).toBe(2);
    expect(calls[0]!.model).toBe(JUDGE);
    expect(calls[0]!.input.state).toContain("a very long cat");
    expect(calls[0]!.input.images[0]).toStartWith("data:image/png;base64,");
    expect(m.scores).toEqual([{ likeness: 1, craft: 2 }, { likeness: 3, craft: 2 }]);
    expect(m.winner).toBe(1);
  });

  test("an empty canvas, a spent budget or a failed call isn't scored", async () => {
    const m = newMatch("m-8", "x", [{ model: "clef", name: "Clef" }, { model: "clef-flash", name: "Clef Flash" }], 1, 0);
    m.scenes = [[head], []];
    await judgeMatch(m, { run: async () => { throw new Error("down"); }, take: async () => true });
    expect(m.scores).toEqual([null, null]);
    expect(m.winner).toBe(-1);
  });

  test("the winner has the best likeness + craft; a tie has none", () => {
    expect(winnerOf([{ likeness: 2, craft: 1 }, { likeness: 1, craft: 1.5 }])).toBe(0);
    expect(winnerOf([{ likeness: 2, craft: 1 }, { likeness: 1, craft: 2 }])).toBe(-1);
    expect(winnerOf([null, { likeness: 0, craft: 0 }])).toBe(1);
    expect(winnerOf([{ likeness: NaN, craft: 1 }, null])).toBe(-1);
  });
});

describe("the planner", () => {
  const reply = { response: '{"parts":[{"part":"body","shape":"ellipse","color":"orange","where":"center","size":"large","aspect":"wide"},{"part":"head","shape":"Ellipse","color":"Orange","where":"top-left","size":"medium","aspect":"square"},{"part":"laser","shape":"laser beam","color":"red","where":"top","size":"small"},{"part":"eye","shape":"dot","color":"black","where":"top-left","size":"tiny"}]}' };

  test("keeps the steps in Clef's vocabulary and drops the rest", () => {
    const plan = parsePlan(reply);
    expect(plan.map((s) => s.part)).toEqual(["body", "head", "eye"]);
    expect(plan[0]).toEqual({ part: "body", shape: "ellipse", color: "orange", where: "center", size: 3, aspect: "wide" });
    expect(plan[2]!.aspect).toBe("square"); // left out: the default
    expect(parsePlan({ response: "I'd draw a cat!" })).toEqual([]);
  });

  test("Clef is offered the next step, and drawing it takes the plan's shape and colour", () => {
    const plan = parsePlan(reply);
    const t = blank({ plan, done: 1, scene: [head] });
    expect(actionsFor(t)[0]).toBe("next");
    const req = clefRequest("clef", t);
    expect(req.state).toContain("1. body: large orange ellipse, wide, center (drawn); 2. head: medium orange ellipse, square, top-left (next)");
    expect((req.questions.action as { criteria: Record<string, string> }).criteria.next).toContain("head");
    const d = decide(answers({ action: "next", target: "none", shape: "rectangle", color: "blue", col: "c2", row: "r3", aspect: "wide" }, 3), t, 0);
    expect(d).toMatchObject({ action: "next", shape: "ellipse", color: "orange", aspect: "square", col: 2, row: 3, size: 2.5, step: 1, part: "head" });
    expect(toOps(d, [head], region, () => "1-9")[0]!.op).toBe("add");
  });

  test("a finished plan isn't offered again", () => {
    expect(actionsFor(blank({ plan: parsePlan(reply), done: 3, scene: [head] }))).not.toContain("next");
  });

  test("a fight plans once, then works through the plan", async () => {
    const m = newMatch("m-3", "a very long cat", [{ model: "clef", name: "Clef" }], 4, 0);
    let plans = 0;
    const deps: TurnDeps = {
      // like Clef, it only picks what it's offered: the next step while there is one
      run: async (_m, input) => {
        const offered = (input as { questions: { action?: { criteria: object } } }).questions.action?.criteria ?? {};
        return answers({ action: "next" in offered ? "next" : "add", target: "none", shape: "dot", color: "black", col: "c2", row: "r3", aspect: "wide" });
      },
      take: async () => true,
      plan: async () => (plans++, parsePlan(reply)),
      temperature: 0,
    };
    while (!finished(m)) await playTurn(m, deps);
    expect(plans).toBe(1);
    expect(m.done).toEqual([3]);
    expect(m.log.map((e) => e.decision?.part ?? e.decision?.action)).toEqual(["body", "head", "eye", "add"]);
  });
});

describe("elements a fighter adds", () => {
  const region = { x: 0, y: 0, w: 100, h: 100 };
  test.each([
    ["a box without a size", { id: "a", type: "rectangle", x: 1, y: 1 }],
    ["a line with one point", { id: "a", type: "line", x: 1, y: 1, points: [[0, 0]] }],
    ["a position that isn't finite", { id: "a", type: "ellipse", x: Number.NaN, y: 1, width: 5, height: 5 }],
    ["a type nobody draws", { id: "a", type: "star", x: 1, y: 1 }],
  ])("%s is rejected", (_, element) => {
    const r = applyOps(new Map(), [{ op: "add", element } as Op], region);
    expect(r.rejected.map((x) => x.reason)).toEqual(["invalid element shape"]);
  });
  test("a good box lands, junk fields dropped and a bad colour left off", () => {
    const element = { id: "a", type: "rectangle", x: 1, y: 1, width: 5, height: 5, strokeColor: "red", evil: 1 };
    const r = applyOps(new Map(), [{ op: "add", element } as Op], region);
    expect(r.scene.get("a")).toEqual({ id: "a", type: "rectangle", x: 1, y: 1, width: 5, height: 5 });
  });
});

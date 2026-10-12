import { describe, expect, test } from "bun:test";
import { PEN_LINES, penCard, penScene, penTurn } from "../src/engine/pen.ts";
import type { BoxEl, LinearEl, Scene, TextEl } from "../src/engine/types.ts";
import { penFight } from "../src/lab/pen.ts";

const full = { x: 0, y: 0, w: 700, h: 700 };
const right = { x: 350, y: 0, w: 350, h: 700 };
const empty = (): Scene => new Map();
const draw = (text: string, scene = empty(), region = full, prefix = "0-") => penTurn(text, scene, region, prefix);
const box = (s: Scene, id: string) => s.get(id) as BoxEl;

const CAT = `o body 350 430 300 170 orange
o head body.top-90,-40 150 130 orange
p earL orange head.top-50,10 head.top-35,-45 head.top-5,5
p earR orange head.top+5,5 head.top+35,-45 head.top+50,10
o eyeL head.c-28,-8 16 16 black
o eyeR head.c+28,-8 16 16 black
l tail black body.right 430,300 470,250`;

describe("the card", () => {
  test("names the canvas, and only offers look to a fighter that can see", () => {
    expect(penCard(full, true)).toContain("canvas 700×700");
    expect(penCard(full, true)).toContain("look →");
    expect(penCard(right, false)).toContain("canvas 350×700");
    expect(penCard(right, false)).not.toContain("look");
  });

  test("is about 200 tokens", () => {
    expect(penCard(full, true).length / 4).toBeLessThan(260);
  });
});

describe("shapes", () => {
  test("o, b and d are centred at X Y, black-outlined over a solid fill", () => {
    const { scene, skipped } = draw("o a 100 100 40 20 red\nb b 200 200 60 60 #123456\nd c 300 300 10 10 green");
    expect(skipped).toEqual([]);
    expect(box(scene, "0-a")).toMatchObject({ type: "ellipse", x: 80, y: 90, width: 40, height: 20, backgroundColor: "#e03131", strokeColor: "#1e1e1e", fillStyle: "solid" });
    expect(box(scene, "0-b")).toMatchObject({ type: "rectangle", x: 170, y: 170, backgroundColor: "#123456" });
    expect(box(scene, "0-c").type).toBe("diamond");
  });

  test("p is a closed, filled line; l is an open stroke in its colour", () => {
    const { scene } = draw("p roof red 100,100 150,50 200,100\nl tail blue 10,10 40,20");
    const roof = scene.get("0-roof") as LinearEl;
    expect(roof).toMatchObject({ type: "line", x: 100, y: 100, backgroundColor: "#e03131", strokeColor: "#1e1e1e" });
    expect(roof.points).toEqual([[0, 0], [50, -50], [100, 0], [0, 0]]);
    const tail = scene.get("0-tail") as LinearEl;
    expect(tail).toMatchObject({ strokeColor: "#1971c2", strokeWidth: 4, points: [[0, 0], [30, 10]] });
    expect(tail.backgroundColor).toBeUndefined();
  });

  test("t is text centred at X Y, size clamped", () => {
    const { scene } = draw("t hi 350 50 30 hello there\nt big 350 300 500 X");
    expect(scene.get("0-hi")).toMatchObject({ type: "text", text: "hello there", fontSize: 30 });
    expect((scene.get("0-big") as TextEl).fontSize).toBe(96);
  });

  test("coordinates are the fighter's own: a right-half fighter's 0,0 is the region's corner", () => {
    const { scene } = draw("b a 50 50 20 20 red", empty(), right, "1-");
    expect(box(scene, "1-a")).toMatchObject({ x: 390, y: 40 });
  });

  test("off-canvas shapes are pulled back into the region", () => {
    const { scene } = draw("b a 690 10 100 100 red", empty(), right, "1-");
    const a = box(scene, "1-a");
    expect(a.x + a.width).toBeLessThanOrEqual(700);
    expect(a.y).toBeGreaterThanOrEqual(0);
  });

  test("a name drawn again is redrawn, on top", () => {
    const first = draw("o a 100 100 20 20 red\no b 200 200 20 20 red");
    const r = draw("o a 300 300 50 50 blue", first.scene);
    expect([...r.scene.keys()]).toEqual(["0-b", "0-a"]);
    expect(box(r.scene, "0-a")).toMatchObject({ x: 275, backgroundColor: "#1971c2" });
    expect(r.edits).toBe(1);
  });
});

describe("anchors", () => {
  test("sit on the bounding box: top, bottom, left, right, c", () => {
    const { scene, skipped } = draw(`b base 300 300 200 100 red
o t base.top 10 10 black
o bo base.bottom 10 10 black
o le base.left 10 10 black
o ri base.right 10 10 black
o ce base.c 10 10 black`);
    expect(skipped).toEqual([]);
    const at = (id: string) => [box(scene, id).x + 5, box(scene, id).y + 5];
    expect(at("0-t")).toEqual([300, 250]);
    expect(at("0-bo")).toEqual([300, 350]);
    expect(at("0-le")).toEqual([200, 300]);
    expect(at("0-ri")).toEqual([400, 300]);
    expect(at("0-ce")).toEqual([300, 300]);
  });

  test("nudges: head.top-30,10 is 30 left and 10 down", () => {
    const { scene } = draw("b head 300 300 100 100 red\no dot head.top-30,10 10 10 black\no dot2 head.top+30,-10 10 10 black");
    expect(box(scene, "0-dot")).toMatchObject({ x: 265, y: 255 });
    expect(box(scene, "0-dot2")).toMatchObject({ x: 325, y: 235 });
  });

  test("follow where a shape actually landed, after clamping", () => {
    const { scene } = draw("b a 10 10 100 100 red\no b a.c 10 10 black");
    expect(box(scene, "0-b")).toMatchObject({ x: 45, y: 45 });
  });

  test("work in polygon and stroke points too", () => {
    const { scene } = draw("o body 350 430 300 170 orange\nl tail black body.right 600,300");
    expect(scene.get("0-tail")).toMatchObject({ x: 500, y: 430, points: [[0, 0], [100, -130]] });
  });

  test("a whole cat in 7 lines", () => {
    const r = draw(CAT);
    expect(r.skipped).toEqual([]);
    expect(r.lines).toBe(7);
    expect([...r.scene.keys()]).toEqual(["0-body", "0-head", "0-earL", "0-earR", "0-eyeL", "0-eyeR", "0-tail"]);
    // the head sits on the body's top, nudged up and left
    expect(box(r.scene, "0-head")).toMatchObject({ x: 185, y: 240, width: 150, height: 130 });
  });

  test("an unknown name skips just that line", () => {
    const r = draw("o a 100 100 20 20 red\no b nope.top 10 10 black\no c a.c 10 10 black");
    expect(r.skipped).toEqual([{ line: "o b nope.top 10 10 black", reason: "no shape named nope" }]);
    expect([...r.scene.keys()]).toEqual(["0-a", "0-c"]);
  });

  test("don't reach another fighter's shapes", () => {
    const left = draw("o head 100 100 50 50 red", empty(), full, "0-");
    const r = draw("o hat head.top 10 10 black", left.scene, full, "1-");
    expect(r.skipped[0]!.reason).toBe("no shape named head");
  });
});

describe("edits", () => {
  const base = () => draw("b a 100 100 40 40 red\nl s blue 10,10 30,10\nt w 300 300 20 hi\no b 400 400 20 20 green").scene;

  test("mv moves by DX DY", () => {
    expect(box(draw("mv a 10 -20", base()).scene, "0-a")).toMatchObject({ x: 90, y: 60 });
  });

  test("sz resizes about the centre; strokes scale their points; text takes H as its size", () => {
    const r = draw("sz a 100 20\nsz s 40 10\nsz w 40 40", base());
    expect(box(r.scene, "0-a")).toMatchObject({ x: 50, y: 90, width: 100, height: 20 });
    expect(r.scene.get("0-s")).toMatchObject({ x: 0, y: 10, points: [[0, 0], [40, 0]] });
    expect((r.scene.get("0-w") as TextEl).fontSize).toBe(40);
  });

  test("fill recolours the fill, or a stroke's line", () => {
    const r = draw("fill a blue\nfill s red", base());
    expect(box(r.scene, "0-a")).toMatchObject({ backgroundColor: "#1971c2", strokeColor: "#1e1e1e" });
    expect(r.scene.get("0-s")).toMatchObject({ strokeColor: "#e03131" });
  });

  test("rm removes, up brings to the front", () => {
    const r = draw("rm s\nup a", base());
    expect([...r.scene.keys()]).toEqual(["0-w", "0-b", "0-a"]);
    expect(r.edits).toBe(2);
  });

  test("edits of a missing shape are skipped", () => {
    expect(draw("mv ghost 1 1", base()).skipped[0]!.reason).toBe("no shape named ghost");
  });
});

describe("what models write anyway", () => {
  test("points as bare X Y pairs, sizes as W,H, hyphenated names, a few more colours", () => {
    const r = draw("l tail black 150 350 100 300\no bun-top 350,310 80,40 pink\no dot bun-top.c 4 4 brown\np hat grey 1,1 20 20 1,20");
    expect(r.skipped).toEqual([]);
    expect(r.scene.get("0-tail")).toMatchObject({ x: 150, y: 350, points: [[0, 0], [-50, -50]] });
    expect(box(r.scene, "0-bun-top")).toMatchObject({ x: 310, y: 290, width: 80, height: 40, backgroundColor: "#f783ac" });
    expect(box(r.scene, "0-dot")).toMatchObject({ x: 348, y: 308 });
    expect((r.scene.get("0-hat") as LinearEl).points.length).toBe(4);
  });

  test("a nudge with only DX", () => {
    const { scene } = draw("b head 300 300 100 100 red\no dot head.left+15 10 10 black");
    expect(box(scene, "0-dot")).toMatchObject({ x: 260, y: 295 });
  });

  test("an odd bare number is still a bad point", () => {
    expect(draw("l s black 1 2 3").skipped[0]!.reason).toBe(`bad point "3"`);
  });
});

describe("a turn", () => {
  test(`stops at ${PEN_LINES} drawing lines; look, done and chatter don't count`, () => {
    const lines = Array.from({ length: 10 }, (_, i) => `o s${i} ${50 + i * 50} 100 20 20 red`);
    const r = draw(["Here's my drawing:", "```", ...lines, "look", "done", "```"].join("\n"));
    expect(r.lines).toBe(PEN_LINES);
    expect(r.scene.size).toBe(PEN_LINES);
    expect(r.look).toBe(true);
    expect(r.done).toBe(true);
    expect(r.skipped.map((s) => s.reason)).toEqual([`unknown command "Here's"`, "over the 8-line cap", "over the 8-line cap"]);
  });

  test("bad lines are skipped with a reason, the rest still draw", () => {
    const r = draw(`o a 100 100 20 20 mauve
o b 100 100 0 20 red
o c 100 x 20 20 red
p d red 1,1 2,2
l e red 1,1
o 9x 1 1 1 1 red
q f 1 1
o ok 100 100 20 20 red`);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      `unknown colour "mauve"`,
      "W and H must be more than 0",
      `bad number "x"`,
      "a polygon needs 3 points",
      "a stroke needs 2 points",
      `bad name "9x"`,
      `unknown command "q"`,
    ]);
    expect([...r.scene.keys()]).toEqual(["0-ok"]);
  });

  test("leaves the scene it was given alone", () => {
    const before = draw("o a 100 100 20 20 red").scene;
    draw("rm a", before);
    expect(before.has("0-a")).toBe(true);
  });

  test("tolerates list markers and backticks", () => {
    expect(draw("- o a 100 100 20 20 red\n`o b 200 200 20 20 red`").lines).toBe(2);
  });
});

describe("the scene, written back", () => {
  test("is pen lines that redraw the same shapes", () => {
    const r = draw(CAT);
    const listed = penScene(r.scene, full, "0-");
    expect(listed.split("\n")[0]).toBe("o body 350 430 300 170 orange");
    expect(listed).toContain("p earL orange ");
    const again = draw(listed);
    expect(again.skipped).toEqual([]);
    expect(penScene(again.scene, full, "0-")).toBe(listed);
  });

  test("lists only this fighter's shapes, in its own coordinates", () => {
    const r = draw("b a 50 50 20 20 red", empty(), right, "1-");
    const both = draw("b mine 10 10 4 4 blue", r.scene, full, "0-").scene;
    expect(penScene(both, right, "1-")).toBe("b a 50 50 20 20 red");
  });
});

describe("a pen fighter", () => {
  const replies = (rs: string[]) => {
    const seen: { messages: { role: string; content: unknown }[] }[] = [];
    const run = async (_m: string, input: unknown) => {
      seen.push(structuredClone(input) as (typeof seen)[number]);
      return { response: rs[seen.length - 1] ?? "" };
    };
    return { run, seen };
  };
  const images = (msgs: { content: unknown }[]) => msgs.filter((m) => Array.isArray(m.content) && m.content.some((p: { type: string }) => p.type === "image_url")).length;

  test("plays turns, sees its shapes and skips, looks when it asks, stops at done", async () => {
    const { run, seen } = replies(["o body 350 430 300 170 orange\nlook", "o head body.top 150 130 orange\no x nope.c 1 1 red\nlook", "fill head red\ndone", "never asked"]);
    const { scene, stats, errors } = await penFight(run, { model: "m", canLook: true, maxTokens: 100 }, "a cat", full, 6);
    expect(errors).toEqual([]);
    expect(seen.length).toBe(3);
    expect(stats).toMatchObject({ turns: 3, lines: 3, edits: 1, looks: 2, doneAt: 3 });
    expect(stats.skipped).toEqual(["turn 2: o x nope.c 1 1 red → no shape named nope"]);
    expect([...scene.keys()]).toEqual(["0-body", "0-head"]);
    expect(seen[0]!.messages[0]!.content).toContain("EXCALIDRAW PEN");
    const last = seen[2]!.messages;
    expect(JSON.stringify(last.at(-1))).toContain("o head 350 345 150 130 orange");
    expect(JSON.stringify(last.at(-1))).toContain("no shape named nope");
    // only the newest message carries the picture
    expect(images(last)).toBe(1);
    expect(images(seen[1]!.messages)).toBe(1);
  });

  test("a reasoning model with no answer draws nothing, and its thinking stays out of the conversation", async () => {
    const { run, seen } = replies([]);
    const out = await penFight(async (m, i) => (await run(m, i), { choices: [{ message: { content: null, reasoning_content: "o a 1 1 1 1 red" } }] }), { model: "m", canLook: false, maxTokens: 100 }, "a box", full, 2);
    expect(out.scene.size).toBe(0);
    expect(seen[1]!.messages.at(-2)).toEqual({ role: "assistant", content: "(nothing)" });
  });

  test("a blind fighter's look is ignored, and a failed call keeps what's drawn", async () => {
    let n = 0;
    const run = async () => {
      if (n++) throw new Error("timeout");
      return { response: "b a 100 100 50 50 red\nlook" };
    };
    const { scene, stats, errors } = await penFight(run, { model: "m", canLook: false, maxTokens: 100 }, "a box", full, 3);
    expect(scene.size).toBe(1);
    expect(stats.looks).toBe(0);
    expect(errors).toEqual(["turn 2: timeout"]);
  });
});

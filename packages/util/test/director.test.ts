import { expect, test } from "bun:test";
import { Director, playNamed, sceneLink, type Scene } from "../src/director.ts";

const credits: Scene = {
  id: "credits", seconds: 10, skip: true, hold: true, lines: [[1, "Narrator: The end."]],
  cards: [[0.5, 10, { kind: "strip", text: "Thank you" }]],
  photos: [[4, { id: "a", caption: "Take 1" }], [6, { id: "b", caption: "Take 2" }]],
};
const run = (d: Director, s: number, skip = false) => { for (let i = 0; i < Math.round(s * 60); i++) d.step(1 / 60, skip && i === 0); return d.frame; };

test("a scene by name: held at a second, let go, then a key cuts to the end and it ends once", () => {
  const d = new Director(0.4, 0.6);
  expect(playNamed(d, { credits: () => credits }, "nope", null)).toBe(false);
  expect(playNamed(d, { credits: () => credits }, "credits", null, 6.3)).toBe(true);
  // Held: the strip on and typed for 5.8 s, the first photo landed, the second still falling.
  let f = run(d, 2);
  expect(f.t).toBeCloseTo(6.3);
  expect(f.line).toEqual({ who: "Narrator", text: "The end." });
  expect(f.cards).toEqual([{ card: credits.cards![0]![2], in: 1, since: expect.closeTo(5.8) }]);
  expect(f.photos.map((p) => [p.photo.id, +p.drop.toFixed(2)])).toEqual([["a", 1], ["b", expect.any(Number)]]);
  expect(f.photos[1]!.drop).toBeLessThan(1);
  // Let go: a key cuts to the fade, and the scene ends once.
  d.paused = false;
  f = run(d, 0.1, true);
  expect(f.out).toBeLessThan(1);
  let ended = 0;
  for (let i = 0; i < 60; i++) if (d.step(1 / 60).ended?.id === "credits") ended++;
  expect(ended).toBe(1);
  expect(d.beat).toBeNull();
});

test("the link: a scene and the second to hold", () => {
  const cases: [string, ReturnType<typeof sceneLink>][] = [
    ["?scene=credits&t=18", { name: "credits", t: 18 }],
    ["?scene=credits", { name: "credits", t: null }],
    ["?scene=credits&t=soon", { name: "credits", t: null }],
    ["?a=1", null],
  ];
  for (const [q, want] of cases) expect(sceneLink(q)).toEqual(want);
});

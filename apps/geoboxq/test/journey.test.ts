import { afterEach, expect, test } from "bun:test";
import { solve } from "../src/engine.ts";
import { THEMES, parts, sceneSvg, shapeSvg } from "../src/viz.ts";
import { example, group, parseRows, toInput, usableBoxes, verdict } from "../src/model.ts";
import { forgetLease } from "@rustybuns/seal";
import { MAX_BODY, handle } from "../src/worker.ts";

afterEach(forgetLease);

// The first page a visitor sees: the small shipper takes the gift tin only when the candles ride inside it.
test("the example fits the small box only by packing a box in a box", async () => {
  const s = example();
  const nested = await solve(...(Object.values(toInput(s)) as [never, never, number]));
  expect(nested.boxes.map((b) => b.fits)).toEqual([true, true, true]);
  expect(nested.nested).toBe(3); // two candles and the matchbook, all in the tin
  expect(group(nested.pieces)).toMatchObject([{ name: "Gift tin", count: 1, inside: [{ name: "Candle", count: 2 }, { name: "Matchbook" }] }]);
  expect(verdict(nested)).toMatchObject({ kind: "fits", box: "Small" });

  // What shipping software does: every product solid. The same order needs the medium box.
  const solid = toInput({ ...s, nest: false });
  const flat = await solve(solid.boxes, solid.items, solid.pad);
  expect(flat.boxes.map((b) => b.fits)).toEqual([false, true, true]);
  expect(verdict(flat)).toMatchObject({ kind: "fits", box: "Medium" });
  expect(flat.nested).toBe(0);
});

test("a chain of three boxes nests as a chain, in any order, and nothing is placed twice", async () => {
  const doll = (name: string, d: number) => ({ name, l: d, w: d, h: d, wall: 0.5 });
  const dolls = [doll("small", 3), doll("large", 7), doll("medium", 5), { name: "seed", l: 1, w: 1, h: 1 }];
  const out = await solve([{ name: "carton", l: 7, w: 7, h: 7 }], dolls);
  expect(out.best).toBe(0);
  expect(out.nested).toBe(3);
  expect(group(out.pieces)).toMatchObject([{ name: "large", inside: [{ name: "medium", inside: [{ name: "small", inside: [{ name: "seed" }] }] }] }]);
});

test("a box that is too snug, or a pad that takes the room, does not fit", async () => {
  const cube = { name: "cube", l: 4, w: 4, h: 4 };
  expect((await solve([{ name: "tight", l: 4, w: 4, h: 4 }], [cube])).best).toBe(0);
  // Two 2-cubes fill a 4 x 2 x 2 box exactly; padding between them does not leave the room.
  const pair = { name: "die", l: 2, w: 2, h: 2, qty: 2 };
  expect((await solve([{ name: "slot", l: 4, w: 2, h: 2 }], [pair])).best).toBe(0);
  expect((await solve([{ name: "slot", l: 4, w: 2, h: 2 }], [pair], 0.5)).best).toBeNull();
  // Turned on its side it fits; a 5 does not fit a 4 however it is turned.
  expect((await solve([{ name: "shelf", l: 2, w: 9, h: 3 }], [{ name: "bar", l: 3, w: 2, h: 9 }])).best).toBe(0);
  expect((await solve([{ name: "shelf", l: 4, w: 9, h: 9 }], [{ name: "bar", l: 5, w: 1, h: 1 }])).best).toBe(0);
  expect((await solve([{ name: "shelf", l: 4, w: 4, h: 4 }], [{ name: "bar", l: 5, w: 1, h: 1 }])).best).toBeNull();
});

test("the answer is the smallest box that works, and bad sizes say so", async () => {
  const boxes = [{ name: "big", l: 20, w: 20, h: 20 }, { name: "small", l: 5, w: 5, h: 5 }];
  expect((await solve(boxes, [{ name: "mug", l: 3, w: 3, h: 4 }])).best).toBe(1);
  expect((await solve(boxes, [{ name: "mug", l: 3, w: 3, h: 4, qty: 2 }])).best).toBe(0); // two don't fit the 5-cube
  await expect(solve(boxes, [{ name: "oops", l: 0, w: 3, h: 4 }])).rejects.toThrow("positive");
});

test("pasting rows: headers, sizes in one cell, tabs and rows with no size", () => {
  expect(parseRows("name,length,width,height,qty,holds\nTin,7,5,3.5,1,yes\nCandle,3,3,3.5,2,").rows).toEqual([
    { name: "Tin", l: 7, w: 5, h: 3.5, qty: 1, holds: true, inner: null },
    { name: "Candle", l: 3, w: 3, h: 3.5, qty: 2, holds: false, inner: null },
  ]);
  const odd = parseRows("Mailer\t10 x 8 x 4\nGhost\t\nCrate 12x12x6\n");
  expect(odd.rows.map((r) => [r.name, r.l, r.w, r.h])).toEqual([["Mailer", 10, 8, 4], ["", 12, 12, 6]]);
  expect(odd.skipped).toBe(1);
  // A box row with a blank size is kept out of the engine's list, and out of the verdict's names.
  const s = { ...example(), boxes: [{ name: "half", l: 0, w: 3, h: 3, qty: 1, holds: false, inner: null }, ...example().boxes] };
  expect(toInput(s).boxes).toHaveLength(3);
  expect(usableBoxes(s).map((b) => b.name)).toEqual(["Small", "Medium", "Large"]);
});

test("the Worker keeps the sealed engine's key until the license is paid", async () => {
  const paid = (async () => new Response(JSON.stringify({ ok: true, key: "k", seconds: 60 }))) as unknown as typeof fetch;
  expect((await handle(new Request("http://geoboxq.local/api/engine/key"), {})).status).toBe(402);
  const real = globalThis.fetch;
  globalThis.fetch = paid;
  try {
    const res = await handle(new Request("http://geoboxq.local/api/engine/key"), { ARTSTEW_URL: "https://stew.example", GEOBOXQ_LICENSE: "art_x" });
    expect(await res.json()).toEqual({ key: "k" });
  } finally { globalThis.fetch = real; }
  expect((await handle(new Request("http://geoboxq.local/api/health"), {})).status).toBe(200);
  expect((await handle(new Request("http://geoboxq.local/api/nope"), {})).status).toBe(404);
});

test("what you type is what you get: a dot, a line, a rectangle, a box, then a hollow one", () => {
  const faces = (svg: string) => svg.match(/<polygon/g)?.length ?? 0;
  const t = THEMES[0]!;
  expect(shapeSvg([0, 0, 0], null, t)).toContain("<circle");
  expect(shapeSvg([4, 0, 0], null, t)).toContain("<polyline");
  expect(faces(shapeSvg([4, 3, 0], null, t))).toBe(1);
  expect(faces(shapeSvg([4, 3, 2.123456789], null, t))).toBe(3);
  expect(faces(shapeSvg([4, 3, 2], [3, 2, 1.5], t))).toBe(6); // the cavity adds a floor and two inside walls
  expect(THEMES).toHaveLength(5);
});

test("a turned holder turns what rides in it: every drawn piece stays inside the shipping box", async () => {
  const s = example();
  const input = toInput(s);
  // A long, thin shipping box forces the tin on its side.
  const out = await solve([{ name: "slot", l: 4.2, w: 7.2, h: 5.2 }], input.items.filter((i) => i.name !== "Matchbook"));
  expect(out.best).toBe(0);
  const all = parts(out.packed);
  expect(all.map((p) => p.name)).toEqual(["Gift tin", "Candle", "Candle"]);
  for (const p of all) for (let k = 0; k < 3; k++) {
    expect(p.at[k]!).toBeGreaterThanOrEqual(-1e-9);
    expect(p.at[k]! + p.size[k]!).toBeLessThanOrEqual([4.2, 7.2, 5.2][k]! + 1e-9);
  }
  const [tin, ...candles] = all;
  for (const c of candles) for (let k = 0; k < 3; k++) { // inside the tin's walls, as drawn
    expect(c.at[k]!).toBeGreaterThanOrEqual(tin!.at[k]! + 0.5 - 1e-9);
    expect(c.at[k]! + c.size[k]!).toBeLessThanOrEqual(tin!.at[k]! + tin!.size[k]! - 0.5 + 1e-9);
  }
  const svg = sceneSvg([4.2, 7.2, 5.2], all, THEMES[1]!);
  expect(svg.match(/class="part/g)).toHaveLength(3);
});

test("float noise is not a reason to say no", async () => {
  // Three 0.1 cubes in a 0.3 slot: 0.1 + 0.1 + 0.1 is 0.30000000000000004.
  expect((await solve([{ name: "slot", l: 0.3, w: 0.1, h: 0.1 }], [{ name: "d", l: 0.1, w: 0.1, h: 0.1, qty: 3 }])).best).toBe(0);
  expect((await solve([{ name: "slot", l: 0.3, w: 0.1, h: 0.1 }], [{ name: "d", l: 0.1, w: 0.1, h: 0.1, qty: 4 }])).best).toBeNull();
  expect((await solve([{ name: "big", l: 1e6, w: 1e6, h: 1e6 }], [{ name: "d", l: 0.1 + 0.2, w: 1, h: 1, qty: 1 }])).best).toBe(0);
});

test("the API answers a store's wrapper in a small shape, and refuses bad or heavy requests with a 4xx", async () => {
  const call = (body: string, method = "POST") => handle(new Request("http://geoboxq.local/api/solve", { method, body: method === "POST" ? body : undefined }), {});
  const { boxes, items } = toInput(example());
  const ok = await call(JSON.stringify({ boxes, items }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ fits: true, box: { name: "Small" }, nested: 3, tree: [{ name: "Gift tin", inside: [{ name: "Candle", count: 2 }, { name: "Matchbook" }] }] });
  expect((await call("{nope")).status).toBe(400);
  expect((await call(JSON.stringify({ boxes, items: [{ name: "z", l: 0, w: 1, h: 1 }] }))).status).toBe(400);
  expect((await call(JSON.stringify({ boxes, items: [{ name: "many", l: 1, w: 1, h: 1, qty: 100000 }] }))).status).toBe(400);
  expect((await call(JSON.stringify({ boxes: Array.from({ length: 31 }, () => boxes[0]), items }))).status).toBe(400);
  expect((await call("x".repeat(MAX_BODY + 1))).status).toBe(413);
  expect((await call("", "GET")).status).toBe(405);
});

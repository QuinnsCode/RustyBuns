import { afterEach, expect, test } from "bun:test";
import { solve } from "../src/engine.ts";
import { example, group, parseRows, toInput, usableBoxes, verdict } from "../src/model.ts";
import { forgetLease } from "../src/seal.ts";
import { handle } from "../src/worker.ts";

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
    { name: "Tin", l: 7, w: 5, h: 3.5, qty: 1, holds: true },
    { name: "Candle", l: 3, w: 3, h: 3.5, qty: 2, holds: false },
  ]);
  const odd = parseRows("Mailer\t10 x 8 x 4\nGhost\t\nCrate 12x12x6\n");
  expect(odd.rows.map((r) => [r.name, r.l, r.w, r.h])).toEqual([["Mailer", 10, 8, 4], ["", 12, 12, 6]]);
  expect(odd.skipped).toBe(1);
  // A box row with a blank size is kept out of the engine's list, and out of the verdict's names.
  const s = { ...example(), boxes: [{ name: "half", l: 0, w: 3, h: 3, qty: 1, holds: false }, ...example().boxes] };
  expect(toInput(s).boxes).toHaveLength(3);
  expect(usableBoxes(s).map((b) => b.name)).toEqual(["Small", "Medium", "Large"]);
});

test("the Worker keeps the sealed engine's key until the license is paid", async () => {
  const paid = (async () => new Response(JSON.stringify({ ok: true, key: "k", seconds: 60 }))) as unknown as typeof fetch;
  expect((await handle(new Request("http://boxfit.local/api/engine/key"), {})).status).toBe(402);
  const real = globalThis.fetch;
  globalThis.fetch = paid;
  try {
    const res = await handle(new Request("http://boxfit.local/api/engine/key"), { ARTSTEW_URL: "https://stew.example", BOXFIT_LICENSE: "art_x" });
    expect(await res.json()).toEqual({ key: "k" });
  } finally { globalThis.fetch = real; }
  expect((await handle(new Request("http://boxfit.local/api/health"), {})).status).toBe(200);
  expect((await handle(new Request("http://boxfit.local/api/nope"), {})).status).toBe(404);
});

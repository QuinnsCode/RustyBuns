import { expect, setDefaultTimeout, test } from "bun:test";
import { runGenomeStress } from "./genome";

setDefaultTimeout(180_000);

test("native + wasm workers hammering one shared genome keep every invariant", async () => {
  const r = await runGenomeStress({ native: 3, wasm: 3, iters: 300_000, genes: 32 });
  expect(r.failed).toEqual([]);
  expect(r.seqlockTorn).toBe(0);
});

test("a wasm-only and a native-only storm both hold", async () => {
  expect((await runGenomeStress({ native: 4, wasm: 0, iters: 200_000, genes: 8 })).failed).toEqual([]);
  expect((await runGenomeStress({ native: 0, wasm: 4, iters: 200_000, genes: 8 })).failed).toEqual([]);
});

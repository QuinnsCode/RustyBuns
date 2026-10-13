import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The shop interiors (src/city-shops/*.js) are plain modules; city.js hands them a ctx and bakes what they put().
const city = readFileSync(new URL("../src/city.js", import.meta.url), "utf8");
const registry = Object.fromEntries([...city.match(/const SHOP_MODULES = \{([^}]*)\}/)![1].matchAll(/(\w+): "(\w+)"/g)].map((m) => [m[1], m[2]]));
const kitKeys = new Set([...city.matchAll(/\bkit\("(\w+)"/g)].map((m) => m[1]));
const shops = new Set([...city.matchAll(/^  (\w+): \{ sign: /gm)].map((m) => m[1]));

async function stock(module: string, kind: string, face: [number, number], lines = 400) {
  const puts: { key: string; x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  let n = 1;
  const r = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const b = { x: 10, z: -4, path: "src/a.ts", lines };
  const ctx = { b, repo: "x", kind, r, pw: 2.9, ph: 1.2, y0: 0.16, scene: {}, THREE: {}, door: face, lines, path: b.path,
    put: (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { puts.push({ key, x, y, z, sx, sy, sz }); } };
  const out = (await import(`../src/city-shops/${module}.js`)).buildInterior(ctx);
  return { puts, out, b };
}

test("every registered shop module exists, and names a real shop kind", async () => {
  for (const [kind, module] of Object.entries(registry)) {
    expect(shops.has(kind)).toBe(true);
    expect(typeof (await import(`../src/city-shops/${module}.js`)).buildInterior).toBe("function");
  }
  expect(Object.keys(registry)).toEqual(expect.arrayContaining(["video", "comics", "records", "lava", "coffee", "hall", "hq", "office"]));
});

test("media shops and the generic store fill their room on every door, using only kit parts, inside the walls", async () => {
  const cases = [...Object.keys(registry).map((k) => [registry[k], k]), ["generic", "library"]];
  for (const [module, kind] of cases) for (const face of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
    const { puts, out, b } = await stock(module, kind, face);
    expect(puts.length).toBeGreaterThan(40);
    for (const p of puts) {
      expect(kitKeys.has(p.key)).toBe(true);
      expect(Math.abs(p.x - b.x)).toBeLessThanOrEqual(1.36 + p.sx / 2 - 0.0001 + 0.001);
      expect(Math.abs(p.z - b.z)).toBeLessThanOrEqual(1.36 + p.sz / 2 + 0.001);
    }
    expect(out.aisles.length).toBeGreaterThan(2);
    for (const [x, z] of [...out.aisles, out.clerk]) { expect(Math.abs(x - b.x)).toBeLessThan(1.35); expect(Math.abs(z - b.z)).toBeLessThan(1.35); }
  }
});

test("the bigger the file, the fuller the shelves", async () => {
  expect((await stock("media", "video", [0, 1], 4000)).puts.length).toBeGreaterThan((await stock("media", "video", [0, 1], 4)).puts.length);
});

test("the speakeasy fills its room on every door, inside the walls, with four stools and a barkeep who talks", async () => {
  for (const face of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
    const { puts, out, b } = await stock("bar", "archive", face);
    expect(puts.length).toBeGreaterThan(40);
    for (const p of puts) {
      expect(kitKeys.has(p.key)).toBe(true);
      expect(Math.abs(p.x - b.x)).toBeLessThanOrEqual(1.36 + p.sx / 2 + 0.001);
      expect(Math.abs(p.z - b.z)).toBeLessThanOrEqual(1.36 + p.sz / 2 + 0.001);
    }
    expect(out.aisles.length).toBe(4);
    expect(out.talk.length).toBeGreaterThan(3);
    expect(out.talk[1]).toContain("a.ts");
  }
});

test("the coffee shop seats patrons and stays inside its walls", async () => {
  const { puts } = await stock("coffee", "coffee", [0, 1], 400);
  expect(puts.length).toBeGreaterThan(100);
  expect((await stock("coffee", "coffee", [0, 1], 4000)).puts.length).toBeGreaterThan((await stock("coffee", "coffee", [0, 1], 4)).puts.length);
});

test("the offices stock more paper for a bigger file", async () => {
  for (const kind of ["hall", "hq", "office"]) expect((await stock("office", kind, [0, 1], 4000)).puts.length).toBeGreaterThanOrEqual((await stock("office", kind, [0, 1], 4)).puts.length);
  expect((await stock("office", "office", [0, 1], 4000)).puts.length).toBeGreaterThan((await stock("office", "office", [0, 1], 4)).puts.length);
});

import { describe, expect, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import { clean, type Splats } from "../src/clean.ts";
import { demoCarton } from "../src/demo.ts";

type Part = "product" | "table" | "floater";

/** A raw capture as a trainer writes one (y-down): a carton on a wide tabletop, with mist and stray splats round the room. */
function capture(o: { table: boolean }) {
  const rand = mulberry32(7);
  const pts: Array<{ p: [number, number, number]; part: Part; opacity: number; size: number }> = [];
  const W = 0.33, H = 0.12, D = 0.2;
  // The carton's six faces, standing on the table at height 0.
  for (let k = 0; k < 6000; k++) {
    const face = k % 6, a = rand() - 0.5, b = rand() - 0.5;
    // On a table the base is never seen, so the trainer has nothing there.
    if (o.table && face === 5) continue;
    const p: [number, number, number] =
      face < 2 ? [a * W, H / 2 + b * H, (face ? 1 : -1) * D / 2]
      : face < 4 ? [(face === 3 ? 1 : -1) * W / 2, H / 2 + b * H, a * D]
      : [a * W, face === 4 ? H : 0.002, b * D];
    pts.push({ p, part: "product", opacity: 0.9, size: 0.004 });
  }
  if (o.table) {
    for (let k = 0; k < 8000; k++) {
      const r = Math.sqrt(rand()) * 1.0, t = rand() * Math.PI * 2;
      pts.push({ p: [Math.cos(t) * r, -0.004 * rand(), Math.sin(t) * r], part: "table", opacity: 0.9, size: 0.006 });
    }
  }
  // Stray splats anywhere in a 3 m room, some faint, a few huge.
  for (let k = 0; k < 600; k++) {
    const p: [number, number, number] = [(rand() - 0.5) * 3, rand() * 2 - 0.5, (rand() - 0.5) * 3];
    pts.push({ p, part: "floater", opacity: k % 3 ? 0.8 : 0.03, size: k % 10 ? 0.01 : 0.5 });
  }
  const s: Splats = {
    pos: Float32Array.from(pts.flatMap(({ p }) => [p[0], -p[1], p[2]])),
    opacity: Float32Array.from(pts.map((x) => x.opacity)),
    size: Float32Array.from(pts.map((x) => x.size)),
  };
  return { s, parts: pts.map((x) => x.part) };
}

describe("cleaning a capture before it goes on a product page", () => {
  test.each([
    ["on a table", true],
    ["shot on a turntable with nothing under it", false],
  ])("%s: the carton stays, the table and the room go", (_, table) => {
    const { s, parts } = capture({ table });
    const r = clean(s);
    const share = (part: Part) => {
      const all = parts.flatMap((p, i) => (p === part ? [i] : []));
      return all.length ? all.filter((i) => r.keep[i]).length / all.length : 0;
    };
    expect(share("product")).toBeGreaterThan(0.95);
    expect(share("table")).toBeLessThan(0.05);
    expect(share("floater")).toBeLessThan(0.05);
    expect(r.table === null).toBe(!table);
  });

  test("an already clean product (the example carton, a .splat on a grid) keeps every point", () => {
    const b = demoCarton(), f = new Float32Array(b), u = new Uint8Array(b), n = b.byteLength / 32;
    const s: Splats = { pos: new Float32Array(n * 3), opacity: new Float32Array(n), size: new Float32Array(n) };
    for (let i = 0; i < n; i++) { s.pos.set(f.subarray(i * 8, i * 8 + 3), i * 3); s.opacity[i] = u[i * 32 + 27]! / 255; s.size[i] = f[i * 8 + 3]!; }
    expect(clean(s)).toMatchObject({ kept: n, table: null });
  });
});

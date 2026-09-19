import { test, expect } from "bun:test";
import { spray } from "../src/spray.ts";

/** Splats on a flat wall facing the camera, at depth z, in a square of half-size r. */
function wall(z: number, r: number, n: number, opacity = 1) {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push(-r + (2 * r * i) / (n - 1), -r + (2 * r * j) / (n - 1), z);
  // blobs as wide as the spacing, so the wall is solid, like a real capture
  const spacing = (2 * r) / (n - 1);
  return { pts, ops: new Array(n * n).fill(opacity), radii: new Array(n * n).fill(spacing) };
}
function sceneOf(...walls: ReturnType<typeof wall>[]) {
  return {
    centers: new Float32Array(walls.flatMap((w) => w.pts)),
    opacities: new Float32Array(walls.flatMap((w) => w.ops)),
    radii: new Float32Array(walls.flatMap((w) => w.radii)),
  };
}
const fromOrigin = { origin: [0, 0, 0] as [number, number, number], dir: [0, 0, -1] as [number, number, number], thickness: 0.05 };

test("paint lands on the near wall, not the wall behind it", () => {
  const near = wall(-2, 1, 21), far = wall(-5, 3, 21);
  const s = sceneOf(near, far);
  const hits = spray({ ...s, ...fromOrigin, halfAngleDeg: 10 });
  expect(hits.length).toBeGreaterThan(0);
  const nearCount = 21 * 21;
  expect([...hits].every((i) => i < nearCount)).toBe(true);
});

test("without blob sizes, sparse points let paint leak through (why radii matter)", () => {
  const near = wall(-2, 1, 21), far = wall(-5, 3, 21);
  const { radii: _, ...points } = sceneOf(near, far);
  const hits = spray({ ...points, ...fromOrigin, halfAngleDeg: 10 });
  expect([...hits].some((i) => i >= 21 * 21)).toBe(true);
});

test("the cone limits the spot size", () => {
  const s = sceneOf(wall(-2, 2, 41));
  const narrow = spray({ ...s, ...fromOrigin, halfAngleDeg: 3 }).length;
  const wide = spray({ ...s, ...fromOrigin, halfAngleDeg: 20 }).length;
  expect(narrow).toBeGreaterThan(0);
  expect(wide).toBeGreaterThan(narrow * 10);
  // every hit is inside the cone: |xy| / depth <= tan(angle)
  const c = s.centers;
  for (const i of spray({ ...s, ...fromOrigin, halfAngleDeg: 5 })) {
    expect(Math.hypot(c[i * 3]!, c[i * 3 + 1]!) / 2).toBeLessThanOrEqual(Math.tan((5 * Math.PI) / 180) + 1e-6);
  }
});

test("faint splats don't block paint, and still get painted", () => {
  const haze = wall(-1, 1, 11, 0.05), solid = wall(-3, 2, 21);
  const s = sceneOf(haze, solid);
  const hits = [...spray({ ...s, ...fromOrigin, halfAngleDeg: 10 })];
  expect(hits.some((i) => i >= 121)).toBe(true);           // reached the solid wall
  expect(hits.some((i) => i < 121)).toBe(true);            // and painted the haze in front
});

test("paint soaks exactly `thickness` deep", () => {
  const front = wall(-2, 1, 11), justBehind = wall(-2.04, 1, 11), wellBehind = wall(-2.2, 1, 11);
  const s = sceneOf(front, justBehind, wellBehind);
  const hits = [...spray({ ...s, ...fromOrigin, halfAngleDeg: 20 })];
  expect(hits.some((i) => i >= 121 && i < 242)).toBe(true);
  expect(hits.some((i) => i >= 242)).toBe(false);
});

test("nothing behind the camera, nothing when aiming away", () => {
  const s = sceneOf(wall(2, 1, 11));   // behind (camera looks toward -z)
  expect(spray({ ...s, ...fromOrigin, halfAngleDeg: 30 }).length).toBe(0);
  expect(spray({ ...s, ...fromOrigin, dir: [0, 0, 1], halfAngleDeg: 30 }).length).toBeGreaterThan(0);
});

test("works when aiming straight up or down (basis edge case)", () => {
  const ceiling = sceneOf(wall(0, 1, 11));
  const pts = ceiling.centers;
  for (let i = 0; i < pts.length; i += 3) { const z = pts[i + 2]!; pts[i + 2] = pts[i + 1]!; pts[i + 1] = 3 + z; }   // plane y = 3
  expect(spray({ ...ceiling, ...fromOrigin, dir: [0, 1, 0], halfAngleDeg: 10 }).length).toBeGreaterThan(0);
  expect(spray({ ...ceiling, ...fromOrigin, dir: [0, -1, 0], halfAngleDeg: 10 }).length).toBe(0);
});

test("a million splats in reasonable time (the Rust candidate)", () => {
  const n = 1_000_000;
  const centers = new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? -2 - Math.random() * 4 : (Math.random() - 0.5) * 6));
  const opacities = new Float32Array(n).fill(0.9);
  const radii = new Float32Array(n).fill(0.01);
  const t = performance.now();
  const hits = spray({ centers, opacities, radii, ...fromOrigin, halfAngleDeg: 8 });
  const ms = performance.now() - t;
  console.log(`1M splats: ${ms.toFixed(0)} ms, ${hits.length} painted`);
  expect(hits.length).toBeGreaterThan(0);
});

// ---- the scanner: dots, not paint ----
import { scan } from "../src/spray.ts";

const seeded = () => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };

test("a shot leaves at most the dots asked for, all inside the cone", () => {
  const s = sceneOf(wall(-3, 2, 61));
  const hits = scan({ ...s, ...fromOrigin, halfAngleDeg: 6, dots: 50, rand: seeded() });
  expect(hits.length).toBeLessThanOrEqual(50);
  expect(hits.length).toBeGreaterThan(20);
  for (const i of hits) {
    expect(Math.hypot(s.centers[i * 3]!, s.centers[i * 3 + 1]!) / 3).toBeLessThanOrEqual(Math.tan((6 * Math.PI) / 180) + 1e-6);
  }
});

test("dots are spread out, not clumped in one spot", () => {
  const s = sceneOf(wall(-3, 2, 61));
  const hits = [...scan({ ...s, ...fromOrigin, halfAngleDeg: 8, dots: 60, rand: seeded() })];
  const xs = hits.map((i) => s.centers[i * 3]!);
  const ys = hits.map((i) => s.centers[i * 3 + 1]!);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  expect(spread(xs)).toBeGreaterThan(0.4);
  expect(spread(ys)).toBeGreaterThan(0.4);
  expect(new Set(hits).size).toBe(hits.length);   // no duplicates
});

test("dots land on the nearest surface only", () => {
  // a dense near wall, like a real capture: no gaps for a ray to slip through
  const near = wall(-2, 1, 121), far = wall(-5, 3, 31);
  const s = sceneOf(near, far);
  const hits = [...scan({ ...s, ...fromOrigin, halfAngleDeg: 8, dots: 40, rand: seeded() })];
  expect(hits.length).toBeGreaterThan(5);
  expect(hits.every((i) => i < 121 * 121)).toBe(true);
});

test("through a sparse foreground, rays reach what's behind (one dot per ray)", () => {
  // unlike painting, a scanner ray is a ray: gaps in a sparse surface show through
  const s = sceneOf(wall(-2, 1, 9), wall(-5, 3, 61));
  const hits = [...scan({ ...s, ...fromOrigin, halfAngleDeg: 8, dots: 60, rand: seeded() })];
  expect(hits.some((i) => i >= 81)).toBe(true);
});

test("a shot into empty space leaves nothing", () => {
  const s = sceneOf(wall(-3, 0.2, 11));
  expect(scan({ ...s, origin: [4, 0, 0], dir: [1, 0, 0], thickness: 0.05, halfAngleDeg: 4, dots: 40, rand: seeded() }).length).toBe(0);
});

test("scanning a million splats stays quick", () => {
  const n = 1_000_000;
  const centers = new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? -2 - Math.random() * 4 : (Math.random() - 0.5) * 6));
  const opacities = new Float32Array(n).fill(0.9);
  const t = performance.now();
  const hits = scan({ centers, opacities, ...fromOrigin, halfAngleDeg: 8, dots: 200, rand: seeded() });
  console.log(`1M splats scanned: ${(performance.now() - t).toFixed(0)} ms, ${hits.length} dots`);
  expect(hits.length).toBeGreaterThan(50);
});

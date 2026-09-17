import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlyHeader, readSceneInfo, shDegreeFrom } from "../desktop/sceneInfo.ts";
import { makeTestSplat } from "../scripts/make-test-splat.ts";

const dir = mkdtempSync(join(tmpdir(), "info-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, data: string | Uint8Array) => { const p = join(dir, name); writeFileSync(p, data); return p; };

test("test splat: count, flat color, bounds of the ring", async () => {
  const info = await readSceneInfo(file("ring.ply", makeTestSplat(3000)));
  expect(info.format).toBe("ply");
  expect(info.splats).toBe(3000);
  expect(info.shDegree).toBe(0);
  const { min, max } = info.bounds!;
  expect(min[0]).toBeCloseTo(-2, 2); expect(max[0]).toBeCloseTo(2, 2);   // x = cos(t) * 2
  expect(min[2]).toBeCloseTo(-2, 2); expect(max[2]).toBeCloseTo(2, 2);   // z = sin(t) * 2
  expect(max[1]).toBeLessThanOrEqual(0.3 + 1e-6);                         // y = sin(3t) * 0.3
});

test("bounds are right when records straddle stream chunks", async () => {
  // enough splats to span many chunks; one far outlier at the very end
  const data = makeTestSplat(50_000);
  const view = new DataView(data.buffer);
  const headerEnd = new TextDecoder().decode(data.slice(0, 2000)).indexOf("end_header\n") + 11;
  view.setFloat32(headerEnd + 49_999 * 17 * 4 + 4, 99, true);   // last splat's y
  const info = await readSceneInfo(file("big.ply", data));
  expect(info.splats).toBe(50_000);
  expect(info.bounds!.max[1]).toBe(99);
});

test("SH degree from f_rest counts", () => {
  expect(shDegreeFrom(0)).toBe(0);
  expect(shDegreeFrom(9)).toBe(1);
  expect(shDegreeFrom(24)).toBe(2);
  expect(shDegreeFrom(45)).toBe(3);
  expect(shDegreeFrom(10)).toBeNull();
});

test("full-detail header reports SH 3", async () => {
  const props = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`), "opacity"];
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${props.map((p) => `property float ${p}`).join("\n")}\nend_header\n`;
  const body = new Uint8Array(props.length * 4);
  const info = await readSceneInfo(file("sh3.ply", new Uint8Array([...new TextEncoder().encode(header), ...body])));
  expect(info.shDegree).toBe(3);
  expect(info.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
});

test("compressed PLY: count known, bounds explained", async () => {
  const header = "ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nelement vertex 256\nproperty uint packed_position\nend_header\n";
  const info = await readSceneInfo(file("c.compressed.ply", header));
  expect(info.format).toBe("compressed ply");
  expect(info.splats).toBe(256);
  expect(info.bounds).toBeNull();
  expect(info.note).toMatch(/compressed/);
});

test("truncated file says so instead of guessing", async () => {
  const full = makeTestSplat(100);
  const info = await readSceneInfo(file("cut.ply", full.slice(0, full.length - 200)));
  expect(info.note).toMatch(/truncated/);
  expect(info.bounds).toBeNull();
});

test(".splat counts by size; unknown formats say so; junk isn't a crash", async () => {
  expect((await readSceneInfo(file("a.splat", new Uint8Array(64)))).splats).toBe(2);
  expect((await readSceneInfo(file("b.spz", "x"))).note).toMatch(/aren't read yet/);
  expect((await readSceneInfo(file("junk.ply", "hello"))).note).toMatch(/not a readable PLY/);
  expect(parsePlyHeader("ply\nformat ascii 1.0\nend_header\n")!.format).toBe("ascii");
});

// A thinned scan must still be a compressed PLY PlayCanvas reads, with the
// splats it kept where they were. Built from a made-up scan so CI runs it,
// plus a real InteriorGS scan when one is on this machine.
import { test, expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decimatePly } from "../src/viewer/decimate.ts";
import { mulberry32 } from "@rustybuns/util";

const CHUNK_PROPS = ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z",
  "min_scale_x", "min_scale_y", "min_scale_z", "max_scale_x", "max_scale_y", "max_scale_z",
  "min_r", "min_g", "min_b", "max_r", "max_g", "max_b"];

function fakeScan(n: number, shBytes = 9) {
  const rand = mulberry32(7);
  const chunks = Math.ceil(n / 256);
  const header = ["ply", "format binary_little_endian 1.0", `element chunk ${chunks}`,
    ...CHUNK_PROPS.map((p) => `property float ${p}`), `element vertex ${n}`,
    ...["packed_position", "packed_rotation", "packed_scale", "packed_color"].map((p) => `property uint ${p}`),
    `element sh ${n}`, ...Array.from({ length: shBytes }, (_, i) => `property uchar f_rest_${i}`), "end_header", ""].join("\n");
  const cd = new Float32Array(chunks * 18);
  for (let c = 0; c < chunks; c++) {
    for (let a = 0; a < 3; a++) {
      cd[c * 18 + a] = c + a; cd[c * 18 + 3 + a] = c + a + 1;           // positions: a 1 m cube per chunk
      cd[c * 18 + 6 + a] = -6; cd[c * 18 + 9 + a] = -1;                 // log scales
      cd[c * 18 + 12 + a] = 0; cd[c * 18 + 15 + a] = 1;                 // colour
    }
  }
  const vd = new Uint32Array(n * 4);
  for (let i = 0; i < n * 4; i++) vd[i] = Math.floor(rand() * 2 ** 32) >>> 0;
  // Each splat's sh row spells out its index, so a test can tell which source splat survived.
  const sh = Uint8Array.from({ length: n * shBytes }, (_, k) => (Math.floor(k / shBytes) >> (8 * (k % 3))) & 255);
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + cd.byteLength + vd.byteLength + sh.length);
  out.set(head); out.set(new Uint8Array(cd.buffer), head.length);
  out.set(new Uint8Array(vd.buffer), head.length + cd.byteLength); out.set(sh, head.length + cd.byteLength + vd.byteLength);
  return out;
}

/** Decoded positions, opacities and sh rows: the reader side, written the way PlayCanvas reads it. */
function decode(bytes: Uint8Array<ArrayBuffer>) {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  const body = text.indexOf("end_header\n") + 11;
  const count = (el: string) => Number(text.match(new RegExp(`element ${el} (\\d+)`))?.[1] ?? 0);
  const chunks = count("chunk"), n = count("vertex"), shBytes = (text.match(/property uchar/g) ?? []).length;
  const buf = bytes.buffer.slice(bytes.byteOffset + body);
  const cd = new Float32Array(buf, 0, chunks * 18), vd = new Uint32Array(buf, chunks * 72, n * 4);
  const sh = new Uint8Array(buf, chunks * 72 + n * 16, n * shBytes);
  const u = (v: number, b: number) => (v & ((1 << b) - 1)) / ((1 << b) - 1);
  const pos: number[][] = [], alpha: number[] = [], rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / 256) * 18, p = vd[i * 4]!;
    const t = [u(p >>> 21, 11), u(p >>> 11, 10), u(p, 11)];
    pos.push(t.map((x, a) => cd[c + a]! + (cd[c + 3 + a]! - cd[c + a]!) * x));
    alpha.push(vd[i * 4 + 3]! & 255);
    rows.push(sh.subarray(i * shBytes, (i + 1) * shBytes).join(","));
  }
  return { chunks, n, pos, alpha, rows };
}

test("a scan over budget comes back at the budget, every kept splat where it was, in order, with its sh", () => {
  const src = fakeScan(5000);
  const before = decode(src);
  const thin = decimatePly(src, 1200);
  const after = decode(thin);
  expect(after.n).toBe(1200);
  expect(after.chunks).toBe(Math.ceil(1200 / 256));
  let i = 0;
  for (let j = 0; j < after.n; j++) {
    // Kept splats keep file order, so each one matches a later source splat by its sh row.
    while (i < before.n && before.rows[i] !== after.rows[j]) i++;
    expect(i).toBeLessThan(before.n);
    expect(after.alpha[j]).toBe(before.alpha[i]!);
    for (let a = 0; a < 3; a++) expect(Math.abs(after.pos[j]![a]! - before.pos[i]![a]!)).toBeLessThan(0.01);
    i++;
  }
});

test("a scan under budget, or a file that is not a compressed PLY, is handed back as it was", () => {
  const src = fakeScan(500);
  expect(decimatePly(src, 1000)).toBe(src);
  const plain = new TextEncoder().encode("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n\0\0\0\0");
  expect(decimatePly(plain, 0)).toBe(plain);
});

const dir = join(homedir(), "Documents/SplatRooms");
const real = existsSync(dir) ? readdirSync(dir).map((s) => join(dir, s, "3dgs_compressed.ply")).find(existsSync) : undefined;

test.if(!!real)("a real InteriorGS scan thins to the budget", () => {
  const src = new Uint8Array(readFileSync(real!));
  const thin = decode(decimatePly(src, 300_000));
  expect(thin.n).toBe(300_000);
});

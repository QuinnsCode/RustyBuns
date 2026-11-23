import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBlender, runBlender } from "@rustybuns/cli/blender";

// A sheet's head parts as the builder lays them (#4291): a slanted almond eye (`r` as [x, y, z], `rot`) and a
// wolf's ear that narrows to a point (`point`), the pair mirrored. Needs Blender (CI has none, so there it skips).
setDefaultTimeout(120_000);
const APP = join(import.meta.dir, "..");

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(APP, "blender"))})
import beast as B
import bpy
sheet = json.loads(sys.argv[sys.argv.index("--") + 1])
B.PALETTE.update(sheet["palette"])
bpy.ops.wm.read_factory_settings(use_empty=True)
out = {}
for o in B.parts(sheet, sheet["nodes"]):
    out[o.name] = [list(o.matrix_world @ v.co) for v in o.data.vertices]
print("PARTS" + json.dumps(out))
`;

async function build(parts: object[], nodes: object = { head: [0, 1, 0, 0.1] }, extra: object = { eyes: false }): Promise<Record<string, number[][]>> {
  const dir = mkdtempSync(join(tmpdir(), "beast-parts-"));
  writeFileSync(join(dir, "parts.py"), PY);
  const sheet = { palette: { eye: [0, 0, 0, 0.1, 0], fur: [0.3, 0.3, 0.3, 0.8, 0] }, material: "fur", nodes, parts, ...extra };
  const { out } = await runBlender({ script: join(dir, "parts.py"), args: [JSON.stringify(sheet)], cwd: APP });
  const line = out.split("\n").find((l) => l.startsWith("PARTS"));
  if (!line) throw new Error(`no parts printed:\n${out}`);
  return JSON.parse(line.slice(5));
}

test.skipIf(!findBlender())("a slanted almond eye lifts its outer corner on both sides, and a pointed ear ends in a point", async () => {
  const ear = { kind: "ear", at: "head", off: [0, 0.08, 0.06], dir: [0, 1, 0], len: 0.2, width: 0.08, mirror: true, material: "fur" };
  const got = await build([
    { kind: "eye", at: "head", off: [0.08, 0, 0.05], r: [0.02, 0.02, 0.05], rot: [-30, 0, 0], mirror: true, material: "eye" },
    { ...ear, point: 0.5 },
    ear,
  ]);
  for (const [name, outward] of [["eye0", 1], ["eye0r", -1]] as const) {
    const vs = got[name]!;
    const outer = vs.reduce((a, b) => (b[2]! * outward > a[2]! * outward ? b : a));
    const inner = vs.reduce((a, b) => (b[2]! * outward < a[2]! * outward ? b : a));
    expect(outer[2]! - inner[2]!).toBeCloseTo(0.1 * Math.cos(Math.PI / 6) * outward, 2); // long across the face
    expect(outer[1]! - inner[1]!).toBeGreaterThan(0.03); // and slanted up toward the outside
  }
  // across the ear (z, its width) near the tip: the pointed one is under half as wide as the plain, rounded one
  const nearTip = (vs: number[][]) => {
    const top = Math.max(...vs.map((v) => v[1]!));
    const tip = vs.filter((v) => v[1]! > top - 0.06);
    return Math.max(...tip.map((v) => v[2]!)) - Math.min(...tip.map((v) => v[2]!));
  };
  expect(nearTip(got["ear1"]!)).toBeLessThan(nearTip(got["ear2"]!) / 2);
  expect(nearTip(got["ear1r"]!)).toBeCloseTo(nearTip(got["ear1"]!), 4);
});

test.skipIf(!findBlender())("an eye sits in a socket: a smaller ball set back, a lid round it and a brow above it", async () => {
  const eye = { kind: "eye", at: "head", off: [0.08, 0, 0.05], r: 0.04, mirror: true, material: "eye" };
  const got = await build([eye], undefined, {});
  const centre = (vs: number[][]) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k]!, 0) / vs.length);
  const ball = got["eye0"]!, c = centre(ball);
  expect(Math.max(...ball.map((v) => Math.hypot(v[0]! - c[0]!, v[1]! - c[1]!, v[2]! - c[2]!)))).toBeCloseTo(0.04 * 0.72, 3);
  // its front no further out along its gaze than the old ball's front
  const g = [1, 0, 0.75].map((x) => x / 1.25);
  expect(Math.max(...ball.map((v) => v[0]! * g[0]! + (v[1]! - 1) * g[1]! + v[2]! * g[2]!))).toBeLessThan(0.08 * g[0]! + 0.05 * g[2]! + 0.04);
  expect(got["lid0"]).toBeDefined();
  expect(got["lid1"]).toBeDefined(); // the mirrored eye's own
  expect(Math.min(...got["brow0"]!.map((v) => v[1]!))).toBeGreaterThan(c[1]!); // over the eye
});

test.skipIf(!findBlender())("a hand has a palm, four curling fingers and a thumb; a walking paw has toes that reach the ground with claws out of their tips", async () => {
  const got = await build([
    { kind: "foot", form: "hand", at: "head", dir: [0, -1, 0], palm: [0, 0, -1], len: 0.2, width: 0.08, curl: 90, claw: 0.01, material: "fur" },
    { kind: "foot", form: "digits", at: "paw", len: 0.2, width: 0.16, toes: 4, claw: 0.04, sole: 0.08, material: "fur" },
  ], { head: [0, 1, 0, 0.1], paw: [0, 0.08, 0.3, 0.08] });
  expect(Object.keys(got).filter((k) => /^foot0_f\d$/.test(k))).toHaveLength(4);
  expect(got["foot0_th"]).toBeDefined();
  // curled 90 degrees toward the palm (-z): each finger's tip ends up further toward the palm than its root
  for (let j = 0; j < 4; j++) {
    const f = got[`foot0_f${j}`]!;
    expect(Math.min(...f.map((v) => v[2]!))).toBeLessThan(f[0]![2]! - 0.02);
  }
  const toes = Object.keys(got).filter((k) => /^foot1_t\d$/.test(k));
  expect(toes).toHaveLength(4);
  for (const t of toes) expect(Math.min(...got[t]!.map((v) => v[1]!))).toBeLessThan(0.03); // down to the floor
  expect(Object.keys(got).filter((k) => /^foot1_c\d$/.test(k))).toHaveLength(4);
});

test.skipIf(!findBlender())("a mirrored pair of hands are mirror images: each thumb on its own hand's inner side", async () => {
  const got = await build(
    [{ kind: "foot", form: "hand", at: "l_hand", dir: [0.3, -1, 0], palm: [0, 0, -1], len: 0.2, width: 0.08, mirror: true, material: "fur" }],
    { l_hand: [0.1, 1, 0.3, 0.03], r_hand: [0.1, 1, -0.3, 0.03] },
  );
  const centre = (vs: number[][]) => [0, 1, 2].map((k) => vs.reduce((s, v) => s + v[k]!, 0) / vs.length);
  const left = centre(got["foot0_th"]!), right = centre(got["foot0r_th"]!);
  expect(right[0]!).toBeCloseTo(left[0]!, 3);
  expect(right[1]!).toBeCloseTo(left[1]!, 3);
  expect(right[2]!).toBeCloseTo(-left[2]!, 3);
});

test.skipIf(!findBlender())("a leg whose gaskin slants back keeps every ring facing the same way, with no twist at the knee", async () => {
  // a lion's hind leg: down and forward to the knee, back at 45 degrees to a high hock, upright to the paw
  const nodes = { l_hipj: [-0.6, 0.8, 0.17, 0.05], l_knee: [-0.5, 0.53, 0.2, 0.03], l_hock: [-0.71, 0.3, 0.2, 0.03], l_bfoot: [-0.65, 0.1, 0.18, 0.04] };
  const got = await build([{ kind: "limb", along: ["l_hipj", "l_knee", "l_hock", "l_bfoot"], radii: [0.1, 0.1, 0.1, 0.1], material: "fur" }], nodes);
  const vs = Object.entries(got).find(([k]) => k.startsWith("limb"))![1];
  const rings = Math.floor(vs.length / 16);
  let worst = 0;
  for (let i = 0; i + 1 < rings; i++) for (let j = 0; j < 16; j++) {
    const a = vs[i * 16 + j]!, b = vs[(i + 1) * 16 + j]!;
    worst = Math.max(worst, Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!));
  }
  expect(worst).toBeLessThan(0.12); // a ring turned half over puts a point about two radii (0.2) from its twin
});

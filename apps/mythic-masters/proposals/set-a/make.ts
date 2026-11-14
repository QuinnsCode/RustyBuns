// Rebuild set A, the four-legged biters (#4249 lane 3): `bun proposals/set-a/make.ts [id ...]` writes beasts/<id>.json
// for each beast below, then `bun scripts/beasts.ts --render <id>` builds it. References and lessons for each are in
// docs/shots-2026-11-11-<id>/README.md. The head, body and legs are ellipsoid blobs merged by `blend` into one skin;
// every face part is placed on that skin with a ray-cast (`skin()`), as the Squonk and Jackalope were.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;
type Blob = { at: string; off: V; r: V; rot?: V };
type Ell = { c: V; r: V };

const f4 = (x: number) => +x.toFixed(4);
const add = (a: V, b: V): V => [f4(a[0] + b[0]), f4(a[1] + b[1]), f4(a[2] + b[2])];
const mul = (a: V, k: number): V => [f4(a[0] * k), f4(a[1] * k), f4(a[2] * k)];
const flipZ = (a: V): V => [a[0], a[1], -a[2]];
const norm = (a: V): V => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

/** Where a ray from `p` along `d` leaves the last of these ellipsoids: the skin it shows. */
function skin(ells: Ell[], p: V, d: V): V {
  let best = 0;
  for (const { c, r } of ells) {
    const q = [0, 1, 2].map((i) => (p[i]! - c[i]!) / r[i]!), e = [0, 1, 2].map((i) => d[i]! / r[i]!);
    const a = e.reduce((s, x) => s + x * x, 0), b = q.reduce((s, x, i) => s + x * e[i]!, 0), cc = q.reduce((s, x) => s + x * x, 0) - 1;
    const disc = b * b - a * cc;
    if (disc >= 0) best = Math.max(best, (-b + Math.sqrt(disc)) / a);
  }
  return [p[0] + d[0] * best, p[1] + d[1] * best, p[2] + d[2] * best];
}

/** Both sides of a blob on an `l_` node (or a centre blob offset to the left, mirrored). */
const pair = (at: string, off: V, r: V): Blob[] =>
  at.startsWith("l_") ? [{ at, off, r }, { at: at.replace(/^l_/, "r_"), off: flipZ(off), r }] : [{ at, off, r }, { at, off: flipZ(off), r }];

type Hound = {
  id: string; name: string; about: string; archetype: string; budget: number;
  k: number;                       // overall size (1: a calf-sized hound, about 0.9 m at the shoulder)
  head: number;                    // head size in k
  muzzle: number;                  // muzzle length in the head
  snout?: number;                  // muzzle thickness (1: a hound's; more: a wolf's broad one)
  legs?: number;                   // leg thickness (1: a hound's)
  crown?: number;                  // cranium height (1: domed; less: a wolf's flat brow)
  gape: number;                    // how far the lower jaw hangs open (0 shut, 1 a snarl)
  ears: { len: number; width: number; dir: V; cup: number; tilt: number; fold: number };
  eyes: "one" | "two";
  chest: number;                   // chest depth in k
  ruff: number;                    // the mane over the neck and shoulders, in k (0 none)
  shag: number;                    // tuft length all over, in k
  tail: { len: number; droop: number; bush: number; curl?: number; tip?: boolean; thick?: number }; // curl: the tip lifts that far; tip: fur only at the end
  long?: number; tall?: number;    // the body stretched fore to aft, and the stance raised or lowered
  horns?: { len: number; base: number; curve: number; dir: V; bend: V };
  bands?: { n: number; width: number }; // tabby bands across the back and tail
  palette: Record<string, number[]>;
  hide: Record<string, unknown>;
  stripe?: boolean;                // a dark band down the spine
  bib?: boolean;                   // a pale throat and belly, painted
  pose?: Record<string, [number, number]>; // nodes moved by (fore, up) in k before the flesh goes on: a crouch, braced legs
  waist?: number;                  // the belly's depth and width (1: a hound's; less: tucked up under the ribs)
  paw?: number;                    // paw size (1: a hound's)
};

function hound(o: Hound) {
  const k = o.k, H = o.head * k;
  const r = (x: number) => f4(x * k);
  const LX = o.long ?? 1, LY = o.tall ?? 1;
  const P = (x: number, y: number, z: number, rad: number): N => [r(x * LX), r(y * LY), r(z), r(rad)];
  const nodes: Record<string, N> = {
    hip: P(-0.46, 0.86, 0, 0.13),
    belly: P(-0.08, 0.84, 0, 0.13),
    chest: P(0.28, 0.9, 0, 0.16),
    neck: P(0.5, 1.06, 0, 0.11),
    head: P(0.68, 1.2, 0, 0.09),
    snout: P(0.68 + 0.2 * o.head * o.muzzle, 1.2 - 0.07 * o.head, 0, 0.05),
    l_shoulder: P(0.3, 0.8, 0.13, 0.06),
    l_elbow: P(0.22, 0.52, 0.14, 0.045),
    l_wrist: P(0.28, 0.17, 0.145, 0.035),
    l_ffoot: P(0.31, 0.05, 0.145, 0.035),
    l_hipj: P(-0.47, 0.8, 0.12, 0.06),
    l_knee: P(-0.34, 0.52, 0.145, 0.045),
    l_hock: P(-0.6, 0.25, 0.15, 0.035),
    l_bfoot: P(-0.56, 0.05, 0.15, 0.035),
  };
  for (const [n, [dx, dy]] of Object.entries(o.pose ?? {})) {
    const p = nodes[n];
    if (!p) throw new Error(`pose: no node ${n}`);
    nodes[n] = [f4(p[0] + r(dx)), f4(p[1] + r(dy)), p[2], p[3]];
  }
  const t = o.tail;
  const tailPts: [number, number][] = [[-0.62, 0.86], [-0.62 - 0.3 * t.len, 0.86 - 0.12 * t.droop], [-0.62 - 0.55 * t.len, 0.86 - 0.36 * t.droop], [-0.62 - 0.72 * t.len, 0.86 - 0.58 * t.droop + (t.curl ?? 0)]];
  tailPts.forEach(([x, y], i) => { nodes[`tail${i + 1}`] = P(x, y, 0, (0.05 - 0.01 * i) * (t.thick ?? 1)); });
  const links = [
    ["tail4", "tail3"], ["tail3", "tail2"], ["tail2", "tail1"], ["tail1", "hip"], ["hip", "belly"], ["belly", "chest"],
    ["chest", "neck"], ["neck", "head"], ["head", "snout"],
    ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_wrist"], ["l_wrist", "l_ffoot"],
    ["hip", "l_hipj"], ["l_hipj", "l_knee"], ["l_knee", "l_hock"], ["l_hock", "l_bfoot"],
  ];
  if (o.bib) {
    nodes.bib1 = P(0.42, 0.86, 0, 0.1);
    nodes.bib2 = P(0.2, 0.7, 0, 0.1);
    nodes.bib3 = P(-0.1, 0.72, 0, 0.09);
    links.push(["neck", "bib1"], ["bib1", "bib2"], ["bib2", "bib3"]);
  }

  // a leg bone as one ellipsoid from node a to node b (both sides): `fore` its half-depth fore to aft, `side` its
  // half-width, both in k, running `over` of its length past each end so the joints overlap
  function bone(a: string, b: string, fore: number, side: number, over: number, lower = false): Blob[] {
    const A = nodes[a]!, B = nodes[b]!, dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const len = Math.hypot(dx, dy, dz), rot: V = [0, 0, f4((Math.atan2(-dx, dy) * 180) / Math.PI)];
    const L = lower ? Math.sqrt(o.legs ?? 1) : o.legs ?? 1, off: V = [f4(dx / 2), f4(dy / 2), f4(dz / 2)], rr: V = [r(fore * L), f4((len / 2) * (1 + over)), r(side * L)];
    return [{ at: a, off, r: rr, rot }, { at: a.replace(/^l_/, "r_"), off: flipZ(off), r: rr, rot }];
  }
  // the body: a deep chest, ribs that tuck up to a narrow waist, a lean haunch, a thick neck under the ruff
  const C = o.chest;
  const blobs: Blob[] = [
    { at: "chest", off: mul([0.0, -0.05, 0], k), r: mul([0.3 * LX, 0.3 * C, 0.24], k) },
    { at: "belly", off: mul([0.06, 0.0, 0], k), r: mul([0.32 * LX, 0.2 * (0.6 + 0.4 * C) * (o.waist ?? 1), 0.18 * (o.waist ?? 1)], k) },
    { at: "hip", off: mul([0.04, 0.0, 0], k), r: mul([0.24 * LX, 0.16, 0.16], k) },
    { at: "neck", off: mul([-0.02, 0, 0], k), r: mul([0.19, 0.17, 0.14], k), rot: [0, 0, -40] },
    ...pair("l_shoulder", mul([0.0, 0.04, -0.02], k), mul([0.12, 0.2, 0.08], k)),
    ...bone("l_shoulder", "l_elbow", 0.11, 0.08, 0.15),
    ...bone("l_elbow", "l_wrist", 0.068, 0.06, 0.12),
    ...bone("l_wrist", "l_ffoot", 0.05, 0.052, 0.3, true),
    ...pair("l_elbow", mul([-0.03, 0, 0], k), mul([0.06, 0.06, 0.05], k)),
    ...bone("l_hipj", "l_knee", 0.15, 0.09, 0.2),
    ...bone("l_knee", "l_hock", 0.085, 0.062, 0.12),
    ...bone("l_hock", "l_bfoot", 0.05, 0.05, 0.3, true),
    ...pair("l_hock", mul([-0.02, 0, 0], k), mul([0.045, 0.045, 0.04], k)),
  ];
  if (o.ruff) blobs.push({ at: "neck", off: mul([-0.08, 0.03, 0], k), r: mul([0.22 * o.ruff, 0.24 * o.ruff, 0.19 * o.ruff], k), rot: [0, 0, -30] });

  const paint: { nodes: string[]; material: string }[] = [];
  if (o.bib) paint.push({ nodes: ["bib1", "bib2", "bib3"], material: "belly" });
  if (o.stripe) {
    const body = blobs.slice(0, 3).map((b) => ({ c: add(nodes[b.at]!.slice(0, 3) as V, b.off), r: b.r }));
    const names: string[] = [];
    for (const [i, x] of [0.32, 0.12, -0.08, -0.28, -0.5].entries()) {
      const top = skin(body, [r(x), r(0.8), 0], [0, 1, 0]);
      nodes[`sp${i + 1}`] = [top[0], f4(top[1] - r(0.022)), 0, r(0.05)];
      names.push(`sp${i + 1}`);
    }
    links.push(["neck", "sp1"], ...names.slice(1).map((n, i) => [names[i]!, n]));
    paint.push({ nodes: names, material: "stripe" });
  }

  // the head: a cranium, a long muzzle, cheeks, and a lower jaw hung open under it
  const M = o.muzzle;
  const T = o.snout ?? 1, Cr = o.crown ?? 1;
  const cran: Ell = { c: [0, 0.01, 0], r: [0.13, 0.11 * Cr, 0.115] };
  const muz: Ell = { c: [0.15 * M, -0.05, 0], r: [0.15 * M, 0.065 * T, 0.07 * T] };
  const cheek: Ell = { c: [0.05, -0.04, 0.06], r: [0.09, 0.075, 0.065] };
  const drop = 0.05 * o.gape;
  const jaw: Ell = { c: [0.13 * M, -0.115 - drop, 0], r: [0.13 * M, 0.035, 0.06] };
  const ells = [cran, muz, cheek, { c: flipZ(cheek.c), r: cheek.r }];
  for (const e of [...ells]) blobs.push({ at: "head", off: mul(e.c, H), r: mul(e.r, H) });
  blobs.push({ at: "head", off: mul(jaw.c, H), r: mul(jaw.r, H), rot: [0, 0, -10 * o.gape] });
  const on = (p: V, d: V, sink = 0, set = ells): V => {
    const s = skin(set, p, d), n = norm(d);
    return mul([s[0] - n[0] * sink, s[1] - n[1] * sink, s[2] - n[2] * sink], H);
  };
  const hr = (x: number) => f4(x * H);
  const tip = 0.3 * M; // the muzzle's front, in head units
  const parts: Part[] = [];
  // the open mouth: a dark gullet between the jaws, glowing faintly
  if (o.gape > 0) parts.push({ kind: "eye", at: "head", off: mul([0.15 * M, -0.09 - drop / 2, 0], H), r: hr(0.05 + 0.02 * o.gape), material: "mouth" });
  // nose and nostrils
  const nose = on([tip - 0.02, -0.03, 0], [1, 0.4, 0], 0.012);
  parts.push({ kind: "eye", at: "head", off: nose, r: hr(0.032), material: "nose" });
  parts.push({ kind: "eye", at: "head", off: add(nose, mul([0.012, -0.006, 0.012], H)), r: hr(0.011), mirror: true, material: "dark" });
  // upper teeth along the muzzle's underside, long canines at the front; the lower row on the jaw
  const n = 4;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), x = tip - 0.05 - f * 0.16 * M, z = 0.035 + f * 0.02;
    const at = on([x, -0.06, z * 0.5], [0, -1, 0.5], 0.012);
    parts.push({ kind: "horn", at: "head", off: at, dir: [0.1, -1, 0], len: hr(i === 0 ? 0.075 : 0.035), base: hr(i === 0 ? 0.017 : 0.011), curve: i === 0 ? 12 : 0, bend: [-1, 0, 0], tip_base: 0.001, mirror: true, material: "fang" });
  }
  if (o.gape > 0) for (let i = 0; i < 3; i++) {
    const x = jaw.c[0] + jaw.r[0] * (0.75 - i * 0.35);
    const at = add(on([x, jaw.c[1], 0.03], [0, 1, 0.4], 0.006, [jaw]), [0, 0, 0]);
    parts.push({ kind: "horn", at: "head", off: at, dir: [0.15, 1, 0], len: hr(i === 0 ? 0.06 : 0.03), base: hr(i === 0 ? 0.015 : 0.01), tip_base: 0.001, curve: 0, mirror: true, material: "fang" });
  }
  // lips: a dark band along each side of the muzzle
  parts.push({ kind: "ridge", at: "head", off: on([0.12 * M, -0.075, 0.045], [0.1, -0.3, 1], 0.012), dir: [1, 0.05, -0.15], len: hr(0.2 * M), base: hr(0.018), curve: 8, bend: [0, -1, 0], mirror: true, material: "dark" });
  // eyes: one coal in the brow, or a pair set forward under heavy brows
  if (o.eyes === "one") {
    const at = on([0.06, 0.05, 0], [0.8, 0.55, 0], 0.03);
    parts.push({ kind: "eye", at: "head", off: at, r: hr(0.055), material: "eye" });
    parts.push({ kind: "eye", at: "head", off: add(at, mul([0.035, 0.005, 0], H)), r: hr(0.022), material: "pupil" });
    parts.push({ kind: "ridge", at: "head", off: on([0.06, 0.1, 0.04], [0.5, 1, 0.3], 0.01), dir: [0.2, -0.1, -1], len: hr(0.12), base: hr(0.03), curve: 40, bend: [0, 1, 0], mirror: true, material: "fur" });
  } else {
    const eyeDir = norm([0.75, 0.3, 0.6]);
    const at = on([0.06, 0.03, 0.03], eyeDir, 0.022);
    parts.push({ kind: "eye", at: "head", off: at, r: hr(0.03), mirror: true, material: "eye" });
    parts.push({ kind: "eye", at: "head", off: add(at, mul(eyeDir, 0.02 * H)), r: hr(0.013), mirror: true, material: "pupil" });
    parts.push({ kind: "ridge", at: "head", off: on([0.05, 0.07, 0.05], [0.5, 1, 0.6], 0.01), dir: [0.3, -0.1, -1], len: hr(0.09), base: hr(0.022), curve: 30, bend: [0, 1, 0], mirror: true, material: "fur" });
  }
  // horns: from the crown behind the brow, curling back and out
  if (o.horns) {
    const h = o.horns;
    parts.push({ kind: "horn", at: "head", off: on([-0.02, 0.07, 0.05], [-0.1, 1, 0.5], 0.015), dir: h.dir, len: hr(h.len), base: hr(h.base), tip_base: 0.002, curve: h.curve, bend: h.bend, mirror: true, material: "horn" });
  }
  // ears: thick, pricked or laid back
  const e = o.ears;
  parts.push({ kind: "ear", at: "head", off: on([-0.04, 0.06, 0.06], [-0.3, 1, 0.7], 0.02), dir: e.dir, len: hr(e.len), width: hr(e.width), tilt: e.tilt, cup: e.cup, thick: 0.08, fold: e.fold, mirror: true, material: "fur" });

  // legs: lofted with a shoulder and an elbow, and paws with claws
  parts.push(
    { kind: "foot", at: "l_ffoot", form: "paw", len: r(0.15 * (o.paw ?? 1)), width: r(0.11 * (o.paw ?? 1)), toes: 4, claw: r(0.03 * (o.paw ?? 1)), sole: r(0.05), mirror: true, material: "fur", claw_mat: "claw" },
    { kind: "foot", at: "l_bfoot", form: "paw", len: r(0.14 * (o.paw ?? 1)), width: r(0.1 * (o.paw ?? 1)), toes: 4, claw: r(0.028 * (o.paw ?? 1)), sole: r(0.05), mirror: true, material: "fur", claw_mat: "claw" },
  );

  // fur: shag down the back, a ruff round the neck, feathering behind the legs, a bushy tail
  const S = o.shag;
  parts.push(
    { kind: "tuft", along: ["head", "neck", "chest", "belly", "hip"], n: 24, len: r(0.13 * S), base: r(0.03 * S), rows: 9, spread: 105, sweep: 1.6, curve: 25, flat: 0.5, material: o.stripe ? "stripe" : "tuft" },
    // a smooth tail (bush 0) has no fur of its own, only the bands
    ...(t.bush ? [{ kind: "tuft", along: t.tip ? ["tail3", "tail4"] : ["tail1", "tail2", "tail3", "tail4"], n: t.tip ? 6 : 14, len: r(0.15 * t.bush), base: r(0.035 * t.bush), rows: 8, spread: 165, sweep: 1.8, curve: 20, flat: 0.5, material: o.stripe ? "stripe" : "tuft" }] : []),
    { kind: "tuft", along: ["l_shoulder", "l_elbow"], n: 4, len: r(0.1 * S), base: r(0.028 * S), rows: 3, spread: 50, flat: 0.5, mirror: true, material: "tuft" },
    { kind: "tuft", along: ["l_hipj", "l_knee"], n: 4, len: r(0.1 * S), base: r(0.03 * S), rows: 3, spread: 50, flat: 0.5, mirror: true, material: "tuft" },
  );
  // a fringe hanging under the chest and belly
  parts.push({ kind: "tuft", along: ["chest", "belly"], n: 10, len: r(0.13 * S), base: r(0.03 * S), rows: 2, spread: 150, sweep: 0.6, curve: 15, flat: 0.5, material: "tuft" });
  if (o.ruff) parts.push({ kind: "tuft", along: ["neck", "chest"], n: 12, len: r(0.17 * S * o.ruff), base: r(0.04 * S), rows: 10, spread: 160, sweep: 1.5, curve: 35, flat: 0.5, material: "tuft" });

  return {
    id: o.id, name: o.name, about: o.about, archetype: o.archetype, feet: 4, budget: o.budget, root: "belly", material: "fur",
    belly: "belly", belly_turn: -0.3, blend: 0.012, palette: o.palette, hide: o.hide, nodes, links, blobs, parts,
    ...(paint.length ? { paint } : {}),
    ...(o.bands ? { stripes: { along: ["tail3", "tail2", "tail1", "hip", "belly", "chest", "neck"], n: o.bands.n, width: o.bands.width, material: "stripe", below: -0.3 } } : {}),
  };
}

const BEASTS: Record<string, () => unknown> = {
  // The Appalachian mountain cat, as the school statues and the panther it's built on show it: long and low, slinking, a
  // small round head on a short muzzle, round ears, a long tail with a lifted tip, dark tabby bands, eyes that glow green.
  "wampus-cat": () => hound({
    id: "wampus-cat", name: "Wampus Cat", archetype: "skirmisher", budget: 8000, k: 0.95, head: 1.1, muzzle: 0.55, snout: 1.2, crown: 1.05, gape: 0.5,
    about: "Appalachian and Cherokee tellings from Tennessee and the Carolinas: a great lean cat of the mountains that slinks low through the laurel at night, its eyes glowing yellow-green out of the dark.",
    long: 1.15, tall: 0.85, legs: 1.1, ears: { len: 0.12, width: 0.09, dir: [-0.2, 1, 0.45], cup: 35, tilt: 18, fold: 0.35 }, eyes: "two", chest: 0.85, ruff: 0, shag: 0.45,
    tail: { len: 1.5, droop: 1.15, bush: 0, curl: 0.3, thick: 1.5 }, bands: { n: 10, width: 0.5 },
    palette: {
      fur: [0.42, 0.36, 0.28, 0.9, 0], tuft: [0.5, 0.43, 0.33, 0.9, 0], belly: [0.82, 0.74, 0.6, 0.9, 0], stripe: [0.09, 0.08, 0.08, 0.9, 0],
      eye: [0.75, 1, 0.2, 0.3, 0, 4], pupil: [0.02, 0.03, 0.02, 0.2, 0], mouth: [0.4, 0.08, 0.1, 0.6, 0],
      nose: [0.45, 0.25, 0.24, 0.5, 0], dark: [0.06, 0.04, 0.04, 0.6, 0], fang: [0.94, 0.92, 0.84, 0.3, 0], claw: [0.85, 0.82, 0.74, 0.4, 0],
    },
    hide: { pattern: "fur", size: 0.03, colours: [[0.3, 0.25, 0.2], [0.6, 0.52, 0.4]], map: 1024 },
  }),
  // The Ozark Howler of the folk drawings: a bear-sized black cat, stocky and shaggy, curving horns, red eyes, a fanged
  // gape, a long ropy tail with a tuft at the end. A child draws: a big black furry cat, the horns, the red eyes.
  "ozark-howler": () => hound({
    id: "ozark-howler", name: "Ozark Howler", archetype: "bruiser", budget: 9000, k: 1.2, head: 1.25, muzzle: 0.7, snout: 1.35, crown: 0.95, gape: 1,
    about: "The Ozark hills of Arkansas and Missouri: a bear-sized black cat with shaggy fur, horns on its head and eyes that glow ember-red, known for a howl somewhere between a wolf's and an elk's bugle.",
    long: 0.95, tall: 0.9, legs: 1.45, ears: { len: 0.09, width: 0.08, dir: [-0.4, 1, 0.6], cup: 30, tilt: 25, fold: 0.3 }, eyes: "two", chest: 1.3, ruff: 1.2, shag: 1.4,
    tail: { len: 1.25, droop: 1.1, bush: 1.3, curl: 0.15, tip: true },
    horns: { len: 0.42, base: 0.05, curve: 120, dir: [-0.35, 1, 0.35], bend: [-1, -0.2, 0.4] },
    palette: {
      fur: [0.15, 0.12, 0.11, 0.95, 0], tuft: [0.21, 0.17, 0.15, 0.95, 0], belly: [0.2, 0.14, 0.11, 0.95, 0], stripe: [0.1, 0.08, 0.08, 0.95, 0],
      horn: [0.78, 0.62, 0.36, 0.45, 0], eye: [1, 0.2, 0.05, 0.3, 0, 5], pupil: [1, 0.7, 0.3, 0.2, 0, 6], mouth: [0.45, 0.06, 0.05, 0.6, 0, 0.6],
      nose: [0.05, 0.04, 0.04, 0.4, 0], dark: [0.05, 0.03, 0.03, 0.6, 0], fang: [0.95, 0.88, 0.6, 0.3, 0], claw: [0.8, 0.75, 0.65, 0.4, 0],
    },
    hide: { pattern: "fur", size: 0.06, colours: [[0.08, 0.065, 0.06], [0.19, 0.16, 0.14]], map: 1024 },
  }),
  // East Anglia's churchyard hound: calf-sized, shaggy and black, one coal of an eye, a snarl of fangs (refs: the
  // 1577 Bungay pamphlet's dog, modern folk paintings). A child draws: black shaggy dog, the burning eye, the teeth.
  "black-shuck": () => hound({
    id: "black-shuck", name: "Black Shuck", archetype: "skirmisher", budget: 9000, k: 1.05, head: 1.1, muzzle: 1.1, gape: 0.8,
    about: "The coast roads and churchyards of East Anglia, and the Bungay storm of 1577 when it burst into the church: a huge shaggy black hound the size of a calf, with a single eye that burns like a coal in the middle of its head.",
    ears: { len: 0.21, width: 0.065, dir: [-0.15, 1, 0.3], cup: 25, tilt: 10, fold: 0.3 }, eyes: "one", chest: 1.1, ruff: 1.1, shag: 1.3,
    tail: { len: 1.0, droop: 0.9, bush: 1.4 },
    palette: {
      fur: [0.13, 0.12, 0.15, 0.95, 0], tuft: [0.17, 0.16, 0.19, 0.95, 0], belly: [0.14, 0.11, 0.1, 0.95, 0], stripe: [0.1, 0.09, 0.12, 0.95, 0],
      eye: [1, 0.25, 0.04, 0.3, 0, 6], pupil: [1, 0.85, 0.4, 0.2, 0, 8], mouth: [0.55, 0.08, 0.04, 0.6, 0, 1.2],
      nose: [0.05, 0.05, 0.06, 0.4, 0], dark: [0.04, 0.03, 0.04, 0.6, 0], fang: [0.92, 0.88, 0.76, 0.3, 0], claw: [0.2, 0.19, 0.2, 0.4, 0],
    },
    hide: { pattern: "fur", size: 0.05, colours: [[0.07, 0.065, 0.08], [0.17, 0.16, 0.2]], map: 1024 },
  }),
  // The Gevaudan beast as the 1764 prints and the Marvejols and Saugues statues show it: a wolf too big, a huge head on a
  // deep chest, a long open jaw, reddish with a black band down the spine, a pale throat, a long heavy tail.
  gevaudan: () => hound({
    id: "gevaudan", name: "Beast of Gevaudan", archetype: "bruiser", budget: 9000, k: 1.15, head: 1.3, muzzle: 1.3, snout: 1.3, crown: 0.8, gape: 1,
    about: "The Margeride hills of southern France, 1764 to 1767: a wolf far bigger than any wolf, reddish with a broad black stripe down its spine, a huge head and chest, long fangs and a long thick tail, that killed scores before it was shot.",
    legs: 1.25, ears: { len: 0.17, width: 0.06, dir: [-0.25, 1, 0.25], cup: 30, tilt: 8, fold: 0.25 }, eyes: "two", chest: 1.25, ruff: 0.9, shag: 1.0,
    tail: { len: 1.15, droop: 0.95, bush: 1.2 }, stripe: true, bib: true,
    palette: {
      fur: [0.5, 0.34, 0.23, 0.95, 0], tuft: [0.6, 0.46, 0.34, 0.95, 0], belly: [0.86, 0.76, 0.6, 0.95, 0], stripe: [0.12, 0.09, 0.08, 0.95, 0],
      eye: [0.95, 0.7, 0.2, 0.3, 0, 0.6], pupil: [0.03, 0.02, 0.02, 0.2, 0], mouth: [0.35, 0.06, 0.06, 0.6, 0],
      nose: [0.06, 0.05, 0.05, 0.4, 0], dark: [0.08, 0.05, 0.04, 0.6, 0], fang: [0.95, 0.92, 0.82, 0.3, 0], claw: [0.18, 0.15, 0.13, 0.4, 0],
    },
    hide: { pattern: "fur", size: 0.045, colours: [[0.28, 0.18, 0.12], [0.72, 0.58, 0.44]], map: 1024 },
  }),
};

// The Chimera as the Arezzo bronze, the Apulian plate and the old engravings show it: a lean lion crouched to spring,
// a mane that rays round a roaring face, a she-goat's neck and horned head rising from the middle of its back, and a
// scaled serpent for a tail that arches up over the rump to bite. A child draws: the lion, the goat on its back, the snake.
function chimera() {
  const k = 1.1;
  const b = hound({
    id: "chimera", name: "Chimera", archetype: "bruiser", budget: 9000, k, head: 1.35, muzzle: 0.6, snout: 1.35, crown: 0.95, gape: 1.2,
    about: "Lycia in Greek myth, slain by Bellerophon riding Pegasus: a fire-breathing lion in front, a she-goat's head rising from the middle of its back, and a serpent for its tail.",
    long: 1.05, tall: 0.95, legs: 1.15, waist: 0.82, paw: 1.35,
    // the Arezzo bronze's crouch: the chest dropped low between forelegs braced out in front, the head raised to roar,
    // the hind legs folded under the haunch ready to spring
    pose: {
      chest: [0, -0.1], belly: [0, -0.04], l_shoulder: [0.02, -0.1], neck: [0.02, -0.06], head: [0.03, -0.04], snout: [0.03, -0.04],
      l_elbow: [0.12, -0.13], l_wrist: [0.24, -0.03], l_ffoot: [0.27, 0],
      hip: [0, -0.02], l_hipj: [0, -0.02], l_knee: [0.1, -0.1], l_hock: [-0.02, -0.06], l_bfoot: [0.04, 0],
    }, ears: { len: 0.06, width: 0.07, dir: [-0.3, 1, 0.6], cup: 35, tilt: 20, fold: 0.3 }, eyes: "two", chest: 1.1, ruff: 1.45, shag: 0.5,
    tail: { len: 1, droop: 0, bush: 0 },
    palette: {
      fur: [0.74, 0.52, 0.24, 0.9, 0], tuft: [0.5, 0.24, 0.08, 0.95, 0], belly: [0.9, 0.78, 0.56, 0.9, 0], stripe: [0.2, 0.32, 0.12, 0.6, 0],
      goat: [0.36, 0.27, 0.2, 0.95, 0], horn: [0.28, 0.24, 0.2, 0.5, 0], scale: [0.3, 0.48, 0.2, 0.55, 0],
      eye: [1, 0.55, 0.08, 0.3, 0, 4], pupil: [0.03, 0.02, 0.02, 0.2, 0], snake_eye: [0.75, 1, 0.2, 0.3, 0, 4], mouth: [0.6, 0.12, 0.04, 0.6, 0, 1.5],
      nose: [0.32, 0.18, 0.14, 0.5, 0], dark: [0.08, 0.05, 0.04, 0.6, 0], fang: [0.95, 0.93, 0.85, 0.3, 0], claw: [0.85, 0.8, 0.7, 0.4, 0],
    },
    hide: { pattern: "fur", size: 0.03, colours: [[0.55, 0.38, 0.17], [0.85, 0.66, 0.36]], map: 1024 },
  }) as { nodes: Record<string, N>; links: string[][]; blobs: Blob[]; parts: Part[]; paint?: { nodes: string[]; material: string }[] } & Record<string, unknown>;
  const P = (x: number, y: number, z: number, rad: number): N => [f4(x * k), f4(y * k), f4(z * k), f4(rad * k)];
  // the serpent: the tail rises off the rump, arches over and ends in a head turned forward to strike
  Object.assign(b.nodes, {
    tail1: P(-0.66, 0.92, 0, 0.06), tail2: P(-0.92, 1.06, 0, 0.055), tail3: P(-1.0, 1.32, 0, 0.05), tail4: P(-0.88, 1.5, 0, 0.045),
    shead: P(-0.7, 1.56, 0, 0.055), ssnout: P(-0.58, 1.53, 0, 0.035),
    // the goat: a long neck out of the middle of the back, a narrow head, swept-back horns
    g1: P(-0.12, 0.98, 0, 0.07), g2: P(-0.06, 1.24, 0, 0.06), ghead: P(0.0, 1.42, 0, 0.06), gmuzzle: P(0.14, 1.36, 0, 0.035),
  });
  b.links.push(["tail4", "shead"], ["shead", "ssnout"], ["belly", "g1"], ["g1", "g2"], ["g2", "ghead"], ["ghead", "gmuzzle"]);
  const s = (x: number) => f4(x * k);
  b.blobs.push(
    { at: "shead", off: [s(0.03), 0, 0], r: [s(0.09), s(0.055), s(0.065)] },
    { at: "g1", off: [s(0.03), s(0.1), 0], r: [s(0.075), s(0.17), s(0.065)], rot: [0, 0, -15] },
    { at: "ghead", off: [s(0.02), 0, 0], r: [s(0.08), s(0.065), s(0.055)] },
    { at: "ghead", off: [s(0.1), s(-0.04), 0], r: [s(0.09), s(0.04), s(0.035)], rot: [0, 0, -25] },
  );
  // the tail and the snake head scaled green, banded darker
  b.paint = [...(b.paint ?? []), { nodes: ["tail2", "tail3", "tail4", "shead", "ssnout"], material: "scale" }];
  b.stripes = { along: ["tail1", "tail2", "tail3", "tail4"], n: 6, width: 0.45, material: "stripe", below: -0.3 };
  b.parts.push(
    // the lion's mane rays out round the face as spikes of hair
    // a full ring of them, the chin and throat too, not only the top and sides
    { kind: "tuft", along: ["head", "neck"], n: 12, len: s(0.34), base: s(0.075), rows: 18, spread: 170, sweep: 0.6, curve: 12, flat: 0.4, material: "tuft" },
    // the goat: eyes, a beard, swept-back horns, ears
    { kind: "eye", at: "ghead", off: [s(0.05), s(0.03), s(0.045)], r: s(0.02), mirror: true, material: "eye" },
    { kind: "horn", at: "ghead", off: [s(-0.01), s(0.05), s(0.03)], dir: [-0.6, 1, 0.15], len: s(0.3), base: s(0.03), tip_base: 0.002, curve: 70, bend: [-1, -0.3, 0], mirror: true, material: "horn" },
    { kind: "horn", at: "ghead", off: [s(-0.03), s(0.02), s(0.05)], dir: [-0.4, 0.1, 1], len: s(0.09), base: s(0.025), tip_base: 0.004, flat: 0.4, mirror: true, material: "goat" },
    { kind: "tuft", along: ["ghead", "gmuzzle"], n: 3, len: s(0.1), base: s(0.025), rows: 1, spread: 20, sweep: 0.2, flat: 0.5, material: "goat" },
    { kind: "tuft", along: ["g1", "g2", "ghead"], n: 6, len: s(0.07), base: s(0.025), rows: 4, spread: 80, sweep: 1.2, flat: 0.5, material: "goat" },
    // the snake: glowing eyes, fangs bared at the front of its mouth
    { kind: "eye", at: "shead", off: [s(0.06), s(0.03), s(0.045)], r: s(0.018), mirror: true, material: "snake_eye" },
    { kind: "horn", at: "ssnout", off: [s(0.0), s(-0.025), s(0.02)], dir: [0.2, -1, 0], len: s(0.06), base: s(0.012), tip_base: 0.001, curve: 15, bend: [-1, 0, 0], mirror: true, material: "fang" },
  );
  // the goat's neck and head in its own dark coat
  b.paint.push({ nodes: ["g1", "g2", "ghead", "gmuzzle"], material: "goat" });
  return b;
}
BEASTS.chimera = chimera;

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BEASTS);
for (const id of ids) {
  const make = BEASTS[id];
  if (!make) throw new Error(`no beast ${id}: ${Object.keys(BEASTS).join(", ")}`);
  await Bun.write(join(import.meta.dir, "..", "..", "beasts", `${id}.json`), JSON.stringify(make(), null, 2) + "\n");
  console.log(`beasts/${id}.json`);
}

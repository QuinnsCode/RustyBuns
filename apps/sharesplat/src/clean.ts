// Clean a raw product capture: keep the product, drop the table it stood on and the floaters round the room.
//
// A trained splat of a product on a table is mostly not the product: the tabletop runs out far past it, and stray
// splats hang in the air where the trainer guessed at the background. With no camera poses to hand, the box comes
// from the splats themselves: sliced into thin layers by height, the product is the run of dense layers whose
// footprint stays narrow, and the table is the dense layer under it that is suddenly far wider. Floaters are too
// thin on the ground to make a layer dense.
//
// Pure arithmetic on positions, opacity and size, so it runs in a test as it does in the page (main.ts reads them
// out of Spark's PackedSplats and writes the kept ones back as an .spz).

export type Splats = {
  /** x, y, z for each splat, in the file's own frame. */
  pos: Float32Array;
  /** 0 to 1. */
  opacity: Float32Array;
  /** Each splat's largest radius. */
  size: Float32Array;
};

export type Cleaned = {
  keep: Uint8Array;
  kept: number;
  /** The height the table's top was cut at, or null when there was no table. */
  table: number | null;
  /** The box kept: centre (x, z) and footprint radius, and the height range (along `up`), in the file's frame. */
  box: { cx: number; cz: number; radius: number; low: number; high: number };
};

/** Height layers across the capture: about a centimetre each on a two-metre room. */
const LAYERS = 200;
/** Fainter than this is mist, not surface. */
const FAINT = 0.1;
/** A layer this many times wider than the product's usual footprint is the table. */
const TABLE_WIDER = 1.6;
/** Empty layers a product may have inside it (a handle, a gap under a lid) before what is above counts as the room. */
const GAP = 3;

function quantile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0) return 0;
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}

/**
 * Which splats to keep. `up` is the file's up axis as a sign on y: most capture tools write y-down (-1), which is
 * also why the viewer turns the mesh upright.
 */
export function clean(s: Splats, up: 1 | -1 = -1): Cleaned {
  const n = s.opacity.length;
  const keep = new Uint8Array(n);
  // Huge splats are the trainer painting the background: far bigger than the surface splats round them.
  const typical = quantile(s.size.filter((_, i) => s.opacity[i]! >= FAINT), 0.5);
  const big = typical * 20 || Infinity;
  const solid: number[] = [];
  for (let i = 0; i < n; i++) if (s.opacity[i]! >= FAINT && s.size[i]! <= big) solid.push(i);

  const h = (i: number) => up * s.pos[i * 3 + 1]!;
  const cx = quantile(solid.map((i) => s.pos[i * 3]!), 0.5);
  const cz = quantile(solid.map((i) => s.pos[i * 3 + 2]!), 0.5);
  const dist = (i: number) => Math.hypot(s.pos[i * 3]! - cx, s.pos[i * 3 + 2]! - cz);

  const heights = solid.map(h);
  const lo = quantile(heights, 0.005), hi = quantile(heights, 0.995);
  // Never thinner than a few splats, or a clean capture (nothing but the product) has a gap between every row.
  const step = Math.max((hi - lo) / LAYERS, typical * 3) || 1;
  const count = Math.max(1, Math.ceil((hi - lo) / step));
  const layers: number[][] = Array.from({ length: count }, () => []);
  for (const i of solid) {
    const b = Math.floor((h(i) - lo) / step);
    if (b >= 0 && b < count) layers[b]!.push(i);
  }
  const dense = Math.max(8, solid.length * 0.002);
  const reach = layers.map((l) => (l.length >= dense ? quantile(l.map(dist), 0.8) : NaN));
  const usual = quantile(reach.filter((r) => !Number.isNaN(r)), 0.5);
  const wide = (b: number) => reach[b]! > usual * TABLE_WIDER;
  const narrow = reach.flatMap((r, b) => (!Number.isNaN(r) && !wide(b) ? [b] : []));
  const middle = narrow[Math.floor(narrow.length / 2)] ?? 0;

  // The table: the highest wide layer under the product's middle.
  let cut = -1;
  for (let b = 0; b < middle; b++) if (wide(b)) cut = b;
  // The product: narrow layers up from the table, until a run of empty ones.
  const run: number[] = [];
  for (const b of narrow) {
    if (b <= cut) continue;
    if (run.length && b - run[run.length - 1]! > GAP + 1) break;
    run.push(b);
  }
  const radius = Math.max(0, ...run.map((b) => quantile(layers[b]!.map(dist), 0.98))) * 1.1;
  // Cut at the tabletop itself (the part of it out past the product), not the layer's edge, so the product's bottom stays.
  const top = cut < 0 ? null : quantile(layers[cut]!.filter((i) => dist(i) > radius).map(h), 0.98);
  const low = top ?? lo + ((run[0] ?? 0) - 1) * step;
  const high = lo + ((run[run.length - 1] ?? count) + 1) * step;

  let kept = 0;
  for (const i of solid) {
    const y = h(i);
    if (y > low && y <= high && dist(i) <= radius) { keep[i] = 1; kept++; }
  }
  return { keep, kept, table: top, box: { cx, cz, radius, low, high } };
}

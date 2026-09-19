// The spray: which splats does one burst of paint reach?
//
// A cone leaves the camera. Splats inside it are binned into a small grid
// across the cone; in each cell, the nearest solid splat is the surface the
// paint hits, and only splats within `thickness` of that surface get painted.
// Splats are blobs, not points: each solid splat blocks every cell its radius
// covers, so paint can't leak through the gaps between them.
// So paint lands on the front of the snowman, not on the hedge behind it.
//
// Pure and allocation-light on purpose: this is the loop that moves to Rust
// (and gets a spatial index) once scenes reach millions of splats.

export interface SprayParams {
  /** xyz per splat, in the same space as origin/dir */
  centers: Float32Array;
  /** 0..1 per splat; faint splats don't block paint */
  opacities: Float32Array;
  /** world-space blob radius per splat; without it, each splat blocks one cell and its neighbors */
  radii?: Float32Array;
  origin: [number, number, number];
  /** unit vector */
  dir: [number, number, number];
  halfAngleDeg: number;
  /** how deep paint soaks past the first surface, in scene units */
  thickness: number;
  /** cells across the cone; more = finer occlusion */
  grid?: number;
  minOpacity?: number;
  near?: number;
  /** cap on how many cells a single splat can block in each direction */
  maxFootprint?: number;
}

export function spray(p: SprayParams): Uint32Array {
  const { centers, opacities, origin: [ox, oy, oz], dir: [dx, dy, dz], thickness } = p;
  const grid = p.grid ?? 48;
  const minOpacity = p.minOpacity ?? 0.3;
  const near = p.near ?? 0.05;
  const maxFootprint = p.maxFootprint ?? 6;
  const radii = p.radii;
  const tan = Math.tan((p.halfAngleDeg * Math.PI) / 180);

  // basis across the cone
  let [ux, uy, uz] = Math.abs(dy) < 0.9 ? [dz, 0, -dx] : [0, -dz, dy];   // dir × (0,1,0) or dir × (1,0,0)
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = uy * dz - uz * dy, vy = uz * dx - ux * dz, vz = ux * dy - uy * dx;   // U × dir

  const n = opacities.length;
  const cellOf = new Int32Array(n).fill(-1);
  const depthOf = new Float32Array(n);
  const nearest = new Float32Array(grid * grid).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const px = centers[i * 3]! - ox, py = centers[i * 3 + 1]! - oy, pz = centers[i * 3 + 2]! - oz;
    const d = px * dx + py * dy + pz * dz;
    if (d <= near) continue;
    const a = (px * ux + py * uy + pz * uz) / (d * tan);
    const b = (px * vx + py * vy + pz * vz) / (d * tan);
    if (a * a + b * b > 1) continue;
    const col = Math.min(grid - 1, ((a + 1) * 0.5 * grid) | 0);
    const row = Math.min(grid - 1, ((b + 1) * 0.5 * grid) | 0);
    const cell = row * grid + col;
    cellOf[i] = cell;
    depthOf[i] = d;
    if (opacities[i]! < minOpacity) continue;
    // cells covered by this blob: its radius, measured in cells at this depth
    const reach = radii
      ? Math.min(maxFootprint, Math.ceil((radii[i]! / (d * tan)) * 0.5 * grid))
      : 1;
    const r0 = Math.max(0, row - reach), r1 = Math.min(grid - 1, row + reach);
    const c0 = Math.max(0, col - reach), c1 = Math.min(grid - 1, col + reach);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * grid + c;
        if (d < nearest[k]!) nearest[k] = d;
      }
    }
  }

  let count = 0;
  const hits = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const cell = cellOf[i]!;
    if (cell < 0) continue;
    // a cell with only faint splats has no surface: paint them all
    if (depthOf[i]! <= nearest[cell]! + thickness) hits[count++] = i;
  }
  return hits.slice(0, count);
}

export interface ScanParams extends SprayParams {
  /** how many dots a single shot leaves */
  dots?: number;
  /** picked deterministically in tests; Math.random by default */
  rand?: () => number;
}

/**
 * A scanner shot: instead of painting every splat in the cone, it lights up
 * one splat per ray, leaving a scatter of dots on whatever surface is nearest.
 * That's the Scanner Sombre look, and it's why a shot reveals shape without
 * revealing colour everywhere at once.
 *
 * Rays are the cells of the same grid the occlusion test uses, so this costs
 * one pass over the splats regardless of how many dots are asked for.
 */
export function scan(p: ScanParams): Uint32Array {
  const { centers, opacities, origin: [ox, oy, oz], dir: [dx, dy, dz] } = p;
  const dots = p.dots ?? 220;
  const rand = p.rand ?? Math.random;
  const minOpacity = p.minOpacity ?? 0.3;
  const near = p.near ?? 0.05;
  // grid fine enough that each dot lands in its own cell
  const grid = p.grid ?? Math.max(16, Math.ceil(Math.sqrt(dots * 4)));
  const tan = Math.tan((p.halfAngleDeg * Math.PI) / 180);

  let [ux, uy, uz] = Math.abs(dy) < 0.9 ? [dz, 0, -dx] : [0, -dz, dy];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = uy * dz - uz * dy, vy = uz * dx - ux * dz, vz = ux * dy - uy * dx;

  const cells = grid * grid;
  const nearest = new Float32Array(cells).fill(Infinity);
  const winner = new Int32Array(cells).fill(-1);

  for (let i = 0; i < opacities.length; i++) {
    if (opacities[i]! < minOpacity) continue;
    const px = centers[i * 3]! - ox, py = centers[i * 3 + 1]! - oy, pz = centers[i * 3 + 2]! - oz;
    const d = px * dx + py * dy + pz * dz;
    if (d <= near) continue;
    const a = (px * ux + py * uy + pz * uz) / (d * tan);
    const b = (px * vx + py * vy + pz * vz) / (d * tan);
    if (a * a + b * b > 1) continue;
    const cell = Math.min(grid - 1, ((b + 1) * 0.5 * grid) | 0) * grid + Math.min(grid - 1, ((a + 1) * 0.5 * grid) | 0);
    if (d < nearest[cell]!) { nearest[cell] = d; winner[cell] = i; }
  }

  // collect the cells that hit something, then thin them down to `dots`
  const hit: number[] = [];
  for (let c = 0; c < cells; c++) if (winner[c]! >= 0) hit.push(winner[c]!);
  if (hit.length <= dots) return new Uint32Array(hit);
  for (let i = hit.length - 1; i > 0; i--) {   // partial shuffle: unbiased pick of `dots`
    const j = Math.floor(rand() * (i + 1));
    [hit[i], hit[j]] = [hit[j]!, hit[i]!];
    if (hit.length - i >= dots) break;
  }
  return new Uint32Array(hit.slice(-dots));
}

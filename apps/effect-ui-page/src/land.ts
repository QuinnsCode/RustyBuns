// A plot's land as data: the shapes a world built with @world/kit hands the page, so Agent Galaxy can stand everyone's
// land side by side in one 3D scene. Shapes and colours only. A neighbour's code never runs in that scene, and what a
// frame sends is checked here like anything else from outside. No DOM.
import { arr, check, int, num, obj, opt, str, type Of } from "@rustybuns/util/guard";

/** A plot is this many units square, centred on 0: the kit's SIZE and the galaxy's. */
export const PLOT = 200;
const coord = num(-4000, 4000);

/** One mesh: its corners (x, y, z), faces, colour, see-through amount, and for many copies a 4x4 matrix each. */
const Part = obj({ p: arr(coord, 60_000), i: opt(arr(int(0, 20_000), 120_000)), c: str(7, { re: /^#[0-9a-f]{6}$/ }), o: opt(num(0, 1)), m: opt(arr(coord, 48_000)) });
export type Part = Of<typeof Part>;
export const Land = obj({ parts: arr(Part, 300) });
export type Land = Of<typeof Land>;

/** Most triangles one plot may put in the shared scene. */
const TRIANGLES = 250_000;
/** How far past its own edge a plot's shape may reach (a tree's crown), and how high. */
const REACH = PLOT / 2 + 12, HIGH = 250;

/** Where a part's corners (or its copies) reach: the farthest east-west or north-south, and the highest. */
function reach({ p, m }: Part) {
  let out = 0, up = 0;
  const see = (x: number, y: number, z: number, wide = 0) => { out = Math.max(out, Math.abs(x) + wide, Math.abs(z) + wide); up = Math.max(up, y + wide); };
  if (!m) for (let i = 0; i + 2 < p.length; i += 3) see(p[i]!, p[i + 1]!, p[i + 2]!);
  else {
    let size = 0;
    for (const v of p) size = Math.max(size, Math.abs(v));
    // A copy is its place plus the shape stretched by its longest column.
    for (let i = 0; i + 15 < m.length; i += 16) see(m[i + 12]!, m[i + 13]!, m[i + 14]!, size * Math.max(Math.hypot(m[i]!, m[i + 1]!, m[i + 2]!), Math.hypot(m[i + 8]!, m[i + 9]!, m[i + 10]!)) - size);
  }
  return { out, up };
}

/** The land from what a frame said, or null: only what stays on its own plot (nobody's shape covers a neighbour), up to
 *  a plot's worth of triangles. */
export function landFrom(said: unknown): Land | null {
  const land = check(Land, said);
  if (!land) return null;
  let left = TRIANGLES;
  const parts = land.parts.filter((part) => {
    const corners = part.p.length / 3;
    if (part.i?.some((i) => i >= corners)) return false;
    const { out, up } = reach(part);
    if (out > REACH || up > HIGH) return false;
    left -= ((part.i?.length ?? corners) / 3) * (part.m ? part.m.length / 16 : 1);
    return left >= 0;
  });
  return parts.length ? { parts } : null;
}

/** A part that covers most of the plot: its ground. */
export const isGround = (part: Part) => !part.m && reach(part).out >= PLOT * 0.45 && part.p.length > 300;

// A plot's land as data: the shapes a world built with @world/kit hands the page, and its mood (sky, light, weather,
// chimney smoke), so Agent Galaxy can stand everyone's land side by side in one 3D scene. Shapes, colours and bounded
// numbers only. A neighbour's code never runs in that scene, and what a frame sends is checked here like anything else
// from outside. No DOM.
import { arr, bool, check, int, num, obj, oneOf, opt, raw, str, type Of } from "@rustybuns/util/guard";

/** A plot is this many units square, centred on 0: the kit's SIZE and the galaxy's. */
export const PLOT = 200;
const coord = num(-4000, 4000);
const colour = str(7, { re: /^#[0-9a-f]{6}$/ });

/** One mesh: its corners (x, y, z), faces, colour, see-through amount, glow, `s` for shapes that are never the ground
 *  (many merged into one), and for many copies a 4x4 matrix each. */
const Part = obj({ p: arr(coord, 60_000), i: opt(arr(int(0, 20_000), 120_000)), c: colour, o: opt(num(0, 1)), e: opt(num(0, 4)), s: opt(bool()), m: opt(arr(coord, 48_000)) });
export type Part = Of<typeof Part>;

const Spot = obj({ x: num(-PLOT / 2, PLOT / 2), y: num(0, 120), z: num(-PLOT / 2, PLOT / 2) });
/** The air over a plot: the sky's two colours, fog, the sun and the sky's fill, how much lights bloom, what falls or
 *  floats there, where chimneys smoke and whether cars fly. */
export const Mood = obj({
  top: colour, low: colour, fog: colour, near: num(40, 800), far: num(200, 1500),
  sun: colour, power: num(0, 4), sky: colour, dirt: colour, fill: num(0, 3), bloom: num(0, 1.2),
  weather: oneOf(["clear", "rain", "snow", "fireflies"]), smoke: opt(arr(Spot, 12)), cars: opt(bool()),
});
export type Mood = Of<typeof Mood>;

/** A land with no mood of its own, and open land: a clear day. */
export const DAY: Mood = {
  top: "#5b97d6", low: "#d6e8fb", fog: "#c4dcf0", near: 260, far: 900,
  sun: "#fff0d0", power: 1.8, sky: "#dfeaff", dirt: "#6b6a45", fill: 1.2, bloom: 0.25, weather: "clear",
};

export const Land = obj({ parts: arr(Part, 300), mood: opt(Mood) });
export type Land = Of<typeof Land>;
const Said = obj({ parts: arr(Part, 300), mood: opt(raw) });

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
 *  a plot's worth of triangles. A mood that doesn't check out is left behind; the shapes still stand. */
export function landFrom(said: unknown): Land | null {
  const land = check(Said, said);
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
  if (!parts.length) return null;
  const mood = check(Mood, land.mood);
  return mood ? { parts, mood } : { parts };
}

/** A part that covers most of the plot: its ground. */
export const isGround = (part: Part) => !part.m && !part.s && reach(part).out >= PLOT * 0.45 && part.p.length > 300;

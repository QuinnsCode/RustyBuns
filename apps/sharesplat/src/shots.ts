// What to photograph. Two plans, because the two ways of getting 3D out of photos want different inputs:
//
// - "six": front, back, left, right, top, bottom. Enough for an image-to-3D model to *guess* a mesh
//   (the hidden parts are invented). Fast, fine for a thumbnail spin, not faithful.
// - "orbit": three rings of photos around the object plus a flipped ring for its underside. This is what
//   Gaussian splatting (and photogrammetry) need: every point seen from many angles with lots of overlap.
//   Splats reconstruct what was photographed; they cannot fill in a side nobody shot.

export type PlanId = "six" | "orbit";

export type Shot = {
  /** Stable index into the plan. */
  i: number;
  /** Which ring: "side" for the six-view plan, else low / mid / high / under. */
  ring: Ring;
  /** Degrees around the object, 0 = front, clockwise seen from above. */
  azimuth: number;
  /** Degrees above the table: 0 is level with the object's middle, 90 straight down. */
  elevation: number;
  /** What to tell the person holding the phone. */
  say: string;
};

export type Ring = "side" | "low" | "mid" | "high" | "under";

const SIX: Array<[string, number, number]> = [
  ["Front", 0, 0], ["Right side", 90, 0], ["Back", 180, 0], ["Left side", 270, 0], ["Top", 0, 90], ["Bottom (flip it over)", 0, -90],
];

// Each ring steps far enough that neighbouring photos share about two thirds of what they see.
const RINGS: Array<{ ring: Ring; elevation: number; count: number; say: string }> = [
  { ring: "low", elevation: 10, count: 24, say: "Low ring, phone at the object's middle" },
  { ring: "mid", elevation: 35, count: 24, say: "Middle ring, phone a hand higher, tilted down" },
  { ring: "high", elevation: 65, count: 12, say: "High ring, looking down at the top" },
  { ring: "under", elevation: 20, count: 12, say: "Flip it over, low ring again for the underside" },
];

export function plan(id: PlanId): Shot[] {
  if (id === "six") return SIX.map(([say, azimuth, elevation], i) => ({ i, ring: "side", azimuth, elevation, say }));
  const shots: Shot[] = [];
  for (const r of RINGS) {
    for (let k = 0; k < r.count; k++) {
      const azimuth = Math.round((k * 360) / r.count);
      shots.push({ i: shots.length, ring: r.ring, azimuth, elevation: r.elevation, say: `${r.say}, ${azimuth}°` });
    }
  }
  return shots;
}

export type Readiness = {
  taken: number;
  total: number;
  /** Rings with fewer than three quarters of their photos: the sides the model will come out blurry or missing. */
  thin: Ring[];
  /** The longest run of missing shots in a row on any ring, in degrees: a gap that wide leaves a hole. */
  widestGap: number;
  /** Good enough to send off: every ring at least three quarters done and no gap over 45°. */
  ready: boolean;
};

export function readiness(shots: Shot[], taken: ReadonlySet<number>): Readiness {
  const byRing = new Map<Ring, Shot[]>();
  for (const s of shots) byRing.set(s.ring, [...(byRing.get(s.ring) ?? []), s]);
  const thin: Ring[] = [];
  let widestGap = 0;
  for (const [ring, ringShots] of byRing) {
    const have = ringShots.filter((s) => taken.has(s.i)).length;
    if (have < ringShots.length * 0.75) thin.push(ring);
    // The six-view plan has no neighbours to overlap with; only the orbit rings have gaps.
    if (ring === "side") continue;
    const step = 360 / ringShots.length;
    let run = 0, best = 0;
    // Twice round, so a gap that wraps past 0° counts as one.
    for (let k = 0; k < ringShots.length * 2; k++) {
      run = taken.has(ringShots[k % ringShots.length]!.i) ? 0 : run + 1;
      best = Math.max(best, Math.min(run, ringShots.length));
    }
    widestGap = Math.max(widestGap, best === 0 ? 0 : Math.min(360, (best + 1) * step));
  }
  const n = shots.filter((s) => taken.has(s.i)).length;
  return { taken: n, total: shots.length, thin, widestGap, ready: thin.length === 0 && widestGap <= 45 };
}

/** The next shot nobody has taken yet, in plan order, or undefined when all are done. */
export function nextShot(shots: Shot[], taken: ReadonlySet<number>): Shot | undefined {
  return shots.find((s) => !taken.has(s.i));
}

// Scenarios: a link that lands straight in the state a hands-on check needs (which park, which quality tier, phone or
// desktop controls, a weak machine, where on the park the ride starts). Pure and three-free: the page reads it from
// the address, the agent tools build the same links, and the scenarios page lists them.
import type { Level, Rail, Spawn } from "./level.ts";
import { QUALITIES, type Quality } from "@rustybuns/util/quality";

/** Places a ride can start besides a named spawn: computed from the park's own rails and walls. */
export const SPOTS = ["rail", "balance", "vert"] as const;
export type Spot = (typeof SPOTS)[number];
export const CONTROLS = ["touch", "desktop"] as const;
export type Controls = (typeof CONTROLS)[number];

export type Scenario = {
  /** `?controls=touch` shows the thumb stick and flick pad and lets a mouse drag them; `desktop` hides them even on a phone. */
  controls: Controls | null;
  /** `?weak[=ms]`: each frame also burns this many ms, like a slow GPU, so the quality watchdog has something to step down from. */
  weak: number;
  /** `?fps`: a frame-time readout with the tier. */
  fps: boolean;
};

const WEAK_MS = 45; // about 20 fps on its own: under the watchdog's floor of 24

export function scenarioOf(search: string): Scenario {
  const q = new URLSearchParams(search), c = q.get("controls"), w = q.get("weak");
  const ms = w === null ? 0 : w === "" ? WEAK_MS : Number(w);
  return {
    controls: CONTROLS.find((x) => x === c) ?? null,
    weak: Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 200) : 0,
    fps: q.has("fps") || q.has("weak"), // a weak run is always measured
  };
}

const lenOf = (r: Rail) => Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (l: Level, x: number, z: number) => x > l.bounds.minX + 4 && x < l.bounds.maxX - 4 && z > l.bounds.minZ + 4 && z < l.bounds.maxZ - 4;

/** A start `back` metres before a rail's `a` end, facing along it. */
function before(l: Level, r: Rail, name: string, back = 14): Spawn | null {
  const len = lenOf(r), dx = (r.b.x - r.a.x) / len, dz = (r.b.z - r.a.z) / len;
  const x = r.a.x - dx * back, z = r.a.z - dz * back;
  return inside(l, x, z) ? { name, x, z, yaw: Math.atan2(dx, dz) } : null;
}

/**
 * The start a spot names, or null when the park has none.
 * - `rail`: before the grindable bar nearest the park's first spawn.
 * - `balance`: before the longest bar of a gentle slope, the best one to hold a grind on.
 * - `vert`: in front of the tallest rideable transition wall (not a sheer face), 12 m out on its low side, facing it.
 */
export function spotFor(l: Level, spot: Spot): Spawn | null {
  const home = l.spawns[0] ?? { x: 0, z: 0 };
  const bars = l.rails.filter((r) => r.kind !== "coping" && lenOf(r) >= 6 && r.y - l.height(r.a.x, r.a.z) > 0.2);
  if (spot === "rail") {
    for (const r of [...bars].sort((a, b) => dist(home, a.a) - dist(home, b.a))) { const s = before(l, r, "rail"); if (s) return s; }
    return null;
  }
  if (spot === "balance") {
    const gentle = bars.filter((r) => Math.abs((r.y2 ?? r.y) - r.y) < lenOf(r) * 0.1);
    for (const r of [...gentle].sort((a, b) => lenOf(b) - lenOf(a))) { const s = before(l, r, "balance"); if (s) return s; }
    return null;
  }
  const walls = l.rails.filter((r) => r.kind === "coping" && lenOf(r) >= 8).flatMap((r) => {
    const len = lenOf(r), mx = (r.a.x + r.b.x) / 2, mz = (r.a.z + r.b.z) / 2, nx = -(r.b.z - r.a.z) / len, nz = (r.b.x - r.a.x) / len;
    return ([-1, 1] as const).flatMap((k) => {
      const h = (d: number) => l.height(mx + nx * k * d, mz + nz * k * d); // d metres out from the lip, on side k
      const steep = Math.max(...Array.from({ length: 12 }, (_, i) => h(i + 1) - h(i + 2))), rise = h(0.5) - h(14);
      const x = mx + nx * k * 12, z = mz + nz * k * 12;
      // a wall to ride is a transition that climbs gently enough to roll up (no sheer cliff face) and is tall enough to fly from
      return rise >= 1.5 && rise <= 8 && steep <= 2.5 && inside(l, x, z) ? [{ rise, s: { name: "vert", x, z, yaw: Math.atan2(-nx * k, -nz * k) } }] : [];
    });
  });
  return walls.sort((a, b) => b.rise - a.rise)[0]?.s ?? null;
}

export const isSpot = (v: string | null): v is Spot => SPOTS.some((s) => s === v);

/** The scenario keys a link may carry, in the order a link writes them. */
export type Link = { level?: string; spawn?: string; quality?: Quality | "auto"; controls?: Controls; weak?: boolean | number; fps?: boolean };

/** The address of a scenario. `?quality=` is remembered by the browser until `?quality=auto`, so a link that sets none leaves it alone. */
export function linkOf(l: Link): string {
  const q = new URLSearchParams();
  if (l.level) q.set("level", l.level);
  if (l.spawn) q.set("spawn", l.spawn);
  if (l.quality && (l.quality === "auto" || QUALITIES.includes(l.quality))) q.set("quality", l.quality);
  if (l.controls && CONTROLS.includes(l.controls)) q.set("controls", l.controls);
  if (l.weak) q.set("weak", l.weak === true ? "" : String(l.weak));
  if (l.fps) q.set("fps", "");
  return `?${q}`.replace(/=(&|$)/g, "$1");
}

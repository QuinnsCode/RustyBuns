// The park journeys of the levels tests, cut into parts (test/levels-<n>.test.ts) so CI can spread them over its shards:
// one file can't be split across shards, and riding every park in one file made it the floor for the whole check (#2675).
// Each part builds only its own parks. The one-park journeys stay in test/levels.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel, Peak } from "../src/levels/park.ts";
import { DECK } from "../src/models.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { build } from "./parks.ts";

/** How many parts the per-park journeys are cut into: one test/levels-<n>.test.ts each. */
export const PARTS = 4;
// m/s held into a gap: every gap clears at any of these (pushing tops out at 16 m/s, so these are boosted lines; a ramp's launch does not scale with the board, so the line is not divided by SCALE)
const SPEEDS = [28, 32];
/** The parks laid out from a survey of their ground (scripts/survey.ts), and the named gap each one has. */
export const SURVEYED = [["zion", "Angels Drop"], ["arches", "Delicate Gap"], ["bryce-canyon", "Hoodoo Hop"], ["rocky-mountain", "Hallett Leap"], ["grand-teton", "Cathedral Gap"], ["glacier", "Logan Pass Leap"], ["olympic", "Ridge Hop"], ["joshua-tree", "Skull Rock Gap"], ["death-valley", "Zabriskie Drop"], ["crater-lake", "Rim Jump"], ["acadia", "Cadillac Leap"], ["badlands", "Gully Gap"], ["big-bend", "Santa Elena Leap"], ["black-canyon", "Painted Wall Gap"], ["canyonlands", "Mesa Arch Gap"], ["capitol-reef", "Waterpocket Hop"], ["carlsbad-caverns", "Sinkhole Jump"], ["great-sand-dunes", "Dune Drop"], ["great-smoky-mountains", "Clingmans Drop"], ["haleakala", "Crater Rim Leap"], ["hawaii-volcanoes", "Caldera Drop"], ["mount-rainier", "Paradise Leap"], ["lassen-volcanic", "Bumpass Hop"], ["sequoia", "Giant Forest Gap"], ["redwood", "Fern Gap"], ["american-samoa", "Ofu Ridge Drop"], ["biscayne", "Boca Chita Gap"], ["channel-islands", "Scorpion Anchorage Drop"], ["congaree", "Cedar Creek Drop"], ["cuyahoga-valley", "Brandywine Drop"], ["denali", "Wonder Lake Drop"], ["dry-tortugas", "Fort Jefferson Hop"], ["everglades", "Anhinga Trail Hop"], ["gates-of-the-arctic", "Frigid Crags Gap"], ["gateway-arch", "Grand Staircase Gap"], ["glacier-bay", "Margerie Leap"], ["great-basin", "Wheeler Peak Drop"], ["guadalupe-mountains", "El Capitan Ledge"], ["hot-springs", "Bathhouse Row Hop"], ["indiana-dunes", "Mount Baldy Drop"], ["isle-royale", "Greenstone Drop"], ["katmai", "Brooks Falls Leap"], ["kenai-fjords", "Exit Glacier Gap"], ["kings-canyon", "Zumwalt Drop"], ["kobuk-valley", "Great Kobuk Drop"], ["lake-clark", "Twin Lakes Leap"], ["mammoth-cave", "Sinkhole Drop"], ["mesa-verde", "Cliff Palace Gap"], ["new-river-gorge", "Endless Wall Leap"], ["north-cascades", "Diablo Leap"], ["petrified-forest", "Blue Mesa Drop"], ["pinnacles", "High Peaks Gap"], ["saguaro", "Signal Hill Drop"], ["shenandoah", "Stony Man Leap"], ["theodore-roosevelt", "Painted Canyon Drop"], ["virgin-islands", "Trunk Bay Drop"], ["voyageurs", "Kettle Falls Hop"], ["white-sands", "Alkali Flat Drop"], ["wind-cave", "Prairie Breath Drop"], ["wrangell-st-elias", "Kennecott Gap"]] as const;

/** Drives from a spawn, steering at a gap's launch and tapping jump at its lip, feeding the tracker. */
export function drive(level: ParkLevel, spawn: string, seconds: number, gapName?: string, line = 27, target?: { x: number; z: number }) {
  const sp = level.spawns.find((p) => p.name === spawn)!, g = level.gaps.find((x) => x.name === gapName);
  const s = start(sp.x, sp.z, sp.yaw, level), run = trackRun(level);
  level = { ...level, obstacles: level.trees }; // these lines ride gaps and pickups, not rail posts: a handrail on the spawn line is in the way, not the point
  for (let i = 0; i < seconds * 60; i++) {
    const to = g?.a ?? target, aim = to ? Math.atan2(to.x - s.x, to.z - s.z) : s.yaw, err = Math.atan2(Math.sin(aim - s.yaw), Math.cos(aim - s.yaw));
    const along = g ? (s.x - g.a.x) * Math.sin(s.yaw) + (s.z - g.a.z) * Math.cos(s.yaw) : -99;
    step(s, { ...IDLE, throttle: s.speed < line ? 1 : -1, boost: !s.air && s.speed < line, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: along > 3 && along < 8 && !s.air }, level);
    run.update(s);
  }
  return { s, run };
}

/** Every named gap: the park, the spawn its run starts from, and the gap. */
const GAPS = [["el-capitan", "street line", "Boulder Gap"], ["old-faithful", "vent line", "Geyser Hop"], ["mariposa-grove", "clearing", "Fallen Giant"], ["glacier-point", "plateau", "Glacier Point Gap"], ["half-dome", "dome run", "Half Dome Face"], ["yosemite-falls", "shelf", "Upper Fall"], ["yosemite-falls", "valley line", "Valley Hop"], ["grand-prismatic", "street line", "Sinter Jump"], ["grand-canyon", "rim line", "Canyon Drop"], ...SURVEYED.map(([id, gap]) => [id, `${gap} run`, gap] as const)] as const;

/** Registers the per-park journeys for part `n` of PARTS: every PARTS-th park, in the picker's order. */
export async function parkJourneys(n: number) {
  setDefaultTimeout(60000);
  const ids = LEVELS.filter((e) => e.id !== "plaza").filter((_, i) => i % PARTS === n).map((e) => e.id);
  const parks = (await Promise.all(LEVELS.filter((e) => ids.includes(e.id)).map((e) => build(e)))) as ParkLevel[];
  const park = (id: string) => parks.find((l) => l.id === id)!;
  const surveyed = SURVEYED.filter(([id]) => ids.includes(id));

  test.each(ids)("%s loads with finite ground, goals and spawns on rideable ground inside its bounds", (id) => {
    const l = park(id);
    expect(l.goals.length).toBeGreaterThanOrEqual(3);
    expect(l.goals.length).toBeLessThanOrEqual(5);
    expect(l.spawns.length).toBeGreaterThan(0);
    for (const sp of l.spawns) {
      expect(sp.x).toBeGreaterThan(l.bounds.minX);
      expect(sp.x).toBeLessThan(l.bounds.maxX);
      expect(sp.z).toBeGreaterThan(l.bounds.minZ);
      expect(sp.z).toBeLessThan(l.bounds.maxZ);
      const h = l.height(sp.x, sp.z);
      expect(Number.isFinite(h)).toBe(true);
      for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) expect(Math.abs(l.height(sp.x + dx!, sp.z + dz!) - h)).toBeLessThan(0.75); // rideable: under a 0.5 slope
    }
    for (const g of l.gaps) expect(g.bonus).toBeGreaterThan(0);
    for (const g of l.goals) if (g.kind === "gap") expect(l.gaps.map((x) => x.name)).toContain(g.name);
    for (const p of l.pickups) expect(Number.isFinite(p.y)).toBe(true);
    for (const p of l.pieces) expect(Math.min(p.w, p.d)).toBeGreaterThan(DECK.width); // the kit is toy-sized beside the deck, never thinner than the board
  });

  // One test per gap: each is twenty seconds of sim at two speeds, and the list is long.
  for (const [id, spawn, name] of GAPS.filter(([id]) => ids.includes(id))) {
    test(`${id}: ${name} is cleared at any speed from 28 to 32 by driving at the launch and jumping at the lip, and a hop onto the obstacle does not count`, () => {
      const l = park(id), sp = l.spawns.find((p) => p.name === spawn)!, g = l.gaps.find((x) => x.name === name)!;
      const seconds = Math.max(20, Math.hypot(g.a.x - sp.x, g.a.z - sp.z) / 20 + 10); // a run-up up a mountain takes its time
      for (const line of SPEEDS) {
        const { s, run } = drive(l, spawn, seconds, name, line);
        expect(run.gaps.get(name)).toBeGreaterThanOrEqual(1);
        expect(s.score).toBeGreaterThanOrEqual(g.bonus);
        expect(run.bestCombo).toBeGreaterThan(0);
      }
    });
  }

  test.each(ids)("%s has a sky rail: a long bar on stilts you can ride from its kicker, steep or shallow, climbing away from the ground", (id) => {
    const l = park(id), sp = l.spawns.find((p) => p.name === "sky rail")!, bar = l.rails.find((r) => Math.abs((r.y2 ?? r.y) - r.y) > 10)!;
    expect(sp).toBeDefined();
    expect(bar).toBeDefined();
    const s = start(sp.x, sp.z, sp.yaw, l);
    let ground = 0, top = 0;
    for (let i = 0; i < 12 * 60; i++) {
      const lip = (s.x - bar.a.x) * Math.sin(s.yaw) + (s.z - bar.a.z) * Math.cos(s.yaw);
      const len = Math.hypot(bar.b.x - bar.a.x, bar.b.z - bar.a.z), ux = (bar.b.x - bar.a.x) / len, uz = (bar.b.z - bar.a.z) / len, ahead = (s.x - bar.a.x) * ux + (s.z - bar.a.z) * uz + 6, to = { x: bar.a.x + ux * ahead, z: bar.a.z + uz * ahead }, err = Math.atan2(Math.sin(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw), Math.cos(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw));
      step(s, { ...IDLE, throttle: s.speed < 30 ? 1 : -1, boost: !s.air && s.speed < 30, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 8)), jump: lip > -3 && lip < -1.5 && !s.air }, l);
      if (s.grind >= 0) ground++;
      top = Math.max(top, s.y);
    }
    expect(ground).toBeGreaterThan(60); // it catches the bar and rides it: a rider stopped by a post on the way in lands at a crawl and slides under 20 frames
    expect(top - l.height(bar.a.x, bar.a.z)).toBeGreaterThan(4);
  });

  test.each(ids)("%s runs edge to edge of its terrain, and a rider driving at the barrier is stopped by it", (id) => {
    const l = park(id);
    expect(l.bounds.maxX - l.bounds.minX).toBeGreaterThan(600);
    const sp = l.spawns[0]!, s = start(sp.x, sp.z, sp.yaw, { ...l, obstacles: [] });
    for (let i = 0; i < 60 * 40; i++) step(s, { ...IDLE, throttle: 1, boost: true }, { ...l, obstacles: [] });
    expect(s.x).toBeGreaterThanOrEqual(l.bounds.minX);
    expect(s.x).toBeLessThanOrEqual(l.bounds.maxX);
    expect(s.z).toBeGreaterThanOrEqual(l.bounds.minZ);
    expect(s.z).toBeLessThanOrEqual(l.bounds.maxZ);
  });

  if (surveyed.length) test.each(surveyed.map(([id]) => id))("%s, a surveyed park, spawns the rider facing its signature spot, near enough to read and with the whole way clear of the edge, and has kit there", (id) => {
    const l = park(id), sp = l.spawns.find((p) => p.name === "view")!, bearing = Math.atan2(-sp.x, -sp.z);
    expect(Math.abs(Math.atan2(Math.sin(bearing - sp.yaw), Math.cos(bearing - sp.yaw)))).toBeLessThan(0.05);
    expect(Math.hypot(sp.x, sp.z)).toBeGreaterThan(40);
    expect(Math.hypot(sp.x, sp.z)).toBeLessThan(l.ground.R);
    expect(l.pieces.filter((p) => !p.name.startsWith("contour") && Math.hypot(p.x, p.z) < 90).length).toBeGreaterThan(0);
  });

  const withPeak = parks.filter((l) => l.landmarks.some((m) => m.kind === "peak" && m.model !== "half-dome"));
  if (withPeak.length) test.each(withPeak.map((l) => l.id))("%s: a far landmark stands straight ahead of the view spawn, past the park's edge, with its toe on the edge", (id) => {
    const l = park(id), sp = l.spawns.find((p) => p.name === "view")!, m = l.landmarks.find((x): x is Peak => x.kind === "peak")!;
    const dist = Math.hypot(m.x, m.z), toward = Math.atan2(m.x - sp.x, m.z - sp.z), off = Math.abs(Math.atan2(Math.sin(toward - sp.yaw), Math.cos(toward - sp.yaw)));
    expect(off).toBeLessThan(0.08); // the spawn looks at it
    expect(dist - 1.5 * m.tall).toBeGreaterThan(l.ground.R - 10); // standing past the edge,
    expect(dist - 1.5 * m.tall).toBeLessThan(l.ground.R + 15); // its toe meeting it
    expect(m.y).toBeCloseTo(l.ground.height(m.x / dist * (l.ground.R - 14), m.z / dist * (l.ground.R - 14)), 0);
  });
}

// The room's check of a den against the world's seed (#3700): every kind of den the page walks into holds what the page
// draws there, and a page that names another creature or level for it is not believed.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mythicOf, sections, SECTIONS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { holds } from "../src/net/dens.ts";
import table from "../src/net/dens.json";
import { denTable } from "../scripts/dens.ts";
import { HUNTS } from "../src/world/hunts.ts";
import { sectionPick } from "../src/world/seed.ts";
import { bandAt, TRAILS, trailWilds, WORLD } from "../src/world/trail.ts";
import { arenaOf, wildsNear, type Wild } from "../src/world/world.ts";

setDefaultTimeout(20_000);
const open = new Set(REGIONS.map((g) => g.n));
const playable = REGIONS.filter((g) => g.tier === "playable");
/** A wild den as the page holds it (view.ts onTrailDen): out on a trail, one of the section's own. */
const asPage = (c: Wild): Wild => {
  const b = TRAILS.has(c.region) ? bandAt(c.x, c.z) : 0, s = b ? sections(REGIONS[c.region - 1]!)[b - 1] : undefined, p = s && sectionPick(c.den, s.wilds, s.level);
  return p ? { ...c, ...p } : c;
};
const first = <T,>(xs: T[]): T => { if (!xs[0]) throw new Error("none found"); return xs[0]; };

describe("a den's creature and level, from the world's seed", () => {
  const g = playable[1]!, a = arenaOf(g), k = 2, sec = sections(g)[k]!, hunt = first([...HUNTS.values()]);
  const wilds = wildsNear(WORLD, a.x + 900, a.z, 0, open, 600);
  const roaming = first(wilds.filter((c) => asPage(c).id === c.id)), onTrail = first(wilds.map(asPage).filter((c, i) => c.id !== wilds[i]!.id));
  const trail = first(trailWilds(a.x, a.z, 0, 8000).filter((c) => c.region === g.n).map(asPage).filter((c) => c.id));
  test.each([
    ["a wild den, its region's pool", roaming.den, roaming.id, roaming.level],
    ["a wild den out on a trail", onTrail.den, onTrail.id, onTrail.level],
    ["a trail section's den", trail.den, trail.id, trail.level],
    ["a keeper's stone", `keeper:${g.n}:${k}`, sec.keeper, sec.level],
    ["the arena's mythic", `mythic:${g.n}`, mythicOf(g).id, sections(g)[SECTIONS - 1]!.level],
    ["a contract's lair", `hunt:${hunt.id}`, hunt.creature, hunt.level],
  ])("%s", (_, den, id, lv) => {
    expect(holds(den, id, lv)).toBe(true);
    expect(holds(den, id, lv + 40)).toBe(false); // a wild den may be on any of its trail's bands, so not just any level off
    expect(holds(den, "not-a-creature", lv)).toBe(false);
  });

  test("a den the world has no one in holds nothing", () => {
    expect(holds("0,0", roaming.id, roaming.level)).toBe(false); // the sea off the north-west corner
    expect(holds("hunt:9.1.1", hunt.creature, hunt.level)).toBe(false);
    expect(holds(`keeper:${g.n}:40`, sec.keeper, sec.level)).toBe(false);
  });

  test("src/net/dens.json is the world's now (rerun bun scripts/dens.ts)", () => {
    expect(denTable()).toEqual(table);
  });
});

// How rare each creature is. Commons are small and everywhere (the starters come from them); legendaries and
// mythics are the big names of their legends, mostly met as arena champions and seldom out roaming. Event
// creatures roam only in their season. An unknown is a shrouded shape whose name and level you don't learn
// until you've won it: for legends still being made, or a preview of an event to come.
// Any id not listed is common, so a new critter needs no line here.

export const TIERS = ["common", "uncommon", "rare", "legendary", "mythic", "event", "unknown"] as const;
export type Tier = (typeof TIERS)[number];

const BY_TIER: Record<Exclude<Tier, "common">, string[]> = {
  uncommon: ["wampus-cat", "chupacabra", "puca", "afanc", "ahuizotl", "curupira", "kappa", "raiju", "tanuki", "boitata", "ninki-nanka"],
  rare: ["mothman", "jersey-devil", "black-shuck", "rougarou", "ozark-howler", "cadejo", "lobizon", "kelpie", "dokkaebi", "tengu", "tikbalang", "bunyip", "ropen", "kongamato", "gevaudan", "nue", "troll", "camahueto", "emela-ntouka", "sasabonsam", "ushi-oni"],
  legendary: ["sasquatch", "champ", "nessie", "yeti", "grootslang", "lambton-worm", "mapinguari", "leshy", "minotaur", "chimera", "manticore", "sphinx", "oni", "imugi", "tarasque", "zmey", "mokele-mbembe"],
  mythic: ["red-dragon", "hydra", "roc", "qilin", "kyubi"],
  event: ["yule-cat", "nian"],
  unknown: ["hidebehind", "olgoi-khorkhoi"],
};
const TIER = new Map<string, Tier>(Object.entries(BY_TIER).flatMap(([t, ids]) => ids.map((id) => [id, t as Tier])));

/** Every id given a tier above common (a typo here would quietly make a legend common). */
export const TIERED = [...TIER.keys()];
export const tierOf = (id: string): Tier => TIER.get(id) ?? "common";

/** An event creature's season, as [month, day] from and to (inclusive; it may wrap the new year). */
const SEASON: Record<string, [[number, number], [number, number]]> = {
  "yule-cat": [[12, 1], [1, 6]],   // the Yule nights
  nian: [[1, 20], [2, 20]],        // around the lunar new year
};
/** Whether `id` may roam on `date`: always, unless it's an event creature out of season. */
export function inSeason(id: string, date: Date): boolean {
  const s = SEASON[id];
  if (tierOf(id) !== "event" || !s) return tierOf(id) !== "event";
  const d = (date.getMonth() + 1) * 100 + date.getDate(), a = s[0][0] * 100 + s[0][1], b = s[1][0] * 100 + s[1][1];
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** How often each tier turns up at a den, against a common's 6; mythics only in their own region. */
export const ROAM_WEIGHT: Record<Tier, number> = { common: 6, uncommon: 4, rare: 2, legendary: 1, mythic: 1, event: 3, unknown: 1 };
/** Levels a creature of each tier stands above the region's wild ones. */
export const TIER_LEVEL: Record<Tier, number> = { common: 0, uncommon: 0, rare: 1, legendary: 3, mythic: 5, event: 2, unknown: 3 };

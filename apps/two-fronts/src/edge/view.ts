// What a seat's view of a campaign looks like on the wire, as a guard the Durable Object's types and the
// page both use. Kept out of campaign.ts so the page can import it without pulling the object in with it.
import { arr, Bad, bool, int, nul, num, obj, oneOf, opt, raw, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { MATCH_MODES, type BattleSpec, type Faction, type PerSide, type SectorKind, type SpaceBattleSpec } from "../battle/contract.ts";
import { CARDS, FACTIONS, type Attack, type Campaign, type Card, type Count, type Deck, type Pending, type Sector, type SystemState } from "../war/rules.ts";
import type { Seats, Vote } from "../war/table.ts";

const n = num(-1e9, 1e9), text = str(1000, { min: 0 }), id = str(200);
const faction = oneOf(FACTIONS);
/** The one `true` a flag field carries, or nothing. */
const lit = <T extends boolean>(x: T): Guard<T> => (v) => { if (v !== x) throw new Bad(`${x}`); return x; };
const yes = lit(true as const);
/** A field that may be left out or null, kept apart: `opt` would turn null into left out. */
const orNull = <T>(g: Guard<T>): Guard<T | null | undefined> => (v) => (v === undefined ? undefined : nul(g)(v));
// A generic T may include undefined, which `obj` would call optional; both sides are always there.
const perFaction = <T>(g: Guard<T>): Guard<Record<Faction, T>> => (v) => { const o = obj({ marines: raw, wooka: raw })(v); return { marines: g(o.marines), wooka: g(o.wooka) }; };
const perSide = <T>(g: Guard<T>): Guard<PerSide<T>> => (v) => { const o = obj({ attacker: raw, defender: raw })(v); return { attacker: g(o.attacker), defender: g(o.defender) }; };
const count: Guard<Count> = perFaction(n);
const mode = oneOf(MATCH_MODES);
const card: Guard<Card> = oneOf(CARDS);
const where = obj({ system: id, sector: int(-1, 1000) });
const vehicles = obj({ tank: opt(n), walker: opt(n), speeder: opt(n), gunship: opt(n) });
const pods = obj({ cap: n, perMinute: n });
const kind = oneOf(["capital", "spaceport", "shield", "cannon", "canyon", "jungle"] as const satisfies readonly SectorKind[]);

const Sector: Guard<Sector> = obj({
  kind: oneOf(["capital", "spaceport", "shield", "cannon", "canyon", "jungle", "warren"] as const),
  owner: faction, armies: count, guns: opt(yes),
});
const System: Guard<SystemState> = obj({
  id, orbit: nul(faction), fleets: count, sectors: arr(Sector, 100), held: opt(n), fog: opt(yes),
});
const BattleSpecG: Guard<BattleSpec> = obj({
  id, turn: n, system: text, sector: kind, factions: perSide(faction), hero: oneOf(["attacker", "defender"] as const),
  heroLevel: n, armies: perSide(n), tickets: perSide(n), vehicles: perSide(vehicles), strikes: perSide(n),
  reinforcements: perSide(pods), turrets: n, mode: opt(mode), assist: opt(lit(false as const)),
  map: opt(text), storm: opt(yes), seed: n,
});
const SpaceSpecG: Guard<SpaceBattleSpec> = obj({
  id, turn: n, system: text, factions: perSide(faction), hero: oneOf(["attacker", "defender"] as const), heroLevel: n,
  fleets: perSide(n), breakout: opt(yes), muster: opt(perSide(n)), batteries: opt(perSide(n)), seed: n,
});
const transit = obj({ faction, from: where, to: where, count: n });
const Pending: Guard<Pending> = (v) => {
  const k = obj({ kind: oneOf(["ground", "space"] as const) })(v).kind;
  return k === "ground"
    ? obj({ kind: oneOf(["ground"] as const), spec: BattleSpecG, at: where })(v)
    : obj({ kind: oneOf(["space"] as const), spec: SpaceSpecG, system: id, landings: arr(transit, 1000) })(v);
};
const Attack: Guard<Attack> = obj({ faction, from: id, to: where });
const cards = arr(card, 100);
const market: Guard<Record<Deck, Card[]>> = obj({ fleet: cards, ground: cards, gale: cards });
const play = obj({ faction, card, system: id, sector: opt(int(0, 1000)) });
const sight = obj({ faction, card: oneOf(["weather", "forecast"] as const), system: id, turn: n });

export const CampaignG: Guard<Campaign> = obj({
  turn: n, seed: n, galaxy: oneOf(["intro", "short", "full", "horde"] as const), player: faction, credits: count,
  systems: rec(System, 1000), heroes: perFaction(obj({ level: n, xp: n, woundedUntil: n })), pending: nul(Pending),
  attacks: orNull(arr(Attack, 1000)), hands: opt(perFaction(arr(card, 100))), energy: opt(count), market: opt(market),
  flips: opt(n), plays: orNull(arr(play, 1000)), sights: orNull(arr(sight, 1000)), galeShift: opt(rec(n, 1000)),
  points: opt(count), objectives: opt(arr(id, 100)), secrets: opt(obj({ marines: opt(text), wooka: opt(text) })),
  traps: orNull(arr(obj({ faction, at: where }), 1000)), dugIn: orNull(arr(obj({ faction, region: id }), 1000)),
  taken: orNull(count), deploying: orNull(arr(faction, 2)), setup: orNull(arr(faction, 2)), pool: opt(count),
  bombards: orNull(arr(obj({ faction, at: where, count: n }), 1000)), winner: nul(faction), log: arr(text, 10000),
  mode: opt(mode), landing: opt(obj({ wideOrbit: n, openSky: n, siegeTurns: n, sealedBy: n })), calm: opt(yes),
});

const Seats: Guard<Seats> = perFaction(oneOf(["human", "ai"] as const));
const VoteG: Guard<Vote> = obj({
  match: text, votes: obj({ marines: opt(mode), wooka: opt(mode) }), picked: nul(mode),
});

/** A seat's view of its campaign: what the Durable Object answers and the page reads. */
export const View = obj({
  seat: faction, seats: Seats, campaign: CampaignG, waiting: arr(faction, 2), handedIn: bool(), vote: nul(VoteG),
});
export type View = Of<typeof View>;

/** What starting a campaign hands back: its id, and a seat token for each human side. */
export const Started = obj({ id, tokens: obj({ marines: opt(text), wooka: opt(text) }) });
export type Started = Of<typeof Started>;

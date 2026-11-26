// The rules sheet (#5382): every rule the player lives under, written once in plain words. Each number is read from
// the code's own constant (or worked out by calling the function that uses it), so the words cannot drift from the
// game. `bun run rules` writes docs/RULES.md from this; a later round feeds the Book's "How this works" leaf and the
// line the game says the first time a rule matters from the same list.
//
// A number the code keeps only as an unnamed literal inside main.ts is left out of the words here, not copied by hand
// (the far south's wild one, the reach of a campfire for calling a resting beast): name it there first, then say it here.
import { keyName } from "@rustybuns/game-controls";
import { ACTIONS } from "./binds.ts";
import office from "../content/faction-office.json";
import { FACTIONS } from "./factions/model.ts";
import { FIELDS, STRONG, typeMul } from "./fields.ts";
import {
  atLevel, baseLevel, bindBelow, bindChance, gainXp, INK, MAULED, OUTNUMBERED, OWN_MAX, PARTY_FIRST, PARTY_MAX, PICKS, SAVE_KEY, SECTIONS, sectionLevel,
  START_LEVEL, STARTERS, toNext, TRAIL_REGIONS, WATCH_SHARE, type Member,
} from "./journey.ts";
import { MAX_PLAYERS } from "./net/party.ts";
import { REGIONS } from "./regions.ts";
import { creature, ROSTER } from "./roster.ts";
import { COST, ENERGY, newMatch } from "./sim.ts";
import { NIGHT, ROAM_WEIGHT, SEASON, TIER_LEVEL, type Tier } from "./tiers.ts";
import { DAY } from "./world/day.ts";
import { CLUES, HUNTS, LEVEL_UP, STEP } from "./world/hunts.ts";
import { FORAGE_MEND } from "./world/nature.ts";
import { BOSS_EVERY, CATCH_FAR, CATCH_NEAR, HOUSES, PATH_HALF } from "./world/night.ts";
import { SHELTER_R } from "./world/poi.ts";
import { GATES, road, WILD_EVERY } from "./world/world.ts";

export interface Rule {
  n: number;
  title: string;
  /** The rule, a short paragraph a line. */
  says: string[];
  /** Every number the words use, by the name of what it is read from. */
  numbers: Record<string, number>;
  /** Where the code keeps it. */
  from: string;
}

const pc = (x: number) => Math.round(x * 1000) / 10;
const key = (id: string) => keyName(ACTIONS.find((a) => a.id === id)?.keys[0] ?? "");
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const regionName = (n: number) => REGIONS.find((g) => g.n === n)?.name ?? `region ${n}`;

// Numbers that live inside a function: asked of the function itself.
const probe = creature(STARTERS[0]);
const flat = (v: number) => ({ ...probe, stats: { ...probe.stats, vigor: v } });
const LEVEL_SHARE = atLevel(flat(100), 11).stats.vigor - atLevel(flat(100), 10).stats.vigor; // % of the level-10 stat a level adds
const STAT_CAP = atLevel(flat(100_000), 100).stats.vigor;
const XP_PER_LEVEL = (() => { const m: Member = { id: probe.id, level: 100, xp: 0 }; gainXp(m, 1); return m.xp; })();
const NEXT_PER_LEVEL = toNext(1);
const START_ENERGY = newMatch(probe, probe).f[0].energy;
const BEATS = typeMul(FIELDS[0], [STRONG[FIELDS[0]][0]!]) - 1, RESISTS = 1 - typeMul(FIELDS[0], [FIELDS[0]]);
const TRAIL_STEP = baseLevel(2) - baseLevel(1), BOSS_OVER = sectionLevel(1, SECTIONS - 1) - baseLevel(1);
const BOARDS = HUNTS.size / TRAIL_REGIONS.length;
const tiersBy = (pick: (t: Tier) => number, ts: Tier[]) => ts.map((t) => `${t} ${pick(t)}`).join(", ");
const NAMED: Tier[] = ["common", "uncommon", "rare", "legendary", "mythic"];
const gates = (needs: "flier" | "swimmer") => Object.entries(GATES).filter(([, g]) => g.needs === needs).map(([n]) => Number(n));
const nightNames = ROSTER.filter((c) => NIGHT.has(c.id)).map((c) => c.name);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = ([m, d]: [number, number]) => `${d} ${MONTHS[m - 1]}`;
const seasons = Object.entries(SEASON).flatMap(([id, [a, b]]) => { const c = ROSTER.find((x) => x.id === id); return c ? [`${c.name} (${day(a)} to ${day(b)})`] : []; });

export const RULES: Rule[] = [
  {
    n: 1, title: "Controls, stamina and energy", from: "src/binds.ts ACTIONS; src/sim.ts COST, ENERGY, SWING",
    numbers: { "COST.special": COST.special, "COST.beam": COST.beam, "COST.ultimate": COST.ultimate, "ENERGY.dealt": ENERGY.dealt, "ENERGY.taken": ENERGY.taken, "ENERGY.still": ENERGY.still, "start energy": START_ENERGY },
    says: [
      `On a keyboard: move with ${key("forward")} ${key("left")} ${key("back")} ${key("right")}, jump with ${key("jump")}, dash with ${key("dash")}, attack with ${key("light")}, strong attack with ${key("heavy")}, guard with ${key("guard")}. Your special is ${key("special")}, your big move is ${key("big")}, your ultimate is ${key("ultimate")}, and ${key("bind")} binds. You can change every key in Settings.`,
      `Stamina is your breath. Attacks, dashes, guarding, running and flying use it. Standing on the ground without attacking gives it back. At zero you are exhausted: you move slowly and cannot dash, guard or take off until some of it returns.`,
      `Energy pays for the strong moves. A fight starts with ${START_ENERGY}. A clean hit gives you ${ENERGY.dealt}, a hit you take gives you ${ENERGY.taken}, and standing still gives ${ENERGY.still} a second. A special costs ${COST.special}, a big move ${COST.beam}, an ultimate ${COST.ultimate}.`,
    ],
  },
  {
    n: 2, title: "Fields: what beats what, and by how much", from: "src/fields.ts STRONG, typeMul",
    numbers: { fields: FIELDS.length, "typeMul strong %": pc(BEATS), "typeMul resisted %": pc(RESISTS) },
    says: [
      `There are ${FIELDS.length} fields. Every move has one field, and every creature has one or two.`,
      `A move does ${pc(BEATS)}% more damage to a creature whose field it beats. It does ${pc(RESISTS)}% less to a creature of its own field, or of a field that beats it. Two fields that lean the same way still count once.`,
      `The field wheel under Settings shows the whole chart.`,
    ],
  },
  {
    n: 3, title: "Levels: what one level gives a beast", from: "src/journey.ts atLevel",
    numbers: { "atLevel % a level": LEVEL_SHARE, "stat cap": STAT_CAP, START_LEVEL },
    says: [
      `Each level adds ${LEVEL_SHARE}% of the creature's level-10 stats to its vigor, might, guard, focus and will. Speed never changes with level.`,
      `So one level is a big step at low levels and a small one at high levels. No stat goes over ${STAT_CAP}.`,
      `Your first three start at level ${START_LEVEL}.`,
    ],
  },
  {
    n: 4, title: "XP: who earns it, how much, what the next level costs", from: "src/journey.ts gainXp, shareXp, WATCH_SHARE, toNext",
    numbers: { "gainXp per foe level": XP_PER_LEVEL, "toNext per level": NEXT_PER_LEVEL, "percent for the rest of the line-up": Math.round(WATCH_SHARE * 100) },
    says: [
      `The beast that wins the fight earns all of its XP. The others in the line-up watched, and each gets ${Math.round(WATCH_SHARE * 100)}% of it.`,
      `A win gives ${XP_PER_LEVEL} XP for each level of the creature you beat. The next level costs ${NEXT_PER_LEVEL} XP for each level you have now. Example: a level-5 beast needs ${toNext(5)} XP, and beating a level-4 creature gives ${4 * XP_PER_LEVEL}.`,
    ],
  },
  {
    n: 5, title: "Health carries between fights", from: "src/journey.ts wound, heal, mend; src/world/nature.ts FORAGE_MEND",
    numbers: { "FORAGE_MEND %": pc(FORAGE_MEND) },
    says: [
      `A beast keeps the health it ended a fight with. It starts the next fight with the same health.`,
      `Sit at a campfire and the whole line-up is back to full health.`,
      `Wild food you pick on the way gives every hurt beast ${pc(FORAGE_MEND)}% of its health back. A knocked-out beast gets up.`,
    ],
  },
  {
    n: 6, title: "A knocked-out beast, who is next, and what a loss costs", from: "src/journey.ts nextUp, heal; src/main.ts (the result note); src/world/world.ts sendHome",
    numbers: {},
    says: [
      `When your beast is knocked out, the next one in the line-up can go in. The foe keeps the damage you did. A knocked-out beast stays out until a campfire or wild food.`,
      `You can also run back to the world. The beast that fell stays knocked out.`,
      `When the whole line-up is knocked out, you lose the fight. You go back to the trail, and the line-up is healed. You lose nothing else: no XP, no beasts, no cleared stones.`,
    ],
  },
  {
    n: 7, title: "Binding", from: "src/journey.ts INK, bindBelow, bindChance",
    numbers: { INK, "bindBelow(false) %": pc(bindBelow(false)), "bindBelow(true) %": pc(bindBelow(true)), "bindChance top %": pc(bindChance(bindBelow(false), false)), "bindChance best %": pc(bindChance(0, false)), "boss top %": pc(bindChance(bindBelow(true), true)), "boss best %": pc(bindChance(0, true)) },
    says: [
      `You can try to bind a creature when its health is under ${pc(bindBelow(false))}%. For a region's boss it must be under ${pc(bindBelow(true))}%. Press ${key("bind")}.`,
      `You get ${INK} tries of ink in each fight. A try holds ${pc(bindChance(bindBelow(false), false))}% of the time at the line and up to ${pc(bindChance(0, false))}% as its health goes to nothing. A boss is half as easy: ${pc(bindChance(bindBelow(true), true))}% up to ${pc(bindChance(0, true))}%.`,
      `You cannot bind a creature that is knocked out. If you knock it out first, it gets away.`,
    ],
  },
  {
    n: 8, title: "The line-up and the Compendium", from: "src/journey.ts PICKS, PARTY_FIRST, PARTY_MAX, OWN_MAX, call, rest, release",
    numbers: { PICKS, PARTY_FIRST, PARTY_MAX, OWN_MAX },
    says: [
      `You start by taking ${PICKS} of the Book's ${STARTERS.length}. The line-up holds ${PARTY_FIRST}. Each region's boss you beat adds one place, up to ${PARTY_MAX}.`,
      `You can own ${OWN_MAX} in all: the line-up and the ones resting in the Compendium together. With ${OWN_MAX}, the ink will not take another until you release one.`,
      `You can send a beast to rest anywhere, but you can call a resting one into the line-up only beside a lit campfire. The line-up always keeps one.`,
      `Release is for good. A released beast does not come back.`,
    ],
  },
  {
    n: 9, title: "The trail", from: "src/journey.ts SECTIONS, baseLevel, sectionLevel, clearSection",
    numbers: { SECTIONS, "levels a region": TRAIL_STEP, "boss over the first stone": BOSS_OVER },
    says: [
      `Each region's trail has ${SECTIONS} sections. A keeper stands on the stone of each one. Beat it or bind it and the next section opens. You cannot skip a stone.`,
      `The keeper of section ${SECTIONS} is the region's boss, in its lair.`,
      `Levels rise along the trail. The boss is ${BOSS_OVER} levels over the first keeper, and each region starts ${TRAIL_STEP} levels over the one before it on the road (${road().join(", ")}), at the level of that region's boss.`,
    ],
  },
  {
    n: 10, title: "Roads and gates", from: "src/world/world.ts reach, GATES, travelOf",
    numbers: {},
    says: [
      `Only the first region is open at the start. When you beat a region's boss, the roads to all its neighbours open.`,
      `Some roads also need a beast in your line-up to carry you. ${list(gates("flier").map(regionName))} need a flier. ${list(gates("swimmer").map(regionName))} need a swimmer: a creature whose first field is tide.`,
      `The beast must be in the line-up, not resting in the Compendium.`,
    ],
  },
  {
    n: 11, title: "Tiers", from: "src/tiers.ts ROAM_WEIGHT, TIER_LEVEL",
    numbers: Object.fromEntries(NAMED.flatMap((t) => [[`ROAM_WEIGHT.${t}`, ROAM_WEIGHT[t]], [`TIER_LEVEL.${t}`, TIER_LEVEL[t]]])),
    says: [
      `A creature's tier says how rare it is: ${NAMED.join(", ")}. There are also event creatures (in season only) and unknown ones (no name or level shown until you own one).`,
      `How often each turns up at a den, as shares: ${tiersBy((t) => ROAM_WEIGHT[t], NAMED)}. A mythic stays in its own region.`,
      `Levels over the region's other wild ones: ${tiersBy((t) => TIER_LEVEL[t], NAMED)}.`,
      `A tier does not change how hard a creature is to bind.`,
    ],
  },
  {
    n: 12, title: "Night", from: "src/world/night.ts HOUSES, PATH_HALF, CATCH_FAR, CATCH_NEAR, BOSS_EVERY; src/world/poi.ts SHELTER_R; src/journey.ts MAULED; src/world/day.ts DAY",
    numbers: { "DAY minutes": DAY / 60, HOUSES, PATH_HALF, SHELTER_R, CATCH_FAR, CATCH_NEAR, "MAULED %": pc(MAULED), BOSS_EVERY },
    says: [
      `A day and a night together take ${DAY / 60} minutes. Sleep at a campfire and it is morning.`,
      `At night, lit paths join the arena, the cabins and ${HOUSES} campfires. You are safe within ${PATH_HALF} m of a path's line and within ${SHELTER_R} m of a lit fire, a cabin or the arena.`,
      `Away from them, something stalks you. It catches you in ${CATCH_FAR} to ${CATCH_NEAR} seconds: quicker the further you are from safety. Go back onto a path and it fades.`,
      `If it catches you, a fight starts and the beast that is up has lost ${pc(MAULED)}% of its full health before the first hit. It is never knocked out this way.`,
      `One night in ${BOSS_EVERY} the dark rolls down the paths, so you must keep moving.`,
    ],
  },
  {
    n: 13, title: "Night-only and seasonal creatures", from: "src/tiers.ts NIGHT, SEASON, inSeason",
    numbers: {},
    says: [
      `Some creatures roam only after dark: ${list(nightNames)}.`,
      `Event creatures roam only in their season: ${list(seasons)}.`,
    ],
  },
  {
    n: 14, title: "Sighting boards", from: "src/world/hunts.ts HUNTS, CLUES, STEP, LEVEL_UP",
    numbers: { "boards a region": BOARDS, CLUES, STEP, LEVEL_UP },
    says: [
      `Each region with a trail has ${BOARDS} sighting boards. Read one to take its report.`,
      `Follow ${CLUES} signs, about ${STEP} m apart. Then a named creature waits at its lair, ${LEVEL_UP} levels over its section.`,
      `You can bind it. Beat it or bind it and the sighting is closed. Boards are optional.`,
    ],
  },
  {
    n: 15, title: "The three factions", from: "src/factions/model.ts FACTIONS; content/faction-*.json quest",
    numbers: { FACTIONS: FACTIONS.length, "steps each": office.quest.length },
    says: [
      `There are ${FACTIONS.length} factions. Each has ${office.quest.length} steps, one in each region with a trail. A step waits at a section's stone.`,
      `A step opens when the step before it is done and you have cleared its section. A step is a talk, and your answers change what the faction thinks of you. Many steps end in a fight against a team.`,
      `Faction steps are optional.`,
    ],
  },
  {
    n: 16, title: "The Book's demands", from: "src/demand.ts demandOf; src/book.ts spendInk",
    numbers: { INK },
    says: [
      `The Book always names the next creature it wants bound. It is a pointer, not an order: there is no reward for it and no cost for binding another.`,
      `When you talk to the Book it sometimes gives a spare drop of ink. That is one more try in your next fight, over the usual ${INK}.`,
    ],
  },
  {
    n: 17, title: "Fights against more than one, and co-op", from: "src/journey.ts OUTNUMBERED; src/net/party.ts MAX_PLAYERS; src/coop.ts",
    numbers: { MAX_PLAYERS, "OUTNUMBERED[2].edge": OUTNUMBERED[2].edge, "OUTNUMBERED[3].edge": OUTNUMBERED[3].edge, "OUTNUMBERED[4].edge": OUTNUMBERED[4].edge },
    says: [
      `A friend joins your world through a party link. Up to ${MAX_PLAYERS} players share a region.`,
      `When you walk into a wild one or a keeper, friends in the region can join the fight. A lone creature that faces a team hits harder: ${OUTNUMBERED[2].edge} times against two, ${OUTNUMBERED[3].edge} against three, ${OUTNUMBERED[4].edge} against four.`,
      `Each player's own beast earns the XP (the rest of that player's line-up gets half), and each player has the usual ${INK} tries of ink. The first bind that holds takes the creature. A keeper beaten together clears the stone only for a player whose next stone it is.`,
    ],
  },
  {
    n: 18, title: "Fast travel between campfires", from: "src/world/poi.ts lightFire, fireSpot; src/world/view.ts fastTravel",
    numbers: {},
    says: [
      `Walk up to a campfire to light it. It stays lit.`,
      `Open the map and pick any lit campfire in an open region to go there. It costs nothing and has no limit. It does not heal you: sit at the fire for that.`,
    ],
  },
  {
    n: 19, title: "The far south", from: "src/world/world.ts WILD_EVERY, sendHome; src/main.ts wildOne",
    numbers: { WILD_EVERY },
    says: [
      `The regions of the far south have no trail, no keepers and no boss.`,
      `A strong wild one attacks every ${WILD_EVERY} m you walk there. Only the beast that is up fights it. You cannot bind it.`,
      `If you lose, the line-up is healed and you are sent back to the last region with a trail.`,
    ],
  },
  {
    n: 20, title: "Saving", from: "src/journey.ts SAVE_KEY, loadJourney; src/main.ts saveJourney",
    numbers: {},
    says: [
      `The game saves by itself: after every fight, at every campfire, and when you read a tape, a board or a sign.`,
      `The save stays in this browser on this device (the key \`${SAVE_KEY}\`). It does not follow your account to another device.`,
      `A new journey asks you twice, then replaces the old save.`,
    ],
  },
];

/** docs/RULES.md, written from the sheet. */
export function rulesMd(rules: readonly Rule[] = RULES): string {
  const head = "# Mythic Masters: the rules\n\nEvery rule the player lives under, written once. This page is written by `bun run rules` from `src/rules.ts`,\nand each number in it is read from the code, so do not edit it by hand: change the constant, then run the script.\n";
  return `${head}\n${rules.map((r) => `## ${r.n}. ${r.title}\n\n${r.says.map((s) => `- ${s}`).join("\n")}\n\nFrom the code: ${r.from}.\n`).join("\n")}`;
}

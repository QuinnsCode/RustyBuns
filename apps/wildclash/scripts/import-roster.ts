// Seeds the roster from a public creature-stats API: each creature's six base stats (the radar chart),
// height, weight, elements and level-up moves. Everything that ships is renamed and reshaped here: the
// creature gets a name from our own syllables, each stat gets our axis name, and its moves are cut to six
// slots on fighting-game inputs, each renamed from its element and shape. No source name leaves this file.
//
//   bun scripts/import-roster.ts          fetch (cached in .cache/), write src/roster.json
//
// Add a creature by adding its source number to PICKS with the archetype it plays.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { arr, int, nul, obj, opt, str, type Of } from "@rustybuns/util/guard";
import type { Archetype, Creature, Move, Slot } from "../src/roster.ts";

const API = "https://pokeapi.co/api/v2";
const CACHE = new URL("../.cache/", import.meta.url).pathname;
const OUT = new URL("../src/roster.json", import.meta.url).pathname;

const PICKS: { n: number; archetype: Archetype }[] = [
  { n: 25, archetype: "skirmisher" },
  { n: 6, archetype: "flyer" },
  { n: 9, archetype: "tank" },
  { n: 3, archetype: "bruiser" },
];

const Ref = obj({ name: str(100), url: str(300) });
const Species = obj({
  id: int(1, 100_000),
  height: int(1, 10_000),
  weight: int(1, 100_000),
  stats: arr(obj({ base_stat: int(1, 255), stat: Ref }), 10),
  types: arr(obj({ type: Ref }), 3),
  moves: arr(obj({ move: Ref, version_group_details: arr(obj({ move_learn_method: Ref }), 200) }), 1000),
});
const MoveRow = obj({
  power: nul(int(0, 300)),
  accuracy: nul(int(0, 100)),
  priority: int(-8, 8),
  type: Ref,
  damage_class: Ref,
  meta: opt(nul(obj({ drain: int(-100, 100), healing: int(-100, 100) }))),
});
type MoveRow = Of<typeof MoveRow> & { key: string };

async function get<T>(path: string, guard: (v: unknown) => T): Promise<T> {
  const file = CACHE + path.replaceAll("/", "_") + ".json";
  if (!existsSync(file)) {
    const res = await fetch(`${API}/${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return guard(JSON.parse(readFileSync(file, "utf8")));
}

// Our names. A seeded pick from syllables that lean on the element, so a fire creature sounds warm.
const HEADS: Record<string, string[]> = {
  electric: ["Zib", "Volt", "Sparr", "Fizz", "Kil"], fire: ["Cind", "Brann", "Sco", "Ash", "Kar"],
  water: ["Tid", "Brin", "Mur", "Kel", "Sur"], grass: ["Fen", "Mos", "Thorn", "Bram", "Ver"],
};
const TAILS = ["wick", "ro", "dax", "mire", "lo", "vane", "gor", "ix", "ett", "hune"];
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const pick = <T>(list: T[], seed: string) => list[hash(seed) % list.length]!;
const creatureName = (n: number, element: string) => pick(HEADS[element] ?? HEADS.grass!, `h${n}`) + pick(TAILS, `${element}${n}`);

const SHAPES: Record<Slot, string[]> = {
  light: ["Jab", "Snap", "Flick", "Nip"], heavy: ["Slam", "Crash", "Maul", "Ram"],
  launcher: ["Uppercut", "Riser", "Geyser", "Hoist"], special: ["Bolt", "Shot", "Burst", "Orb"],
  beam: ["Beam", "Lance", "Stream", "Ray"], ultimate: ["Storm", "Cataclysm", "Nova", "Tempest"],
};
const PREFIX: Record<string, string> = {
  electric: "Arc", fire: "Ember", water: "Tide", grass: "Bramble", flying: "Gale", normal: "Brute",
  poison: "Venom", ground: "Quake", rock: "Stone", ice: "Frost", psychic: "Mind", steel: "Iron",
  fighting: "Iron", dark: "Shade", dragon: "Wyrm", fairy: "Glimmer", bug: "Swarm", ghost: "Wisp",
};
const moveName = (slot: Slot, element: string, seed: string) => `${PREFIX[element] ?? "Wild"} ${pick(SHAPES[slot], seed)}`;

// Six slots. Every creature gets a launcher (its anti-air), so nothing in the air is out of reach.
function slots(rows: MoveRow[], elements: string[]): Record<Slot, MoveRow> {
  const hits = rows.filter((r) => (r.power ?? 0) > 0 && (r.meta?.healing ?? 0) === 0).sort((a, b) => (a.power ?? 0) - (b.power ?? 0) || a.key.localeCompare(b.key));
  const phys = hits.filter((r) => r.damage_class.name === "physical");
  const spec = hits.filter((r) => r.damage_class.name === "special");
  const own = (list: MoveRow[]) => list.filter((r) => elements.includes(r.type.name));
  const first = (...lists: MoveRow[][]) => lists.find((l) => l.length)![0]!;
  const last = (...lists: MoveRow[][]) => lists.find((l) => l.length)!.at(-1)!;
  const mid = (list: MoveRow[]) => list[Math.floor(list.length / 2)]!;
  const used = new Set<string>();
  const take = (r: MoveRow) => { used.add(r.key); return r; };
  const free = (list: MoveRow[]) => list.filter((r) => !used.has(r.key));
  const ultimate = take(last(hits));
  const light = take(first(free(phys), free(hits)));
  const heavy = take(last(free(phys), free(hits)));
  const beam = take(last(free(own(spec)), free(spec), free(hits)));
  const special = take(first(free(own(spec)), free(spec), free(own(hits)), free(hits)));
  const launcher = take(free(phys).length ? mid(free(phys)) : mid(free(hits)));
  return { light, heavy, launcher, special, beam, ultimate };
}

const AXES: Record<string, keyof Creature["stats"]> = {
  hp: "vigor", attack: "might", defense: "guard", "special-attack": "focus", "special-defense": "will", speed: "speed",
};

mkdirSync(CACHE, { recursive: true });
const roster: Creature[] = [];
for (const { n, archetype } of PICKS) {
  const s = await get(`pokemon/${n}`, Species);
  const elements = s.types.map((t) => t.type.name);
  const learned = s.moves.filter((m) => m.version_group_details.some((d) => d.move_learn_method.name === "level-up"));
  const rows: MoveRow[] = [];
  for (const m of learned) rows.push({ ...(await get(`move/${m.move.url.split("/").at(-2)}`, MoveRow)), key: m.move.name });
  const chosen = slots(rows, elements);
  const stats = Object.fromEntries(s.stats.map((x) => [AXES[x.stat.name]!, x.base_stat])) as Creature["stats"];
  const moves = (Object.keys(chosen) as Slot[]).map((slot): Move => {
    const r = chosen[slot];
    return {
      slot, name: moveName(slot, r.type.name, `${n}${slot}`), element: r.type.name,
      power: r.power ?? 40, accuracy: r.accuracy ?? 100, ranged: r.damage_class.name === "special", drain: Math.max(0, r.meta?.drain ?? 0),
    };
  });
  const id = creatureName(n, elements[0]!);
  roster.push({ id: id.toLowerCase(), name: id, archetype, elements, heightM: s.height / 10, massKg: s.weight / 10, stats, moves });
  console.log(`${id.padEnd(12)} ${archetype.padEnd(10)} ${(s.weight / 10).toFixed(1)} kg  ${moves.map((m) => m.name).join(", ")}`);
}
writeFileSync(OUT, JSON.stringify(roster, null, 1) + "\n");
console.log(`wrote ${roster.length} creatures to src/roster.json`);

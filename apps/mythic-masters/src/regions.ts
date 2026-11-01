// The 64 regions of the world map, each with the folklore it's known for (#2708). The route runs
// North America → Central and South America → Africa → Europe → Japan → the rest of Asia → Oceania (#2723).
// Regions 1-8 are playable, 9-16 are built but high level, 17-64 are coming soon. A region is a row here:
// adding one is a new row and, once it's built, an arena skin.
//
// High level means no level number: the roads into 9-16 open like any other, but they hold no arena,
// only strong wild creatures that come at you as you walk (`world/world.ts`) and send you home if you lose.
//
// A sacred being is held sacred today, in a living religion or an Indigenous culture. It belongs to
// the region's story and setting and is never a fighter, unless people from that culture agree to it.
// Regions 1-16 are source-checked and carry a lore page (`lore.ts`, #2710); 17-64 are a first pass from general
// knowledge and get the same check when they are built.
import type { Skin } from "./arena.ts";
import { SKINS } from "./arena.ts";
import type { Lore } from "./lore.ts";
import { LORE } from "./lore.ts";

export const TIERS = ["playable", "high-level", "coming-soon"] as const;
export type Tier = (typeof TIERS)[number];
export type Biome = "pine-barrens" | "forest" | "rainforest" | "lake" | "desert" | "swamp" | "plains" | "highlands" | "jungle"
  | "island" | "mountains" | "river" | "coast" | "savanna" | "tundra" | "steppe";

export interface Being { id: string; name: string; sacred: boolean }
export interface Region {
  n: number; id: string; name: string; block: string; tier: Tier; biome: Biome;
  folklore: Being[];
  /** Built regions only: the arena's look there. */
  skin?: Skin;
  /** Built regions only: the legend, its sources, and what of it is sacred. */
  lore?: Lore;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const being = (name: string, sacred = false): Being => ({ id: slug(name), name, sacred });

type Row = [name: string, biome: Biome, folklore: string[], sacred?: string[], skin?: Skin];
// Blocks in route order, with how many regions each holds.
const BLOCKS: [string, number][] = [
  ["North America", 8], ["Central and South America", 8], ["Africa", 12], ["Europe", 16], ["Japan", 8], ["Asia", 8], ["Oceania", 4],
];

const sk = (name: string, sky: number, fog: number, ground: number, water: number, rim: number, prop: number, props: Skin["props"], line = 0xf2f2e6): Skin =>
  ({ name, sky, fog, ground, line, water, rim, prop, props });

const ROWS: Row[] = [
  // 1-8 · North America (playable)
  ["Pine Barrens", "pine-barrens", ["Jersey Devil"], [], sk("Pine Barrens", 0x9fb7c4, 0xb9c6c8, 0xc9b98a, 0x6b4a2a, 0x7a6a4a, 0x2f4a2a, "trees")],
  ["Appalachian hollows", "forest", ["Mothman", "Flatwoods Monster", "Wampus Cat", "Snallygaster"], [], sk("Appalachian hollows", 0x8a9aa8, 0xa8b2b4, 0x4f6b3a, 0x3a5a6a, 0x6a5a48, 0x3a5230, "trees")],
  ["Great North Woods", "forest", ["Hodag", "Squonk", "Hidebehind", "Agropelter", "Beast of Bray Road", "Teakettler"], [], sk("Great North Woods", 0xb8cde0, 0xd4e0e8, 0x55703f, 0x2f5f88, 0x8a6a48, 0x1f3f2a, "trees")],
  ["Pacific Northwest rainforest", "rainforest", ["Sasquatch", "Splintercat", "Fur-bearing Trout"], [], sk("Pacific Northwest", 0x7f9a9a, 0x9fb4ae, 0x3f5f32, 0x2f5a5a, 0x5a4a38, 0x1f3a24, "trees")],
  ["Great Lakes and Lake Champlain", "lake", ["Champ", "Bessie", "Dover Demon", "Loveland Frogman"], [], sk("Great Lakes", 0x9fc7e8, 0xc4dcec, 0xb8b090, 0x2a6aa8, 0x9a9488, 0x8a8a84, "rocks")],
  ["Southwest desert", "desert", ["Chupacabra", "Jackalope", "Fresno Nightcrawler"], ["skinwalker"], sk("Southwest desert", 0xf0c890, 0xf4dcb4, 0xd09a5f, 0x4a9aa8, 0xa8603a, 0xb0583a, "rocks")],
  ["Bayou and Everglades", "swamp", ["Rougarou", "Honey Island Swamp Monster", "Skunk Ape", "Lizard Man of Scape Ore Swamp"], [], sk("Bayou", 0xa8b08a, 0xb8bc98, 0x4a5a2f, 0x3f4a2a, 0x5a4a30, 0x3a4a28, "trees")],
  ["Ozarks and the southern plains", "plains", ["Ozark Howler", "Fouke Monster", "Hoop Snake"], [], sk("Ozarks", 0xa8c8e8, 0xd0dce4, 0x8a9a4a, 0x3a6a8a, 0x8a7050, 0x4a5a30, "trees")],
  // 9-16 · Central and South America (high level)
  ["Valley of Mexico", "highlands", ["Ahuizotl", "nahual"], ["feathered serpent"], sk("Valley of Mexico", 0xa8c0d8, 0xd8d0c0, 0x9a8458, 0x2f7a8a, 0x7a5a3a, 0x8a7a68, "rocks")],
  ["Yucatán and the Maya lowlands", "jungle", ["Xtabay"], ["Alux"], sk("Yucatán", 0x9ac8c0, 0xc0dcd0, 0x5a7a38, 0x2fa0a8, 0xc8bca0, 0x2a5a2a, "trees")],
  ["Central American highlands", "highlands", ["Cadejo", "La Siguanaba", "Sisimite"], [], sk("Central American highlands", 0x8aa8b8, 0xb8c8c8, 0x4a6a3a, 0x3a6a7a, 0x5a4a3a, 0x3a3a38, "rocks")],
  ["Caribbean isles", "island", ["Chupacabra", "Soucouyant", "Lagahoo", "Duppy"], [], sk("Caribbean isles", 0x8fd0f0, 0xd0ecf4, 0xe8d8a8, 0x30c0d0, 0xd8c8a0, 0x3a7a3a, "trees")],
  ["The Andes", "mountains", ["Pishtaco"], ["Amaru", "Ukuku"], sk("The Andes", 0x88aee0, 0xe0e8f0, 0x8a8068, 0x5a8ab0, 0x6a6058, 0xe8ecf0, "rocks")],
  ["Amazon basin", "jungle", ["Mapinguari", "Boitatá", "Curupira"], ["Encantado", "Yacumama"], sk("Amazon basin", 0x8aa890, 0xa8c0a8, 0x3a5a28, 0x7a5a30, 0x4a3a28, 0x1f4a1f, "trees")],
  ["Pampas", "plains", ["Lobizón", "Luz Mala", "Yaguareté-Abá"], [], sk("Pampas", 0xa8c8f0, 0xdce8f0, 0xb8b068, 0x4a7aa0, 0x9a8a60, 0xc8c8c0, "clouds")],
  ["Chiloé and the southern fjords", "coast", ["Trauco", "Caleuche", "Camahueto"], [], sk("Chiloé", 0x8898a8, 0xa8b4bc, 0x4a6a48, 0x2a4a6a, 0x6a6058, 0x5a5a58, "rocks")],
  // 17-28 · Africa
  ["Nile valley", "river", ["Sphinx", "Bennu", "Apep"]],
  ["Sahara", "desert", ["Ghoul"], ["djinn"]],
  ["Maghreb and the Atlas", "mountains", ["Ghoula", "Boughattat"]],
  ["Senegambia", "river", ["Ninki Nanka"]],
  ["Gold Coast forests", "rainforest", ["Sasabonsam", "Anansi"]],
  ["Niger delta", "swamp", ["river spirits"], ["Mami Wata"]],
  ["Congo basin", "rainforest", ["Mokele-mbembe", "Emela-ntouka", "Kongamato"]],
  ["African Great Lakes", "lake", ["Lukwata"]],
  ["Ethiopian highlands", "highlands", ["Buda"]],
  ["Swahili coast", "coast", ["Popobawa", "Zimwi"]],
  ["Southern Africa", "savanna", ["Grootslang", "Impundulu", "Tokoloshe", "Inkanyamba"]],
  ["Madagascar", "island", ["Kalanoro", "Tokandia"]],
  // 29-44 · Europe
  ["Scottish Highlands", "highlands", ["Loch Ness monster", "Kelpie", "Each-uisge"]],
  ["Ireland", "coast", ["Banshee", "Púca", "Dullahan"]],
  ["Wales", "highlands", ["Red dragon", "Afanc", "Gwyllgi"]],
  ["England and Cornwall", "coast", ["Black Shuck", "Lambton Worm", "Knocker"]],
  ["Norway and Sweden", "mountains", ["Troll", "Nøkken", "Draugr", "Fossegrim"]],
  ["Iceland", "tundra", ["Lagarfljót worm", "Yule cat", "Huldufólk"]],
  ["Finland and the Baltic", "forest", ["Iku-Turso", "Lempo", "Laumė"]],
  ["Black Forest and the Rhine", "forest", ["Lorelei", "Nixie", "Kobold", "Wolpertinger"]],
  ["The Alps", "mountains", ["Tatzelwurm", "Krampus"]],
  ["France", "plains", ["Tarasque", "Beast of Gévaudan", "Mélusine"]],
  ["Iberia", "mountains", ["Basajaun", "Coco", "Ojáncanu"]],
  ["Italy and Sicily", "coast", ["Scylla", "Charybdis", "Strix", "Monaciello"]],
  ["Greece and the Aegean", "island", ["Hydra", "Minotaur", "Cyclops", "Chimera", "Siren"]],
  ["The Balkans", "mountains", ["Zmey", "Vila", "Drekavac"]],
  ["Slavic forests", "forest", ["Baba Yaga", "Rusalka", "Leshy", "Domovoi"]],
  ["Carpathians and Transylvania", "mountains", ["Strigoi", "Balaur"]],
  // 45-52 · Japan
  ["Hokkaido", "tundra", [], ["Ainu tales"]],
  ["Tōhoku", "forest", ["Yuki-onna", "Zashiki-warashi", "Kappa"]],
  ["Kantō and Nasu", "plains", ["Nine-tailed fox"]],
  ["Kyoto and Kansai", "mountains", ["Oni", "Nue", "Tengu"]],
  ["The Japan Alps", "mountains", ["Yamauba", "Raijū"]],
  ["Shikoku", "island", ["Tanuki", "Inugami"]],
  ["Kyūshū", "island", ["Ushi-oni", "Kappa"]],
  ["Okinawa and the Ryūkyū", "island", ["Kijimuna", "Shisa"]],
  // 53-60 · Asia
  ["Korea", "mountains", ["Gumiho", "Dokkaebi", "Imugi"]],
  ["Yellow River and the Yangtze", "river", ["Lóng", "Qilin", "Nian", "Fenghuang", "Huli jing", "Jiangshi"]],
  ["Tibet and the Himalaya", "mountains", ["Yeti"]],
  ["Mongolia and Siberia", "steppe", ["Olgoi-khorkhoi", "Almas", "Chuchuna"]],
  ["India", "river", ["Rakshasa", "Vetala", "Yali", "Makara"], ["nāga"]],
  ["Persia and Arabia", "desert", ["Simurgh", "Div", "Manticore", "Shahmaran", "Roc", "Bahamut"]],
  ["Mekong lands", "river", ["Krasue", "Phi pop"]],
  ["Indonesia and the Philippines", "island", ["Tikbalang", "Aswang", "Manananggal", "Leyak", "Barong"]],
  // 61-64 · Oceania. The Dreaming beings and Māori, Papuan and Hawaiian spirits are living belief, so they start
  // sacred; the bunyip, the yowie, the ropen and the menehune are the folk and cryptid tales told around them.
  ["Australia", "desert", ["Bunyip", "Yowie", "Drop Bear"], ["Rainbow Serpent"]],
  ["New Guinea and Melanesia", "jungle", ["Ropen"], ["Masalai"]],
  ["Aotearoa New Zealand", "coast", [], ["Taniwha", "Patupaiarehe"]],
  ["Hawaii and Polynesia", "island", ["Menehune"], ["Moʻo", "Nightmarchers"]],
];

const blockOf = (n: number) => { let end = 0; for (const [b, size] of BLOCKS) if (n <= (end += size)) return b; return BLOCKS.at(-1)![0]; };

export const REGIONS: Region[] = ROWS.map(([name, biome, folk, sacred = [], skin], i) => {
  const n = i + 1;
  return {
    n, id: slug(name), name, block: blockOf(n), biome, skin: skin && { ...skin, biome }, lore: LORE[slug(name)],
    tier: n <= 8 ? "playable" : n <= 16 ? "high-level" : "coming-soon",
    folklore: [...folk.map((f) => being(f)), ...sacred.map((s) => being(s, true))],
  };
});

/** Every arena look: the exhibition skins plus each built region's, keyed by skin or region id. */
export const ALL_SKINS: Record<string, Skin> = {
  ...SKINS,
  ...Object.fromEntries(REGIONS.flatMap((r) => (r.skin ? [[r.id, r.skin]] : []))),
};

/** Beings held sacred: setting and story, never a fighter in the roster. */
export const sacredIds = new Set(REGIONS.flatMap((r) => r.folklore.filter((b) => b.sacred).map((b) => b.id)));

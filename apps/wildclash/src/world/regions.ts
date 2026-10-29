// The 64 regions of the supercontinent (#2708), as data. A region is a row: its cell on the world grid,
// the real place its ground is read from (centre and width), its arena skin and the folklore it hides.
// Adding one is a row here and `bun scripts/fetch-world.ts` for its ground, not new code.
//
// The grid is a loose Pangaea, tuned for play: North America in the north-west, Central and South America
// below it, Europe east of North America (the Appalachians against Ireland, as the old mountain belt ran),
// Africa below Europe and against Brazil, Asia east of Europe and Japan as an arc down the far edge.
// Cells with no region are open sea.

export type Tier = "playable" | "high" | "soon";

export interface Region {
  n: number;              // 1-64, the order in #2708
  name: string;
  tier: Tier;             // playable: North America; high: built but deadly; soon: on the map, closed
  cell: [number, number]; // [column east, row south] on the world grid
  at: [number, number];   // [lat, lon] of the real place the cell's ground comes from
  km: number;             // how wide a square of the real world the cell squeezes into CELL metres
  skin: string;           // a key of SKINS in ../arena.ts: the arena's look and the ground's tint
  folklore: string;
}

export const GRID = { w: 12, h: 8 } as const;

const r = (n: number, name: string, tier: Tier, cell: [number, number], at: [number, number], km: number, skin: string, folklore: string): Region =>
  ({ n, name, tier, cell, at, km, skin, folklore });

export const REGIONS: Region[] = [
  // 1-8 · North America (playable)
  r(1, "Pine Barrens", "playable", [3, 0], [39.8, -74.55], 120, "pines", "the Jersey Devil"),
  r(2, "Appalachian hollows", "playable", [3, 1], [37.9, -81.0], 400, "hollow", "the Mothman, the Flatwoods Monster, the Wampus Cat"),
  r(3, "Great North Woods", "playable", [2, 0], [45.3, -69.4], 500, "northwoods", "the fearsome critters: Hodag, Squonk, Hidebehind, Agropelter"),
  r(4, "Pacific Northwest", "playable", [0, 0], [47.6, -123.0], 300, "rainforest", "Sasquatch"),
  r(5, "Great Lakes and Lake Champlain", "playable", [1, 0], [43.9, -76.5], 600, "lakeshore", "the lake serpents Champ and Bessie"),
  r(6, "Southwest desert", "playable", [0, 1], [34.5, -110.5], 600, "desert", "chupacabra sightings, the jackalope"),
  r(7, "Bayou and Everglades", "playable", [2, 1], [30.0, -91.0], 300, "bayou", "the Rougarou, the Honey Island Swamp Monster, the skunk ape"),
  r(8, "Ozarks and the southern plains", "playable", [1, 1], [36.0, -93.5], 400, "plains", "the Ozark Howler, the Fouke Monster"),
  // 9-16 · Central and South America (built, high level: deadly encounters only)
  r(9, "Valley of Mexico", "high", [1, 2], [19.4, -99.1], 300, "highland", "the Ahuizotl, nahual shapeshifters"),
  r(10, "Yucatán and the Maya lowlands", "high", [2, 2], [19.6, -89.0], 400, "jungle", "the Alux, Xtabay"),
  r(11, "Central American highlands", "high", [2, 3], [14.6, -90.5], 300, "highland", "the Cadejo, La Siguanaba, Sisimite"),
  r(12, "Caribbean isles", "high", [3, 2], [18.6, -71.0], 500, "isles", "the chupacabra, soucouyant and lagahoo, the duppy"),
  r(13, "The Andes", "high", [2, 4], [-13.5, -72.0], 500, "andes", "Pishtaco, Ukuku the bear-man"),
  r(14, "Amazon basin", "high", [3, 4], [-3.5, -62.0], 800, "jungle", "Mapinguari, Boitatá, Curupira, Yacumama"),
  r(15, "Pampas", "high", [3, 5], [-35.0, -61.0], 600, "plains", "the Lobizón, Luz Mala, Yaguareté-Abá"),
  r(16, "Chiloé and the southern fjords", "high", [2, 5], [-42.6, -73.8], 300, "fjords", "the Trauco, the Caleuche ghost ship, the Camahueto"),
  // 17-28 · Africa (coming soon)
  r(17, "Nile valley", "soon", [6, 4], [26.0, 32.5], 500, "desert", "the sphinx, the Bennu"),
  r(18, "Sahara", "soon", [5, 4], [24.0, 9.0], 900, "desert", "ghouls of desert lore"),
  r(19, "Maghreb and the Atlas", "soon", [4, 4], [31.5, -6.5], 500, "andes", "Ghoula, Boughattat"),
  r(20, "Senegambia", "soon", [4, 5], [13.5, -15.5], 400, "plains", "Ninki Nanka"),
  r(21, "Gold Coast forests", "soon", [5, 5], [6.7, -1.6], 400, "jungle", "Sasabonsam, Anansi tales"),
  r(22, "Niger delta", "soon", [6, 5], [5.2, 6.3], 300, "bayou", "river spirits"),
  r(23, "Congo basin", "soon", [5, 6], [-0.5, 18.0], 800, "jungle", "Mokele-mbembe, Emela-ntouka, Kongamato"),
  r(24, "African Great Lakes", "soon", [6, 6], [-1.5, 31.5], 600, "lakeshore", "Lukwata the lake serpent"),
  r(25, "Ethiopian highlands", "soon", [7, 5], [10.5, 38.5], 600, "highland", "the Buda hyena-folk"),
  r(26, "Swahili coast", "soon", [7, 6], [-6.2, 39.2], 400, "isles", "Popobawa, Zimwi"),
  r(27, "Southern Africa", "soon", [6, 7], [-29.0, 29.0], 800, "plains", "Grootslang, Impundulu, Inkanyamba"),
  r(28, "Madagascar", "soon", [7, 7], [-19.0, 46.7], 700, "jungle", "Kalanoro, Tokandia"),
  // 29-44 · Europe (coming soon)
  r(29, "Scottish Highlands", "soon", [5, 0], [57.2, -4.6], 250, "moor", "the Loch Ness monster, the kelpie, the each-uisge"),
  r(30, "Ireland", "soon", [4, 1], [53.3, -8.0], 350, "moor", "the banshee, the púca, the Dullahan"),
  r(31, "Wales", "soon", [5, 1], [52.4, -3.7], 200, "moor", "the red dragon, the afanc, the gwyllgi"),
  r(32, "England and Cornwall", "soon", [6, 1], [51.5, -2.0], 400, "hollow", "Black Shuck, the Lambton Worm, knockers"),
  r(33, "Norway and Sweden", "soon", [6, 0], [61.5, 10.0], 600, "fjords", "trolls, the nøkken, draugr, the fossegrim"),
  r(34, "Iceland", "soon", [4, 0], [64.9, -18.6], 450, "tundra", "the Lagarfljót worm, the Yule cat"),
  r(35, "Finland and the Baltic", "soon", [7, 0], [61.0, 25.0], 600, "northwoods", "Iku-Turso, Lempo, laumės"),
  r(36, "Black Forest and the Rhine", "soon", [6, 2], [48.4, 8.2], 300, "pines", "the Lorelei, nixies, kobolds, the Wolpertinger"),
  r(37, "The Alps", "soon", [5, 3], [46.5, 9.5], 400, "andes", "the Tatzelwurm, Krampus"),
  r(38, "France", "soon", [5, 2], [46.5, 2.5], 600, "plains", "the Tarasque, the Beast of Gévaudan, Mélusine"),
  r(39, "Iberia", "soon", [4, 2], [40.3, -4.0], 700, "desert", "Basajaun, the Coco, Ojáncanu"),
  r(40, "Italy and Sicily", "soon", [4, 3], [40.5, 15.0], 600, "isles", "Scylla and Charybdis, the strix, the Monaciello"),
  r(41, "Greece and the Aegean", "soon", [7, 3], [38.5, 23.5], 500, "isles", "the hydra, the minotaur, the cyclops, the sirens"),
  r(42, "The Balkans", "soon", [6, 3], [43.5, 19.5], 500, "hollow", "the zmey, the vila, the drekavac"),
  r(43, "Slavic forests", "soon", [7, 1], [52.0, 28.0], 800, "northwoods", "Baba Yaga, the rusalka, the leshy, the domovoi"),
  r(44, "Carpathians and Transylvania", "soon", [7, 2], [46.5, 24.5], 400, "highland", "the strigoi, the balaur"),
  // 45-52 · Japan (coming soon)
  r(45, "Hokkaido", "soon", [11, 0], [43.4, 142.8], 400, "tundra", "Ainu tales (a living culture: consult first)"),
  r(46, "Tōhoku", "soon", [11, 1], [39.3, 140.8], 350, "northwoods", "the yuki-onna, the zashiki-warashi, the kappa of Tōno"),
  r(47, "Kantō and Nasu", "soon", [11, 2], [36.3, 139.6], 250, "plains", "the nine-tailed fox"),
  r(48, "Kyoto and Kansai", "soon", [11, 4], [35.0, 135.7], 200, "shrine", "oni, the nue, the tengu of Mount Kurama"),
  r(49, "The Japan Alps", "soon", [11, 3], [36.3, 137.6], 200, "andes", "the yamauba, the raijū"),
  r(50, "Shikoku", "soon", [11, 5], [33.7, 133.5], 250, "shrine", "tanuki, inugami"),
  r(51, "Kyūshū", "soon", [11, 6], [32.6, 130.8], 250, "highland", "the ushi-oni, the kappa"),
  r(52, "Okinawa and the Ryūkyū", "soon", [11, 7], [26.4, 127.9], 200, "isles", "the kijimuna, the shisa"),
  // 53-64 · Asia (coming soon)
  r(53, "Korea", "soon", [10, 1], [36.5, 127.8], 450, "hollow", "the gumiho, the dokkaebi, the imugi"),
  r(54, "Yellow River", "soon", [10, 0], [35.0, 112.0], 700, "plains", "lóng dragons, the qilin, the Nian"),
  r(55, "Yangtze and the south", "soon", [10, 2], [28.5, 112.0], 800, "jungle", "the fenghuang, the huli jing, the jiangshi"),
  r(56, "Tibet and the Himalaya", "soon", [9, 1], [30.0, 88.0], 800, "andes", "the yeti"),
  r(57, "Mongolia and the steppe", "soon", [9, 0], [46.5, 103.0], 900, "plains", "the death worm, the almas"),
  r(58, "Siberia", "soon", [8, 0], [62.0, 105.0], 1200, "tundra", "the Chuchuna"),
  r(59, "Ganges plain", "soon", [9, 2], [26.0, 82.0], 700, "plains", "the rakshasa, the vetala"),
  r(60, "Deccan and the Western Ghats", "soon", [9, 3], [15.5, 75.5], 700, "jungle", "the yali, the makara"),
  r(61, "Persia", "soon", [8, 1], [32.5, 53.5], 900, "desert", "the simurgh, the div, the manticore, the shahmaran"),
  r(62, "Arabia and the Levant", "soon", [8, 2], [27.0, 42.0], 1000, "desert", "the roc, Bahamut the great fish"),
  r(63, "Mekong lands", "soon", [10, 3], [16.0, 103.0], 700, "jungle", "the krasue, the phi pop"),
  r(64, "Indonesia and the Philippines", "soon", [10, 4], [5.0, 118.0], 1500, "isles", "the tikbalang, the aswang, the manananggal, the leyak"),
];

export const region = (n: number) => REGIONS.find((g) => g.n === n);

// The 64 fighters, each a beast from a legend (public domain; the old tellings, not a modern version of one).
// Size and stats follow the story: the Jackalope is a 6 kg hare, the Loch Ness Monster a tonne of lake.
// Beings held sacred today are setting, never fighters (regions.ts lists them; a test checks none is here).
//
// A row: id, name, region (its number on the route in regions.ts), archetype, fields, height m, mass kg,
// stats [vigor, might, guard, focus, will, speed], and its signature, the big finish from its legend.
// `knows` swaps a slot for another field's move it learned in its story (the Squonk's tears are tide, not spirit).
import type { Field } from "./fields.ts";
import type { Fx, Motion, Slot } from "./moves.ts";

export type Archetype = "skirmisher" | "flyer" | "tank" | "bruiser";
type Stats6 = [vigor: number, might: number, guard: number, focus: number, will: number, speed: number];
export interface Signature { name: string; field: Field; ranged: boolean; fx: Fx; power?: number; drain?: number; motion?: Motion }
export interface Row {
  id: string; name: string; region: number; archetype: Archetype; fields: Field[];
  heightM: number; massKg: number; stats: Stats6; sig: Signature; knows?: Partial<Record<Slot, string>>;
}

const sig = (name: string, field: Field, ranged: boolean, fx: Fx, more: Partial<Signature> = {}): Signature => ({ name, field, ranged, fx, ...more });

export const ROWS: Row[] = [
  // North America
  { id: "jersey-devil", name: "Jersey Devil", region: 1, archetype: "flyer", fields: ["shadow", "gale"], heightM: 1.4, massKg: 40, stats: [60, 80, 55, 80, 60, 100], sig: sig("Pine Barrens Shriek", "shadow", true, "wave", { motion: "shriek" }) },
  { id: "mothman", name: "Mothman", region: 2, archetype: "flyer", fields: ["spirit", "storm"], heightM: 2.1, massKg: 70, stats: [65, 60, 55, 100, 85, 90], sig: sig("Red-Eyed Omen", "spirit", true, "beam", { motion: "shriek" }) },
  { id: "wampus-cat", name: "Wampus Cat", region: 2, archetype: "skirmisher", fields: ["shadow", "wild"], heightM: 1.1, massKg: 45, stats: [55, 90, 50, 60, 60, 110], sig: sig("Hollow Pounce", "shadow", false, "rampage") },
  { id: "hodag", name: "Hodag", region: 3, archetype: "tank", fields: ["stone", "ember"], heightM: 0.8, massKg: 140, stats: [100, 95, 110, 50, 70, 40], sig: sig("Spear-Tail Charge", "stone", false, "rampage", { motion: "roll" }) },
  { id: "squonk", name: "Squonk", region: 3, archetype: "skirmisher", fields: ["spirit", "tide"], heightM: 0.6, massKg: 20, stats: [55, 45, 50, 95, 100, 95], sig: sig("Dissolve in Tears", "tide", true, "nova", { drain: 30 }), knows: { special: "tide-special" } },
  { id: "hidebehind", name: "Hidebehind", region: 3, archetype: "skirmisher", fields: ["shadow"], heightM: 2.0, massKg: 60, stats: [55, 95, 45, 55, 60, 115], sig: sig("From Behind the Pine", "shadow", false, "rampage") },
  { id: "agropelter", name: "Agropelter", region: 3, archetype: "bruiser", fields: ["grove", "wild"], heightM: 1.3, massKg: 50, stats: [75, 95, 65, 65, 60, 85], sig: sig("Hurled Branch", "grove", true, "rain"), knows: { special: "stone-special" } },
  { id: "sasquatch", name: "Sasquatch", region: 4, archetype: "bruiser", fields: ["wild", "stone"], heightM: 2.6, massKg: 300, stats: [105, 115, 85, 40, 70, 55], sig: sig("Rainforest Stampede", "wild", false, "rampage") },
  { id: "champ", name: "Champ", region: 5, archetype: "tank", fields: ["tide"], heightM: 2.5, massKg: 600, stats: [115, 95, 95, 75, 85, 40], sig: sig("Lake Champlain Swell", "tide", true, "wave") },
  { id: "chupacabra", name: "Chupacabra", region: 6, archetype: "skirmisher", fields: ["venom", "shadow"], heightM: 1.0, massKg: 35, stats: [55, 85, 50, 60, 55, 110], sig: sig("Goatsucker", "venom", false, "rampage", { drain: 50, motion: "grab" }) },
  { id: "jackalope", name: "Jackalope", region: 6, archetype: "skirmisher", fields: ["wild", "gale"], heightM: 0.5, massKg: 6, stats: [45, 60, 40, 75, 60, 120], sig: sig("Antler Ricochet", "wild", false, "rampage"), knows: { beam: "gale-beam" } },
  { id: "rougarou", name: "Rougarou", region: 7, archetype: "bruiser", fields: ["shadow", "wild"], heightM: 2.1, massKg: 110, stats: [85, 105, 70, 50, 65, 85], sig: sig("Bayou Hunt", "wild", false, "rampage") },
  { id: "ozark-howler", name: "Ozark Howler", region: 8, archetype: "bruiser", fields: ["shadow", "ember"], heightM: 1.4, massKg: 150, stats: [85, 100, 75, 75, 65, 75], sig: sig("Death Howl", "shadow", true, "wave", { motion: "shriek" }) },
  // Central and South America
  { id: "ahuizotl", name: "Ahuizotl", region: 9, archetype: "skirmisher", fields: ["tide", "venom"], heightM: 0.8, massKg: 20, stats: [55, 85, 50, 70, 60, 100], sig: sig("Hand from the Water", "tide", false, "rampage", { drain: 30, motion: "grab" }) },
  { id: "cadejo", name: "Cadejo", region: 11, archetype: "skirmisher", fields: ["spirit", "ember"], heightM: 1.1, massKg: 60, stats: [65, 75, 55, 85, 80, 95], sig: sig("Burning Eyes", "ember", true, "beam") },
  { id: "mapinguari", name: "Mapinguari", region: 14, archetype: "tank", fields: ["grove", "venom"], heightM: 2.2, massKg: 400, stats: [115, 100, 110, 50, 65, 40], sig: sig("Belly-Mouth Roar", "venom", true, "wave") },
  { id: "boitata", name: "Boitatá", region: 14, archetype: "bruiser", fields: ["ember", "spirit"], heightM: 0.8, massKg: 80, stats: [80, 75, 70, 105, 80, 75], sig: sig("Serpent of Fire", "ember", true, "breath") },
  { id: "curupira", name: "Curupira", region: 14, archetype: "skirmisher", fields: ["grove", "spirit"], heightM: 1.0, massKg: 30, stats: [55, 65, 55, 90, 80, 110], sig: sig("Backward Trail", "grove", true, "rain") },
  { id: "lobizon", name: "Lobizón", region: 15, archetype: "bruiser", fields: ["shadow", "wild"], heightM: 1.6, massKg: 90, stats: [85, 105, 70, 45, 60, 90], sig: sig("Seventh Son", "shadow", false, "rampage") },
  { id: "camahueto", name: "Camahueto", region: 16, archetype: "tank", fields: ["tide", "stone"], heightM: 1.5, massKg: 500, stats: [110, 105, 105, 55, 70, 45], sig: sig("Horn to the Sea", "stone", false, "rampage") },
  // Africa
  { id: "sphinx", name: "Sphinx", region: 17, archetype: "tank", fields: ["stone", "spirit"], heightM: 2.2, massKg: 450, stats: [105, 90, 100, 100, 110, 45], sig: sig("The Riddle", "spirit", true, "nova") },
  { id: "sasabonsam", name: "Sasabonsam", region: 21, archetype: "flyer", fields: ["shadow", "grove"], heightM: 1.8, massKg: 70, stats: [65, 95, 55, 70, 60, 95], sig: sig("Hook from the Canopy", "shadow", false, "rampage") },
  { id: "ninki-nanka", name: "Ninki Nanka", region: 20, archetype: "bruiser", fields: ["tide", "venom"], heightM: 1.5, massKg: 300, stats: [95, 100, 85, 85, 70, 60], sig: sig("Gaze of the Swamp", "venom", true, "beam") },
  { id: "mokele-mbembe", name: "Mokele-mbembe", region: 23, archetype: "tank", fields: ["tide", "stone"], heightM: 3.0, massKg: 900, stats: [125, 110, 105, 50, 70, 35], sig: sig("River Stopper", "tide", true, "wave") },
  { id: "emela-ntouka", name: "Emela-ntouka", region: 23, archetype: "tank", fields: ["stone", "wild"], heightM: 1.8, massKg: 800, stats: [110, 120, 110, 40, 60, 40], sig: sig("Elephant Killer", "wild", false, "rampage") },
  { id: "kongamato", name: "Kongamato", region: 23, archetype: "flyer", fields: ["gale", "storm"], heightM: 1.0, massKg: 25, stats: [50, 75, 45, 90, 55, 115], sig: sig("Boat Breaker", "gale", false, "rampage") },
  { id: "grootslang", name: "Grootslang", region: 27, archetype: "bruiser", fields: ["stone", "venom"], heightM: 2.0, massKg: 700, stats: [110, 115, 90, 70, 80, 45], sig: sig("Bottomless Pit", "stone", true, "wave") },
  // Europe
  { id: "kelpie", name: "Kelpie", region: 29, archetype: "bruiser", fields: ["tide", "spirit"], heightM: 1.6, massKg: 450, stats: [85, 95, 65, 85, 75, 90], sig: sig("Drag to the Loch", "tide", false, "rampage", { drain: 25, motion: "grab" }) },
  { id: "nessie", name: "Loch Ness Monster", region: 29, archetype: "tank", fields: ["tide"], heightM: 2.6, massKg: 1000, stats: [125, 95, 105, 85, 90, 30], sig: sig("Deep Water Rising", "tide", true, "wave") },
  { id: "puca", name: "Púca", region: 30, archetype: "skirmisher", fields: ["spirit", "wild"], heightM: 1.2, massKg: 60, stats: [60, 75, 55, 85, 80, 105], sig: sig("Wild Midnight Ride", "spirit", false, "rampage") },
  { id: "red-dragon", name: "Red Dragon", region: 31, archetype: "flyer", fields: ["ember", "gale"], heightM: 2.4, massKg: 400, stats: [95, 105, 85, 110, 85, 70], sig: sig("Dinas Emrys Fire", "ember", true, "breath") },
  { id: "afanc", name: "Afanc", region: 31, archetype: "tank", fields: ["tide", "wild"], heightM: 1.0, massKg: 250, stats: [100, 100, 105, 60, 70, 45], sig: sig("Flood the Valley", "tide", true, "wave") },
  { id: "black-shuck", name: "Black Shuck", region: 32, archetype: "skirmisher", fields: ["shadow", "spirit"], heightM: 1.3, massKg: 70, stats: [65, 85, 55, 75, 70, 105], sig: sig("Through the Church Door", "shadow", false, "rampage") },
  { id: "lambton-worm", name: "Lambton Worm", region: 32, archetype: "bruiser", fields: ["venom", "tide"], heightM: 2.0, massKg: 700, stats: [125, 105, 85, 60, 75, 40], sig: sig("Rejoining Coils", "venom", false, "rampage", { drain: 40, motion: "grab" }) },
  { id: "troll", name: "Troll", region: 33, archetype: "bruiser", fields: ["stone", "frost"], heightM: 2.6, massKg: 500, stats: [120, 120, 95, 35, 55, 45], sig: sig("Mountain Hurl", "stone", true, "rain") },
  { id: "yule-cat", name: "Yule Cat", region: 34, archetype: "bruiser", fields: ["frost", "shadow"], heightM: 2.4, massKg: 400, stats: [95, 105, 75, 65, 70, 80], sig: sig("No New Clothes", "frost", false, "rampage") },
  { id: "wolpertinger", name: "Wolpertinger", region: 36, archetype: "flyer", fields: ["gale", "wild"], heightM: 0.4, massKg: 4, stats: [40, 55, 40, 85, 65, 120], sig: sig("Snipe Hunt", "gale", true, "rain") },
  { id: "tatzelwurm", name: "Tatzelwurm", region: 37, archetype: "skirmisher", fields: ["venom", "frost"], heightM: 0.6, massKg: 25, stats: [55, 80, 55, 80, 55, 105], sig: sig("Poison Breath", "venom", true, "breath") },
  { id: "tarasque", name: "Tarasque", region: 38, archetype: "tank", fields: ["stone", "ember"], heightM: 2.2, massKg: 900, stats: [120, 110, 125, 60, 75, 30], sig: sig("Shell of the Rhône", "stone", false, "rampage", { motion: "roll" }) },
  { id: "gevaudan", name: "Beast of Gévaudan", region: 38, archetype: "bruiser", fields: ["wild"], heightM: 1.2, massKg: 80, stats: [75, 105, 60, 50, 60, 100], sig: sig("Terror of the Margeride", "wild", false, "rampage") },
  { id: "hydra", name: "Hydra", region: 41, archetype: "bruiser", fields: ["venom", "tide"], heightM: 2.4, massKg: 600, stats: [130, 100, 80, 85, 75, 45], sig: sig("Two Heads Grow Back", "venom", true, "nova", { drain: 35, motion: "shake" }) },
  { id: "minotaur", name: "Minotaur", region: 41, archetype: "bruiser", fields: ["wild", "stone"], heightM: 2.4, massKg: 300, stats: [100, 125, 90, 35, 65, 65], sig: sig("Labyrinth Charge", "wild", false, "rampage") },
  { id: "chimera", name: "Chimera", region: 41, archetype: "bruiser", fields: ["ember", "venom"], heightM: 1.7, massKg: 250, stats: [90, 100, 75, 100, 70, 75], sig: sig("Three-Headed Fire", "ember", true, "breath", { motion: "shake" }) },
  { id: "zmey", name: "Zmey", region: 42, archetype: "flyer", fields: ["ember", "storm"], heightM: 2.2, massKg: 350, stats: [90, 95, 80, 105, 80, 80], sig: sig("Three Heads of Storm", "storm", true, "rain", { motion: "shake" }) },
  { id: "leshy", name: "Leshy", region: 43, archetype: "tank", fields: ["grove", "spirit"], heightM: 2.6, massKg: 300, stats: [110, 85, 100, 90, 95, 45], sig: sig("Lost in the Woods", "grove", true, "wave") },
  // Japan
  { id: "kappa", name: "Kappa", region: 46, archetype: "skirmisher", fields: ["tide", "wild"], heightM: 1.0, massKg: 30, stats: [65, 95, 75, 60, 65, 90], sig: sig("Sumo Throw", "wild", false, "rampage") },
  { id: "kyubi", name: "Nine-tailed Fox", region: 47, archetype: "skirmisher", fields: ["ember", "spirit"], heightM: 1.2, massKg: 25, stats: [60, 55, 55, 115, 105, 105], sig: sig("Foxfire of Nine Tails", "ember", true, "rain") },
  { id: "oni", name: "Oni", region: 48, archetype: "bruiser", fields: ["iron", "ember"], heightM: 2.6, massKg: 300, stats: [105, 125, 90, 45, 65, 55], sig: sig("Iron Club", "iron", false, "rampage") },
  { id: "nue", name: "Nue", region: 48, archetype: "flyer", fields: ["storm", "shadow"], heightM: 1.5, massKg: 120, stats: [75, 80, 65, 95, 75, 90], sig: sig("Black Cloud", "storm", true, "rain") },
  { id: "tengu", name: "Tengu", region: 48, archetype: "flyer", fields: ["gale", "iron"], heightM: 1.8, massKg: 60, stats: [65, 90, 60, 85, 80, 100], sig: sig("Feather Fan Gale", "gale", true, "wave") },
  { id: "raiju", name: "Raijū", region: 49, archetype: "skirmisher", fields: ["storm"], heightM: 0.8, massKg: 12, stats: [50, 70, 45, 105, 65, 120], sig: sig("Thunder Beast Falls", "storm", true, "rain") },
  { id: "tanuki", name: "Tanuki", region: 50, archetype: "tank", fields: ["wild", "spirit"], heightM: 0.9, massKg: 40, stats: [100, 70, 95, 80, 90, 55], sig: sig("Belly Drum", "spirit", true, "nova", { motion: "drum" }) },
  { id: "ushi-oni", name: "Ushi-oni", region: 51, archetype: "tank", fields: ["venom", "tide"], heightM: 1.8, massKg: 800, stats: [115, 110, 110, 70, 70, 35], sig: sig("Shore Ambush", "venom", false, "rampage", { drain: 30, motion: "grab" }) },
  // Asia
  { id: "dokkaebi", name: "Dokkaebi", region: 53, archetype: "bruiser", fields: ["iron", "spirit"], heightM: 1.8, massKg: 120, stats: [85, 100, 75, 85, 75, 75], sig: sig("Magic Club", "iron", true, "rain") },
  { id: "imugi", name: "Imugi", region: 53, archetype: "bruiser", fields: ["tide", "storm"], heightM: 2.2, massKg: 400, stats: [100, 90, 85, 95, 90, 60], sig: sig("Pearl of Ascension", "storm", true, "beam") },
  { id: "qilin", name: "Qilin", region: 54, archetype: "skirmisher", fields: ["spirit", "ember"], heightM: 1.7, massKg: 200, stats: [80, 75, 70, 100, 110, 95], sig: sig("Walks on No Grass", "spirit", true, "wave") },
  { id: "nian", name: "Nian", region: 54, archetype: "bruiser", fields: ["wild", "ember"], heightM: 2.0, massKg: 350, stats: [100, 115, 85, 65, 55, 75], sig: sig("New Year's Rampage", "wild", false, "rampage") },
  { id: "yeti", name: "Yeti", region: 55, archetype: "bruiser", fields: ["frost", "wild"], heightM: 2.4, massKg: 250, stats: [105, 115, 85, 55, 70, 60], sig: sig("Avalanche", "frost", true, "rain") },
  { id: "olgoi-khorkhoi", name: "Olgoi-khorkhoi", region: 56, archetype: "skirmisher", fields: ["venom", "storm"], heightM: 0.8, massKg: 15, stats: [55, 55, 50, 105, 70, 100], sig: sig("Death Worm's Shock", "storm", true, "nova") },
  { id: "manticore", name: "Manticore", region: 58, archetype: "bruiser", fields: ["venom", "wild"], heightM: 1.6, massKg: 230, stats: [85, 105, 70, 85, 65, 85], sig: sig("Volley of Tail Spikes", "venom", true, "rain", { motion: "volley" }) },
  { id: "roc", name: "Roc", region: 58, archetype: "flyer", fields: ["gale", "stone"], heightM: 3.0, massKg: 900, stats: [110, 120, 85, 65, 70, 75], sig: sig("Dropped Boulder", "stone", true, "rain") },
  { id: "tikbalang", name: "Tikbalang", region: 60, archetype: "skirmisher", fields: ["wild", "shadow"], heightM: 2.4, massKg: 150, stats: [75, 90, 60, 65, 70, 110], sig: sig("Led Astray", "shadow", false, "rampage") },
  // Oceania
  { id: "bunyip", name: "Bunyip", region: 61, archetype: "tank", fields: ["tide", "shadow"], heightM: 1.6, massKg: 450, stats: [110, 100, 100, 70, 80, 45], sig: sig("Billabong Boom", "tide", true, "wave") },
  { id: "ropen", name: "Ropen", region: 62, archetype: "flyer", fields: ["gale", "spirit"], heightM: 1.6, massKg: 40, stats: [60, 75, 50, 95, 70, 105], sig: sig("Night Glow", "spirit", true, "beam") },
];

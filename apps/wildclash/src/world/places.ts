// Where each of the 64 regions (../regions.ts) sits on the supercontinent: its cell on the world grid, and
// the real place its ground is read from (centre and width). Adding a region to the world is a row here and
// `bun scripts/fetch-world.ts <n>` for its ground.
//
// The grid is a loose Pangaea, tuned for play: North America in the north-west, Central and South America
// below it, Europe east of North America (the Appalachians against Ireland, as the old mountain belt ran),
// Africa below Europe and against Brazil, Asia east of Europe and Japan as an arc down the far edge.
// Cells with no region are open sea.

export const GRID = { w: 12, h: 8 } as const;

export interface Place {
  cell: [number, number]; // [column east, row south] on the world grid
  at: [number, number];   // [lat, lon] of the real place the cell's ground comes from
  km: number;             // how wide a square of the real world the cell squeezes into one cell
}

const p = (cx: number, cz: number, lat: number, lon: number, km: number): Place => ({ cell: [cx, cz], at: [lat, lon], km });

/** By region number. */
export const PLACES: Record<number, Place> = {
  1: p(3, 0, 39.8, -74.55, 120), // Pine Barrens
  2: p(3, 1, 37.9, -81.0, 400), // Appalachian hollows
  3: p(2, 0, 45.3, -69.4, 500), // Great North Woods
  4: p(0, 0, 47.6, -123.0, 300), // Pacific Northwest
  5: p(1, 0, 43.9, -76.5, 600), // Great Lakes and Lake Champlain
  6: p(0, 1, 34.5, -110.5, 600), // Southwest desert
  7: p(2, 1, 30.0, -91.0, 300), // Bayou and Everglades
  8: p(1, 1, 36.0, -93.5, 400), // Ozarks and the southern plains
  9: p(1, 2, 19.4, -99.1, 300), // Valley of Mexico
  10: p(2, 2, 19.6, -89.0, 400), // Yucatán and the Maya lowlands
  11: p(2, 3, 14.6, -90.5, 300), // Central American highlands
  12: p(3, 2, 18.6, -71.0, 500), // Caribbean isles
  13: p(2, 4, -13.5, -72.0, 500), // The Andes
  14: p(3, 4, -3.5, -62.0, 800), // Amazon basin
  15: p(3, 5, -35.0, -61.0, 600), // Pampas
  16: p(2, 5, -42.6, -73.8, 300), // Chiloé and the southern fjords
  17: p(6, 4, 26.0, 32.5, 500), // Nile valley
  18: p(5, 4, 24.0, 9.0, 900), // Sahara
  19: p(4, 4, 31.5, -6.5, 500), // Maghreb and the Atlas
  20: p(4, 5, 13.5, -15.5, 400), // Senegambia
  21: p(5, 5, 6.7, -1.6, 400), // Gold Coast forests
  22: p(6, 5, 5.2, 6.3, 300), // Niger delta
  23: p(5, 6, -0.5, 18.0, 800), // Congo basin
  24: p(6, 6, -1.5, 31.5, 600), // African Great Lakes
  25: p(7, 5, 10.5, 38.5, 600), // Ethiopian highlands
  26: p(7, 6, -6.2, 39.2, 400), // Swahili coast
  27: p(6, 7, -29.0, 29.0, 800), // Southern Africa
  28: p(7, 7, -19.0, 46.7, 700), // Madagascar
  29: p(5, 0, 57.2, -4.6, 250), // Scottish Highlands
  30: p(4, 1, 53.3, -8.0, 350), // Ireland
  31: p(5, 1, 52.4, -3.7, 200), // Wales
  32: p(6, 1, 51.5, -2.0, 400), // England and Cornwall
  33: p(6, 0, 61.5, 10.0, 600), // Norway and Sweden
  34: p(4, 0, 64.9, -18.6, 450), // Iceland
  35: p(7, 0, 61.0, 25.0, 600), // Finland and the Baltic
  36: p(6, 2, 48.4, 8.2, 300), // Black Forest and the Rhine
  37: p(5, 3, 46.5, 9.5, 400), // The Alps
  38: p(5, 2, 46.5, 2.5, 600), // France
  39: p(4, 2, 40.3, -4.0, 700), // Iberia
  40: p(4, 3, 40.5, 15.0, 600), // Italy and Sicily
  41: p(7, 3, 38.5, 23.5, 500), // Greece and the Aegean
  42: p(6, 3, 43.5, 19.5, 500), // The Balkans
  43: p(7, 1, 52.0, 28.0, 800), // Slavic forests
  44: p(7, 2, 46.5, 24.5, 400), // Carpathians and Transylvania
  45: p(11, 0, 43.4, 142.8, 400), // Hokkaido
  46: p(11, 1, 39.3, 140.8, 350), // Tōhoku
  47: p(11, 2, 36.3, 139.6, 250), // Kantō and Nasu
  48: p(11, 4, 35.0, 135.7, 200), // Kyoto and Kansai
  49: p(11, 3, 36.3, 137.6, 200), // The Japan Alps
  50: p(11, 5, 33.7, 133.5, 250), // Shikoku
  51: p(11, 6, 32.6, 130.8, 250), // Kyūshū
  52: p(11, 7, 26.4, 127.9, 200), // Okinawa and the Ryūkyū
  53: p(10, 1, 36.5, 127.8, 450), // Korea
  54: p(10, 0, 35.0, 112.0, 700), // Yellow River
  55: p(10, 2, 28.5, 112.0, 800), // Yangtze and the south
  56: p(9, 1, 30.0, 88.0, 800), // Tibet and the Himalaya
  57: p(9, 0, 46.5, 103.0, 900), // Mongolia and the steppe
  58: p(8, 0, 62.0, 105.0, 1200), // Siberia
  59: p(9, 2, 26.0, 82.0, 700), // Ganges plain
  60: p(9, 3, 15.5, 75.5, 700), // Deccan and the Western Ghats
  61: p(8, 1, 32.5, 53.5, 900), // Persia
  62: p(8, 2, 27.0, 42.0, 1000), // Arabia and the Levant
  63: p(10, 3, 16.0, 103.0, 700), // Mekong lands
  64: p(10, 4, 5.0, 118.0, 1500), // Indonesia and the Philippines
};

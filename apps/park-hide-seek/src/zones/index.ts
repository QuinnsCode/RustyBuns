// The drop zones whose ground isn't bundled: one per national park, 2 km of real terrain round its signature
// spot, fetched by Skate Tech Park's scripts/fetch-parks.ts into packages/terrain/src/zones. They carry no
// landmarks or park map yet (that's what a park survey adds: fetch-zones.ts), so the ranger station is found
// on the ground and the drop map shows the terrain alone. The lobby lists them from this table; the ground
// itself arrives (loadZoneData in zone.ts) the first time a round lands there.
import type { ZoneData } from "./types.ts";

export type ZoneMeta = Pick<ZoneData, "id" | "park" | "name" | "blurb" | "trees">;

const pine = "pine" as const, sequoia = "sequoia" as const, desert = "desert" as const;
export const ZONE_INDEX: ZoneMeta[] = [
  { id: "acadia", park: "ACAD", name: "Cadillac Mountain", blurb: "Pink granite ledges and low spruce, with the Atlantic spread below", trees: pine },
  { id: "american-samoa", park: "NPSA", name: "Ofu Beach", blurb: "A white beach under a rainforest ridge; the hiding is up in the trees", trees: pine },
  { id: "arches", park: "ARCH", name: "Delicate Arch", blurb: "Slickrock bowls round the arch, with sandstone fins to duck behind", trees: pine },
  { id: "badlands", park: "BADL", name: "The Wall", blurb: "Striped clay ridges and gullies, soft as sand and steep as a wall", trees: pine },
  { id: "big-bend", park: "BIBE", name: "Santa Elena Canyon", blurb: "Where the Rio Grande cuts a 450 m limestone slot through the desert", trees: desert },
  { id: "biscayne", park: "BISC", name: "Boca Chita Key", blurb: "A flat coral island in a bay: nothing to hide behind but the bushes", trees: pine },
  { id: "black-canyon", park: "BLCA", name: "Painted Wall", blurb: "The rim over a gorge so narrow the sun barely reaches the river", trees: pine },
  { id: "bryce-canyon", park: "BRCA", name: "Sunset Point", blurb: "A rim path over the amphitheater and a thousand hoodoos below it", trees: pine },
  { id: "canyonlands", park: "CANY", name: "Mesa Arch", blurb: "A window on the rim of the Island in the Sky, a 150 m drop behind it", trees: pine },
  { id: "capitol-reef", park: "CARE", name: "Fruita", blurb: "Orchards under the Waterpocket Fold, a wrinkle in the earth 160 km long", trees: pine },
  { id: "carlsbad-caverns", park: "CAVE", name: "Natural Entrance", blurb: "A desert ridge over the cave mouth, 250 m of cave below your feet", trees: pine },
  { id: "channel-islands", park: "CHIS", name: "Scorpion Anchorage", blurb: "Grassy hills on Santa Cruz Island falling to a cobble cove", trees: pine },
  { id: "congaree", park: "CONG", name: "Floodplain Forest", blurb: "Old-growth bottomland, level ground and the tallest trees in the east", trees: pine },
  { id: "crater-lake", park: "CRLA", name: "Rim Village", blurb: "The rim over the deepest lake in the country, Wizard Island out in the blue", trees: pine },
  { id: "cuyahoga-valley", park: "CUVA", name: "Brandywine Falls", blurb: "A 20 m ribbon of water in a wooded valley between two cities", trees: pine },
  { id: "death-valley", park: "DEVA", name: "Zabriskie Point", blurb: "Ochre badlands folding down towards the lowest basin in North America", trees: pine },
  { id: "denali", park: "DENA", name: "Wonder Lake", blurb: "Tundra by the lake, with the highest peak in North America filling the sky", trees: pine },
  { id: "dry-tortugas", park: "DRTO", name: "Fort Jefferson", blurb: "A brick fortress filling Garden Key, seventy miles of open water from anywhere", trees: pine },
  { id: "everglades", park: "EVER", name: "Anhinga Trail", blurb: "A sawgrass river a hand deep and fifty miles wide", trees: pine },
  { id: "gates-of-the-arctic", park: "GAAR", name: "Frigid Crags", blurb: "Boreal Mountain and Frigid Crags either side of the Koyukuk, north of any road", trees: pine },
  { id: "gateway-arch", park: "JEFF", name: "The Arch", blurb: "The riverfront lawn that rolls up to the legs of the stainless steel arch", trees: pine },
  { id: "glacier", park: "GLAC", name: "Logan Pass", blurb: "The Continental Divide where the road crosses between two huge cirques", trees: pine },
  { id: "glacier-bay", park: "GLBA", name: "Margerie Glacier", blurb: "The shore facing a wall of blue ice under snowy peaks", trees: pine },
  { id: "grand-canyon", park: "GRCA", name: "Mather Point", blurb: "The South Rim and the first drop into the canyon", trees: pine },
  { id: "grand-teton", park: "GRTE", name: "Cascade Canyon", blurb: "The canyon mouth below the Cathedral Group, peaks 2,000 m straight up from the valley", trees: pine },
  { id: "great-basin", park: "GRBA", name: "Wheeler Peak", blurb: "Bristlecone pines, the oldest trees alive, on a ridge under the peak", trees: pine },
  { id: "great-sand-dunes", park: "GRSA", name: "High Dune", blurb: "The tallest dunes in North America, 230 m of sand against the Sangre de Cristo", trees: pine },
  { id: "great-smoky-mountains", park: "GRSM", name: "Clingmans Dome", blurb: "The roof of Tennessee, in the blue haze that names the range", trees: pine },
  { id: "guadalupe-mountains", park: "GUMO", name: "Guadalupe Peak", blurb: "The highest ground in Texas, on the edge of a fossil reef above the salt flats", trees: pine },
  { id: "haleakala", park: "HALE", name: "Haleakalā Crater", blurb: "A crater 11 km across at the summit, cinder cones on its floor and clouds below", trees: pine },
  { id: "hawaii-volcanoes", park: "HAVO", name: "Kīlauea", blurb: "The caldera from the Jaggar overlook, a crater a mile wide", trees: pine },
  { id: "hot-springs", park: "HOSP", name: "Bathhouse Row", blurb: "The foot of the Ouachitas, 47 springs behind a street of ornate stone", trees: pine },
  { id: "indiana-dunes", park: "INDU", name: "Mount Baldy", blurb: "A wandering sand dune on the shore of Lake Michigan", trees: pine },
  { id: "isle-royale", park: "ISRO", name: "Rock Harbor", blurb: "An island in Lake Superior with wolves, moose and no roads at all", trees: pine },
  { id: "joshua-tree", park: "JOTR", name: "Skull Rock", blurb: "A pile of golden granite boulders where two deserts meet", trees: desert },
  { id: "katmai", park: "KATM", name: "Brooks Falls", blurb: "Where the brown bears stand on the lip and catch salmon out of the air", trees: pine },
  { id: "kenai-fjords", park: "KEFJ", name: "Exit Glacier", blurb: "The end of a gravel valley, an arm of the Harding Icefield you can walk up to", trees: pine },
  { id: "kings-canyon", park: "KICA", name: "Zumwalt Meadow", blurb: "The deepest canyon in America, under granite walls 1,000 m high", trees: pine },
  { id: "kobuk-valley", park: "KOVA", name: "Great Kobuk Sand Dunes", blurb: "Arctic dunes with caribou crossing between them", trees: pine },
  { id: "lake-clark", park: "LACL", name: "Twin Lakes", blurb: "Two long blue lakes and a log cabin at the foot of the Alaska Range", trees: pine },
  { id: "lassen-volcanic", park: "LAVO", name: "Bumpass Hell", blurb: "Steaming vents and boiling mud in the bowl of an old volcano", trees: pine },
  { id: "mammoth-cave", park: "MACA", name: "Historic Entrance", blurb: "A cave mouth in a Kentucky sinkhole with 400 miles of passages behind it", trees: pine },
  { id: "mesa-verde", park: "MEVE", name: "Cliff Palace", blurb: "A stone village tucked under a sandstone overhang 800 years ago", trees: pine },
  { id: "mount-rainier", park: "MORA", name: "Paradise", blurb: "A wildflower meadow on the flank of a glaciated volcano", trees: pine },
  { id: "new-river-gorge", park: "NERI", name: "The Bridge", blurb: "The gorge under a steel arch 267 m above one of the oldest rivers on the continent", trees: pine },
  { id: "north-cascades", park: "NOCA", name: "Diablo Lake", blurb: "A turquoise reservoir under jagged peaks and 300 glaciers", trees: pine },
  { id: "olympic", park: "OLYM", name: "Hurricane Ridge", blurb: "Meadows looking across to the glaciers on Mount Olympus", trees: pine },
  { id: "petrified-forest", park: "PEFO", name: "Blue Mesa", blurb: "Striped badlands and logs of quartz that were trees 220 million years ago", trees: pine },
  { id: "pinnacles", park: "PINN", name: "High Peaks", blurb: "Spires of an old volcano split in two and carried 200 km along a fault", trees: pine },
  { id: "redwood", park: "REDW", name: "Lady Bird Johnson Grove", blurb: "The tallest trees on Earth, in a ground fog", trees: sequoia },
  { id: "rocky-mountain", park: "ROMO", name: "Dream Lake", blurb: "A glacier cirque under Hallett Peak, 3,000 m up", trees: pine },
  { id: "saguaro", park: "SAGU", name: "Signal Hill", blurb: "A hill above a forest of saguaros, the cactus that grows nowhere else on Earth", trees: desert },
  { id: "sequoia", park: "SEQU", name: "General Sherman Tree", blurb: "A grove on a Sierra slope round the largest living thing by volume", trees: sequoia },
  { id: "shenandoah", park: "SHEN", name: "Stony Man", blurb: "A Blue Ridge cliff above Skyline Drive and a valley full of fog", trees: pine },
  { id: "theodore-roosevelt", park: "THRO", name: "Painted Canyon", blurb: "North Dakota badlands, where the president ranched and found his cause", trees: pine },
  { id: "virgin-islands", park: "VIIS", name: "Trunk Bay", blurb: "White sand on St. John and a green hill behind it", trees: pine },
  { id: "voyageurs", park: "VOYA", name: "Kettle Falls", blurb: "A waterfall between two lakes on the Canadian border, reached only by boat", trees: pine },
  { id: "white-sands", park: "WHSA", name: "The Dunes", blurb: "Gypsum dunes as white as snow, the biggest field of them on Earth", trees: pine },
  { id: "wind-cave", park: "WICA", name: "Natural Entrance", blurb: "A prairie hill over the cave that breathes in and out with the weather", trees: pine },
  { id: "wrangell-st-elias", park: "WRST", name: "Kennecott", blurb: "A red mill town under the Root Glacier, at the foot of the biggest mountains in the country", trees: pine },
  { id: "zion", park: "ZION", name: "Angels Landing", blurb: "A sandstone fin with 450 m drops both sides, over the canyon of the Virgin River", trees: pine },
];

/** The state each park is in (the first one, where it spans several), for the lobby's regions. */
export const PARK_STATES: Record<string, string> = {
  ACAD: "ME", NPSA: "AS", ARCH: "UT", BADL: "SD", BIBE: "TX", BISC: "FL", BLCA: "CO", BRCA: "UT", CANY: "UT", CARE: "UT",
  CAVE: "NM", CHIS: "CA", CONG: "SC", CRLA: "OR", CUVA: "OH", DEVA: "CA", DENA: "AK", DRTO: "FL", EVER: "FL", GAAR: "AK",
  JEFF: "MO", GLAC: "MT", GLBA: "AK", GRCA: "AZ", GRTE: "WY", GRBA: "NV", GRSA: "CO", GRSM: "TN", GUMO: "TX", HALE: "HI",
  HAVO: "HI", HOSP: "AR", INDU: "IN", ISRO: "MI", JOTR: "CA", KATM: "AK", KEFJ: "AK", KICA: "CA", KOVA: "AK", LACL: "AK",
  LAVO: "CA", MACA: "KY", MEVE: "CO", MORA: "WA", NERI: "WV", NOCA: "WA", OLYM: "WA", PEFO: "AZ", PINN: "CA", REDW: "CA",
  ROMO: "CO", SAGU: "AZ", SEQU: "CA", SHEN: "VA", THRO: "ND", VIIS: "VI", VOYA: "MN", WHSA: "NM", WICA: "SD", WRST: "AK",
  YELL: "WY", YOSE: "CA", ZION: "UT",
};

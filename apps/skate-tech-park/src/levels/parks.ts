// All 63 US national parks as data: where each one's signature spot is (the centre of its 2 km of real ground,
// fetched with `bun scripts/fetch-parks.ts`), a line about it, the air over it. A park with a level of its own
// lists it in `levels.ts`; the picker groups the cards by `regionOf(state)`.

import type { Biome } from "./park.ts";

export type ParkRow = {
  id: string; name: string;
  /** Two-letter code (the first one where a park spans several). */
  state: string;
  /** The signature spot: the origin of the park's ground, so spawns face (0, 0). */
  lat: number; lon: number;
  blurb: string;
  /** A name from render/weather.ts; golden hour when absent. */
  weather?: string;
  /** Height scale for flat ground (sea level, dunes): 0.35 when absent, more where the land is nearly level. */
  relief?: number;
  /** The scenery's biome (a ParkSpec's `biome`); pine forest when absent. */
  biome?: Biome;
  /** Parks whose levels were drawn before this table: the levels they own, in the zone files they already had. */
  places?: string[];
};

export const REGIONS = ["West Coast", "Southwest", "Rockies", "Plains & Midwest", "East & Florida", "Alaska & Islands"] as const;
export type Region = (typeof REGIONS)[number];

const BY_STATE: Record<string, Region> = {
  CA: "West Coast", OR: "West Coast", WA: "West Coast",
  AZ: "Southwest", NM: "Southwest", UT: "Southwest", NV: "Southwest", TX: "Southwest",
  CO: "Rockies", WY: "Rockies", MT: "Rockies",
  SD: "Plains & Midwest", ND: "Plains & Midwest", MO: "Plains & Midwest", AR: "Plains & Midwest", IN: "Plains & Midwest", OH: "Plains & Midwest", MI: "Plains & Midwest", MN: "Plains & Midwest",
  ME: "East & Florida", VA: "East & Florida", WV: "East & Florida", TN: "East & Florida", KY: "East & Florida", SC: "East & Florida", FL: "East & Florida",
  AK: "Alaska & Islands", HI: "Alaska & Islands", AS: "Alaska & Islands", VI: "Alaska & Islands",
};
export const regionOf = (state: string): Region => BY_STATE[state] ?? "West Coast";

export const PARKS: ParkRow[] = [
  { id: "acadia", name: "Acadia", state: "ME", lat: 44.3526, lon: -68.226, blurb: "Pink granite on Cadillac Mountain, the first place the sun reaches the country, with the Atlantic spread below.", weather: "mist", biome: "alpine" },
  { id: "american-samoa", name: "National Park of American Samoa", state: "AS", lat: -14.1836, lon: -169.678, blurb: "A white beach on Ofu under a rainforest ridge, nearly at sea level.", weather: "rain", relief: 1.2, biome: "swamp" },
  { id: "arches", name: "Arches", state: "UT", lat: 38.7436, lon: -109.4993, blurb: "Slickrock around Delicate Arch: a sandstone bowl to roll down and the arch standing on its rim.", weather: "dust", biome: "desert" },
  { id: "badlands", name: "Badlands", state: "SD", lat: 43.7407, lon: -101.9503, blurb: "Striped clay ridges and gullies cut into the prairie, steep as a wall and soft as sand.", weather: "dust", relief: 2, biome: "desert" },
  { id: "big-bend", name: "Big Bend", state: "TX", lat: 29.1647, lon: -103.6075, blurb: "The Rio Grande squeezes through Santa Elena Canyon, a 450 m limestone slot in the desert.", weather: "dust", biome: "desert" },
  { id: "biscayne", name: "Biscayne", state: "FL", lat: 25.5237, lon: -80.1755, blurb: "Boca Chita Key, a flat coral island in a bay: all the hills here are the ones we pour.", weather: "noon", relief: 6, biome: "swamp" },
  { id: "black-canyon", name: "Black Canyon of the Gunnison", state: "CO", lat: 38.5726, lon: -107.7176, blurb: "The Painted Wall, Colorado's tallest cliff, across a gorge so narrow the sun barely reaches the river.", weather: "overcast", biome: "desert" },
  { id: "bryce-canyon", name: "Bryce Canyon", state: "UT", lat: 37.6283, lon: -112.1653, blurb: "Sunset Point over the amphitheater of hoodoos: a rim to run up speed on and a thousand spires below it.", weather: "dusk", biome: "desert" },
  { id: "canyonlands", name: "Canyonlands", state: "UT", lat: 38.3892, lon: -109.8683, blurb: "Mesa Arch, a window on the rim of the Island in the Sky with a drop of 150 m behind it.", weather: "dusk", biome: "desert" },
  { id: "capitol-reef", name: "Capitol Reef", state: "UT", lat: 38.283, lon: -111.246, blurb: "Fruita's orchards under the Waterpocket Fold, a wrinkle in the earth 160 km long.", weather: "dust", biome: "desert" },
  { id: "carlsbad-caverns", name: "Carlsbad Caverns", state: "NM", lat: 32.178, lon: -104.444, blurb: "The natural entrance, a sinkhole in a desert ridge with 250 m of cave switchbacking down.", weather: "dusk", biome: "desert" },
  { id: "channel-islands", name: "Channel Islands", state: "CA", lat: 34.048, lon: -119.556, blurb: "Santa Cruz Island's Scorpion Anchorage: grassy hills falling to a cobble cove.", weather: "mist" },
  { id: "congaree", name: "Congaree", state: "SC", lat: 33.7915, lon: -80.816, blurb: "Old-growth floodplain forest: the ground is level and the trees are the tallest in the east.", weather: "mist", relief: 4, biome: "swamp" },
  { id: "crater-lake", name: "Crater Lake", state: "OR", lat: 42.93, lon: -122.164, blurb: "The rim over the deepest lake in the country, with Wizard Island, a volcano inside a volcano, out in the blue.", weather: "snow", biome: "alpine" },
  { id: "cuyahoga-valley", name: "Cuyahoga Valley", state: "OH", lat: 41.318, lon: -81.542, blurb: "Brandywine Falls, a 20 m ribbon of water in a wooded valley between two cities.", weather: "rain", relief: 1.2, biome: "hardwood" },
  { id: "death-valley", name: "Death Valley", state: "CA", lat: 36.422, lon: -116.811, blurb: "Zabriskie Point: ochre badlands folding down toward the lowest, hottest basin in North America.", weather: "dust", relief: 0.7, biome: "desert" },
  { id: "denali", name: "Denali", state: "AK", lat: 63.453, lon: -150.864, blurb: "Wonder Lake in the tundra with the highest peak in North America, a hundred kilometres away, filling the sky.", weather: "snow", biome: "alpine" },
  { id: "dry-tortugas", name: "Dry Tortugas", state: "FL", lat: 24.628, lon: -82.873, blurb: "Fort Jefferson, a brick fortress filling Garden Key, seventy miles of open water from anywhere.", weather: "noon", relief: 8, biome: "swamp" },
  { id: "everglades", name: "Everglades", state: "FL", lat: 25.383, lon: -80.608, blurb: "The Anhinga Trail across a sawgrass river a hand-width deep and fifty miles wide.", weather: "mist", relief: 6, biome: "swamp" },
  { id: "gates-of-the-arctic", name: "Gates of the Arctic", state: "AK", lat: 67.8, lon: -149.75, blurb: "Boreal Mountain and Frigid Crags stand either side of the Koyukuk, a gate north of any road.", weather: "overcast", biome: "alpine" },
  { id: "gateway-arch", name: "Gateway Arch", state: "MO", lat: 38.6247, lon: -90.1848, blurb: "The stainless steel arch on the riverfront of St. Louis, over a lawn that rolls up to its legs.", weather: "noon", relief: 4, biome: "hardwood" },
  { id: "glacier", name: "Glacier", state: "MT", lat: 48.6967, lon: -113.7182, blurb: "Logan Pass on the Continental Divide, where the road crosses the crest between two huge cirques.", weather: "snow", biome: "alpine" },
  { id: "glacier-bay", name: "Glacier Bay", state: "AK", lat: 58.93, lon: -137.08, blurb: "The face of Margerie Glacier, a wall of blue ice calving into a fjord under snowy peaks.", weather: "mist", biome: "alpine" },
  { id: "grand-canyon", name: "Grand Canyon", state: "AZ", lat: 36.0614, lon: -112.1077, blurb: "The South Rim at Mather Point, with the first drop into the canyon.", weather: "dust", places: ["grand-canyon"], biome: "desert" },
  { id: "grand-teton", name: "Grand Teton", state: "WY", lat: 43.754, lon: -110.738, blurb: "The mouth of Cascade Canyon below the Cathedral Group, peaks that jump 2,000 m straight from the valley.", weather: "overcast" },
  { id: "great-basin", name: "Great Basin", state: "NV", lat: 38.98, lon: -114.303, blurb: "Bristlecone pines, the oldest trees alive, on a ridge under Wheeler Peak.", weather: "snow", biome: "alpine" },
  { id: "great-sand-dunes", name: "Great Sand Dunes", state: "CO", lat: 37.738, lon: -105.542, blurb: "The tallest dunes in North America piled against the Sangre de Cristo, 230 m of sand to roll down.", weather: "dust", relief: 0.5, biome: "desert" },
  { id: "great-smoky-mountains", name: "Great Smoky Mountains", state: "TN", lat: 35.5628, lon: -83.4986, blurb: "Clingmans Dome, the roof of Tennessee, in the blue haze that gives the range its name.", weather: "mist", relief: 0.2, biome: "hardwood" },
  { id: "guadalupe-mountains", name: "Guadalupe Mountains", state: "TX", lat: 31.891, lon: -104.861, blurb: "Guadalupe Peak, the highest ground in Texas, on the edge of a fossil reef 2,000 m above the salt flats.", weather: "dust", biome: "desert" },
  { id: "haleakala", name: "Haleakala", state: "HI", lat: 20.712, lon: -156.248, blurb: "A crater 11 km across at the summit of a Maui volcano, with cinder cones on its floor and clouds below.", weather: "dusk", biome: "alpine" },
  { id: "hawaii-volcanoes", name: "Hawaii Volcanoes", state: "HI", lat: 19.418, lon: -155.287, blurb: "Kilauea's caldera at the Jaggar overlook: a crater a mile wide and a lava lake that comes and goes.", weather: "overcast", biome: "alpine" },
  { id: "hot-springs", name: "Hot Springs", state: "AR", lat: 34.514, lon: -93.054, blurb: "Bathhouse Row at the foot of the Ouachitas, 47 springs under a street of ornate stone.", weather: "mist", relief: 0.8, biome: "hardwood" },
  { id: "indiana-dunes", name: "Indiana Dunes", state: "IN", lat: 41.6787, lon: -86.9075, blurb: "Mount Baldy, a wandering sand dune on the shore of Lake Michigan, with a beach you can skate to.", weather: "noon", relief: 1.5, biome: "hardwood" },
  { id: "isle-royale", name: "Isle Royale", state: "MI", lat: 48.1, lon: -88.55, blurb: "Rock Harbor on an island in Lake Superior, with wolves, moose and no roads at all.", weather: "mist", relief: 1.2  },
  { id: "joshua-tree", name: "Joshua Tree", state: "CA", lat: 34.012, lon: -116.06, blurb: "Skull Rock in a pile of golden monzogranite boulders, where two deserts meet.", weather: "dusk", biome: "desert" },
  { id: "katmai", name: "Katmai", state: "AK", lat: 58.5551, lon: -155.7807, blurb: "Brooks Falls, where brown bears stand on the lip and catch salmon out of the air.", weather: "mist", biome: "alpine" },
  { id: "kenai-fjords", name: "Kenai Fjords", state: "AK", lat: 60.188, lon: -149.633, blurb: "Exit Glacier at the end of a gravel valley, an arm of the Harding Icefield you can walk up to.", weather: "overcast", biome: "alpine" },
  { id: "kings-canyon", name: "Kings Canyon", state: "CA", lat: 36.7938, lon: -118.587, blurb: "Zumwalt Meadow in the deepest canyon in America, under granite walls 1,000 m high.", weather: "noon" },
  { id: "kobuk-valley", name: "Kobuk Valley", state: "AK", lat: 67.095, lon: -159.0, blurb: "The Great Kobuk Sand Dunes, 25 square miles of arctic dune with caribou crossing between them.", weather: "dust", relief: 0.8, biome: "desert" },
  { id: "lake-clark", name: "Lake Clark", state: "AK", lat: 60.62, lon: -153.83, blurb: "Twin Lakes, two long blue lakes and a log cabin at the foot of the Alaska Range.", weather: "mist", biome: "alpine" },
  { id: "lassen-volcanic", name: "Lassen Volcanic", state: "CA", lat: 40.462, lon: -121.504, blurb: "Bumpass Hell, steaming vents and boiling mud in the bowl of an old volcano.", weather: "overcast", biome: "alpine" },
  { id: "mammoth-cave", name: "Mammoth Cave", state: "KY", lat: 37.187, lon: -86.1, blurb: "The Historic Entrance, a cave mouth in a Kentucky sinkhole with 400 miles of passages behind it.", weather: "mist", relief: 1.2, biome: "hardwood" },
  { id: "mesa-verde", name: "Mesa Verde", state: "CO", lat: 37.167, lon: -108.472, blurb: "Cliff Palace, a stone village tucked under a sandstone overhang 800 years ago.", weather: "dust", biome: "desert" },
  { id: "mount-rainier", name: "Mount Rainier", state: "WA", lat: 46.786, lon: -121.735, blurb: "Paradise, a meadow of wildflowers on the flank of a glaciated volcano.", weather: "snow", biome: "alpine" },
  { id: "new-river-gorge", name: "New River Gorge", state: "WV", lat: 38.069, lon: -81.083, blurb: "The bridge, a steel arch 267 m above one of the oldest rivers on the continent.", weather: "mist", biome: "hardwood" },
  { id: "north-cascades", name: "North Cascades", state: "WA", lat: 48.7142, lon: -121.133, blurb: "Diablo Lake, a turquoise reservoir under jagged peaks and 300 glaciers.", weather: "overcast" },
  { id: "olympic", name: "Olympic", state: "WA", lat: 47.9695, lon: -123.4985, blurb: "Hurricane Ridge, a meadow ridge looking across to glaciers on Mount Olympus.", weather: "mist" },
  { id: "petrified-forest", name: "Petrified Forest", state: "AZ", lat: 34.931, lon: -109.783, blurb: "Blue Mesa's striped badlands, with logs of quartz that were trees 220 million years ago.", weather: "dust", biome: "desert" },
  { id: "pinnacles", name: "Pinnacles", state: "CA", lat: 36.49, lon: -121.168, blurb: "The High Peaks, spires of an old volcano split in two and carried 200 km along a fault.", weather: "dusk", biome: "desert" },
  { id: "redwood", name: "Redwood", state: "CA", lat: 41.293, lon: -124.013, blurb: "Lady Bird Johnson Grove, the tallest trees on Earth in a ground fog.", weather: "mist" },
  { id: "rocky-mountain", name: "Rocky Mountain", state: "CO", lat: 40.308, lon: -105.66, blurb: "Dream Lake under Hallett Peak, in a glacier cirque 3,000 m up.", weather: "snow", biome: "alpine" },
  { id: "saguaro", name: "Saguaro", state: "AZ", lat: 32.231, lon: -111.178, blurb: "Signal Hill above a forest of saguaros, the cactus that grows nowhere else on Earth.", weather: "dusk", biome: "desert" },
  { id: "sequoia", name: "Sequoia", state: "CA", lat: 36.5817, lon: -118.7512, blurb: "The General Sherman Tree, the largest living thing by volume, in a grove on a Sierra slope.", weather: "mist" },
  { id: "shenandoah", name: "Shenandoah", state: "VA", lat: 38.59, lon: -78.37, blurb: "Stony Man, a Blue Ridge cliff above the Skyline Drive and a valley full of fog.", weather: "mist", biome: "hardwood" },
  { id: "theodore-roosevelt", name: "Theodore Roosevelt", state: "ND", lat: 46.915, lon: -103.525, blurb: "Painted Canyon in the North Dakota badlands, where the president ranched and found his cause.", weather: "dust", biome: "desert" },
  { id: "virgin-islands", name: "Virgin Islands", state: "VI", lat: 18.352, lon: -64.769, blurb: "Trunk Bay on St. John, white sand and a green hill behind it, mostly under water.", weather: "noon", relief: 1.5, biome: "swamp" },
  { id: "voyageurs", name: "Voyageurs", state: "MN", lat: 48.5, lon: -92.65, blurb: "Kettle Falls on the Canadian border, a waterfall between two lakes that you reach only by boat.", weather: "mist", relief: 1.5  },
  { id: "white-sands", name: "White Sands", state: "NM", lat: 32.783, lon: -106.258, blurb: "Gypsum dunes as white as snow, the biggest field of them on Earth.", weather: "noon", relief: 2, biome: "desert" },
  { id: "wind-cave", name: "Wind Cave", state: "SD", lat: 43.557, lon: -103.478, blurb: "The natural entrance, a hole in a prairie hill that breathes in and out with the weather.", weather: "dust", relief: 0.8, biome: "desert" },
  { id: "wrangell-st-elias", name: "Wrangell-St. Elias", state: "AK", lat: 61.485, lon: -142.886, blurb: "Kennecott, a red mill town under the Root Glacier at the foot of the biggest mountains in the country.", weather: "overcast", biome: "alpine" },
  { id: "yellowstone", name: "Yellowstone", state: "WY", lat: 44.4605, lon: -110.8281, blurb: "The geyser basin and the spring: Old Faithful's bowl and Grand Prismatic's runoff.", weather: "overcast", places: ["old-faithful", "grand-prismatic"]  },
  { id: "yosemite", name: "Yosemite", state: "CA", lat: 37.7459, lon: -119.5332, blurb: "El Capitan Meadow, Glacier Point, Half Dome, the Falls and Mariposa Grove.", weather: "mist", places: ["el-capitan", "glacier-point", "half-dome", "yosemite-falls", "mariposa-grove"]  },
  { id: "zion", name: "Zion", state: "UT", lat: 37.2693, lon: -112.9473, blurb: "Angels Landing, a sandstone fin with a drop of 450 m on both sides, over the canyon of the Virgin River.", weather: "dusk", biome: "desert" },
];

export const parkRow = (id: string): ParkRow => {
  const row = PARKS.find((p) => p.id === id);
  if (!row) throw new Error(`no park ${id}`);
  return row;
};

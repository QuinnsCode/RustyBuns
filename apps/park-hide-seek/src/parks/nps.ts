// Every US national park, for "Request a park": players vote for the next one
// to get zones. A fixed list, so a request is a vote, never free text.

export const NATIONAL_PARKS: { code: string; name: string }[] = [
  { code: "ACAD", name: "Acadia" }, { code: "NPSA", name: "American Samoa" }, { code: "ARCH", name: "Arches" },
  { code: "BADL", name: "Badlands" }, { code: "BIBE", name: "Big Bend" }, { code: "BISC", name: "Biscayne" },
  { code: "BLCA", name: "Black Canyon of the Gunnison" }, { code: "BRCA", name: "Bryce Canyon" }, { code: "CANY", name: "Canyonlands" },
  { code: "CARE", name: "Capitol Reef" }, { code: "CAVE", name: "Carlsbad Caverns" }, { code: "CHIS", name: "Channel Islands" },
  { code: "CONG", name: "Congaree" }, { code: "CRLA", name: "Crater Lake" }, { code: "CUVA", name: "Cuyahoga Valley" },
  { code: "DEVA", name: "Death Valley" }, { code: "DENA", name: "Denali" }, { code: "DRTO", name: "Dry Tortugas" },
  { code: "EVER", name: "Everglades" }, { code: "GAAR", name: "Gates of the Arctic" }, { code: "JEFF", name: "Gateway Arch" },
  { code: "GLAC", name: "Glacier" }, { code: "GLBA", name: "Glacier Bay" }, { code: "GRCA", name: "Grand Canyon" },
  { code: "GRTE", name: "Grand Teton" }, { code: "GRBA", name: "Great Basin" }, { code: "GRSA", name: "Great Sand Dunes" },
  { code: "GRSM", name: "Great Smoky Mountains" }, { code: "GUMO", name: "Guadalupe Mountains" }, { code: "HALE", name: "Haleakalā" },
  { code: "HAVO", name: "Hawaiʻi Volcanoes" }, { code: "HOSP", name: "Hot Springs" }, { code: "INDU", name: "Indiana Dunes" },
  { code: "ISRO", name: "Isle Royale" }, { code: "JOTR", name: "Joshua Tree" }, { code: "KATM", name: "Katmai" },
  { code: "KEFJ", name: "Kenai Fjords" }, { code: "KICA", name: "Kings Canyon" }, { code: "KOVA", name: "Kobuk Valley" },
  { code: "LACL", name: "Lake Clark" }, { code: "LAVO", name: "Lassen Volcanic" }, { code: "MACA", name: "Mammoth Cave" },
  { code: "MEVE", name: "Mesa Verde" }, { code: "MORA", name: "Mount Rainier" }, { code: "NERI", name: "New River Gorge" },
  { code: "NOCA", name: "North Cascades" }, { code: "OLYM", name: "Olympic" }, { code: "PEFO", name: "Petrified Forest" },
  { code: "PINN", name: "Pinnacles" }, { code: "REDW", name: "Redwood" }, { code: "ROMO", name: "Rocky Mountain" },
  { code: "SAGU", name: "Saguaro" }, { code: "SEQU", name: "Sequoia" }, { code: "SHEN", name: "Shenandoah" },
  { code: "THRO", name: "Theodore Roosevelt" }, { code: "VIIS", name: "Virgin Islands" }, { code: "VOYA", name: "Voyageurs" },
  { code: "WHSA", name: "White Sands" }, { code: "WICA", name: "Wind Cave" }, { code: "WRST", name: "Wrangell–St. Elias" },
  { code: "YELL", name: "Yellowstone" }, { code: "YOSE", name: "Yosemite" }, { code: "ZION", name: "Zion" },
];

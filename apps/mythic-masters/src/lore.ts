// The lore page of each built region (#2710): the legend in a paragraph, where it comes from, what we checked it
// against, and whether any of it is held sacred today. Keyed by region id; `regions.ts` hangs it off the row.
// A source is one we could name with confidence; where only oral tradition stands behind a tale, the entry says so.
// Imports nothing, so a lore check or a docs page can read it on its own.

export interface Lore {
  /** The legend, as the region tells it. */
  legend: string;
  /** Who tells it and since when. */
  from: string;
  /** What the entry was checked against. */
  sources: string[];
  /** Whether any of it is held sacred today, and what the game does about it. */
  sacred: string;
}

export const LORE: Record<string, Lore> = {
  "pine-barrens": {
    legend: "In 1735 Mother Leeds, already the mother of twelve, swore that her thirteenth child would be the devil. It was born a baby and changed at once into a winged thing with a horse's head, hooves and a forked tail, and flew up the chimney into the pines. It has been heard screaming there since, and in one week of January 1909 hundreds of people across South Jersey and Philadelphia reported its tracks and its cry.",
    from: "Colonial South Jersey, first as the Leeds Devil. The 1909 sighting wave made it the state's mascot.",
    sources: ["James F. McCloy and Ray Miller Jr., The Jersey Devil (1976)", "Newspaper reports of the January 1909 sightings"],
    sacred: "Nothing sacred. A colonial tale, told for fun.",
  },
  "appalachian-hollows": {
    legend: "In 1966 and 1967 people around Point Pleasant, West Virginia, saw a man-sized grey shape with wings and glowing red eyes along the river, until the Silver Bridge fell and the sightings stopped. Fourteen years earlier in Braxton County, boys chasing a falling light up a hill met a tall figure with a spade-shaped head and a hissing mist: the Flatwoods Monster. And in the hills a wampus cat, half woman and half cougar, prowls the edge of the firelight.",
    from: "West Virginia newspapers (Flatwoods, September 1952; Point Pleasant, 1966-67) and Appalachian settler tales.",
    sources: ["John A. Keel, The Mothman Prophecies (1975)", "Contemporary reports in West Virginia papers, September 1952"],
    sacred: "Nothing sacred. The wampus cat is often called a Cherokee legend, but we found no early written source for that; we treat it as settler folklore and don't credit it to the Cherokee.",
  },
  "great-north-woods": {
    legend: "Lumber camps passed long winters inventing beasts to scare the new men. The hodag, horned and spiked down its back, was 'captured' in Rhinelander, Wisconsin. The squonk is so ashamed of its warty skin that it weeps, and dissolves into tears when caught. The hidebehind is never seen because it always stands behind you, and the agropelter drops branches on loggers from hollow trees.",
    from: "Lumberjack tall tales of the upper Midwest, Maine and the Pennsylvania hemlock woods, around 1890-1920.",
    sources: ["William T. Cox, Fearsome Creatures of the Lumberwoods (1910)", "Eugene Shepard's hodag hoax, Rhinelander, Wisconsin (1893 and 1896)"],
    sacred: "Nothing sacred. These were jokes from the start.",
  },
  "pacific-northwest-rainforest": {
    legend: "A great hairy giant walks the coast forests on two legs, leaves footprints far too long for a man, and is almost never seen. Plaster casts of tracks at Bluff Creek in 1958 named it Bigfoot, and the forests of British Columbia, Washington and Oregon have been searched for it ever since.",
    from: "The name comes from the Halkomelem sásq'ets, written as Sasquatch by J. W. Burns in the 1920s; the modern legend from 1950s California logging reports.",
    sources: ["J. W. Burns' articles in Maclean's (1929)", "Bluff Creek, California, track reports (1958)"],
    sacred: "The Sasquatch here is the modern one of the hiking-trail legend. Several First Nations (the Sts'ailes among them) hold the sásq'ets as a real being to respect; that being is setting, never a fighter, and if the game ever shows it, it asks them first.",
  },
  "great-lakes-and-lake-champlain": {
    legend: "Something long-necked lives in Lake Champlain. Hundreds of sightings since the 1800s, and a 1977 photograph of a hump and a head rising from the water, call it Champ. Lake Erie has its own, Bessie, a grey serpent seen off the Ohio shore.",
    from: "New York, Vermont and Quebec lake-shore reports from the 1800s on; Lake Erie sightings, named Bessie in the 1990s.",
    sources: ["Joseph W. Zarzynski, Champ: Beyond the Legend (1984)", "The 1977 Mansi photograph"],
    sacred: "Nothing sacred. The tale that Samuel de Champlain saw Champ in 1609 is a misreading: his journal describes a large fish.",
  },
  "southwest-desert": {
    legend: "Goats found drained of blood in Puerto Rico in 1995 gave the goat-sucker its name, and within a few years the chupacabra was a hairless, grey dog-like thing raiding ranches from Mexico to Texas. The jackalope, a jackrabbit with antelope horns, is gentler: it sings in cowboy voices at night and can only be caught with whiskey.",
    from: "The chupacabra from Puerto Rico (1995), carried north into Mexico and the Southwest; the jackalope from Douglas, Wyoming taxidermists in the 1930s.",
    sources: ["Benjamin Radford, Tracking the Chupacabra (2011)", "Douglas, Wyoming and the Herrick brothers' mounted jackalopes (1930s)"],
    sacred: "The yee naaldlooshii (skinwalker) belongs to Navajo belief and is not to be talked about lightly. It is marked sacred: never a fighter, never shown, only felt as a warning in the region's story.",
  },
  "bayou-and-everglades": {
    legend: "The rougarou, the Cajun loup-garou, is a man with a wolf's head who hunts Catholics breaking Lent, and a curse that passes on to whoever draws its blood. Deeper in the Honey Island swamp walks a grey, hairy, four-toed giant, and in the Everglades the skunk ape announces itself by its smell.",
    from: "French Louisiana's werewolf tales; a 1963 hunter's sighting and 1974 tracks for the Honey Island monster; Florida reports of the skunk ape from the 1960s on.",
    sources: ["Barry Jean Ancelet, Cajun and Creole Folktales (1994)", "Harlan Ford's Honey Island accounts (1963, 1974)"],
    sacred: "Nothing sacred.",
  },
  "ozarks-and-the-southern-plains": {
    legend: "In 1971 the Ford family of Fouke, Arkansas said a tall, hairy creature reached through their window, and the Boggy Creek monster has stalked the bottomlands since. The Ozark howler is younger: a bear-sized black cat with horns and a cry like a wolf and an elk at once.",
    from: "The Texarkana Gazette's 1971 reports and the film that followed; the howler appears in the late 1990s and is widely held to be a modern hoax.",
    sources: ["Texarkana Gazette, May 1971", "The howler's own story: no record before the late 1990s"],
    sacred: "Nothing sacred.",
  },
  "valley-of-mexico": {
    legend: "The ahuizotl is a small dog-like water creature with a hand on the end of its tail. It waits under the lake's edge, drags the careless down and gives back the body without eyes, teeth or nails. On land, a nahual is a person who can take an animal's shape at night.",
    from: "Nahua (Aztec) tradition of the Valley of Mexico, written down by Nahua scholars and Bernardino de Sahagún in the 1500s; the nahual is still told across Mexico and Central America.",
    sources: ["Florentine Codex, Book 11 (ahuizotl)", "Alfredo López Austin, Cuerpo humano e ideología (1980), on the nahualli"],
    sacred: "Quetzalcoatl, the feathered serpent, was a god and is honoured today by Mexica revival groups. Marked sacred: the plumed serpent is in the region's carvings and story, never a fighter.",
  },
  "yucatan-and-the-maya-lowlands": {
    legend: "Aluxob are knee-high spirits of the fields and forest. A farmer who makes them offerings has his milpa guarded; one who forgets has his crops trampled and his tools hidden. Xtabay is a beautiful woman under a ceiba tree who calls men into the forest and is never seen again by them.",
    from: "Yucatec Maya tradition; aluxob are still given offerings at fields and building sites today.",
    sources: ["Robert Redfield and Alfonso Villa Rojas, Chan Kom: A Maya Village (1934)", "The tale of Xkeban and Utz-Colel, Yucatec oral tradition"],
    sacred: "The source check moved the alux to sacred: it is a living belief people make offerings to, not a monster. It stays in the region's story and shrines. Xtabay is a cautionary tale and is not sacred.",
  },
  "central-american-highlands": {
    legend: "Two dogs follow night walkers: a white cadejo that guards them home and a black one that leads them astray. La Siguanaba is a woman seen washing at a river, who turns, when a man comes close, to show a horse's face. The sisimite is a huge hairy man of the mountains with backward feet who carries off women.",
    from: "Oral tradition of Guatemala, El Salvador, Honduras and Belize, with Maya and Spanish roots.",
    sources: ["Oral tradition only: no single written source we could name with confidence; told in national folklore collections of each country"],
    sacred: "Nothing sacred.",
  },
  "caribbean-isles": {
    legend: "By day the soucouyant is an old woman at the edge of the village; by night she sheds her skin and flies as a ball of fire to drink blood, and salt on the skin keeps her out. The lagahoo drags a chain behind it and changes shape. In Jamaica, a duppy is the spirit of the dead that a careless burial lets loose. And the chupacabra started here, in Puerto Rico, in 1995.",
    from: "Trinidad and Tobago and the Lesser Antilles (soucouyant, lagahoo), Jamaica (duppy), Puerto Rico (chupacabra), with West African and French roots.",
    sources: ["Gerard Besson, Folklore and Legends of Trinidad and Tobago (1989)", "Martha Warren Beckwith, Black Roadways: A Study of Jamaican Folk Life (1929)", "Benjamin Radford, Tracking the Chupacabra (2011)"],
    sacred: "Nothing marked sacred. A duppy is the spirit of someone's dead, so the game shows them as haunting the setting, not as fighters to beat.",
  },
  "the-andes": {
    legend: "The pishtaco is a stranger on the mountain roads who kills travellers for their fat, a fear that began with the colonial conquerors and changed its face with each new outsider. The amaru is a great serpent of the underworld and the waters. And on the glacier of Qullqipunku, ukukus, half bear and half man, climb in the night to bring down ice for the pilgrims.",
    from: "Quechua and Aymara tradition of Peru and Bolivia; the ukuku from the Qoyllur Rit'i pilgrimage near Cusco.",
    sources: ["Mary Weismantel, Cholas and Pishtacos (2001)", "UNESCO, the Qoyllur Rit'i pilgrimage, Intangible Cultural Heritage (2011)"],
    sacred: "The amaru stays sacred. The source check moved the ukuku to sacred: it is a role in a living pilgrimage, danced by real pilgrims. Both are setting and story; the pishtaco, a fear of outsiders, is not sacred.",
  },
  "amazon-basin": {
    legend: "The curupira has his feet on backwards, so hunters who track him walk away from him; he guards the forest from those who take too much. The boitatá is a fire snake that guards the fields. The mapinguari is a giant with a mouth in its belly, the yacumama an anaconda big enough to be the mother of the river, and the boto, a pink river dolphin, comes ashore as a man in a white hat to dance at festivals.",
    from: "Tupi and other Amazonian peoples' tradition, mixed with Portuguese and African tales in caboclo Brazil. Curupira and boitatá are already in a Jesuit letter of 1560.",
    sources: ["José de Anchieta's letter of 1560", "Luís da Câmara Cascudo, Dicionário do Folclore Brasileiro (1954)", "Candace Slater, Dance of the Dolphin (1994)"],
    sacred: "The source check moved the encantado to sacred: encantados are spirits received in living Afro-Brazilian and Amazonian religions. The dolphin-man appears in the region's story, never as a fighter. The yacumama is revered in some Amazonian shamanic practice as the mother of the waters, so it is sacred too (#2723).",
  },
  pampas: {
    legend: "A seventh son born in a row becomes a lobizón, a wolf-dog on Friday nights under a full moon. On empty plains a luz mala, a bad light, hangs where a soul is lost or treasure is buried. And a yaguareté-abá is a man, often a shaman, who has become a jaguar.",
    from: "Guaraní tradition and rural Argentina, Paraguay and Uruguay; the lobizón is strongest in the northeast of Argentina, not the pampas proper.",
    sources: ["The Argentine custom of the president standing godparent to a seventh son, from 1907, written into law in 1974", "Oral tradition, Guaraní and gaucho"],
    sacred: "Nothing sacred.",
  },
  "chiloe-and-the-southern-fjords": {
    legend: "The Caleuche is a ghost ship of drowned sailors, lit up and full of music, that sinks when you look at it. In the forest the trauco, a small ugly man with an axe, is blamed for unexplained pregnancies. And the camahueto is a horned calf that breaks out of the ground and tears its way to the sea, and must be caught by a machi before it ruins the land.",
    from: "Chilote tradition of the Chiloé archipelago, mixing Huilliche and Spanish beliefs.",
    sources: ["Oral tradition only: the Chiloé mythology is well documented in Chilean folklore collections, but we did not check a single book"],
    sacred: "Nothing marked sacred. The machi is a living Mapuche healer role; it appears only as a person in the story, never as a fighter or a foe.",
  },
};

import type { Tape } from "./poi.ts";

// Found tapes for the seven playable regions after the Pine Barrens (those live in poi.ts), six apiece, three lines
// each, in the director's voices. Every fact is one a ranger would sign: only the voices are made up.
export const TAPES: Record<string, Tape[]> = {
  "appalachian-hollows": [
    { title: "Camper's log, Spruce Knob", lines: [
      "Camper: Spruce Knob, the highest ground in West Virginia. Cold at night even in summer. Colder tonight.",
      "Camper: The ridge hums after dark. Low, like a wire. I told myself it was the wind through the spruce.",
      "Camper: The wind stopped an hour ago. The humming didn't.",
    ] },
    { title: "Ranger's report, Green Bank", lines: [
      "Ranger: Green Bank sits inside the National Radio Quiet Zone. No cell towers, no broadcast, so the telescopes can hear.",
      "Ranger: A visitor says his radio picked up a voice at the trailhead. I said there's no signal here. He said that's the point.",
      "Ranger: I checked. There's no signal here. Report ends.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: We're at the New River Gorge, which is not new, and arguably not a river. It's one of the oldest rivers on the continent.",
      "Gary: The bridge above us is nearly nine hundred feet up. Great shot. Great shot of the bridge.",
      "Gary: Something on the far cliff just waved. It's a branch. Is it a branch? Hold the shot.",
    ] },
    { title: "The Flatwoods night", lines: [
      "Narrator: September 1952, Flatwoods. Boys saw a light fall on a hill and ran for help.",
      "Narrator: They climbed it with a flashlight and found a mist, a smell, and two eyes in the dark above them.",
      "Narrator: The Air Force found a skid mark in the field. Nobody has found the rest.",
    ] },
    { title: "Silver Bridge", lines: [
      "Narrator: On the evening of December 15, 1967, the Silver Bridge at Point Pleasant fell into the Ohio River.",
      "Narrator: Forty-six people died. Months before it, locals had talked of a tall grey shape with red eyes near the old munitions grounds.",
      "Narrator: Some say it warned them. Most say it was a coincidence. The bridge is gone either way.",
    ] },
    { title: "Foreman, McClintic", lines: [
      "Foreman: The McClintic ground was a wartime depot, concrete domes in the woods, and the woods took them back.",
      "Foreman: Night shift said you'd hear wings over the domes. Big ones. Slow ones.",
      "Foreman: I never believed it. I just stopped taking the night shift.",
    ] },
  ],
  "great-north-woods": [
    { title: "Camper's log, Nicolet", lines: [
      "Camper: Nicolet National Forest, Wisconsin. A million and a half acres, and tonight I can believe every one.",
      "Camper: The loons stopped calling at dusk. All at once. Like someone raised a hand.",
      "Camper: Whatever it is, the dog won't leave the tent.",
    ] },
    { title: "Ranger's report, Bray Road", lines: [
      "Ranger: Elkhorn, Wisconsin, late eighties. Drivers on Bray Road reported a tall, hairy thing that ran on two legs and then four.",
      "Ranger: Most were farmers. Most said they would rather not have been asked.",
      "Ranger: I drove the road twice. Nothing. I drove it faster the second time.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: Welcome to the Boundary Waters, over a million acres of lakes you can only reach by paddle.",
      "Gary: The quiet here is the loudest thing I've ever recorded. That's a good line. Keep that.",
      "Gary: Why is the canoe moving? We tied the canoe. We tied it.",
    ] },
    { title: "Logging camp cook", lines: [
      "Cook: The lumberjack camps ran on stories, and the best ones were about the hidebehind.",
      "Cook: It's always behind the tree you turn toward. Men swore it took the one who walked last, and never left a boot.",
      "Cook: That's why we always walked in pairs. And why neither of us ever looked back.",
    ] },
    { title: "Paul Bunyan, as told", lines: [
      "Narrator: The tall tales say Paul Bunyan dug the Great Lakes for his ox's drinking water, and his boots made the ten thousand lakes of Minnesota.",
      "Narrator: Truth is, the stories were polished by logging-camp storytellers and an ad writer in the 1910s.",
      "Narrator: The ad writer never explained the footprints near Bemidji. Those are older than the ad.",
    ] },
    { title: "Katahdin, last entry", lines: [
      "Hiker: Katahdin. The end of the Appalachian Trail, and it feels like the end of the world.",
      "Hiker: The Penobscot say Pamola, the spirit of the mountain, doesn't like to be laughed at.",
      "Hiker: I'm turning back. Tell the others the weather turned. Tell them it was the weather.",
    ] },
  ],
  "pacific-northwest-rainforest": [
    { title: "Camper's log, Hoh", lines: [
      "Camper: The Hoh Rain Forest gets twelve feet of rain a year. Everything is green, including the tent.",
      "Camper: There's a smell on the wind. Wet dog, wet leaves, something sour underneath.",
      "Camper: The moss near the camp has been pressed flat in a line. A long line. Long strides.",
    ] },
    { title: "Ranger's report, Mount St. Helens", lines: [
      "Ranger: Mount St. Helens erupted on May 18, 1980. Fifty-seven people died and the forest north of it went flat in minutes.",
      "Ranger: Sasquatch stories from Ape Canyon, on the south side, go back to 1924. The mountain has its own opinions of strangers.",
      "Ranger: Elk are back. Fireweed is back. The rest is up to the mountain.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: Multnomah Falls, over six hundred feet. Lovely.",
      "Gary: The word Sasquatch comes from the Halkomelem sásq'ets. The First Nations stories are older than any camera.",
      "Gary: Something just walked behind the falls. A person. A very tall person. Roll that. Roll that!",
    ] },
    { title: "Bluff Creek, 1967", lines: [
      "Narrator: October 20, 1967. Roger Patterson and Bob Gimlin film a large figure walking away along Bluff Creek, northern California.",
      "Narrator: Fifty-nine and a half feet of film. It looks back once over its shoulder.",
      "Narrator: People have argued over that glance for more than half a century. The creek keeps its counsel.",
    ] },
    { title: "Surveyor, Redwood Creek", lines: [
      "Surveyor: The coast redwoods are the tallest trees on earth. Some have stood two thousand years.",
      "Surveyor: A man can stand at the foot of one and feel he's been looked at from a great way up.",
      "Surveyor: I felt that. Then I heard a branch the size of a fence post break. Nothing fell.",
    ] },
    { title: "Crater Lake", lines: [
      "Narrator: Crater Lake is the deepest lake in the United States, nearly two thousand feet, in the hollow of a volcano that blew about 7,700 years ago.",
      "Narrator: The Klamath people have stories of it that are far older than the maps. The water is the bluest in the country.",
      "Narrator: Boat crews say they don't stay out in the middle at dusk. They don't say why.",
    ] },
  ],
  "great-lakes-and-lake-champlain": [
    { title: "Camper's log, Isle Royale", lines: [
      "Camper: Isle Royale, a roadless island in Lake Superior. Wolves, moose, and no one else.",
      "Camper: The lake is so big it makes its own weather. Tonight it's making fog.",
      "Camper: Something long went past the shore just now. Under the water. Slowly. I'm staying in the tent.",
    ] },
    { title: "Ranger's report, Mackinac", lines: [
      "Ranger: Mackinac Island, no cars since the 1890s. Horses, bikes, and a lot of fudge.",
      "Ranger: Ferry captains log odd wakes. A wake with nothing making it. Two a year, maybe three.",
      "Ranger: I log them too. Nobody asks me what I think they are.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: Niagara Falls. Hundreds of thousands of gallons a second go over the edge. That's a lot of gallons.",
      "Gary: The Great Lakes hold about a fifth of the world's surface fresh water. A fifth! Write that down.",
      "Gary: Lake Erie has a thing in it, locals say. They call it Bessie. Bessie, if you're there, we're ready.",
    ] },
    { title: "The photograph", lines: [
      "Narrator: July 5, 1977. Sandra Mansi photographs a long dark shape rising from Lake Champlain, her family at the shore.",
      "Narrator: She kept the photograph private for years. She never changed her story.",
      "Narrator: The original has never been found. The lake has never been drained. Draw your own conclusions.",
    ] },
    { title: "Valcour Island", lines: [
      "Narrator: In October 1776 Benedict Arnold's small fleet fought the British on Lake Champlain, off Valcour Island.",
      "Narrator: He lost the battle and won the summer; it delayed the British invasion for a year.",
      "Narrator: The gunboat Philadelphia was raised in 1935. The lake bottom still has surprises. Some may have eyes.",
    ] },
    { title: "Adirondack guide", lines: [
      "Guide: The Adirondack Park is bigger than Yellowstone, Yosemite and Glacier combined. People forget that.",
      "Guide: Old hands on the lake talk about Champ like a neighbour. It'll leave you alone if you leave it alone.",
      "Guide: I leave it alone. We have an understanding. We have never met.",
    ] },
  ],
  "southwest-desert": [
    { title: "Camper's log, Saguaro", lines: [
      "Camper: The saguaros here can take a century to grow their first arm. Tonight they look like a crowd.",
      "Camper: The desert cools fast after sunset. Forty degrees in an hour. I'm wearing everything.",
      "Camper: One of them wasn't there when I looked up the first time. I counted. I'll count again.",
    ] },
    { title: "Ranger's report, Roswell", lines: [
      "Ranger: Roswell, July 1947. A rancher found debris. The Army said weather balloon, then said something else later.",
      "Ranger: The later answer was Project Mogul, a secret balloon array for listening to the sky. Which is a very good thing to say.",
      "Ranger: The festival draws crowds every July. Not one has found a saucer. Everyone has found a sunburn.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: White Sands, the biggest gypsum dunefield in the world. It's like walking on cold flour.",
      "Gary: The gypsum doesn't hold heat. You can lie down on it at noon. I'm going to lie down. Roll that.",
      "Gary: ...Something is lying down next to me. Something tall. Cut. Cut!",
    ] },
    { title: "Meteor Crater", lines: [
      "Narrator: Meteor Crater, Arizona, nearly a mile across, was made about fifty thousand years ago by a nickel-iron meteorite.",
      "Narrator: Apollo astronauts trained on it. It is among the best-preserved impact craters on earth.",
      "Narrator: Something that big landing is a good reason for the sky to be afraid of. The locals remember.",
    ] },
    { title: "Puerto Rico, 1995", lines: [
      "Narrator: In 1995, in Puerto Rico, farmers found goats drained of blood, each with small punctures.",
      "Narrator: The press named the cause the chupacabra, the goat-sucker. The sightings then spread across the Southwest.",
      "Narrator: Biologists have a ready answer: coyotes with mange. The farmers have a ready answer too, and it doesn't fit.",
    ] },
    { title: "Guide, Monument Valley", lines: [
      "Guide: Monument Valley sits on Navajo Nation land. The red buttes are sandstone that took millions of years to wear down.",
      "Guide: Movies have used it for ninety years. It looks like the end of the world, and the start of it.",
      "Guide: My grandmother told me never to whistle there after dark. I whistle. I don't whistle after dark.",
    ] },
  ],
  "bayou-and-everglades": [
    { title: "Camper's log, Honey Island", lines: [
      "Camper: Honey Island Swamp, east of New Orleans, one of the least-touched river swamps in the country. The only way in is a boat.",
      "Camper: The frogs went quiet at the same moment. Not a few. All of them.",
      "Camper: Something is wading near the camp. Heavy. In no hurry.",
    ] },
    { title: "Ranger's report, Okeechobee", lines: [
      "Ranger: Lake Okeechobee is the largest lake in Florida and the second-largest freshwater lake entirely inside the lower forty-eight.",
      "Ranger: A fisherman says a smell comes up with the fog. Sour, like a wet dog in a dumpster. We call it the skunk ape.",
      "Ranger: I've worked here nineteen years. I've smelled it twice. I'd like that on the record.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: Welcome to the Everglades. A river of grass, fifty miles wide and a few inches deep.",
      "Gary: It's the only place on earth where alligators and crocodiles share the same home. Two kinds of teeth. Fantastic.",
      "Gary: Is that a log? It's a log. It's blinking. Okay. Okay.",
    ] },
    { title: "Fais do-do", lines: [
      "Grandmother: The rougarou is the loup-garou, the werewolf of the bayou. Cher, he comes for the ones who break Lent.",
      "Grandmother: Watch the dark edge of the cane field on a Friday. That's why we eat fish on Fridays.",
      "Grandmother: Don't laugh. Eat your fish.",
    ] },
    { title: "Scape Ore Swamp", lines: [
      "Narrator: June 1988, Bishopville, South Carolina. A teenager saw a green-eyed, scaly creature crossing the road by Scape Ore Swamp.",
      "Narrator: Cars were found with scratches the next morning. The sheriff's office took the reports seriously.",
      "Narrator: The Lizard Man has not been seen since. The swamp has not been drained either.",
    ] },
    { title: "Atchafalaya", lines: [
      "Narrator: The Atchafalaya Basin is the largest river swamp in the United States, over a million acres of bayou, cypress and mud.",
      "Narrator: The Army Corps spent decades keeping the Mississippi from changing course into it. The river keeps trying.",
      "Narrator: Whatever lives out there got along fine before the levees. It plans to be here after.",
    ] },
  ],
  "ozarks-and-the-southern-plains": [
    { title: "Camper's log, Buffalo River", lines: [
      "Camper: The Buffalo, the first National River in the country. Bluffs two hundred feet high on both sides.",
      "Camper: Heard a scream across the hollow at dusk. Like a woman. Then like a cat. Then like both.",
      "Camper: The old-timers say it's the howler. Everyone says it with a smile. Nobody follows it.",
    ] },
    { title: "Ranger's report, Hot Springs", lines: [
      "Ranger: Hot Springs, Arkansas. The water comes out at about 143 degrees and fell as rain thousands of years ago.",
      "Ranger: A visitor reported something with cat eyes at the edge of Bathhouse Row. Large cat. Large.",
      "Ranger: I've been told it's a bobcat. I've seen bobcats. This is a different conversation.",
    ] },
    { title: "Gary narrates", lines: [
      "Gary: Crater of Diamonds State Park. You can dig and keep what you find. Real diamonds!",
      "Gary: Tens of thousands have been found here since 1906. Tens of thousands. We've found a bottle cap.",
      "Gary: Something is watching from the tree line. It's a cat. It's a very big cat. Don't film the cat. Film the cat.",
    ] },
    { title: "Fouke, 1971", lines: [
      "Narrator: Fouke, Arkansas, May 1971. A family reports a big hairy creature at the window of their house near Boggy Creek.",
      "Narrator: Deputies found tracks, and a screen torn from the window. The press called it the Fouke Monster.",
      "Narrator: A 1972 film made it famous. The town still runs a festival. The creek still floods.",
    ] },
    { title: "Route 66", lines: [
      "Narrator: Route 66 ran about two thousand four hundred miles from Chicago to Santa Monica, and for a generation it was the road west.",
      "Narrator: It cut across the southern plains. Truckers who drove it at night still tell the stories.",
      "Narrator: The road was replaced by the interstate. The stories were not.",
    ] },
    { title: "Storm chaser, Tornado Alley", lines: [
      "Storm chaser: Tornado Alley. The Gulf warms the air from below, the Rockies dry it from above, and the plains take the argument.",
      "Storm chaser: On a bad day you can see the funnel for twenty miles. On a worse day, you can't.",
      "Storm chaser: Out in the fields after one, I've found things where they shouldn't be. I stopped asking.",
    ] },
  ],
};

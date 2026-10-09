# Park Hide & Seek

Hide and seek in a real national park, in 3D. Campers drop into a zone around a famous attraction (Half Dome, El Capitan, Yosemite Falls, Glacier Point, the Mariposa Grove sequoias) and hide. Park rangers come looking, with flashlights after dark. Last the whole hunt and you camped out successfully.

- **The ground is real.** Each zone is 2 km of actual Yosemite terrain from public elevation data, shrunk six times in every direction: El Capitan is still a sheer wall, just 150 m tall instead of 900. People, trees and tents stay life-size.
- **No find button.** A ranger catches a camper by reaching them. To get there they sweep with a flashlight, listen for footsteps, call out ("Anybody out there?") so nearby campers rustle, and use radio questions that shade the map. Rangers are faster than campers, so a camper who's spotted in the open should run for cover.
- **The real weather, right now.** By default a round plays in the park's actual conditions and time of day: at 3 pm in Yosemite it's day, after sunset it's flashlights. Rain hides footsteps, fog shortens how far anyone sees, wind sways the bushes and makes rustles hard to place, and a cloudy night has no moon. The lobby can pick day, dusk or night by hand instead.
- **Find Bigfoot, or don't get caught.** Bigfoot is hiding in the park. Whoever reaches him first ends the round, like catching the snitch: a camper who finds him wins it for every camper still out, a ranger who finds him wins it for the rangers. Otherwise campers just have to last the three minutes.
- **The search area closes in on him.** During the hunt a circle shrinks towards wherever Bigfoot is hiding. Nobody is told where it ends up, but everyone can watch which way it's heading, rangers included. Campers outside it stand out like a flare, so sooner or later everyone has to move, and moving makes noise.
- **One button to play.** *Play* drops you straight into a game: online, with whoever else pressed it in the same few seconds and AI in the empty spots; on the desktop, against AI. The zone and the weather are picked for you. *Custom game*, *Play with friends* (a room code or link) and LAN games on the desktop are underneath, with the settings.

Built with [Three.js](https://threejs.org) and [Rusty Buns](../../README.md). More examples: [EXAMPLES.md](../../EXAMPLES.md).

## Run it

```
cd apps/park-hide-seek
bun install
bun run dev              # browser: Play (vs AI here; quick play needs the Worker, see Online)
bun run desktop:dev      # desktop app: Play vs AI, or Host / Join a LAN game
bun test                 # zones, movement, sight, rules, bots
```

## Online

The browser build can also be played online at https://park-hide-seek.notryanquinn.workers.dev. *Play* asks `/api/match` for a room: one Matchmaker Durable Object (`src/edge/match.ts`) hands everyone who asks within 12 seconds the same code, up to six people. Whoever hosts that room fills it out to four with AI and starts it when the 12 seconds are up. *Play with friends* makes a private room instead: send friends the link (`?room=CODE`) or the code. `src/edge/worker.ts` serves the page and sends `/ws?room=CODE` to that room's Durable Object, which is the same World class the desktop runs for LAN games (`packages/desktop/world.ts`). The Worker vouches each player's id and name, refuses WebSockets from other sites, and limits how many new rooms one address can open, and how many new players it can bring to quick play, a minute. The world drops messages from any socket sending faster than it should. Whoever reaches a room first hosts it, and if they leave, someone else takes over. A room lives in memory, so it ends once everyone leaves.

```
bun run edge:dev         # the Worker locally (wrangler dev)
bun run deploy           # build and deploy (wrangler deploy)
```

**A round:** *drop* (15 s: click the zone map to pick where you land, or get dropped at random) → *hide* (30 s: rangers count in the cabin) → *hunt* (3 min) → *results*. Everyone takes a turn as ranger; two rangers once there are five players.

| | |
|---|---|
| Move · run · look | `WASD` · `Shift` · mouse (click the view to capture it, `Esc` to let go) |
| Camera | `V` switches first and third person |
| Map | `M` (the radio map, for rangers) |
| Camper | `C` crouch. Crouched in a bush you can't be seen from more than a few metres, unless a flashlight finds you close up |
| Ranger | `F` flashlight, `Q` call out (10 s cooldown) |
| Spectating | `Tab` cycles who you follow once you're caught |

**Scoring:** campers get a point per second they last in the hunt, plus 30 for camping out (lasting the whole thing, or still being out when a camper finds Bigfoot). Rangers get 40 per catch. Finding Bigfoot is worth 100 to whoever does it.

**Your camper:** the lobby has a customizer (jacket, pants, skin, hat, backpack) with a live preview; it's saved in the browser and everyone in a LAN game sees it.

To try a LAN game on one machine, run two copies on different ports. Each instance has its own token cookie, so they coexist:

```
RB_LISTEN=127.0.0.1:4411 bun .rustybuns/dev/desktop.js     # host: click "Host a LAN game"
RB_LISTEN=127.0.0.1:4412 bun .rustybuns/dev/desktop.js     # guest: "Join a LAN game" with the address it shows
```

## The data

All of it is fetched once by scripts and committed, so the game never downloads anything:

- **Terrain:** `bun scripts/fetch-zones.ts` reads the public [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNGs, mostly USGS 3DEP in the US) around each attraction and writes a 161×161 heightmap per zone (`src/zones/data`, about 70 KB each). It decodes the PNGs itself, with no image library.
- **Signposts:** named places inside each zone (Diving Board, Lost Arrow Spire, Grizzly Giant…) from [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass. Map data © OpenStreetMap contributors, ODbL.
- **Parks:** `bun scripts/fetch-parks.ts` keeps NPS boundaries and OSM features for eight parks in `src/parks/data`. Zones are placed with them. To add a zone (in any of those parks), add it to `ZONES` in `scripts/fetch-zones.ts`, run the script with its id, and import the JSON in `src/zones/zone.ts`.

The props (pines, sequoias, bushes, boulders, logs, a campground, the ranger station) are generated from a seed per zone: every player gets the same park, and nothing is placed on rock too steep to stand on.

## How it works

**One game, two hosts.** `src/hunt/game.ts` is the whole game: phases, drops, movement checks, catching, calls, the closing circle, radio questions and scoring. `src/room.ts` adds the bots. Against AI the page runs a Room itself. For LAN games the same Room runs inside the world (`packages/desktop/world.ts`), a Durable Object-shaped class that the Rusty Buns host runs in-process.

**Nobody gets told more than they could see.** Every player gets `view(id)`, built for them by the host. A ranger is sent a camper only if one could actually see the other (`src/hunt/sim.ts`):
- **Range from the light:** 90 m by day, 45 m at dusk, 7 m at night, or 42 m inside a flashlight's 26° beam (less in fog; see Weather below).
- **Hiding:** crouching shortens your range. Crouched in a bush, you're seen only from 3.5 m, or 10 m in the beam.
- **Line of sight:** checked against the terrain and every trunk, boulder, tent and cabin in the way.

So a modified client can't show hidden campers, because their positions never reach it. Bots play from the same views as people.

**Moving feels instant.** Your own body moves in the page every frame, with the same `step()` the host uses: uphill is slower, cliffs can't be climbed, trunks can't be walked through, stamina runs out. The host accepts each position only as far as running could have taken you, and pushes you out of solid objects. The page follows the host only when the host reports a position the page never sent, which means it corrected you, so normal network lag doesn't yank you around.

**Weather** (`src/weather.ts`): when a round starts, whoever hosts it (the page against AI, the world for LAN and online games) asks [Open-Meteo](https://open-meteo.com) (free, no key, for non-commercial use) for the zone's current temperature, weather code, cloud, wind, precipitation and `is_day`, plus today's sunrise and sunset. The half hour or so round sunset and sunrise is dusk. The reading goes out in everyone's view, so guests on a LAN never call the API and everyone plays in the same conditions. It's fetched during the drop; if it hasn't come by the time the hunt starts (offline, slow, refused), the lobby's time of day stands. The effects are in the shared sim (`Sky` and `WEATHER` in `src/hunt/sim.ts`), so visibility filtering and bots respect them:
- **Fog:** sight ranges drop by up to 60%, flashlights by up to 45%.
- **Rain** (or snow): footsteps carry up to 55% less far.
- **Wind:** rustles and footsteps are placed up to 2.5 times more roughly.
- **Cloud:** an overcast night is 30% darker (no moon, no stars).

**Cues.** Running campers make footsteps that rangers within 45 m hear, and walking ones within 14 m. Crouching is silent. A call makes campers within 55 m rustle: always if they're close, sometimes if they're farther, always if they're moving. Rustles and steps are placed roughly, so a ranger has to search round them. Sounds are synthesized, and calls are spoken by the browser.

**Bigfoot** (`src/hunt/game.ts`) hides in a bush near where the circle ends up (within half its final radius of the centre). He's only seen within 6 m, and only in sight (less at night, unless a flashlight finds him), and reaching within 2 m finds him. Once the circle starts closing he howls every 25 s or so, which everyone hears, placed up to 30 m off (more in the wind). Players are only sent the circle as it is now and 3 s ahead, never where it ends up, so his spot stays secret until the circle gives it away. In bot games he's found in about 40% of rounds, about as often by campers as by rangers, usually in the last minute.

**Radio questions** (`src/clues.ts`): radar ("within 300 m of me?"), compass, thermometer and nearest signpost or peak. They're answered truthfully by every camper's radio and shaded on the ranger's map. Answers are worked out on a grid, so the shading and the answer always agree. Campers keep moving, so a clue is true for where they were when it was asked.

**The bots** (`src/hunt/bots.ts`) only know what their view tells them:
- **Ranger bots** sweep bush to bush, preferring where the radio says campers could be and where the circle is heading. They call out now and then, search the bushes round every rustle, and chase anyone their light finds.
- **Camper bots** drop somewhere bushy, crouch in a bush, move well inside the circle before it reaches them, and run for cover on the far side when a ranger gets close. The bolder ones go looking for Bigfoot round the middle of the circle once it's halfway in.
- **Everyone** runs for Bigfoot the moment they see him, and ranger bots chase his howls late in the hunt.

Headless bot-vs-bot rounds: easy rangers catch about a third of the campers, normal about two thirds, and hard most of them.

**Rusty Buns pieces it uses:** spa mode with a `world` class, `guests` opened and closed at runtime with `POST /__rb/host`, `worldSocket()` for guests, and one `desktop.host` route (`GET /api/lan`), because the page can't see the machine's LAN address and the host can.

## Not yet

- More parks: the data for seven others is already here.
- No TLS: LAN games are `ws://` on a network you trust.
- The world keeps the match in memory; restarting the host ends it.

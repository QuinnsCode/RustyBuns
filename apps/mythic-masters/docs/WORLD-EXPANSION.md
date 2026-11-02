# Growing the world

How Mythic Masters gets much bigger without getting slower, and how it keeps growing after that: a new
pack every time a big monster film comes out and gets people talking about the old legends.

The plan borrows three map designs from open-world RPGs, described here by how they work and not by name:

- **The JRPG overworld.** The world map is small and cheap: a connecting layer you cross quickly. The towns,
  dungeons and set pieces are their own scenes. New ways to travel (a boat, then flight) open the map in rings,
  and stories you find along the way are short text memories.
- **The monster-hunter's maps.** Each land is its own map, loaded on its own, not one seamless world. Later
  lands (an island chain, a sunny wine country) came out as expansions with their own map files. Every few
  hundred metres there is a marked point of interest, and the best quests are monster contracts off a notice
  board: read the sighting, follow the tracks, learn what it is, then fight it.
- **The seamless province.** One hand-made land streamed in a grid of cells around you, with cheap distant
  versions of the land past that grid and indoor spaces as their own cells. Something new shows up about once a
  minute of walking. Its regions each have a capital, and you discover a place by seeing it.

## Where the world stands (2026-11-01, after the nature spike)

| | Today | Cost |
|---|---|---|
| Size | 64 regions on a 12 × 8 grid, 6.4 km each, about 77 × 51 km | |
| Ground | A mesh per region cell at three distances, 33 samples a side, 200 m apart | about 20 tiles drawn, 1 draw call each |
| Ground near you | A 129 × 129 patch at 4 m (every octave) inside a 129 × 129 patch at 24 m (the big hills), both following you | 2 draw calls, rebuilt every 64 m and 384 m |
| Relief | Real elevation, square-rooted (the Andes 77 m), plus six octaves of fractal, ridged in rough country, scaled by the land's own relief | `detailAt` in `world.ts` |
| Plants | 18 kinds (14 from the scenery set, grass, mushrooms, logs and reeds made here), near, each one instanced mesh; grass tufts within 70 m; far cards for the 8 tall kinds out to 1.4 km | about 30 draw calls, a few thousand instances each way |
| Day and weather | A 24-minute day on a sky dome: sun, dusk, moonlit night, haze; wind gusts that every plant leans to | `nature.ts` |
| Life | Flocks that flush and settle (one roost per 110 m at 30%), wild food patches (one per 70 m at 30%) that mend the line-up | `nature.ts`, `life.ts` |
| Elevation data | `public/ground/<n>.bin`, 2 KB a region, nine loaded round you; `coarse.json` bundled | about 20 KB bundled |
| Beasts | 76 rigged GLBs, an LRU of 12 | |
| Content | 8 playable regions, each 12 trail sections with a keeper; dens 200 m across, 40% hold a creature; a place every 600 m | about 110 places per region |

What this round did not do, and where it would go next:

- **Water as a thing.** The sea is a flat plane at 0 and a hollow below it is a pond you wade. Rivers, lakes with
  banks, and reflections are the next big step in realism.
- **Weather.** The wind is there; rain, mist in the hollows at dawn, and snow in the tundra are not.
- **A second, bigger patch** would carry the big hills out to 4 km instead of 1.4, for mountain vistas.
- **Sound.** Birds flush in silence. Wind, birdsong by biome and footfalls would be worth more than they cost.
- **The mid patch's rebuild** (16k vertices every 384 m) is one frame's hitch; spreading it over frames is easy.

## The plan in one line

Keep the continent as a cheap overworld, make it dense with small things to find, put the expensive places
inside pockets that load on their own, let the beasts you bind be the way you cross it, and ship every new
land as a data pack.

## 1. Stream by region, not by world

Today the whole continent loads up front. That is fine for 64 regions; it is not fine for 64 plus a new island
every few months.

- **Ground per region.** Split `ground.json` into one file per region (`public/ground/<n>.bin`, Int16, about
  3 KB each) and fetch the nine regions around you, the way the seamless province loads a grid of cells. The
  rest of the world draws from a coarse 9 × 9 sample per region already in the bundle (about 10 KB for all
  64), so the far mountains are still there.
- **Ground meshes per region, three distances.** Replace the one world mesh with a mesh per region at 33,
  17 and 9 samples a side, picked by distance and skipped behind the camera. The draw calls go from 1 to about
  20, the triangles in view drop by more than half, and a new island is new meshes, not a rebuilt world.
- **Distant trees as cards.** Past the fine patch, a forest is one instanced quad per tree facing the camera,
  baked from the GLB once at load. The far hills look wooded instead of bald, for one extra draw call.
- **A beast cache with a ceiling.** `loadBeast` keeps everything forever. Give it an LRU of about 12 beasts
  that disposes geometry and textures on eviction, so a long walk past 70 species doesn't keep 20 MB on a phone.
  Wild creatures past 80 m draw as a flat silhouette of their own model (one instanced quad per species) and
  only the nearest few get the rigged puppet (#2972 asks for the same cap).
- **Only simulate what's near.** Dens more than two regions away don't tick. When you come back, each den
  rolls where its creature has wandered from the hash of the time, as if it had been moving all along.

Budget for a phone: under 120 draw calls, under 400k triangles, under 150 MB of JS heap after an hour's walk.
A test walks a line across eight regions headless and checks the beast cache and the loaded regions stay
under their caps.

## 2. Something every minute

At a walking pace of about 5 m/s, the seamless province's "something new about once a minute" means a point of
interest every 250 to 300 m: around 20 per region. Today there is only the den. Each region gets a list of
**places** in a new `src/world/poi.ts`, partly hand-placed (the trail's sections already give twelve
anchors) and partly placed from the region's hash, so the same ground always has the same places. Each kind is
small and reusable:

- **Found tapes.** The JRPG's short text memories, in our voice: a VHS tape in a stump plays one or two minutes
  of found footage through `director.ts` (a camper's last log, a park ranger's report, Gary narrating badly).
  Written per region, collected into the compendium. Cheap to write, and it's where the jokes live.
- **Sighting boards.** The monster-hunter's contracts, fitted to cryptids: a corkboard at a ranger station or
  diner with a blurry photo and a report ("something took the hound, left three-toed prints"). Taking it lays
  clues on the ground (prints, tufts, a broken fence) that lead to one named creature, stronger than the wild
  ones, with something the den creatures don't have (a unique colour, a title, a move). Most of a contract is data:
  a creature id, a level, three clue spots and a few lines.
- **Campfires.** Rest (the line-up heals), save, and travel between fires you've lit. A fire you can see from
  far off pulls you across empty ground.
- **Landmarks you discover by seeing them.** A fire tower, a crashed weather balloon, a sunken church. When one
  comes into view on screen it's marked on the map with no walk needed, the way the province does it. They give
  you a reason to climb.
- **Totem stones.** Hidden in awkward places. Three in a region unlock a seventh party slot or a cosmetic for a
  beast. They reward going off the trail.

Placement rule: no two places closer than 120 m, at least one in every 300 m square of open ground, never on a
trail section's keeper stone. A test checks the spacing per region.

## 3. Pockets: the expensive places load on their own

The overworld stays cheap because anything dense goes into a **pocket**: its own small scene, loaded when you
step in and dropped when you step out, like the province's indoor cells or the JRPG's towns.

- **One pocket per region to start**: a cave, a mine, a cellar, a lighthouse. Each one is a layout file (rooms,
  where its walls are, where things are placed, using the arena's look) plus a creature list. The arena already
  repaints one layout with a skin; a pocket is the same idea with walls.
- **Towns are pockets too.** The diner, the gas station and the motel where the sighting boards and the people
  are. On the overworld a town is just a few buildings and a door.
- Pockets are where the set pieces go: the keeper fight inside the old mill, the mythic in its lair.

A pocket's budget is its own, so a lair can have fog, many lights and a crowd of small creatures without
costing anything on the overworld.

## 4. Your beasts are how you travel

The JRPG opens its map with a boat, then flight. We already have the vehicles: they're in your line-up.

- **Swim.** A bound swimmer (a lake monster, the hoop snake rolling across the surface) carries you over lakes
  and later the narrow seas between continents.
- **Glide.** A bound flyer lets you glide from high ground. Flying drains stamina here just like in the arena,
  so it's a jump between ridges, not free flight.
- **Burrow.** A bound digger opens a cave mouth and lets you take the tunnels under a range.
- **Run.** A fast beast lets you ride. Riding speed is capped at what streaming can keep up with: at 12 m/s the
  nine-region ring has about a minute and a half of lead.

This gives every bind a reason beyond fighting, and it gates the map by **what you've collected** rather than
by your level. The 48 coming-soon regions open in rings: the sea crossing to Europe needs a swimmer, the Andes
need a glider.

## 5. Packs: one more land every time a monster film is out

Every big creature film gets people interested in the legend it's built on. The game can come out with a
pack in the same season and lean on that, **without using the film**: the legend is centuries old and
everyone's to use; the film, its name, its characters and its look belong to the studio. A pack never names a
film, an actor or a studio, never copies a design from one, and never uses the trailer's look. It does the
trope ("giant thing in the bay", "the house in the woods nobody should go into") with folklore and
our own designs, and the found-footage narrator can wink at the genre as much as it likes.

A pack is data, no code:

```
packs/<id>/
  pack.json        # name, season (from/to), the land's place on the grid, its tier
  beasts/*.json    # 3-6 sheets: the same format as beasts/
  pocket.json      # the pack's lair
  poi.json         # its places: tapes, boards, fires, landmarks
  lore.json        # each legend's sources and what of it is sacred
  director.json    # the narrator's lines for the land
```

- **Its land is an island off the coast**, the monster-hunter's way: a new 3 × 2 corner of the grid, reached by
  boat from a port town, loaded as its own map (part 1 means the main continent doesn't change).
- **Event creatures** (the `event` tier in `src/tiers.ts`, already seasonal: the Yule Cat and the Nian) roam
  the main continent during the pack's season too, so a returning player meets the pack before they reach the
  island. The `unknown` tier gives each pack a shrouded teaser a few weeks before.
- **After its season** the island stays; its event creatures go back to roaming only in season, every year.
- A pack builds with the tools we already have: `bun run beasts` for its sheets, `scripts/fetch-world.ts` for
  its ground (an island's real elevation, from any coast), and a test that loads every pack and checks its
  lore, licences and sacred marks the way the roster's tests do.

Packs that would sell well now, with nothing borrowed from any film: a **sea-serpent coast** (krakens, the
Loch's cousins, a cetus), a **vampire valley** (strigoi, upir, the aswang where it isn't sacred), a **giant
monster bay** (the big beasts of folklore at a size the arena can't hold, fought in their pocket), and a
**haunted holiday** run (Krampus, the Yule Cat, the Nian: winter's legends together).

## Order of work

Each item is one PR, and each is useful on its own.

1. **Streaming:** ground per region, region meshes at three distances, the beast LRU. Nothing new to see, but
   everything after it depends on it.
2. **Places:** `poi.ts` with tapes, campfires and landmarks in the 8 playable regions, plus the spacing test.
3. **Sighting boards:** contracts with clues, two per playable region.
4. **Pockets:** the layout format and one cave, used for the Pine Barrens' mythic.
5. **Beast travel:** swim and glide first, gating the crossing south.
6. **Packs:** the format and the first pack, a winter island in time for the December legends.

Distant tree cards and the shrouded teasers are follow-ups once those land.

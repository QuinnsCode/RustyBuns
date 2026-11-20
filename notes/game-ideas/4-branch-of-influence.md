# Game idea 4: Branch of Influence

Working title, and probably the real one. A small pixel god game where you mostly watch. Societies
grow, trade, fight and fall on their own over 15,000 years. You can step in with a few "miracles",
but every one you spend makes the people who saw it lean on you a little more, and your reach over
the world shrinks the whole time. You can't save everyone. The game is picking who.

The world is a git repo. Every game you play writes into it for good: rules, map, peoples and
legends. Forking it is a timeline split. No two players' worlds stay the same.

## Pillars

1. **Watch first, touch rarely.** The best run is the one with the fewest miracles that still
   carries a people to the stars. The score rewards a light hand.
2. **You fade.** Your influence works like spreading creep in a real-time strategy game, but backwards.
   It starts wide and pulls in toward the few people who still remember you. Each epoch the world
   gets bigger and your share of it gets smaller.
3. **The Wild always wins by default.** Forest, desert, ice and swamp are a faction. Any land that
   people stop working goes back to them, slowly, and you get to watch it happen.
4. **The world remembers forever.** It is a real repo, not a save slot. The map, the rules and the
   peoples' sheets change through commits. A collapse leaves ruins in every later game on that world.
5. **Timelines are branches.** Going back to before the collapse doesn't undo it. It forks the
   world, and both histories stay.

## The feeling we're after

You sit back for 30 minutes on "Watch" speed. A river valley city has grown lazy on three good
harvests you gave it. You stop helping. Granaries go empty, the canals silt up, the terraces
crumble. Grass comes first, then scrub, then young trees, and after a few hundred years there is
old forest with broken walls under it. Years later a forest people finds those walls. You never
touched any of it.

---

## 1. What "editing our own code" can mean (the polymorphic layer)

The legacy board-game idea is that you write on the board and tear up cards, and the box you own
ends up different from everyone else's. Here the "box" is a git repo held in a Cloudflare Artifact.
These are the ways a game can rewrite it, from safest to wildest:

| # | What changes | Git primitive | In the game |
|---|---|---|---|
| 1 | **Map scars.** A flood moves a river, a fire clears a forest, a city leaves ruins. | commit to `map/` | The next game on this world starts with those scars |
| 2 | **Rule stickers.** A big event changes a law of the world for good ("on this world, fire spreads twice as fast"). | commit to `rules/*.json` | Legacy rule cards, chosen at an age's end |
| 3 | **Peoples' sheets.** A people that lived through the Long Winter gains a trait. Its unit roster grows a named hero. | commit to `peoples/<id>.json` | Your history becomes their stats |
| 4 | **Extinction is a delete.** A dead people's file is removed from HEAD. | `git rm` | The file is still in history, so it can come back |
| 5 | **Archaeology is checkout.** Digging up a ruin restores a lost tech or people from an old commit. | `git checkout <old> -- file` | Relic digs bring the past back |
| 6 | **Timeline split.** Rewind to year 1200 and play it again. | `git branch timeline/<name> <commit>` | Both histories exist; you can visit either |
| 7 | **Ages are tags.** Each age you finish is a tag. | `git tag age/bronze` | The world's chronicle has chapter marks |
| 8 | **Oracle of the fall.** "When did this empire start to die?" | `git bisect` over replays | A miracle that costs a lot and tells you the year the trouble started |
| 9 | **Who made this desert?** | `git blame` on a tile | Click a tile, see which people (or which of your miracles) changed it |
| 10 | **A gift from another timeline.** Bring the wheel from branch B into branch A. | `git cherry-pick` | Expensive miracle, has side effects |
| 11 | **Two timelines meet.** Merge a friend's world, or two of your own branches. | `git merge` (through Mervin) | Merge conflicts happen in the world: two rivers in one valley, two peoples claiming one coast |
| 12 | **Undo.** Revert one event. | `git revert` | The most expensive miracle, and the commit log says you did it |
| 13 | **Behaviour that evolves.** Each people's choices come from a tiny rule script (a small DSL, not JS). Between ages the scripts change: the habits that survived spread and the others die out. | commit to `peoples/<id>.rules` | The AI of your world is not the AI of mine |
| 14 | **An agent chronicler.** A cheap model reads the commit log and writes the history book. Later it can suggest new rule stickers. | PR into the world repo | The world's "laws" suite has to pass before a sticker lands |

Number 14 is "CI as the laws of physics". Each world repo has an invariant suite (energy is
bounded, at least one people can still survive, the map stays connected), and nothing merges into a
world's trunk unless it passes. Agents, players and events all change the world the same way: a
commit, checked by the world's own laws.

**Safety rule:** no game ever evaluates JS from a world repo. Rules are JSON checked by guards
(`@rustybuns/util/guard`), and behaviour scripts are a small DSL run by an interpreter with a step
limit. That way a forked world from a stranger is just data.

### Seed + log = the whole world

The base world comes from a seed (terrain, rivers, starting peoples), the way a voxel sandbox
world grows out of one number. Everything after that is in the log: the miracles you made and the
commits at legacy moments. The sim is deterministic (`mulberry32` from `@rustybuns/util`), so any
commit can be replayed to any year. That is what makes bisect, blame and timeline splits cheap: we
store choices, not frames.

### Repo layout for one world

```
world.json            seed, name, created, current epoch/age
rules/                laws: growth.json, fire.json, decay.json, influence.json, miracles.json
map/                  terrain layers per chunk (RLE JSON or tiny PNGs), ruins layer
peoples/<id>.json     traits, roster, memory, faith; <id>.rules behaviour script
legends/              named heroes, relics, wonders (each one a file)
chronicle/<age>.md    the written history, one file per age
log/<session>.jsonl   inputs (miracles with tick + target): enough to replay
laws.test.json        the invariants a commit must pass
```

Branches: `trunk` (canon), `timeline/<name>`. Tags: `age/<n>-<name>`, `epoch/<n>`.
Commits happen at legacy moments (end of session, age change, a people dies, a miracle that
rewrites a rule), not every tick.

---

## 2. Time: how fast it runs

The whole campaign is **15,000 years in three epochs of about 5,000 each**: the human story we
know, then 5,000 years of one world and its sky, then 5,000 years among the stars.

One tick is one season. The speed dial:

| Speed | Rate | Used for |
|---|---|---|
| Moment | 1 day / s | Aiming a miracle, a battle, a flood cresting |
| Season | 1 season / s | Planting, a migration, a siege |
| **Watch** | **1 year / 6 s** | The default. 30 minutes is about 300 years: long enough to see a city go back to forest |
| Drift | 1 year / s | A quiet stretch |
| Era | 10 years / s | Skipping a quiet dark age |

The game slows down by itself when something worth seeing happens (a people near collapse, two
borders meeting, a wonder going up) and speeds up when nothing is. You can always lock it.

**Ecology clock (so the forest timing feels real):** bare ground to grass in 2-5 years, grass to
scrub in 10-30, scrub to young forest in 30-80, young to old forest in 150-300. Ruins stay as tiles
under the canopy. Desert spreads from overgrazed grass over decades, and comes back only with water.

**Session shape:** one session is about one age, 30-60 minutes. The campaign is about 25 sessions
(9 + 8 + 8 ages), a legacy campaign's length. A world you finish keeps going: you can come back and
play it on another branch.

---

## 3. Influence: the reverse creep

Influence is a field over the map, drawn as **glowing branches**: veins of light running out from
the shrines and the people who remember you, like roots or a tree's branches. That is where the name
comes from. The branches pull back every year. Where they don't reach, you can't act.

- **Sources:** faith. Shrines, priests, legends of past miracles, a people that saw you help.
- **Fade:** every year each tile loses a fixed share. The rate goes up each epoch (you are a smaller
  thing in a bigger world).
- **Cost:** a miracle spends the influence where it lands. A big one can cut a branch off.
- **Dependence (the catch):** people who see a miracle gain faith (more influence for you later) and
  dependence (less effort of their own). Dependence slowly lowers a people's **Vigor**. A people
  that waits for you stops maintaining its world. That's how a society "atrophies on effort".
- **Hidden hand:** a miracle nobody sees costs three times as much and gives no faith and no
  dependence. The rain just comes.

So every miracle is a trade: help now, a weaker people later, and more reach for you if they
remember it.

### Tiers of reach

Your view and your miracles scale up each epoch. The finer tools go away and bigger, blunter ones come.

| Tier | Epoch | Map | Tile is about | Your miracles touch |
|---|---|---|---|---|
| Valley | I, early | 128 x 128 | 1 km | One field, one herd, one dream |
| Land | I, late | 256 x 256 | 10 km | A river, a season's weather, a plague |
| World | II, early | one planet | 100 km | A climate, an ocean current, a sky omen |
| Sky | II, late | planet + moons + orbit | a body or orbit | A solar flare, a comet's path, a signal |
| Stars | III | a cluster of systems | one system | A stellar wind, a seed ship's course, a quiet star |

At each step the old map **folds** into one tile of the new one: your whole valley world becomes
one pixel of the planet, the planet becomes one dot of the cluster. You can still zoom back in and
watch (and the repo keeps every layer).

---

## 4. The peoples

**Our call:** peoples are **ways of living**, not real nations. Each one is a pattern that shows
up many times in real history, under our own made-up names, and the seed decides which of them a
world gets and where. That keeps the game away from caricatures of real peoples, keeps it out of
politics, and lets every world grow its own. The real-history patterns behind each one are listed
in the appendix, as design references only.

Every people has the same four stats:

- **Vigor:** effort. The work done to keep fields, walls and canals up. Falls with comfort and dependence.
- **Memory:** what they know. Lost in collapses, found again in ruins.
- **Faith:** how much they remember you. Feeds your influence.
- **Reach:** how much land they hold and work.

When Vigor falls below what their land and buildings need, things decay in order: outer fields,
roads, walls, then the city. Decayed tiles become ruins, then the Wild takes them.

Units are a few sprites standing in for many people, drawn on the map at the settlement level. Each
people has five unit lines that get new looks and powers each age (role: Epoch I name to Epoch III name).

### Epoch I: the Earthbound (about 3000 before year zero to about 2000 after)

**1. River Folk (the Furrowed).** Floodplain farmers. They grow tall fast and fall hard.
- Grow by: flood farming, canals, granaries, writing.
- Break by: drought, salt in the soil, silted canals, a capital too big to feed.
- Units: Tiller (farm), Canal-digger (land shaping), Scribe (memory), Granary Keeper (store), River Guard (defence).
- Asks you for: rain, a flood at the right time.

**2. Steppe Riders (the Long Grass).** Herders who move with their animals.
- Grow by: herds, horses, speed. No cities until late, and few buildings to keep up.
- Break by: overgrazing (they make the desert themselves), hard winters, losing grazing land to farmers.
- Units: Herder, Outrider (scout and raid), Yurt-raiser (camps that move), Storyteller (memory, no writing), Horse Lord (leader).
- Asks you for: mild winters, new grass.

**3. Sea Traders (the Salt Roads).** Coastal ports and ships.
- Grow by: trade routes that carry goods and ideas to other peoples.
- Break by: storms, a trade partner collapsing, coast lost to the sea.
- Units: Fisher, Shipwright, Merchant, Navigator, Harbour Watch.
- Asks you for: calm seas, a fair wind.
- Special: they spread Memory to anyone they trade with, so they can save other peoples' knowledge.

**4. Forest Keepers (the Canopy).** They live inside the Wild instead of against it.
- Grow by: foraging, small gardens, slow growth that never goes too far.
- Break by: other peoples cutting the forest, fire.
- Units: Forager, Ranger, Grove Speaker, Herbalist (stops plague), Bark Warden.
- Asks you for: almost nothing. They are hard to lose and hard to grow.
- Special: the Wild doesn't fight them. They find ruins in forests first.

**5. Mountain Terracers (the Stairs).** Stone terraces, mines and passes.
- Grow by: terraced farms, metal, strongholds that are hard to take.
- Break by: earthquakes, terraces falling apart when Vigor drops (steep land decays fastest), isolation.
- Units: Terracer, Miner, Mason, Pass Warden, Star-watcher (calendar and sky, early science).
- Asks you for: a steady mountain, a good ore vein.

**6. Desert Caravaners (the Wells).** Oases joined by caravan routes.
- Grow by: wells, salt and spice routes, linking peoples who never meet.
- Break by: wells drying up, sand moving over routes.
- Units: Well-digger, Caravan Master, Salt Trader, Dune Scout, Oasis Keeper.
- Asks you for: water under the sand.

**7. Island Navigators (the Wayfinders).** Ocean voyagers who read the stars and swells.
- Grow by: finding empty islands and settling them, fishing, star navigation.
- Break by: small islands running out of trees and soil, storms, being cut off.
- Units: Wayfinder, Canoe-builder, Fisher, Chant-keeper (memory), Reef Tender.
- Asks you for: a sign pointing to land.
- Special: the best future spacefarers. Their Memory of star paths carries forward.

**8. Ice Hunters (the White).** Small groups on tundra and ice edge.
- Grow by: hunting, sleds, almost no buildings.
- Break by: almost nothing. They rarely grow either.
- Units: Hunter, Sled-runner, Snow-builder, Lore-keeper, Ice Watcher.
- Asks you for: a herd's path. They are the people who outlast everyone in a bad world.

**9. The Wild.** Not a people, but it plays like one and wins by default.
- Units (tile states): Seedling, Grass, Thicket, Young Forest, Old Forest, Swamp, Dune, Glacier,
  plus the beasts that live in them.
- It takes any tile nobody works. It never attacks. It just waits.

**How the peoples meet:** borders touch, then trade, war, marriage or one swallowing the other.
Peoples can merge into a new people with traits from both (a new file in `peoples/`, both parents in
its history). Peoples can split when they grow too wide. Over 5,000 years a world with 4 starting
peoples might end Epoch I with 10, or 1.

**Ages of Epoch I** (each one a tag in the world repo, each about one session):

| # | Age | Rough real-world years | What opens up |
|---|---|---|---|
| 1 | Kindling | before -3000 | Bands, fire, first camps |
| 2 | Furrow | -3000 to -2000 | Farms, herds, first towns |
| 3 | Crown | -2000 to -1000 | Cities, writing, kings |
| 4 | Bronze Road | -1000 to 0 | Empires, roads, coined trade |
| 5 | Long Faith | 0 to 700 | Great beliefs spread (your faith competes with theirs) |
| 6 | Sail & Script | 700 to 1450 | Ocean trade, universities, plague |
| 7 | Powder & Press | 1450 to 1750 | Printing, ocean crossings, peoples meet everywhere |
| 8 | Steam | 1750 to 1900 | Engines, the first big forest losses, cities explode |
| 9 | Wire & Signal | 1900 to 2000 | Electricity, flight, the first look up |

From age 5 on, peoples have their own beliefs. Your faith is one among several. From age 8,
industry can beat the Wild back faster than ever, and can also wreck land for good.

### Epoch II: the Worldbound (2000 to 7000)

One planet, all of it known. Then its sky.

Descendant peoples (who each Epoch I people tends to become, depending on its history):

| Descends from | Becomes | Lives by | Fails by |
|---|---|---|---|
| River Folk | **Arcologists** | Huge planned cities fed by machines | Machines failing with no one who remembers how they work |
| Steppe Riders | **Ring Nomads** | Moving stations in orbit, never settling | Supply chains, cold |
| Sea Traders | **Signal Guilds** | Networks; they hold the world's Memory | Network collapse (a dark age for everyone) |
| Forest Keepers | **Greenwrights** | Regrowing the world, gene gardens | Being overrun by those who want the land |
| Mountain Terracers | **Deep Delvers** | Underground cities, mining moons | Being cut off |
| Desert Caravaners | **Sun Farmers** | Solar fields, water from air | Dust storms, losing water tech |
| Island Navigators | **Void Sailors** | First crewed ships to other planets | Ships lost; a ship is a whole island of people |
| Ice Hunters | **Cold Keepers** | Polar stations, then icy moons | Barely anything; they inherit hard places |

New things in Epoch II: one shared climate (any people can wreck it for all), satellites, the moon,
the first colonies. The Wild becomes the **planet's health**: forest cover, clean sea, stable climate.
A dead planet is the Wild winning in a new way.

Ages: 10 Satellite, 11 Moonrise, 12 Inner Worlds, 13 The Belt, 14 Gas Giants' Moons, 15 Sunshade
(managing the climate on purpose), 16 Long Haul (ships that take generations), 17 The Leaving.

Your miracles here: steer a storm system, a mild solar year, a comet that brings water to a moon,
a signal in the noise (a dream at planet scale: an idea everyone gets at once).

### Epoch III: the Starbound (7000 to 12000)

Several star systems, slow light, generation ships. Peoples drift apart so far they become new peoples.

| Becomes | From | Lives by |
|---|---|---|
| **Seed Clades** | Greenwrights, Wayfinders | Ships that plant whole biospheres on empty worlds (they *bring* the Wild) |
| **Lattice** | Signal Guilds, Arcologists | Minds spread over many ships; one people across light years |
| **Swarm Dwellers** | Ring Nomads, Deep Delvers, Cold Keepers | Habitats around a star, no planets needed |
| **Lightsail Couriers** | Void Sailors | Fast tiny ships that carry Memory between systems |
| **Star Tenders** | Sun Farmers | Harvesting stars; can make or end a system |
| **The Quiet** | anyone | A people that stopped reaching out. They are the Wild's new face: silence |

Ages: 18 First Light (the first other star), 19 Seeding, 20 Swarm, 21 The Lattice, 22 Drift (peoples
split by distance), 23 Long Silence, 24 Return Signal, 25 Last Light (the campaign's end).

Your miracles here: a stellar wind, a seed ship's course, a quiet star made loud. Your branches
cross between stars only along Courier routes, so a system with no Couriers is a system you can't
touch anymore.

**The Wild in Epoch III** is the dark between stars. Peoples that stop sending ships and signals go
quiet, then go out. The map shows them fading the same way a city went back to forest in Epoch I.

---

## 5. Miracles

Few, slow to come back, and all of them leave marks in the repo.

| Miracle | Epoch | Effect | Side effect |
|---|---|---|---|
| Rain | I | Ends a drought on a few tiles | Floods if overused |
| Fire | I | Clears forest for farms, or stops an army | The Wild remembers: forest grows back thicker |
| Seed | I | Grows grass or forest on bare land | Can shut out farmers |
| Calm Sea | I | Safe crossing for one season | Traders take bigger risks next time |
| Dream | I-III | One people gets an idea (a tech) early | Big dependence if they know it came from you |
| Omen | I-II | Points a migration one way | They follow omens after that, even false ones |
| Plague's End | I | Stops a plague | Very visible: big faith, big dependence |
| Quake | I | Moves a river or opens a pass | Kills; rewrites the map for good |
| Storm Steer | II | Moves a weather system | Climate drift |
| Comet | II-III | Water or metal to a moon | Can also hit |
| Signal | II-III | A planet-wide idea | Every people gets it, friend or not |
| Stellar Wind | III | Speeds a fleet | The system's planets take radiation |
| Oracle | any | `git bisect`: shows the year the trouble began | Costs most of your influence |
| Gift Across Time | any | `cherry-pick` a tech from another branch | The branch you took it from loses it |
| Undo | any | `revert` one event | Logged forever as your doing; peoples sense it (faith drops everywhere) |

---

## 6. Winning, losing, scoring

- **You lose** a world when every people is gone and the Wild holds it all. The world doesn't end:
  the repo gets a "Long Quiet" commit, and a later game can start from it (new peoples, old ruins).
- **You win the campaign** if at least one people (any descendant line) reaches Last Light.
- **Score: Light Hand** = people-years lived across the campaign divided by influence spent. A run
  that carried two lines to the stars with forty miracles beats one that carried four lines with
  four hundred.
- **Lines carried:** how many of the starting peoples have a descendant at the end. You can't save
  them all, by design: the tuning should make 2 of 8 a good run and 4 of 8 a great one.

Retry is a timeline split, never a reset. Going back costs nothing but leaves the old branch in the
world, and the chronicle tells both stories.

---

## 7. How we'd build it (small steps, each one playable)

The sim is plain TypeScript with no Effect (per-tick code), deterministic and headless-testable. The
page is a pixel canvas. Effect only at the edges: saving to the world repo, Artifacts sync.

| Step | What ships | Proof |
|---|---|---|
| 0 | This plan, the owner's calls on the open questions | - |
| 1 | **Ecology toy.** Seeded map, rivers, the succession rules, fire, flood, desert spread, the speed dial. No people. | Headless: 300 years on a bare map gives the forest timing above. `window.branchOfInfluence.state()` and a `probe` row |
| 2 | **One people (River Folk)**, settlements, Vigor and upkeep, decay to ruins, the Wild taking ruins back | The "city goes back to forest" journey in 30 minutes of Watch |
| 3 | **Influence branches** + Rain, Fire, Seed, Dream + dependence | A run where helping too much makes the people collapse sooner |
| 4 | **The world is a repo.** Local git first: commit at session end, timeline split, replay from seed + log | Replaying a commit gives the same map, bit for bit |
| 5 | **Artifacts.** Worlds live in Cloudflare Artifacts (reuse codeSplitter's code), share a world as a link, fork it | Two browsers, two forks of one world |
| 6 | Four more peoples, borders, trade, merge/split, ages 1-9 | A full Epoch I campaign |
| 7 | Rule stickers, archaeology (checkout), blame on a tile, the chronicle written by a cheap model | A sticker that fails the world's laws gets turned away |
| 8 | Epoch II fold and zoom | Valley folds into a planet tile |
| 9 | Epoch III, timeline merges through Mervin | Two friends' worlds merged, conflicts as events |

Steps 1-3 are the game. Steps 4-5 are what makes it this game. Everything after is the long tail.

---

## 8. Open questions for the owner

1. **Peoples: ways of living (our recommendation) or real civilizations by name?** Real names make it
   a history game, with all the care that needs. Archetypes keep every world its own.
2. **What are you?** A nameless influence, or a literal world tree whose branches are the influence
   map? (The tree would give the title, the art and the UI one picture.)
3. **One player or shared worlds?** Shared worlds (friends fork and merge) is the strongest use of
   the repo idea, but it's step 9.
4. **War:** how much do we show? Proposal: peoples clash as borders moving and settlements changing
   hands, small sprite skirmishes, nothing gory, and war is one of the main ways peoples fall.
5. **Pixel scale:** 8 x 8 tiles (more world on screen) or 16 x 16 (more readable units)?
6. **Where it runs:** web first (canvas), desktop through Rusty Buns later?

---

## Appendix: the real-history patterns behind each people (design reference only)

These are the patterns we're drawing on, not factions in the game.

| People | Pattern | Seen in (broadly) |
|---|---|---|
| River Folk | Flood farming states that rise fast and fall to drought and salt | The early river valley states of the Near East, the Nile, the Indus, the Yellow River |
| Steppe Riders | Mobile herders who sweep across wide grassland | The peoples of the Eurasian steppe across 4,000 years |
| Sea Traders | Ports linked by sea routes, spreading goods and writing | Eastern Mediterranean traders, the Swahili coast, the North Sea and Baltic trading towns, Indian Ocean ports |
| Forest Keepers | Living in and with forest, with managed gardens | Amazon and Congo basin peoples, early woodland Europe and North America |
| Mountain Terracers | Terraces, stone, mountain roads | The Andes, the Himalaya, highland Ethiopia, terraced Southeast Asian hills |
| Desert Caravaners | Oases joined by caravan routes | Saharan and Arabian routes, the overland silk routes |
| Island Navigators | Open-ocean voyaging by stars and swells | The Pacific voyagers, the Austronesian spread |
| Ice Hunters | Small, mobile groups in the far north | Arctic peoples across the polar rim |

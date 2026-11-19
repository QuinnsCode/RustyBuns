# Story progression: what opens what

How a player gets from waking in the pines to the far south, as the game plays today (15 Nov 2026). Every rule here
is read from the code; the source is named on each one. The illustrated version of this page, with boss cards for
every region, is the field-guide artifact linked from the PR that added this file.

The rules a player lives under, each written once with its numbers read from the code, are in [RULES.md](RULES.md)
(`src/rules.ts`; `bun run rules` writes it).

## The rules

- **Start.** Tape 1 (the saucer), then the Book opens, says the job and offers the five it caught long ago (hodag,
  squonk, agropelter, jackalope, tatzelwurm); you take three.
  Only the Pine Barrens is open. (`STARTERS`, `newJourney` in `src/journey.ts`; `reach` in `src/world/world.ts`)
- **A trail per region.** Each playable region (1-8) is 12 sections in rings round its arena. A keeper stands on each
  section's stone: beat or bind it and the next ring opens. Section 12 is the region's mythic, in its lair.
  (`sections`, `clearSection` in `src/journey.ts`; `src/world/trail.ts`; lairs in `src/pockets.ts`)
- **Beating the mythic** marks the region beaten. That opens the road to **every neighbouring region** and adds a
  line-up slot (3 to start, 5 at most: `PARTY_FIRST`, `PARTY_MAX`). (`reach`, `slots`)
- **Gates.** Some roads also need a beast in the line-up: a **flier** (archetype `flyer`) for region 2 and the Andes
  (13), a **swimmer** (first field `tide`) for the rest of the south. (`GATES`, `travelOf`)
- **The south** (9-16) has no trail and no arena. Once one high-level region is open, every high-level region joined
  to it is too (gates still apply). A strong wild one attacks every 400 m; a loss sends you to your last playable
  region. (`reach`, `WILD_EVERY`, `sendHome`)
- **Regions 17-64** are coming soon and never open.
- **Levels** are fixed by region number, not by the order you reach it: region n's trail starts at `2 + (n-1)*8`
  and its mythic is level `2 + 8n`. (`baseLevel`, `sectionLevel`)

## The road graph (regions 1-16)

| # | Region | Mythic (level) | Opened by beating | Gate | Its win opens |
| --- | --- | --- | --- | --- | --- |
| 1 | Pine Barrens | Jersey Devil (10) | open at start | | 2, 3 (30, 34 soon) |
| 2 | Appalachian hollows | Mothman (18) | 1 or 3 or 7 | flier | 7, 10, 12 (39 soon) |
| 3 | Great North Woods | Hidebehind (26) | 1, 2, 5 or 7 | | 5, 7 |
| 4 | Pacific Northwest rainforest | Sasquatch (34) | 5 or 6 | | 6 |
| 5 | Great Lakes and Lake Champlain | Champ (42) | 3, 4, 7 or 8 | | 4, 7, 8 |
| 6 | Southwest desert | Chupacabra (50) | 4 or 8 | | 4, 8 |
| 7 | Bayou and Everglades | Rougarou (58) | 2, 3, 5 or 8 | | 8, 9, 10 |
| 8 | Ozarks and the southern plains | Ozark howler (66) | 5, 6 or 7 | | 6, 9 |
| 9-12, 14-16 | the south | none | 2, 7 or 8, then each other | swimmer | |
| 13 | The Andes | none | the south | flier | 14, 16 |

Suggested order, lowest level first as far as the roads allow: **1, 2, 3, 5, 4, 6, 7, 8**, then the south.

## Optional fights in each region

- **Sighting boards**: two per playable region, at sections 2 and 7. Read the report, follow three signs about 220 m
  apart, and a named creature waits at its lair, 4 levels over its section. (`src/world/hunts.ts`)
- **Faction quests**: the Office, the Institute and the Lamplighters each have 8 steps, one per playable region,
  waiting at a section's stone. A step opens once the step before is done and you are past its section; most end in
  a team fight. The Lamplighters' first step waits for your first night. (`content/faction-*.json`, `docs/FACTIONS.md`)
- **The Yule Isle**, 1 Dec to 6 Jan: a boat from the port town in the Great North Woods. Its lair holds Grýla
  (level 28); Krampus, Grýla and the kallikantzaros can be bound there. (`packs/yule-isle`)
- **Between fights**: campfires (heal and fast travel), the safe paths at night (`src/world/night.ts`), and the Book's demands
  (`src/demand.ts`).

## Design notes: what the data shows

These are open questions for the next design pass, not bugs filed yet.

1. **Every later boss lives in region 1.** Ten of the Pine Barrens' eleven keepers are the other seven regions'
   mythics (Mothman, hidebehind, Champ, chupacabra, rougarou, Ozark howler, Sasquatch), bindable at level 2-8.
2. **The gates are met in region 1.** The gate text names the Jersey Devil, but the Mothman keeps Apple Pie Hill
   (section 5) and flies, and Champ keeps Atsion Lake (section 4) and swims.
3. **The Pacific Northwest comes too late.** Region 4 (levels 26-34) borders only regions 5 (34-42) and 6 (42-50),
   so a level-42 or level-50 boss must fall before a level-26 region opens.
4. **No flier means a level jump.** Without one, region 3 (trail from level 18) is the only road out of region 1
   (boss at level 10).
5. **The south has no finish.** Regions 9-16 have no boss and no cleared state.
6. **Roads to the coming-soon map already exist.** Region 1 borders Ireland (30) and Iceland (34), region 2 Iberia
   (39), the Amazon (14) Italy and Sicily (40), the Maghreb (19) and Senegambia (20).

# Mythic Masters: the rules

Every rule the player lives under, written once. This page is written by `bun run rules` from `src/rules.ts`,
and each number in it is read from the code, so do not edit it by hand: change the constant, then run the script.

## 1. Controls, stamina and energy

- On a keyboard: move with W A S D, jump with Space, dash with Shift, attack with J, strong attack with K, guard with ;. Your special is L, your big move is I, your ultimate is U, and B binds. You can change every key in Settings.
- Stamina is your breath. Attacks, dashes, guarding, running and flying use it. Standing on the ground without attacking gives it back. At zero you are exhausted: you move slowly and cannot dash, guard or take off until some of it returns.
- Energy pays for the strong moves. A fight starts with 20. A clean hit gives you 6, a hit you take gives you 5, and standing still gives 2 a second. A special costs 15, a big move 35, an ultimate 100.

From the code: src/binds.ts ACTIONS; src/sim.ts COST, ENERGY, SWING.

## 2. Fields: what beats what, and by how much

- There are 12 fields. Every move has one field, and every creature has one or two.
- A move does 12.5% more damage to a creature whose field it beats. It does 10% less to a creature of its own field, or of a field that beats it. Two fields that lean the same way still count once.
- The field wheel under Settings shows the whole chart.

From the code: src/fields.ts STRONG, typeMul.

## 3. Levels: what one level gives a beast

- Each level adds 3% of the creature's level-10 stats to its vigor, might, guard, focus and will. Speed never changes with level.
- So one level is a big step at low levels and a small one at high levels. No stat goes over 255.
- Your first three start at level 5.

From the code: src/journey.ts atLevel.

## 4. XP: who earns it, how much, what the next level costs

- The beast that wins the fight earns all of its XP. The others in the line-up watched, and each gets 50% of it.
- A win gives 10 XP for each level of the creature you beat. The next level costs 15 XP for each level you have now. Example: a level-5 beast needs 75 XP, and beating a level-4 creature gives 40.

From the code: src/journey.ts gainXp, shareXp, WATCH_SHARE, toNext.

## 5. Health carries between fights

- A beast keeps the health it ended a fight with. It starts the next fight with the same health.
- Sit at a campfire and the whole line-up is back to full health.
- Wild food you pick on the way gives every hurt beast 25% of its health back. A knocked-out beast gets up.

From the code: src/journey.ts wound, heal, mend; src/world/nature.ts FORAGE_MEND.

## 6. A knocked-out beast, who is next, and what a loss costs

- When your beast is knocked out, the next one in the line-up can go in. The foe keeps the damage you did. A knocked-out beast stays out until a campfire or wild food.
- You can also run back to the world. The beast that fell stays knocked out.
- When the whole line-up is knocked out, you lose the fight. You go back to the trail, and the line-up is healed. You lose nothing else: no XP, no beasts, no cleared stones.

From the code: src/journey.ts nextUp, heal; src/main.ts (the result note); src/world/world.ts sendHome.

## 7. Binding

- You can try to bind a creature when its health is under 45%. For a region's boss it must be under 30%. Press B.
- You get 3 tries of ink in each fight. A try holds 30% of the time at the line and up to 95% as its health goes to nothing. A boss is half as easy: 15% up to 47.5%.
- You cannot bind a creature that is knocked out. If you knock it out first, it gets away.

From the code: src/journey.ts INK, bindBelow, bindChance.

## 8. The line-up and the Compendium

- You start by taking 3 of the Book's 5. The line-up holds 3. Each region's boss you beat adds one place, up to 5.
- You can own 9 in all: the line-up and the ones resting in the Compendium together. With 9, the ink will not take another until you release one.
- You can send a beast to rest anywhere, but you can call a resting one into the line-up only beside a lit campfire. The line-up always keeps one.
- Release is for good. A released beast does not come back.

From the code: src/journey.ts PICKS, PARTY_FIRST, PARTY_MAX, OWN_MAX, call, rest, release.

## 9. The trail

- Each region's trail has 12 sections. A keeper stands on the stone of each one. Beat it or bind it and the next section opens. You cannot skip a stone.
- The keeper of section 12 is the region's boss, in its lair.
- Levels rise along the trail. The boss is 8 levels over the first keeper, and each region starts 8 levels over the one before it by number.

From the code: src/journey.ts SECTIONS, baseLevel, sectionLevel, clearSection.

## 10. Roads and gates

- Only the first region is open at the start. When you beat a region's boss, the roads to all its neighbours open.
- Some roads also need a beast in your line-up to carry you. Appalachian hollows and The Andes need a flier. Valley of Mexico, Yucatán and the Maya lowlands, Central American highlands, Caribbean isles, Amazon basin, Pampas and Chiloé and the southern fjords need a swimmer: a creature whose first field is tide.
- The beast must be in the line-up, not resting in the Compendium.

From the code: src/world/world.ts reach, GATES, travelOf.

## 11. Tiers

- A creature's tier says how rare it is: common, uncommon, rare, legendary, mythic. There are also event creatures (in season only) and unknown ones (no name or level shown until you own one).
- How often each turns up at a den, as shares: common 6, uncommon 4, rare 2, legendary 1, mythic 1. A mythic stays in its own region.
- Levels over the region's other wild ones: common 0, uncommon 0, rare 1, legendary 3, mythic 5.
- A tier does not change how hard a creature is to bind.

From the code: src/tiers.ts ROAM_WEIGHT, TIER_LEVEL.

## 12. Night

- A day and a night together take 24 minutes. Sleep at a campfire and it is morning.
- At night, lit paths join the arena, the cabins and 8 campfires. You are safe within 4 m of a path's line and within 24 m of a lit fire, a cabin or the arena.
- Away from them, something stalks you. It catches you in 10 to 30 seconds: quicker the further you are from safety. Go back onto a path and it fades.
- If it catches you, a fight starts and the beast that is up has lost 40% of its full health before the first hit. It is never knocked out this way.
- One night in 5 the dark rolls down the paths, so you must keep moving.

From the code: src/world/night.ts HOUSES, PATH_HALF, CATCH_FAR, CATCH_NEAR, BOSS_EVERY; src/world/poi.ts SHELTER_R; src/journey.ts MAULED; src/world/day.ts DAY.

## 13. Night-only and seasonal creatures

- Some creatures roam only after dark: Jersey Devil, Mothman, Rougarou, Ozark Howler, Beast of Bray Road, Splintercat, Dover Demon and Fresno Nightcrawler.
- Event creatures roam only in their season: Yule Cat (1 December to 6 January), Nian (20 January to 20 February), Krampus (1 December to 6 January), Grýla (1 December to 6 January) and Kallikantzaros (1 December to 6 January).

From the code: src/tiers.ts NIGHT, SEASON, inSeason.

## 14. Sighting boards

- Each region with a trail has 2 sighting boards. Read one to take its report.
- Follow 3 signs, about 220 m apart. Then a named creature waits at its lair, 4 levels over its section.
- You can bind it. Beat it or bind it and the sighting is closed. Boards are optional.

From the code: src/world/hunts.ts HUNTS, CLUES, STEP, LEVEL_UP.

## 15. The three factions

- There are 3 factions. Each has 8 steps, one in each region with a trail. A step waits at a section's stone.
- A step opens when the step before it is done and you have cleared its section. A step is a talk, and your answers change what the faction thinks of you. Many steps end in a fight against a team.
- Faction steps are optional.

From the code: src/factions/model.ts FACTIONS; content/faction-*.json quest.

## 16. The Book's demands

- The Book always names the next creature it wants bound. It is a pointer, not an order: there is no reward for it and no cost for binding another.
- When you talk to the Book it sometimes gives a spare drop of ink. That is one more try in your next fight, over the usual 3.

From the code: src/demand.ts demandOf; src/book.ts spendInk.

## 17. Fights against more than one, and co-op

- A friend joins your world through a party link. Up to 6 players share a region.
- When you walk into a wild one or a keeper, friends in the region can join the fight. A lone creature that faces a team hits harder: 2.5 times against two, 3.5 against three, 5 against four.
- Each player's own beast earns the XP (the rest of that player's line-up gets half), and each player has the usual 3 tries of ink. The first bind that holds takes the creature. A keeper beaten together clears the stone only for a player whose next stone it is.

From the code: src/journey.ts OUTNUMBERED; src/net/party.ts MAX_PLAYERS; src/coop.ts.

## 18. Fast travel between campfires

- Walk up to a campfire to light it. It stays lit.
- Open the map and pick any lit campfire in an open region to go there. It costs nothing and has no limit. It does not heal you: sit at the fire for that.

From the code: src/world/poi.ts lightFire, fireSpot; src/world/view.ts fastTravel.

## 19. The far south

- The regions of the far south have no trail, no keepers and no boss.
- A strong wild one attacks every 400 m you walk there. Only the beast that is up fights it. You cannot bind it.
- If you lose, the line-up is healed and you are sent back to the last region with a trail.

From the code: src/world/world.ts WILD_EVERY, sendHome; src/main.ts wildOne.

## 20. Saving

- The game saves by itself: after every fight, at every campfire, and when you read a tape, a board or a sign.
- The save stays in this browser on this device (the key `mythic-masters.journey`). It does not follow your account to another device.
- A new journey asks you twice, then replaces the old save.

From the code: src/journey.ts SAVE_KEY, loadJourney; src/main.ts saveJourney.

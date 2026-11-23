# Fleet Commander: the design

You stand on the bridge of a wedge destroyer and run a battle the way a cold, patient admiral would: you read the
enemy, call plays for your wings of fighters, and pick when your guns go on their ships and when they go on the land.
The battle is chaotic and real-time (an RTS), but every order is a play from a short playbook, so the chaos is yours to
call.

Our own setting, no borrowed names: **the Concord Navy** (wedge destroyers, pale grey, amber fire) against **the Free
Rim** (welded industrial hulls, rust and ochre, cyan fire). Every word a player reads is in `src/names.ts`.

## Pillars

1. **You are the admiral, not the pilot.** You never fly a fighter. You watch wings go out like sparks and you choose
   what they do.
2. **Plays, not micro.** One key sends six wings into a pincer with its timing built in. You can still grab one wing
   and point it at something (that is the chaos), but the good moves are plays.
3. **Heavy hulls, light craft.** Capital ships are slow, tough and decisive at the end; fighters decide who gets there.
4. **The land matters.** Bases sit on planets in gravity wells. Guns on the land are guns not on ships, and the
   defender chooses between shielding the world and fighting back.
5. **The same game at every scale.** A wing, a ship and a fleet take the same orders. Win a sector and you command
   destroyers the way you commanded wings (the fractal).

## The primitives (what survives any taste call)

These are the bones. Every taste option below changes how they look or are named, never what they are.

| Primitive | What it is | In the code |
| --- | --- | --- |
| Seeded tick | 10 ticks a second, one `step(world, brains)`, all randomness from the world's seed. Replays, tests and lockstep multiplayer all come from this. | `src/sim/world.ts` `step` |
| Capital ship | Hull, shields, heading, speed, turn rate, gun range, point defence. Orders: hold, move, engage (optionally broadside), flank, rake, lane, guard. | `Ship`, `HULL`, `ShipOrder` |
| Wing | 4-6 craft of one role round an anchor, with a stance, a formation and an order (attack, escort, patrol, return). Launches from a hangar, rearms there. | `Wing`, `CRAFT` |
| Role triangle | Interceptors beat bombers, escorts beat interceptors, bombers beat ships, point defence beats bombers without escorts. | `CRAFT.vs` |
| Stance | Attack (hits harder, chases further, takes more), steady, defend (stays near its charge, takes less). | `Stance` |
| Formation | Tight (fast, focused, easy for point defence), screen (a wall), loose (hard to track, jinks). | `Formation`, `slot` |
| Shield arcs | Shields hold best ahead, less on the flank, least astern. Two hits from far-apart arcs inside 4 s split the shields (both halve) for 6 s. | `hitShip` |
| Broadside | A ship's guns bear fully side-on, partly ahead, barely astern. Broadside order adds 40% while side-on. | `bearFactor` |
| Torpedoes | Real objects with a drive plume; point defence and escorts shoot them down. Mostly soaked by forward shields, deadly from astern or on split shields. | `Torp`, `TORP` |
| Play | A set of wing orders with timing: groups wait at waypoints and go together; a feint holds its real strike. | `src/sim/plays.ts` |
| Doctrine | How a captain AI runs a ship: press, steady, shield. The same three as stances, one level up. | `Doctrine`, `captain` |
| Captain / admiral | AIs that call plays from the same playbook. The Rim admiral has a temper (zealot, pragmatist, cagey) that decides what it does when you rake its world. | `src/sim/ai.ts` |
| Gravity well and lane | Every battle is fought over a planet with a base; reinforcements come through a hyperspace lane. An interdictor on the lane pulls them out on top of itself, shields down. | `arrive`, `orbitPoint` |
| Rake vs guard | Raking bombards the base from low orbit (your guns stop shooting ships). A bastion's shield lets only a quarter through. Rim hulls on the line take 70% of the fire meant for the land. | `rake` |
| Focus | The commander's meter: fills with time and kills. Spent on Foresight (see their next move, weak arcs hit harder) or Fleet Trance (your pilots better, theirs worse). | `usePower`, `FOCUS` |
| Sector | Worlds joined by lanes; one jump a turn; mines pay supply; bases spread and raid; refit spends supply. | `src/sector.ts` |

## The battle, minute to minute

1. **Drop in.** The fleet comes out of hyperspace over a world. The Rim has a bastion in orbit, a cruiser, a carrier
   and corvettes, and a lane off to the south that will bring more in 80 s.
2. **Read.** The comms crackle; the Rim launches. Spend focus on Foresight early to see what its admiral will do.
3. **Call plays.** Mark the carrier, press W: two arms swing round its flanks, wait for each other, then run in
   together and split its shields. Meanwhile send the interdictor to the lane (Shift+G), broadside the cruiser (B).
4. **Juggle.** Bombers run dry and come home to rearm. A Rim bomber wing goes for your flagship: grab your escorts
   and screen (R). The reinforcements arrive: on top of your interdictor, shields down, if you got it there in time.
5. **Choose the land.** Once the bastion breaks, rake the world (V). A zealot admiral throws its hulls into your fire
   to save its people; a pragmatist forgets the land and turns every gun on your flagship. Raking means your guns are
   not on their ships. Choose the moment.
6. **Win or lose.** The base burns, or every Rim hull breaks, or your flagship goes, or the clock (8 min) runs out and
   the Rim evacuates.

## Progression

| Stage | You command | What it adds | State |
| --- | --- | --- | --- |
| Quick battle | One destroyer, an interdictor, six wings | The whole battle loop | **Built** |
| Campaign: the sector | The same fleet across nine worlds | Mines and supply, bases that spread and raid, strikes on half-built bases, refits, three defeats and you're out | **Built (first cut)** |
| Campaign: bigger sectors | The same, with two more sectors | New Rim hulls (a battlecarrier, minelayers), new craft for you (boarding shuttles, drone swarms), a bonus mission in the middle (a convoy, a rescue) and an end battle | Next |
| Playbook | Your own plays | The play editor: pick wings by role, give each an order, stance, formation, approach, delay and group. Earned plays unlock as you win | Next |
| Armada | A dreadnought, three destroyers with captains, its own wings | The fractal: plays and doctrines now go to captains, who call plays for their own wings | **Built (quick battle)** |
| Admiral | Several armadas over a sector | One level further: sector plays (a pincer of two fleets on one system, a feint on a mine), battles you can fight or let your captains settle by doctrine | Later |

## The fractal

The same five words at every level: **target, play, stance (doctrine), formation, approach.**

- A **wing** takes them from you (quick battle) or from its captain (Armada).
- A **ship** takes them from you (the flagship's orders) or from its admiral. A captain AI turns a ship's doctrine into
  plays for its wings: press means pincers and torpedo runs on its focus, steady means hammer and anvil, shield means
  screen its charge. `captain` in `src/sim/ai.ts`.
- A **fleet** (the Armada) takes the same plays from you: a pincer of destroyers swings two ships round the flanks
  (`runFleetPlay`). The Rim admiral runs the same code on its side.
- An **armada of armadas** (Admiral) is the next level: the sector map's battles become plays too.

## Logistics (the RTS layer)

The sector map is where the strategy lives: you can't be everywhere.

- **Mines** (resource worlds) pay 3 supply a turn while you hold them. Seizing one is a picket fight.
- **Rim bases** grow stronger and spread: every few turns a base starts building on a free world next door. A base
  being built is a **strike**: an easier fight with no bastion, if you get there in time.
- **Raids**: a base next to one of your mines may take it back while your fleet is away.
- **Refit** at a world you hold: 1 supply a craft, 1 per 5% hull, half price at the yard.
- **Lose** at six Rim bases or three defeats; **win** when no base is left.

Next on this layer: the sector in real time (the fleet moves while the Rim moves, an RTS map and not turns),
detachments (send the interdictor or a destroyer alone to hold a lane), and hyperspace lanes as the thing you fight
over (block a lane and the Rim can't reinforce down it).

## Modes

| Mode | Shape | Notes |
| --- | --- | --- |
| Solo campaign | The sector, then more | Built: one sector |
| Co-op campaign | Each player a destroyer under one dreadnought (the host), or each on their own front of the sector | The Armada is already this battle: each destroyer a seat. A bonus mission mid-campaign, an end battle at the end |
| Co-op battle | Two to four players against the Rim | Quick battle with seats |
| Versus | Navy against Rim | The Rim gets its own playbook: hit and run, decoys, suicide rams, hiding in the planet's shadow |

Multiplayer is lockstep: orders are tiny (a play id, a target id, a tick) and the sim is seeded, so every page runs
the same battle. The eqosys sign-in and Qollab party are already wired by the starter (`src/eqosys.ts`). An empty seat
is played by `autoCommander`.

## Look and feel

Grounded naval sci-fi: silent heavy hulls, point-defence cannons that hose tracer streams at incoming torpedoes,
torpedoes with long bright drive plumes, flak bursting round bombers, and a huge capital-ship furball over a world
whose surface lights up where it is raked. The bridge is cold and quiet: glass panels, a fixed-width clock, terse
comms. Today: two looks (`L`): **cinema** (lit hulls on black) and **holo** (the tactical table in wireframe).

## Taste calls

Each one is the owner's to make; the game runs on the default today. The page to pick them on is linked from the PR.

- **T1 The view**: cinema (default) · holo table · the bridge window (first person, the table inset) · split (table plus a picture of the hottest fight).
- **T2 Pace**: real-time, pause allowed (default) · real-time, no pause · time slows while you hold a play card · command points that regenerate.
- **T3 Names**: Concord Navy vs Free Rim (default) · Hegemony vs Kindred · Directorate vs Free Worlds Compact · Ascendancy vs Lantern Clans.
- **T4 Your hull**: wedge (default) · dagger with flared stern · long spine with a hammerhead · twin-tower arrowhead.
- **T5 Fire colours**: amber vs cyan (default) · white-blue vs orange · all tracer yellow, colour only on the holo.
- **T6 The commander's gifts**: Foresight and Fleet Trance (default) · Foresight only · Trance only · three, with Command Voice (orders with no comms lag).
- **T7 Calling plays**: card bar (default) · a radial menu on the target · draw the arrows on the table · a coach's binder of pages.
- **T8 Camera**: angled RTS (default) · straight down · ride the flagship · an auto-director that cuts to the big moments.

## Balance today (a climb, not settled)

`autoCommander` (a by-the-book player) wins every quick battle it is given; a fleet with no orders loses every one.
Over 12 seeds: torpedo run is the safest (92% hull left, 20 craft lost), feint the fastest (3:17), pincer and hammer
split shields twice as often, hunt alone rarely wins (8 of 12). The Rim's fighters die too early; its carriers should
relaunch. Numbers live in `HULL`, `CRAFT` and `TORP` at the top of `src/sim/world.ts`.

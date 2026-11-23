# Fleet Commander: the design

You stand on the bridge of a wedge destroyer and run a battle the way a cold, patient admiral would: you read the
enemy, call plays for your wings of fighters, and pick when your guns go on their ships and when they go on the land.
The battle is chaotic and real-time (an RTS), but every order is a play from a short playbook, so the chaos is yours to
call.

Our own setting, no borrowed names: **the Directorate** (wedge destroyers, pale grey, white-blue fire) against **the Free
Worlds Compact** (welded industrial hulls, rust and ochre, orange fire). Every word a player reads is in `src/names.ts`.

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
| Captain / admiral | AIs that call plays from the same playbook. The Compact admiral has a temper (zealot, pragmatist, cagey) that decides what it does when you rake its world. | `src/sim/ai.ts` |
| Gravity well and lane | Every battle is fought over a planet with a base; reinforcements come through a hyperspace lane. An interdictor on the lane pulls them out on top of itself, shields down. | `arrive`, `orbitPoint` |
| Rake vs guard | Raking bombards the base from low orbit (your guns stop shooting ships). A bastion's shield lets only a quarter through. Compact hulls on the line take 70% of the fire meant for the land. | `rake` |
| Focus | The commander's meter: fills with time and kills. Spent on Foresight (see their next move, weak arcs hit harder), Fleet Trance (your pilots better, theirs worse) or Command Voice (orders land at once). | `usePower`, `FOCUS` |
| The radio | Orders to wings are data on the radio (`Pending`: a play or a route, ids and points) and land `COMMS_LAG` (2 s) later; ships on your own bridge obey at once. The same data is what a lockstep game will send. | `send`, `courier` |
| Drawn route | A play you draw: points to fly through, then an order where the stroke ends. Routes with one group wait for each other at their ends, so two strokes make your own pincer. | `runRoute`, `Wing.route` |
| Sector | Worlds joined by lanes; one jump a turn; mines pay supply; bases spread and raid; refit spends supply. | `src/sector.ts` |

## The battle, minute to minute

1. **Drop in.** The fleet comes out of hyperspace over a world. The Compact has a bastion in orbit, a cruiser, a carrier
   and corvettes, and a lane off to the south that will bring more in 80 s.
2. **Read.** The comms crackle; the Compact launches. Spend focus on Foresight early to see what its admiral will do.
3. **Call plays.** Each order spends 2 s on the radio, so call it early. Mark the carrier, press W: two arms swing round its flanks, wait for each other, then run in
   together and split its shields (or draw the two arms yourself with right-drags). Meanwhile send the interdictor to the lane (Shift+G), broadside the cruiser (B).
4. **Juggle.** Bombers run dry and come home to rearm. A Compact bomber wing goes for your flagship: grab your escorts
   and screen (R). The reinforcements arrive: on top of your interdictor, shields down, if you got it there in time.
5. **Choose the land.** Once the bastion breaks, rake the world (V). A zealot admiral throws its hulls into your fire
   to save its people; a pragmatist forgets the land and turns every gun on your flagship. Raking means your guns are
   not on their ships. Choose the moment.
6. **Win or lose.** The base burns, or every Compact hull breaks, or your flagship goes, or the clock (8 min) runs out and
   the Compact evacuates.

## Progression

| Stage | You command | What it adds | State |
| --- | --- | --- | --- |
| Quick battle | One destroyer, an interdictor, six wings | The whole battle loop | **Built** |
| Campaign: the sector | The same fleet across nine worlds | Mines and supply, bases that spread and raid, strikes on half-built bases, refits, three defeats and you're out | **Built (first cut)** |
| Campaign: bigger sectors | The same, with two more sectors | New Compact hulls (a battlecarrier, minelayers), new craft for you (boarding shuttles, drone swarms), a bonus mission in the middle (a convoy, a rescue) and an end battle | Next |
| Drawn plays | Routes you draw on the table | Right-drag a route for the picked wings; Shift adds an arm that strikes with the last | **Built** |
| Playbook | Your own plays | Save a drawn play as a card of its own (its arms by role, relative to the target), plus earned plays that unlock as you win | Next |
| Armada | A dreadnought, three destroyers with captains, its own wings | The fractal: plays and doctrines now go to captains, who call plays for their own wings | **Built (quick battle)** |
| Admiral | Several armadas over a sector | One level further: sector plays (a pincer of two fleets on one system, a feint on a mine), battles you can fight or let your captains settle by doctrine | Later |

## The fractal

The same five words at every level: **target, play, stance (doctrine), formation, approach.**

- A **wing** takes them from you (quick battle) or from its captain (Armada).
- A **ship** takes them from you (the flagship's orders) or from its admiral. A captain AI turns a ship's doctrine into
  plays for its wings: press means pincers and torpedo runs on its focus, steady means hammer and anvil, shield means
  screen its charge. `captain` in `src/sim/ai.ts`.
- A **fleet** (the Armada) takes the same plays from you: a pincer of destroyers swings two ships round the flanks
  (`runFleetPlay`). The Compact admiral runs the same code on its side.
- An **armada of armadas** (Admiral) is the next level: the sector map's battles become plays too.

## Logistics (the RTS layer)

The sector map is where the strategy lives: you can't be everywhere.

- **Mines** (resource worlds) pay 3 supply a turn while you hold them. Seizing one is a picket fight.
- **Compact bases** grow stronger and spread: every few turns a base starts building on a free world next door. A base
  being built is a **strike**: an easier fight with no bastion, if you get there in time.
- **Raids**: a base next to one of your mines may take it back while your fleet is away.
- **Refit** at a world you hold: 1 supply a craft, 1 per 5% hull, half price at the yard.
- **Lose** at six Compact bases or three defeats; **win** when no base is left.

Next on this layer: the sector in real time (the fleet moves while the Compact moves, an RTS map and not turns),
detachments (send the interdictor or a destroyer alone to hold a lane), and hyperspace lanes as the thing you fight
over (block a lane and the Compact can't reinforce down it).

## Modes

| Mode | Shape | Notes |
| --- | --- | --- |
| Solo campaign | The sector, then more | Built: one sector |
| Co-op campaign | Each player a destroyer under one dreadnought (the host), or each on their own front of the sector | The Armada is already this battle: each destroyer a seat. A bonus mission mid-campaign, an end battle at the end |
| Co-op battle | Two to four players against the Compact | Quick battle with seats |
| Versus | Directorate against Compact | The Compact gets its own playbook: hit and run, decoys, suicide rams, hiding in the planet's shadow |

Multiplayer is lockstep: orders are tiny (a play id, a target id, a tick) and the sim is seeded, so every page runs
the same battle. The eqosys sign-in and Qollab party are already wired by the starter (`src/eqosys.ts`). An empty seat
is played by `autoCommander`.

## Look and feel

Grounded naval sci-fi: silent heavy hulls, point-defence cannons that hose tracer streams at incoming torpedoes,
torpedoes with long bright drive plumes, flak bursting round bombers, and a huge capital-ship furball over a world
whose surface lights up where it is raked. The bridge is cold and quiet: glass panels, a fixed-width clock, terse
comms. Two looks (`L`): **holo** (the tactical table in wireframe, the default) and **cinema** (lit hulls on black). The
camera rides your flagship and looks out from it; a pan moves where it sits from the ship.

## Taste calls

The owner picked these on 2026-11-23; each other option is kept here in case one is worth trying later.

| Call | Picked | The others |
| --- | --- | --- |
| T1 The view | **Holo table** (the default look; L switches to cinema) | cinema · the bridge window · split |
| T2 Pace | **Real-time, no pause** (speed up is still there: 1x, 2x, 4x) | pause allowed · slow while a card is held · command points |
| T3 Names | **The Directorate vs the Free Worlds Compact** | Concord Navy vs Free Rim · Hegemony vs Kindred · Ascendancy vs Lantern Clans |
| T4 Your hull | **Wedge** | dagger · spine and hammerhead · twin-tower arrowhead |
| T5 Fire colours | **White-blue vs orange** | amber vs cyan · plain yellow tracer |
| T6 Gifts | **Three: Foresight, Fleet Trance, Command Voice** | Foresight only · Trance only · two |
| T7 Calling plays | **Card bar**, plus drawing routes on the table (the owner: "something cool to being able to draw the plays out too") | radial menu · coach's binder |
| T8 Camera | **Ride the flagship** | angled RTS · straight down · auto-director |

The code still keeps the sides' ids as `navy` and `rim`; only the words changed.

## Balance today (a climb, not settled)

`autoCommander` (a by-the-book player) wins every quick battle it is given; a fleet with no orders loses every one.
Hangars hold spare craft (`Ship.reserve`): a wing wiped out is rebuilt from them 20 s later, so the Compact's carriers keep
launching and your own spares are a campaign resource that refits buy back. Over 12 seeds, autoCommander calling one
play all battle: every play wins, each at a different cost. Feint is fastest (4:07) with the most hull left (67%),
torpedo run lands the most torpedoes (68) at 4:22, hammer and anvil and pincer are slow (5:16, 5:38) but split shields
more, and hunt keeps the flagship safest (75%) by killing their bombers. Numbers live in `HULL`, `CRAFT` and `TORP` at
the top of `src/sim/world.ts`, and the spares in `src/sim/scenarios.ts`.

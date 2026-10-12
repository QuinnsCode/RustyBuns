# Game idea 2: Two Fronts, a galactic strategy map where you lead the key ground battles yourself

Working title. A turn-based space strategy game in the spirit of the classic world-conquest board
games (territories, armies, production, a front line), where at the turning points you drop to a
planet and fight the battle yourself as a hero in a large third-person combined-arms battle:
infantry, vehicles, command posts, and fighters overhead.

The core rule: **you have to win both fronts.** Fleets decide who controls the orbit. Ground
battles decide who controls the worlds. Each one feeds the other, and you can't win by only
winning one.

All factions, ships and worlds are our own. No licensed universe.

## Pillars

1. **Two layers, one war.** The galaxy map and the ground battle share state both ways. What
   happens in one shows up in the other.
2. **One hero, decisive moments.** You don't fight every battle, only the ones that matter, and
   when you do, your play matters.
3. **Losing compounds, and so does winning.** Lose a planet's ground war and it's lost. Lose key
   sectors and the strategic map turns against you.
4. **Sessions of the right size.** One strategic turn takes a few minutes. One ground battle runs
   15-25 minutes. A campaign is played over many evenings.

## Layer 1: the strategic map

- **The galaxy is a graph.** Star systems connected by hyperlanes. Systems group into regions
  that give a bonus to whoever holds the whole region (the classic continent bonus).
- **Each planet has sectors.** A planet isn't one tile. It's 3-7 sectors (capital, shipyard,
  mines, shield generator, spaceport, wilds). You can hold part of a world.
- **Units:** fleets (ships by class: fighters/carriers, frigates, capitals, troop transports),
  ground armies (infantry, armour, artillery, air), and heroes.
- **Economy:** each sector produces credits, materials or manpower. Shipyards build ships,
  factories build ground forces. Supply runs along held lanes, and cut-off forces weaken.
- **Turn structure (simultaneous orders, then resolve):**
  1. Collect income, buy and place units.
  2. Give orders: move fleets, launch invasions, set up blockades and defences.
  3. Space battles resolve (auto-resolve with dice-plus-stats, or a quick tactical view later).
  4. Ground battles resolve: most are auto-resolved, but **one per turn** can be chosen as the
     **hero battle**, which you play.
  5. Update control, supply and morale.

## How the two fronts link

| Space → ground | Ground → space |
|---|---|
| Holding orbit lets you land troops and reinforce mid-battle | Holding the shield generator sector protects your orbit from bombardment |
| Orbital bombardment strikes are a call-in during the ground battle | Holding the spaceport/shipyard sector lets you build and repair fleets there |
| Losing orbit mid-war cuts the ground army off from reinforcements (respawn tickets stop coming) | Capturing anti-ship cannons on the surface damages blockading fleets every turn |
| Fighter cover in orbit gives air support on the ground | Holding the capital sector flips the planet and its income |

That's the "lose too much ground and it becomes impossible" rule in practice:

- **Ground war:** each planet has a **control track** across its sectors. Win a sector and the
  attacker gets a foothold. Lose the capital and the shield and the defender can't respawn
  there any more. Once a side holds less than a threshold (say 1 of 5 sectors) and has no
  orbit, it can't win that planet back from the surface. The only way back is a new invasion
  from space.
- **Strategic war:** **key sectors** (shipyards, capitals, chokepoint worlds) feed a
  **war-score**. Lose too many and your production, supply and morale fall faster than you can
  rebuild, and the strategic win drifts out of reach. Wins on the ground matter because they
  hold the war-score up.

## Layer 2: the hero ground battle

- **Third-person combined arms.** You play one hero alongside dozens of AI troops (and later
  other players). Classes for the troops (assault, heavy, sniper, engineer), vehicles you can
  climb into (walkers, tanks, speeders, gunships).
- **Command posts and objectives.** The battle is fought over the planet sector's command posts,
  with a **ticket** pool for each side. Run a side's tickets out and the sector goes to the other.
- **The battle is built from the map.** The strategic state sets it up:
  - Tickets come from the number of armies committed.
  - The vehicle pool comes from what was built and brought.
  - Orbit control gives call-ins (bombardment, drop pods, air cover).
  - The terrain and layout come from the sector type (capital city, mining canyon, shield
    generator plain, jungle).
  - The defender's earlier fortifications (turrets, walls) appear in the level.
- **The hero:** a stronger unit with abilities and a respawn limit. Your hero's level and gear
  carry over between battles. Lose the hero and it's out for a few turns (wounded) or gone for
  good (on a hardcore setting).
- **Results flow back:** a win takes the sector. The surviving units and vehicles stay on the
  map, the losses are lost. Even in a loss, a battle that drained most of the enemy's tickets
  leaves their army weaker.

## Modes

- **Single-player campaign against AI factions** (start here).
- **Hotseat / async multiplayer:** each player takes a strategic turn, hero battles are played
  when they come up, and if two players' heroes meet, that battle is played live as PvP.
- **Skirmish:** just a ground battle on a chosen sector, for practice.

## Tech sketch (fits the repo)

- Strategy layer: deterministic TS rules engine, state as JSON, one Durable Object per campaign
  (SQLite for history), async turns. Runs locally on the desktop build with the same code.
- Ground layer: three.js third-person shooter with AI squads, loaded with a battle spec
  generated from the strategy state, which returns a result spec when it ends.
- The contract between them is two small JSON types: `BattleSpec` (in) and `BattleResult`
  (out). Either side can be built and tested on its own with fixtures.

## First milestone (vertical slice)

1. A small galaxy: 8 systems, 2 factions, 1 AI opponent.
2. A strategy loop with fleets, armies, production and auto-resolve.
3. One planet with 3 sectors. Pick one battle per turn to play as a hero.
4. One playable ground map (a shield generator plain) with 2 command posts, AI infantry, one
   vehicle type and an orbital strike call-in tied to orbit control.
5. Results write back to the map, and the shield-to-orbit and orbit-to-reinforcement links work.

## Decisions

- **Turn-based strategic layer**, not real-time with pause.
- **One hero battle per turn.** You have one hero, and they can only be in one place. Every other
  ground battle that turn is auto-resolved. Orders carry a single `hero` pick and `resolveTurn`
  pauses on it ([#1076](https://github.com/QuinnsCode/RustyBuns/issues/1076)).
- **A full campaign is about 30 systems** in 6-8 regions, played over several evenings. The
  8-system galaxy stays as the short map ([#1082](https://github.com/QuinnsCode/RustyBuns/issues/1082)).
- **Space battles are auto-resolved** (dice plus stats) unless the hero flies one. The hero's one
  battle a turn can be a space battle instead of a ground one: a fighter in a three.js dogfight
  over the orbit, through `SpaceBattleSpec` and `SpaceBattleResult`. The turn pauses before the
  landings, since where troops can land waits on who wins the orbit
  ([#1083](https://github.com/QuinnsCode/RustyBuns/issues/1083)).

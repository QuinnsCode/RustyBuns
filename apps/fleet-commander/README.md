# Fleet Commander

> **What it proves:** a real-time fleet battle in three.js from one seeded sim with no DOM in it, where the player
> and the AI captains call plays from the same playbook, so the same game runs one level up (a dreadnought commanding
> destroyers). The Theater plays it as a top-down RTS over a whole star system in the fog, with gravity wells that
> speed up what falls along them and rifts that hide hulls from sensors. The design, its parts and the open taste calls
> are in [DESIGN.md](DESIGN.md).

## Play it

**What it is:** a space-fleet battle seen from the bridge of a wedge destroyer. You don't fly; you command. Send wings
of fighters out in plays (a torpedo run, a pincer, a feint), trade broadsides with Compact ships, hold the hyperspace lane
against their reinforcements, and burn their base on the world below. Or play the *Theater*: a whole star system in the
fog of war, where you hunt a Compact fleet hiding in rifts and in the star's heat, slingshot round gravity wells, and
hold strongpoints for supply.

**Play:** not online yet. Run it yourself: `bun install --frozen-lockfile` at the repo root, then
`cd apps/fleet-commander && bun run dev`.

**How to play the Theater:** press *Theater*. The board is dark: the Compact is in the system, but you can't see where.
Press **3** to pick your scouts and right-click into the black to send them (they see into rifts; only the sensor
ship, or thermal sensors, sees into the star's heat). Drag a box round your ships and right-click to move or attack, or
right-drag a route that curves round a planet or the star: a hull falling along a gravity well moves faster, so the
long way round can be the quick way. **K** pings with the sensor ship: everything near shows for a few seconds,
mines too, but the Compact hears it. Park hulls on a strongpoint to take it; each one you hold pays supply, which buys
wings and thermal sensors (the buttons at the right of the bar). Hold all four for a minute, burn the base on Hollow,
or break every Compact hull to win. Watch for mines round what the Compact holds, and for ambushers that wait in the
dark and give themselves away when they fire.

**How to play a quick battle:** press *Quick battle*. Your six wings start selected and the Compact carrier is marked: press **W** for a
pincer on it, **Shift+G** to send your interdictor to the lane, **B** to broadside the marked ship. When the orbital
bastion falls, **V** rakes the base. Or draw a play: right-drag a route from your wings round to a ship, and Shift+right-drag a
second arm; the arms wait for each other and strike together. Orders to wings take 2 s on the radio (Command Voice, **N**,
makes them instant), and there is no pause. *Campaign* is a sector of worlds to take turn by turn; *Armada* puts you on a
dreadnought whose three destroyers run their own wings. New to it? *Levels* is eight short battles, easiest first, each
teaching one idea (a torpedo run, the role triangle, split shields, an escort, the fog, the lane, the rake, a last stand);
the list says what each one teaches before you start it.

**Controls:** Theater, desktop: drag a box to pick, right-click to move or attack, right-drag a route, **K** ping,
the minimap (click to look, right-click to order) and the screen edges or arrows move the view, the middle button
drags it, wheel to zoom. Every battle, desktop: **1-6** pick a wing (Shift adds), **F** the flagship, **G** the interdictor; click a Compact ship to
mark it, right-click to order the selection there, right-drag to draw it a route (Shift adds an arm; **P** is the pen
for a plain drag). **Q W E R T Y** call plays (torpedo run, pincer, hammer and anvil,
screen, hunt, feint), **H** recalls. **A S D** stance (attack, steady, defend), **Z X C** formation (tight, screen,
loose). **Space** Foresight, **M** Fleet Trance, **N** Command Voice. The camera rides your flagship: drag or arrows to
look further out, **F** back on it, wheel to zoom, **L** holo table or cinema, **.** speed, **Tab** next target. · Phone: tap a card to pick it, tap a Compact ship to mark it, tap a play; with a
wing picked, tap open space to send it there; the pen button, then a drag, draws a route (a second route onto the same ship within 10 s is another arm). Drag to pan, pinch to zoom.

**Account:** not needed.

## Run it

```
bun install --frozen-lockfile   # at the repo root
bun run dev                     # in the browser
bun test                        # the battles and the campaign, played by the tests
```

Jump links: `/?battle=theater` (or `quick`, `armada`, `campaign`, `levels`), `/?battle=level&level=escort-run` (an id or a number), `&seed=4`, `&look=holo`.

## What's in it

| File | What it does |
| --- | --- |
| `src/sim/world.ts` | the battle: ships, wings, torpedoes, shields by arc, broadsides, point defence, the rake, the lane, one `step`. No DOM. |
| `src/sim/plays.ts` | the playbook: wing plays (`runPlay`) and the same plays for a fleet of destroyers (`runFleetPlay`) |
| `src/sim/ai.ts` | the Compact admiral and its tempers, the captains that run a ship and its wings, and `autoCommander` (a by-the-book player for tests, the menu and an empty seat) |
| `src/sim/levels.ts` | the levels: each one a battle built as data, the line it teaches, and its intended play as a brain (the test plays it to a win, and a fleet with no orders to a loss) |
| `src/sim/theater.ts` | the Theater: sensors and the fog (rifts, heat shear, pings, firing gives you away), mines, strongpoints and supply, requisitions, the Pyre system. Gravity wells are `wellAt` in `world.ts`. |
| `src/view/fog.ts`, `minimap.ts` | the fog of war over the table (explored, seen, the veils) and the minimap |
| `src/sim/scenarios.ts` | the battles: the assault on a base, a picket, a strike on a half-built base, the Armada |
| `src/sector.ts` | the campaign map: worlds, lanes, supply, bases that spread, refits |
| `src/view/scene.ts`, `models.ts` | the view: hulls made in code, tracer streams, bolts, drive plumes, explosions, the orders overlay, holo and cinema looks |
| `src/view/sheets.ts`, `ships.ts` | the hull drawing sheets (our own: size in metres and every named piece) and each piece built from its sheet, with a cheap far level for the Theater. Built so far: the Lance-class destroyer and the Bastion cruiser; the other hulls and the craft are still plain shapes in `models.ts`. See them on `/ships.html?ship=destroyer` (`~exploded`, `~<piece>`, `~far`; `&view=three\|top\|side\|front\|below\|stern`) |
| `src/main.ts` | the page: input, the HUD, the sector screen, the harness |
| `src/names.ts` | every faction, hull and wing name the player reads |

## The harness

`window.fleetCommander.state()` returns the screen, the battle (time, outcome, focus, the base, every ship and wing
with its order, the Compact admiral's temper and doctrine) and the campaign. `quick(seed)`, `armada(seed)`, `campaign()`
and `go(world)` start things, and `theater(seed)` the Theater (`ping()`, `buy(what)`, `box(x1, y1, x2, y2)` there; its state
has `field`: supply, strongpoints, what you see and last saw); `select(...ids)`, `mark(id)`, `play(id)`, `stance(s)`, `formation(f)`,
`flagship('broadside' | 'rake' | 'hold')`, `lane()`, `orderAt(x, z)`, `power(p)` command; `run(seconds)` plays the
battle ahead at once. In the Rusty Buns repo, `bun run probe fleet-commander "/?battle=quick"` reads it from headless
Chrome.

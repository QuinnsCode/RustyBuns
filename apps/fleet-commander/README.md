# Fleet Commander

> **What it proves:** a real-time fleet battle in three.js from one seeded sim with no DOM in it, where the player
> and the AI captains call plays from the same playbook, so the same game runs one level up (a dreadnought commanding
> destroyers). The design, its parts and the open taste calls are in [DESIGN.md](DESIGN.md).

## Play it

**What it is:** a space-fleet battle seen from the bridge of a wedge destroyer. You don't fly; you command. Send wings
of fighters out in plays (a torpedo run, a pincer, a feint), trade broadsides with Compact ships, hold the hyperspace lane
against their reinforcements, and burn their base on the world below.

**Play:** not online yet. Run it yourself: `bun install --frozen-lockfile` at the repo root, then
`cd apps/fleet-commander && bun run dev`.

**How to play:** press *Quick battle*. Your six wings start selected and the Compact carrier is marked: press **W** for a
pincer on it, **Shift+G** to send your interdictor to the lane, **B** to broadside the marked ship. When the orbital
bastion falls, **V** rakes the base. Or draw a play: right-drag a route from your wings round to a ship, and Shift+right-drag a
second arm; the arms wait for each other and strike together. Orders to wings take 2 s on the radio (Command Voice, **N**,
makes them instant), and there is no pause. *Campaign* is a sector of worlds to take turn by turn; *Armada* puts you on a
dreadnought whose three destroyers run their own wings.

**Controls:** Desktop: **1-6** pick a wing (Shift adds), **F** the flagship, **G** the interdictor; click a Compact ship to
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

Jump links: `/?battle=quick` (or `armada`, `campaign`), `&seed=4`, `&look=holo`.

## What's in it

| File | What it does |
| --- | --- |
| `src/sim/world.ts` | the battle: ships, wings, torpedoes, shields by arc, broadsides, point defence, the rake, the lane, one `step`. No DOM. |
| `src/sim/plays.ts` | the playbook: wing plays (`runPlay`) and the same plays for a fleet of destroyers (`runFleetPlay`) |
| `src/sim/ai.ts` | the Compact admiral and its tempers, the captains that run a ship and its wings, and `autoCommander` (a by-the-book player for tests, the menu and an empty seat) |
| `src/sim/scenarios.ts` | the battles: the assault on a base, a picket, a strike on a half-built base, the Armada |
| `src/sector.ts` | the campaign map: worlds, lanes, supply, bases that spread, refits |
| `src/view/scene.ts`, `models.ts` | the view: hulls made in code, tracer streams, bolts, drive plumes, explosions, the orders overlay, holo and cinema looks |
| `src/main.ts` | the page: input, the HUD, the sector screen, the harness |
| `src/names.ts` | every faction, hull and wing name the player reads |

## The harness

`window.fleetCommander.state()` returns the screen, the battle (time, outcome, focus, the base, every ship and wing
with its order, the Compact admiral's temper and doctrine) and the campaign. `quick(seed)`, `armada(seed)`, `campaign()`
and `go(world)` start things; `select(...ids)`, `mark(id)`, `play(id)`, `stance(s)`, `formation(f)`,
`flagship('broadside' | 'rake' | 'hold')`, `lane()`, `orderAt(x, z)`, `power(p)` command; `run(seconds)` plays the
battle ahead at once. In the Rusty Buns repo, `bun run probe fleet-commander "/?battle=quick"` reads it from headless
Chrome.

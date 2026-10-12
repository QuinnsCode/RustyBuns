# Two Fronts

> **What it proves:** a turn-based strategy engine and a three.js ground battle built apart and joined by two small JSON types, with no backend. One of the [Rusty Buns](../../README.md#see-it-work) examples.

A galactic war you have to win on two fronts. Fleets fight for the orbit of each world and armies fight for its sectors. Once a turn, you pick one ground battle and play it yourself as a hero in a third-person fight over command posts. This is the first slice of the plan in [notes/game-ideas/2-two-fronts.md](../../notes/game-ideas/2-two-fronts.md).

- **The galaxy:** eight systems in three regions, two factions, and you against the AI. Hold every capital in a region for its bonus. Most worlds are one capital. Kessa, on the front line, has three sectors: a shield generator, a spaceport and a capital.
- **A turn:** spend credits (ships at a spaceport, armies at a capital), order moves, then everything resolves at once. Space battles come first, then landings, then ground battles. Battles you don't play are settled with dice plus stats.
- **Orbit → ground:** troops can only land under your own orbit. An enemy orbit blockades a world, so nothing gets built there. In the hero battle, your orbit gives you drop-pod reinforcements and orbital strikes, and a fleet of two or more bombards enemy armies every turn.
- **Ground → orbit:** a shield generator protects its holder's armies from bombardment and cuts the enemy's strikes to one. The spaceport is where Kessa's ships are built. Without the orbit, a side holding a third of a planet or less can't push out from the surface, and has to land again from space.
- **War score:** your share of the key sectors (capitals and spaceports). Hold 75% and you win. Drop under 30% and your income halves, so losing gets worse the longer it goes.
- **The hero battle:** a shield generator plain with two command posts, AI troopers and tanks on both sides, and the defender's turrets. Each side has tickets, and the side holding fewer posts bleeds them. Your hero has three lives. Their level carries over between battles, and losing all three lives sidelines them for three turns. You can also leave a battle to the AI from the briefing, or partway through.

## Run it

```
cd apps/two-fronts
bun install
bun run dev              # in the browser
bun run desktop:dev      # as a desktop app
bun test test            # the rules, the AI and the battle sim, headless
```

In battle: click the field to take control, WASD to move, the mouse to look, click to fire, Q for an orbital strike where you're aiming, E to get in or out of a tank, and Esc to let go of the mouse.

## How it's built

- `src/battle/contract.ts`: `BattleSpec` (what the map gives the battle) and `BattleResult` (what comes back). It's the only file both layers import.
- `src/war/`: the strategy layer. It's a deterministic rules engine over plain JSON (`rules.ts`), the map (`galaxy.ts`) and the AI (`ai.ts`). `resolveTurn` pauses on the hero battle's `BattleSpec`, and `applyBattleResult` finishes the turn.
- `src/battle/sim.ts`: the ground battle as a pure fixed-step simulation. The tests run it from a fixture spec with no strategy layer and no renderer. `view.ts` draws it in three.js and turns the keyboard and mouse into the hero's input.
- `src/main.ts`: the map, the orders panel, and the screens between them. The campaign is saved in the browser's localStorage.

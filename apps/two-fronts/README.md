# Two Fronts

> **What it proves:** a turn-based strategy engine and a three.js ground battle built apart and joined by two small JSON types, with no backend. One of the [Rusty Buns](../../README.md#see-it-work) examples.

The Wooka have pushed into the galaxy, and only the Thunder Marines stand in their way. The Marines are the good guys here: black armour with white trim, full-face helmets with snorkel masks on the front, and backpacks far too big for anyone, bristling with antennas. The Wooka are round and fluffy, about knee-high, with big black eyes that have nothing behind them and clubs built to maim. The radio keeps reminding you that they are not cuddly.

*Hold the line* drops you straight into the default fight: a Thunder Marine holding the shield generator against the horde in a redwood forest. *Be the horde* plays it from the other side, as a Wooka chieftain. The campaign wraps those fights in a galactic war you have to win on two fronts. Fleets fight for the orbit of each world and armies fight for its sectors. Once a turn, you pick one ground battle and play it yourself as a hero, in a third-person fight over command posts. This builds on the plan in [notes/game-ideas/2-two-fronts.md](../../notes/game-ideas/2-two-fronts.md).

- **The galaxy:** eight systems in three regions, the Thunder Marines (you) against the Wooka (the AI). Hold every capital in a region for its bonus. Most worlds are one capital. Kessa, on the front line, has three sectors: a shield generator, a spaceport and a capital. Lumen and Morrow, either side of the Narrows, each have an anti-ship cannon beside their capital.
- **A turn:** spend credits (ships at a spaceport, armies at a capital), order moves, then everything resolves at once. Space battles come first, then landings, then ground battles. Battles you don't play are settled with dice plus stats.
- **Orbit → ground:** troops can only land under your own orbit. An enemy orbit blockades a world, so nothing gets built there. In the hero battle, your orbit gives you drop-pod reinforcements and orbital strikes, and a fleet of two or more bombards enemy armies every turn.
- **Ground → orbit:** a shield generator protects its holder's armies from bombardment and cuts the enemy's strikes to one. An anti-ship cannon knocks a ship a turn out of an enemy fleet in its orbit, so a blockade over it doesn't last. The spaceport is where Kessa's ships are built. Without the orbit, a side holding a third of a planet or less can't push out from the surface, and has to land again from space.
- **Supply:** supply runs out from your capitals along the hyperlanes, through any system whose orbit the enemy doesn't hold. Armies past an enemy orbit are cut off and lose one a turn, down to a last one holding on.
- **War score:** your share of the key sectors (capitals and spaceports). Hold 75% and you win. Drop under 30% and your income halves, so losing gets worse the longer it goes.
- **The hero battle:** each kind of sector is its own map, all in a redwood forest: a shield generator clearing, a capital with three posts and the palace, a spaceport's landing pads and control tower, and a cannon battery. The trunks block movement, and the canopy is lost in the fog. The defender starts holding the last post, their keep, ringed by turrets, which for the Wooka are rock-chuckers. The Marines field troopers and tanks. The Wooka field a horde: more of them, fast, and dangerous only up close, with their share of the tanks coming as yet more Wooka. Each side has tickets, and the side holding fewer posts bleeds them. Your hero has three lives. Their level carries over between battles, and losing all three lives sidelines them for three turns. You can also leave a battle to the AI from the briefing, or partway through.

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
- `src/battle/sim.ts`: the ground battle as a pure fixed-step simulation, forest included. The tests run it from a fixture spec with no strategy layer and no renderer. `view.ts` draws it in three.js and turns the keyboard and mouse into the hero's input. `models.ts` builds the Marines, the Wooka, the vehicles and the forest from three.js primitives, so there are no assets to load or license.
- `src/main.ts`: the map, the orders panel, and the screens between them. The campaign is saved in the browser's localStorage.

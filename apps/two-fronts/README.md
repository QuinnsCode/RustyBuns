# Two Fronts

> **What it proves:** a turn-based strategy engine and three.js battles, on the ground and in orbit, built apart and joined by small JSON types, with no backend. One of the [Rusty Buns](../../README.md#see-it-work) examples.

The Wooka have pushed into the galaxy, and only the Thunder Marines stand in their way. The Marines are the good guys here: black armour with white trim, full-face helmets with snorkel masks on the front, and backpacks far too big for anyone, bristling with antennas. The Wooka are round and fluffy, about knee-high, with big black eyes that have nothing behind them and clubs built to maim. The radio keeps reminding you that they are not cuddly.

*Hold the line* drops you straight into the default fight: a Thunder Marine holding the shield generator against the horde in a redwood forest. *Be the horde* plays it from the other side, as a Wooka chieftain. 🚀 puts you in a fighter, holding an orbit against the Wooka fleet. The campaign wraps those fights in a galactic war you have to win on two fronts. Fleets fight for the orbit of each world and armies fight for its sectors. Once a turn, you pick one battle and play it yourself as a hero: a ground battle, in a third-person fight over command posts, or a space battle, in a fighter over the orbit. This builds on the plan in [notes/game-ideas/2-two-fronts.md](../../notes/game-ideas/2-two-fronts.md).

- **The galaxy:** the Thunder Marines (you) against the Wooka (the AI), on a map you pick when you start a new campaign. The short war is eight systems in three regions, an evening's play. The full campaign is thirty systems in seven regions, over several evenings: each side's two home regions, with the High Drift, the Narrows and the Ember Belt between them. Hold every capital in a region for its bonus. Most worlds are one capital. On the short map, Kessa, on the front line, has three sectors: a shield generator, a spaceport and a capital. Lumen and Morrow, either side of the Narrows, each have an anti-ship cannon beside their capital. The full map has eight multi-sector worlds: a shipyard homeworld for each side, a shipyard in each outer middle region, shield worlds either side of the Narrows, and a cannon world guarding each way into a home region. It's point-symmetric, so neither side starts with the better ground.
- **A turn:** spend credits (ships at a spaceport, armies at a capital), order moves, then everything resolves at once. Space battles come first, then landings, then ground battles. Battles you don't play are settled with dice plus stats. Pick ⚔ on a sector for its ground battle, or ⚔ on the orbit line for the space battle over the system.
- **Orbit → ground:** troops can only land under your own orbit. An enemy orbit blockades a world, so nothing gets built there. In the hero battle, your orbit gives you drop-pod reinforcements and orbital strikes, and a fleet of two or more bombards enemy armies every turn.
- **Ground → orbit:** a shield generator protects its holder's armies from bombardment and cuts the enemy's strikes to one. An anti-ship cannon knocks a ship a turn out of an enemy fleet in its orbit, so a blockade over it doesn't last. The spaceport is where Kessa's ships are built. Without the orbit, a side holding a third of a planet or less can't push out from the surface, and has to land again from space.
- **Supply:** supply runs out from your capitals along the hyperlanes, through any system whose orbit the enemy doesn't hold. Armies past an enemy orbit are cut off and lose one a turn, down to a last one holding on.
- **War score:** your share of the key sectors (capitals and spaceports). Hold 75% and you win. Drop under 30% and your income halves, so losing gets worse the longer it goes.
- **The hero battle:** each kind of sector is its own map, all in a redwood forest: a shield generator clearing, a capital with three posts and the palace, a spaceport's landing pads and control tower, and a cannon battery. The trunks block movement, and the canopy is lost in the fog. The defender starts holding the last post, their keep, ringed by turrets, which for the Wooka are rock-chuckers. The Marines field troopers and tanks. The Wooka field a horde: more of them, fast, and dangerous only up close, with their share of the tanks coming as yet more Wooka. Each side has tickets, and the side holding fewer posts bleeds them. Your hero has three lives. Their level carries over between battles, and losing all three lives sidelines them for three turns. You can also leave a battle to the AI from the briefing, or partway through.
- **The space battle:** each ship on the map is a cruiser over the planet, launching its wing of fighters: black darts with white trim for the Marines, hollowed-out logs with hide sails for the Wooka. Cruisers trade broadsides across the gap and shoot at fighters that come close. A third of the fighters fly bombing runs on the enemy cruisers and the rest dogfight. Lose every cruiser and you lose the orbit. At the time limit, the side with more hull left keeps it. Afterwards a cruiser under half its hull counts as lost, and then the turn's landings come down under whoever holds the orbit. The hero flies a fighter of their own, with three lives, like on the ground.

## Run it

```
cd apps/two-fronts
bun install
bun run dev              # in the browser
bun run desktop:dev      # as a desktop app
bun test test            # the rules, the AI and both battle sims, headless
```

In a ground battle: click the field to take control, WASD to move, the mouse to look, click to fire, Q for an orbital strike where you're aiming, E to get in or out of a tank, and Esc to let go of the mouse.

In a space battle: click to take the stick, the mouse to steer (the fighter turns after it), W to boost, S to brake, click to fire, and Esc to let go.

## How it's built

- `src/battle/contract.ts`: `BattleSpec` (what the map gives the battle) and `BattleResult` (what comes back), and `SpaceBattleSpec` and `SpaceBattleResult` for a fight over the orbit. It's the only file both layers import.
- `src/war/`: the strategy layer. It's a deterministic rules engine over plain JSON (`rules.ts`), the two maps (`galaxy.ts`, picked per campaign) and the AI (`ai.ts`). `resolveTurn` pauses on the hero battle's spec. `applyBattleResult` finishes the turn after a ground battle. After a space battle, `applySpaceResult` runs the landings and the ground battles still to come.
- `src/battle/sim.ts`: the ground battle as a pure fixed-step simulation, forest included. The tests run it from a fixture spec with no strategy layer and no renderer. `view.ts` draws it in three.js and turns the keyboard and mouse into the hero's input. `models.ts` builds the Marines, the Wooka, the vehicles, the forest and the ships from three.js primitives, so there are no assets to load or license.
- `src/battle/space.ts`: the space battle, again a pure fixed-step simulation tested headless. `space-view.ts` draws it, with a chase camera behind the hero's fighter.
- `src/main.ts`: the map, the orders panel, and the screens between them. The campaign is saved in the browser's localStorage.

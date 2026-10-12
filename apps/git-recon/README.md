# Git Recon

> **What it proves:** a repo can be a level. Real ground, a codebase laid onto it, and a third-person shooter played through it, all in the page with no backend (`world: false`). One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A toy-soldier third-person shooter, fought in a codebase. You're a smooth black pillar with a rifle. The repo's biggest folders are compounds in conflict, held by orange guards; its files are the buildings you fight around, and the bigger the file, the taller the building. Down a compound's guards and the folder is merged. Merge them all and you win.

- **Real ground or toy ground.** *El Capitan* is the valley floor under the big wall, from Park Hide & Seek's elevation data, shrunk eight times. *The Backyard* is authored the way Druids Curse builds terrain: rolling noise plus stamps (a sandbox, a deck, garden rows, a trench).
- **The weapons are git.** `git commit` is the rifle (never runs out), `git push` the bazooka (splash and a shove), `git merge` the grenade (lobbed, bounces), `git rebase -i` the sniper (right click to scope).
- **Soldier's moves.** Run, strafe, jump, crouch, and dive-roll: direct hits pass through you mid-roll. You can climb onto any file short enough to step or jump onto. Cliffs stop you.
- **Lives are the reflog.** Go down and you're back at the start, three times.

Built with [Three.js](https://threejs.org) and [Rusty Buns](../../README.md).

## Run it

```
cd apps/git-recon
bun install
bun run dev            # the browser
bun run desktop:dev    # the desktop app
bun test               # terrain, the repo mapping, movement, weapons, guards
```

| | |
|---|---|
| Move · aim | `WASD` · mouse (click the view to capture it) |
| Fire · scope | click · right click (rebase) |
| Dive-roll · jump · crouch | `Shift` · `Space` · `C` |
| Weapons | `1`-`4` or the wheel |

## How it works

- `src/sim/terrain.ts` is the ground: Park Hide & Seek's heightmap format, or Druids Curse's noise and stamps, and `withPads()` to cut a level shelf where a compound stands.
- `src/sim/codemap.ts` lays a repo onto the ground, like codeSplitter's code city lays repos onto streets. Files are grouped by folder (`apps/x` and `packages/x` count as their own); the biggest six become compounds, placed on flat ground you can walk to from the start, as far from each other as they fit. Their biggest files spiral out from a yard in the middle. Files from everywhere else are crates in the field.
- `src/sim/game.ts` is the whole game with no rendering: movement, shots, splash, the guards (they watch, spot you, wait a beat, then strafe and shoot in bursts) and the rules. `src/ui/` draws it in codeSplitter's paper style and feeds it the mouse and keys.

The repo is a snapshot: `bun scripts/snapshot.ts <repo-dir> <name>` writes the path and line count of its biggest tracked source files to `src/levels/repos/<name>.json`. The levels use this repo, Rusty Buns itself.

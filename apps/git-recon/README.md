# Git Recon

> **What it proves:** a repo can be a level. Real ground, a codebase laid onto it, and a third-person shooter played through it, all in the page with no backend (`world: false`). One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A toy-soldier third-person shooter, fought in a codebase. You're a smooth black pillar with a rifle. The repo's biggest folders are compounds in conflict, held by orange guards; its files are the buildings you fight around, and the bigger the file, the taller the building. Down a compound's guards and the folder is merged. Merge them all and you win.

- **Real ground or toy ground.** *El Capitan*, *Half Dome* and *Glacier Point* are Yosemite from Park Hide & Seek's elevation data, shrunk eight times. *The Backyard*, *The Kitchen Floor* (table and chair legs, a sink cabinet too sheer to climb) and *The Garden* (vegetable rows, a hose, a pond to wade) are authored the way Druids Curse builds terrain: rolling noise plus stamps.
- **Anywhere is a level.** Type a latitude, longitude on the menu and the page reads the ground there from AWS Terrain Tiles, decodes it itself, and keeps it in the browser for next time.
- **The weapons are git.** `git commit` is the rifle (never runs out), `git push` the bazooka (splash and a shove), `git merge` the grenade (lobbed, bounces), `git rebase -i` the sniper (right click to scope; the sight sways), `git cherry-pick` a round that homes on the guard nearest your aim, `git revert` sends a guard back where it was three seconds ago and makes it forget you, `git stash` throws down a box to hide behind that the guards shoot instead of you, `git blame` tags a guard so you see it through walls. `git reset --hard` is a rare crate: wherever it lands, that yard's guards all go down.
- **Crates.** Ammo and health crates sit by the files out in the field, and a taken yard drops one of each.
- **Soldier's moves.** Run, strafe, jump, crouch, go prone (`Z`: slow, steady, hard to spot), and dive-roll: direct hits pass through you mid-roll, strafe and roll to get sideways out from behind cover, and lying down it's a log roll. You can climb onto any file short enough to step or jump onto. Cliffs stop you.
- **Guards fight as squads.** Every other guard flanks round your side; they duck behind files when hit or reloading. A big compound has a heavy: slower, tougher, with a launcher.
- **Missions.** *El Capitan*: carry a commit from the farthest yard back to HEAD (go down and you drop it). *The Backyard*: defend main for two minutes while the compounds raid it in waves; guards standing on it overwrite it.
- **Sound.** Every weapon has its own synthesized voice, panned by where it was fired.
- **Lives are the reflog.** Go down and you're back at the start, three times.

Built with [Three.js](https://threejs.org) and [Rusty Buns](../../README.md).

## Run it

```
cd apps/git-recon
bun install
bun run dev            # the browser
bun run desktop:dev    # the desktop app
bun test               # terrain, the repo mapping, movement, weapons, crates, guards, missions
```

| | |
|---|---|
| Move · aim | `WASD` · mouse (click the view to capture it) |
| Fire · scope | click · right click (rebase) |
| Dive-roll · jump · crouch · prone | `Shift` · `Space` · `C` · `Z` |
| Weapons | `1`-`9` or the wheel |

## How it works

- `src/sim/terrain.ts` is the ground: Park Hide & Seek's heightmap format, or Druids Curse's noise and stamps with an optional water table, and `withPads()` to cut a level shelf where a compound stands.
- `src/levels/place.ts` turns a lat/long into that heightmap format in the page: it fetches the Terrarium tiles (they're served with `Access-Control-Allow-Origin: *`), inflates the PNGs with the browser's `DecompressionStream` and samples a 2 km square. The tests run it on a recorded tile.
- `src/sim/codemap.ts` lays a repo onto the ground, like codeSplitter's code city lays repos onto streets. Files are grouped by folder (`apps/x` and `packages/x` count as their own); the biggest six become compounds, placed on flat ground you can walk to from the start, as far from each other as they fit. Their biggest files spiral out from a yard in the middle. Files from everywhere else are crates in the field.
- `src/sim/weapons.ts` is the arsenal, one table row per git command: damage, splash, speed, gravity, ammo, homing, and an effect (revert, stash, blame, reset) that `game.ts` carries out where the round lands.
- `src/sim/game.ts` is the whole game with no rendering: movement and stances, shots, splash, crates, stashes, the guards (they watch, spot you or a stash, wait a beat, then hold or flank, shoot in bursts and take cover behind files) and the rules. Each guard keeps a three-second trail of where it has been, which is what `git revert` rewinds.
- `src/sim/missions.ts` says what wins each level (clear, carry or defend); `game.ts` keeps the mission's state in `objective`.
- `src/ui/` draws it in codeSplitter's paper style (contours spaced for each level's relief, rock faces hatched), feeds it the mouse and keys, and plays its events through `audio.ts`, a synthesized voice per weapon in Park Hide & Seek's style.

The repo is a snapshot: `bun scripts/snapshot.ts <repo-dir> <name>` writes the path and line count of its biggest tracked source files to `src/levels/repos/<name>.json`. The levels use this repo, Rusty Buns itself.

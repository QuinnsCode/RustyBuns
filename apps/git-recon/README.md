# Git Recon

> **What it proves:** a repo can be a level. Real ground, a codebase laid onto it, and a third-person shooter played through it, in the page on your own, or by up to 32 players in one battle that the desktop app hosts in its world and opens to the LAN, or online in a Durable Object per room. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A toy-soldier third-person shooter, fought in a codebase. You're a glossy black clay soldier with a rifle: pick a thick, average or lank build, and swap your head for a logo. The repo's biggest folders are compounds in conflict, held by orange guards; its files are the buildings you fight around, and the bigger the file, the taller the building. What it is decides its shape: code is a tower, a doc a house with a pitched roof, config a silo, a test a bunker under a slab, styles and assets a stepped stack. Down a compound's guards and the folder is merged. Merge them all and you win.

- **Real ground or toy ground.** *El Capitan*, *Half Dome* and *Glacier Point* are Yosemite from Park Hide & Seek's elevation data, shrunk eight times. *The Backyard*, *The Kitchen Floor* (table and chair legs, a sink cabinet too sheer to climb) and *The Garden* (vegetable rows, a hose, a pond to wade) are authored the way Druids Curse builds terrain: rolling noise plus stamps.
- **Anywhere is a level.** Type a latitude, longitude on the menu and the page reads the ground there from AWS Terrain Tiles, decodes it itself, and keeps it in the browser for next time. Pick *Anywhere* as a battle's level to host one there: the ground goes out with the setup, so nobody else has to fetch it.
- **The weapons are git.** The weapon list in the corner draws each one beside its command (no "git", since they all are). `git commit` is the rifle (always another magazine), `git add -A` the shotgun (nine pellets, brutal up close, nothing at range), `git fetch --all` the machine gun (hold it and it climbs off target; let go and it settles), `git clean -fdx` the flamethrower (ten metres of fire that sets guards running about alight; dive-roll or wade in to put yourself out), `git push` the bazooka (splash and a shove), `git merge` the grenade (lobbed, bounces), `git rebase -i` the sniper (right click to scope; the sight sways), `git cherry-pick` a round that homes on the guard nearest your aim, `git revert` sends a guard back where it was three seconds ago and makes it forget you, `git stash` throws down a box to hide behind that the guards shoot instead of you, `git blame` tags a guard so you see it through walls. `git reset --hard` is a rare crate: wherever it lands, that yard's guards all go down.
- **Magazines, not spam.** Every gun fires from a magazine and has to be reloaded (`R`, or it starts by itself when one runs dry): thirty rounds for `git commit`, six shells for `git add -A`, one rocket for `git push`. The crosshair rings round while a fresh one goes in, and the soldier dips the gun and reaches for it.
- **Roles.** You carry a role's kit, not everything: *Committer* (rifle, shotgun, grenades, a stash), *Maintainer* (machine gun, flamethrower, bazooka), *Reviewer* (sniper, homing rounds, revert, blame) or *Releaser* (shotgun, bazooka, grenades, fire). The first gun's spare magazines never run out; the rest come with what they come with, plus crates. Pick one on the menu or the results screen for the next round, or press `N` mid-fight to change it for your next life. In a battle everyone carries every gun.
- **The ground is the code.** It's printed with the repo's own source: the opening lines of its biggest files, each under an orange header with its path, in columns like a newspaper page, fading out on rock faces. A loaded GitHub repo prints its own.
- **Hills are hard work.** The steeper the slope, the slower you climb it (and a little quicker coming down); too steep to stand on and you slide back to the bottom. Guards slog up the same hills.
- **Things blow up.** Each yard has orange barrels of build artifacts that explode when shot and set off the ones beside them, a beat apart. A file that comes down goes up with a bang, bigger the bigger the file.
- **Killstreaks.** On your own, down 15 guards in a level and a buggy drops in beside you; 25 and it's an attack helicopter. `E` gets in and out. The buggy runs guards over, smashes files it hits at speed and has a gun on the roll bar that fires where you aim. The helicopter flies the way you look (`Space` climbs, `C` drops), with a chin gun on click and rockets on right click. Both take the hits meant for you, and when one is wrecked it blows up and throws you clear.
- **The files come down.** Every building is a file, and blasts, fire and bullets delete its lines: it sinks as it loses them, the crosshair reads how many are left, and one with none left bursts into paper chips and is gone. Cover wears away under fire, yours and theirs. The flamethrower burns a file down in a second.
- **Guns with weight.** Recoil kicks your aim up (less crouched, least prone) and the gun up in the soldier's hands, blasts shake the view, bullets draw as tracers, and the crosshair flashes on a hit and harder on a kill. Every git command has its own gun in the hands: a tube for `git push`, a drum for `git fetch --all`, a tank for `git clean -fdx`, a scope for `git rebase -i`.
- **A shield over your health.** It soaks hits first (an orange shimmer round you, a fizz), pops when it runs out, and four seconds after the last hit a band sweeps up you as it refills. A heavy has one too. An orange arc round the crosshair points at whoever hit you.
- **Drawn like a comic.** Glow vanishes on white paper, so the action is inked: muzzle flashes are orange starbursts, blasts are an orange core under inked puffs of smoke with a ring running out along the ground, and each one throws a quick orange light on what's near it. The soldiers carry an ink outline, and the shadows round you stay crisp.
- **Crates.** Ammo and health crates sit by the files out in the field, and a taken yard drops one of each.
- **Soldier's moves.** Run, strafe, jump, crouch, go prone (`Z`: slow, steady, hard to spot), and dive-roll: direct hits pass through you mid-roll, strafe and roll to get sideways out from behind cover, and lying down it's a log roll. You can climb onto any file short enough to step or jump onto. Cliffs stop you.
- **Guards fight as squads.** Every other guard flanks round your side; they duck behind files when hit or reloading. A big compound has a heavy: slower, tougher, with a launcher.
- **Missions.** *El Capitan*: carry a commit from the farthest yard back to HEAD (go down and you drop it). *The Backyard*: defend main for two minutes while the compounds raid it in waves; guards standing on it overwrite it.
- **Sound.** Every weapon has its own synthesized voice, panned by where it was fired.
- **Your soldier.** A soft clay mannequin: fat rounded limbs, a ball for a head, no face. It kneels to crouch, lies flat prone, balls up for a dive-roll, tucks a knee in a jump and dips on landing, flails when a blast throws it, and puts its hands up when it goes down. Poses blend into each other; it strafes with its legs going sideways and backs up with the stride reversed, leans into a run, leans back to aim up, and jolts away from a hit.
- **The camera.** Over your right shoulder: aim is instant, but the camera eases after your body through a crouch or going prone, dips when you land, and widens while you run and in a dive-roll. The head is a slot: the plain ball, or a white block with a logo on its four sides (`src/ui/heads.ts`; a logo is a row there and an image in `public/heads/`). Builds are looks only, with one hitbox for all.
- **Lives are the reflog.** Go down and you're back at the start, three times.
- **Battles.** Up to 32 players in one repo. *Side by side* is everyone against the guards on the level's mission; *Free-for-all* is first to 15 downs; *Teams* puts ours at HEAD and theirs at the far end, first side to 30, with the guards shooting at both. Battles run ten minutes, you're back three seconds after going down, and the next round starts on the same repo. Each player wears their own head and build; theirs are slate. Hold `Tab` for the scoreboard. Host one from the desktop app's menu (it shows an address and passphrase to give friends on your network), or Join someone's.
- **Fight any repo.** Type `owner/repo` on the menu and any public GitHub repo becomes the level, read in the browser at play time.
- **A richer map.** Folders that import each other are joined by roads. A folder that changed a lot lately holds more guards. Files agents mostly wrote are black glass, not paper. A failing check sets its folder's compound on fire until you merge it.
- **Toy heads.** Besides the ball and the logo blocks, every level you win (a level on a repo you haven't won it on) unlocks a toy head for the neck slot. They're our own designs, nods to the dev tools and platforms developers build and ship on (no AI labs): no traced logos, no real faces.

| Head | A nod to |
|---|---|
| Steamed bun | Bun |
| Orange cloud | Cloudflare |
| Black pyramid | Vercel |
| Hedgehog | PostHog |
| Watchtower | Sentry |
| Orange bucket | AWS |
| Magnifying glass | Google Cloud |
| Little terminal | opencode |
| Chunky pi | pi |
| Many-armed cat | GitHub |
| Whale with cargo | Docker |
| Hot-air balloon | Fly.io |

Built with [Three.js](https://threejs.org) and [Rusty Buns](../../README.md).

## Run it

```
cd apps/git-recon
bun install
bun run dev            # the browser
bun run desktop:dev    # the desktop app
bun test               # terrain, the repo mapping, live loading, heads, movement, weapons, crates, guards, missions, battles
```

A battle in dev: `bun run battle` serves the world on 127.0.0.1:4180 (Vite proxies `/ws` to it), then `bun run dev`. Host in one tab and Join with no address in another: each tab is its own player.

### Battles online

`bun run edge:dev` runs the browser build behind a Cloudflare Worker locally (`wrangler dev`); `bun run deploy` deploys it. `src/edge/worker.ts` serves the page and sends `/ws?room=CODE` to that room's Durable Object, the same `World` class the desktop hosts. The Worker vouches each player's id and name, refuses WebSockets from other sites and limits how many new rooms one address opens a minute (per isolate: a speed bump, not a quota). Online the menu deals in room codes: Host makes one and puts it in the link (`?room=CODE`) to send friends; Join takes one. Everyone is a guest, so whoever picks the battle first owns the room and only they can pick again. The page sends the repo with its pick; a load keeps at most 360 files and 24 excerpts, so even a big repo's setup is about 220 KB at most, well within the world's 1 MB cap (`tests/edge.test.ts` checks the worst case).

What a room costs (Workers Paid, priced 2026-10-12 from [Cloudflare's DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)): the world steps 20 times a second while anyone's in, so the object never hibernates and is billed for 128 MB the whole time: 460.8 GB-s an hour, $0.0058 at $12.50 per million GB-s. Each player's inputs come in about 30 a second, billed at 20:1 as requests: 5,400 an hour, $0.0008 at $0.15 per million. Snapshots going out (binary deltas, about 16 KB/s a player) aren't billed: outgoing messages and Workers bandwidth are free. So a full room of 32 is about **$0.03 an hour**, and the plan's included 400,000 GB-s and 1M requests cover about 870 room-hours and 185 player-hours a month. A room ends once everyone has left, and closes after five minutes with no input from anyone, so a tab left open in the background doesn't keep one billed.

| | |
|---|---|
| Move · aim | `WASD` · mouse (click the view to capture it) |
| Fire · scope | click · right click (rebase) |
| Dive-roll · jump · crouch · prone | `Shift` · `Space` · `C` · `Z` |
| Weapons · reload | `1`-`9`, `0`, `-`, `=` or the wheel (your role's guns; all of them in a battle) · `R` |
| Role for your next life | `N` |
| Get in or out of a vehicle | `E` (helicopter: `Space` up, `C` down, right click rockets) |
| Scoreboard · leave a battle | `Tab` · `Q` (with the mouse let go) |

## How it works

- `src/sim/terrain.ts` is the ground: Park Hide & Seek's heightmap format, or Druids Curse's noise and stamps with an optional water table, and `withPads()` to cut a level shelf where a compound stands.
- `src/levels/place.ts` turns a lat/long into that heightmap format in the page: it fetches the Terrarium tiles (they're served with `Access-Control-Allow-Origin: *`), inflates the PNGs with the browser's `DecompressionStream` and samples a 2 km square. The tests run it on a recorded tile.
- `src/sim/codemap.ts` lays a repo onto the ground, like codeSplitter's code city lays repos onto streets. Files are grouped by folder (`apps/x` and `packages/x` count as their own); the biggest six become compounds, placed on flat ground you can walk to from the start, as far from each other as they fit. Their biggest files spiral out from a yard in the middle. Files from everywhere else are crates in the field. Imports between compounds become roads, a folder's share of recent changes adds up to two guards, a file whose recent commits were mostly agents' is glass, and a failing check whose name has a folder's name in it sets that compound on fire.
- `src/sim/intel.ts` works out what a snapshot knows besides sizes: imports between folders (relative ones, and workspace packages by their `package.json` name), churn per file over recent commits, and which of those an agent made (a `Co-Authored-By` trailer or a bot author).
- `src/levels/github.ts` loads any public repo: the repo, its last ten commits and their files, its tree, the check runs at the tip (about a dozen of the 60 API calls an hour GitHub gives a browser), plus the biggest scripts' text from `raw.githubusercontent.com` for imports. A load is kept in the browser for half an hour.
- `src/sim/heads.ts` lists the toy heads and what unlocks them; `src/ui/characters.ts` builds each from a few primitives, and `src/ui/heads.ts` puts them after the plain and logo heads on the menu.
- `src/sim/weapons.ts` is the arsenal, one table row per git command: damage, splash, speed, gravity, ammo, homing, pellets, bloom, burn, how hard it wrecks files, recoil, and an effect (revert, stash, blame, reset) that `game.ts` carries out where the round lands.
- `src/sim/game.ts` is the whole game with no rendering: movement and stances, shots, splash, files losing lines and coming down, burning, crates, stashes, the guards (they watch, spot you or a stash, wait a beat, then hold or flank, shoot in bursts and take cover behind files) and the rules. Each guard keeps a three-second trail of where it has been, which is what `git revert` rewinds.
- `src/sim/roles.ts` is the four kits; `Game.arm()` hands one out, and a respawn takes up the role picked for the next life.
- `src/sim/vehicles.ts` is the killstreak vehicles' numbers; `game.ts` drops them, drives them (a buggy steers like a car on the ground, a helicopter strafes where you look within a ceiling over the ground) and routes hits on the driver to the vehicle.
- A battle is the same `Game` with a mode (`coop`, `ffa` or `teams`): players join after the guards and take a left player's slot, guards go for the nearest player they can see, `hostile()` says who hurts whom, and downs score.
- `src/net/room.ts` runs a battle with no sockets: it keeps each player's latest input (and any tap since the last step, so a quick click still fires), steps the game, and packs each player a snapshot of only what's within 90 m of them (the events every round makes, too), as a delta against the last snapshot that player acked: only the soldiers that changed, and only their fields that did; a round in flight once, then again only if it strays from the line the page flies it on. `src/net/wire.ts` is what crosses the socket: the welcome as JSON, snapshots as binary frames. On a 32-player test a delta averages under 1 KB, about 16 KB/s a player (the JSON snapshots before were about 3 KB, 60 KB/s). The page acks with each input. `src/net/world.ts` is the room as a Durable Object-shaped world: the host player's page sends the setup (level, mode, repo, and a lat/long level's ground, checked to be n*n heights on a real place), everyone joining gets it in their welcome and builds the same map, then the world steps and sends snapshots 20 times a second. On a 32-player test a second of battle steps and packs in well under a second of CPU.
- Online, `src/edge/worker.ts` is the Worker in front of a `World` Durable Object per room code, and `ONLINE` in `wrangler.jsonc` turns on the world's online rules (first to pick owns the room, idle rooms close). See [Battles online](#battles-online).
- `src/net/mirror.ts` is the page's copy of a battle: everyone else is drawn 100 ms behind the newest snapshot, eased between the two either side; your own soldier moves on your keys at once (`Game.predict`) and is pulled back only as far as it drifts past what the lag explains, or jumps back if it's more than 3 m off. Shots are the world's call. It keeps the frames it built from recent snapshots, since the next delta builds on one of them. `src/ui/net.ts` is the socket, and `src/host/host.ts` tells the page this machine's LAN address.
- `src/sim/missions.ts` says what wins each level (clear, carry or defend); `game.ts` keeps the mission's state in `objective`.
- `src/ui/figure.ts` builds the soldiers from rounded limbs on joints (inked by pushing each mesh's back faces out along its normals) and poses them from what each one is doing: stance, how it's moving against where it faces, recoil, a hit's jolt, a landing. Given a blend rate it eases every joint towards the pose, so moves flow into each other; `tests/figure.test.ts` checks the poses land where they should.
- `src/ui/` draws it in codeSplitter's paper style (contours spaced for each level's relief, rock faces hatched), feeds it the mouse and keys, and plays its events through `audio.ts`, a synthesized voice per weapon in Park Hide & Seek's style.

The repo is a snapshot: `bun scripts/snapshot.ts <repo-dir> <name>` writes the path and line count of its biggest tracked source files to `src/levels/repos/<name>.json`, with the imports between folders, the last hundred commits' churn, and the opening lines of the biggest scripts (`excerpts()` in `src/sim/intel.ts`) that the ground is printed with. The levels use this repo, Rusty Buns itself.

# Examples

Games, music makers and 3D tools you can run on your own computer. Pick one, paste two lines into the terminal, and it opens in a window.

(These live in `apps/`. They are not part of any published package: installing `@rustybuns/cli` never downloads them.)

## Before your first app (do this once)

1. **Install Bun** (the program that runs everything). Paste this into the terminal and press Enter:
   ```
   curl -fsSL https://bun.sh/install | bash
   ```
   Then close the terminal and open a new one.
2. **Get the code and set it up:**
   ```
   git clone https://github.com/QuinnsCode/RustyBuns.git
   cd RustyBuns
   bun install
   ```

That's it. Now pick an app.

## How every app works

- **Start:** paste the lines under **Start it**, from the `RustyBuns` folder. A window opens by itself.
- **Stop:** click the terminal and press <kbd>Ctrl</kbd> + <kbd>C</kbd>.
- **Try a different app:** type `cd ../..` to go back to the `RustyBuns` folder, then start the next one.
- **Stuck?** Every app has a **Full guide** link with all the details.

## Pick one

| App | What you do | Setup |
|---|---|---|
| [Hippo Tycoon](#hippo-tycoon) | Be a greedy hippo and chomp the most oil money | ⭐ Easy |
| [Park Hide & Seek](#park-hide--seek) | Hide from park rangers in real Yosemite, or be the ranger | ⭐ Easy |
| [Splat Spray](#splat-spray) | Find hidden things in a pitch-dark room with a scanner | ⭐ Easy |
| [FM Groovebox](#fm-groovebox-fm-daw) | Make beats and songs with your computer keyboard | ⭐ Easy |
| [Auto Rig](#auto-rig) | Give a 3D model bones, then pose it like a puppet | ⭐ Easy |
| [Motion MIDI](#motion-midi) | Press play and race two music engines | ⭐ Easy |
| [Splat Desktop](#splat-desktop) | Edit 3D scans of real places | ⭐⭐ Takes a minute |
| [tscircuit Desktop](#tscircuit-desktop) | Design real circuit boards | ⭐⭐⭐ Needs Rust |
| [Splat Rooms](#splat-rooms) | Hunt objects in photo-real 3D rooms | ⭐⭐⭐ Needs a grown-up account |
| [Agent Office](#agent-office) | Run a 3D office where AI helpers write code at desks | ⭐⭐⭐ Needs a grown-up's Claude account |

---

## Hippo Tycoon

**Four angry, greedy hippos around a pan of oil. Slide, chomp the drops, get rich.** Black oil is $1M and gold is $3M. Dodge the brown sludge and the spiky bolts.

![Four hippos chomping oil drops in the pan](apps/hippo-tycoon/docs/gulp.gif)

**Start it:**
```
cd apps/hippo-tycoon
bun run desktop:dev
```

| Do this | Player 1 | Player 2 |
|---|---|---|
| Slide left / right | <kbd>A</kbd> / <kbd>D</kbd> | <kbd>←</kbd> / <kbd>→</kbd> |
| Chomp | <kbd>W</kbd> or <kbd>Space</kbd> | <kbd>↑</kbd> or <kbd>Enter</kbd> |
| Bellow (scare the others) | <kbd>Q</kbd> | <kbd>/</kbd> |

Gamepads work too.

**Menu:** the game opens on it. Pick **Solo** to play against 3 bots, or **Couch** to share one keyboard with friends. Change the bot difficulty and round length there too. During a game, click **Menu** at the top to go back. **Host a LAN game** lets friends on the same Wi-Fi join from their own computers.

[Full guide →](apps/hippo-tycoon/README.md)

## Park Hide & Seek

**Hide and seek in a real national park.** Campers drop in and hide. Park rangers hunt them with flashlights, and at night it gets spooky.

**Start it:**
```
cd apps/park-hide-seek
bun run desktop:dev
```

| Do this | Keys |
|---|---|
| Move / run | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / hold <kbd>Shift</kbd> |
| Look around | Click the game, then move the mouse (<kbd>Esc</kbd> gets your mouse back) |
| Crouch (hide in a bush) | <kbd>C</kbd> |
| First person / third person | <kbd>V</kbd> |
| Map | <kbd>M</kbd> |
| Ranger only: flashlight / call out | <kbd>F</kbd> / <kbd>Q</kbd> |
| Watch someone else after you're caught | <kbd>Tab</kbd> |

**Menu:** type your name and press **Play vs AI**. In the lobby, dress up your camper, pick a place and a time of day (try **Night**), then press **Start the hunt**. The keys are always shown at the bottom of the screen during a game.

[Full guide →](apps/park-hide-seek/README.md)

## Splat Spray

**Like I Spy in the dark.** A kid's room with 100 things in it is totally black. Every shot from your scanner lights up a few dots. Find the thing it asks for in the fewest shots.

**Start it:**
```
cd apps/splat-spray
bun run desktop:dev
```

| Do this | Keys |
|---|---|
| Scan (shoot dots) | Hold the left mouse button |
| Look around | Right-click and drag, or the arrow keys |
| Pick the thing you found | Hold <kbd>Shift</kbd> and click |
| Next round | <kbd>Space</kbd> |

**Menu:** there isn't one. You start playing right away, and the banner at the top tells you what to find. The **Pick mode** button does the same thing as holding <kbd>Shift</kbd>.

[Full guide →](apps/splat-spray/README.md)

## FM Groovebox (fm-daw)

**Make a beat.** Five drums and three synths, a grid to click in beats, and your computer keyboard turns into a piano. **Turn your speakers down first!**

**Start it:**
```
cd apps/fm-daw
bun run desktop:dev
```

| Do this | Keys |
|---|---|
| Play / stop | <kbd>Space</kbd> |
| Play notes like a piano | The middle row of letters, <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd>… (the row above is the black keys) |
| Lower / higher notes | <kbd>Z</kbd> / <kbd>X</kbd> |
| Pick an instrument | <kbd>1</kbd> to <kbd>8</kbd> |
| Record | <kbd>R</kbd> |
| Undo | <kbd>⌘</kbd> + <kbd>Z</kbd> (<kbd>Ctrl</kbd> + <kbd>Z</kbd> on Windows) |
| **Too loud? Stop everything!** | <kbd>Esc</kbd> |

On drums, click squares in the grid to add hits. On synths, drag to draw notes.

**Menu:** there isn't one. Click past the "speakers down" screen and press <kbd>Space</kbd> to hear the demo song.

[Full guide →](apps/fm-daw/README.md)

## Auto Rig

**Give a 3D model a skeleton, then pose it like a puppet.** It works out where the arms, legs and head are all by itself.

**Start it:**
```
cd apps/auto-rig
bun run desktop:dev
```

| Do this | How |
|---|---|
| Move a hand or foot | Click a dot on the model, then drag the arrows |
| Let the whole body move | Uncheck **Pin the root** |
| Make two hands hold each other | Click one hand, then <kbd>Shift</kbd> + click the other |

**Menu:** it starts on a gingerbread man that's already rigged. The panel on the side has more models (try **Fox**) and **Race the engines**, which shows the Rust and TypeScript versions racing. Drag in your own `.glb` model file to rig it.

[Full guide →](apps/auto-rig/README.md)

## Motion MIDI

**A synthesizer built twice, once in Rust and once in TypeScript.** Press play to hear a song, then see which one is faster.

**Start it:**
```
cd apps/motion-midi
bun run desktop:dev
```

**Controls:** click **Render and play**, then click **Compare engines**. That's the whole app!

[Full guide →](apps/motion-midi/README.md)

## Splat Desktop

**A 3D editor for "splats"** (3D scans of real places and things). Clean them up, recolor them, and save them.

**Start it** (the first time takes a minute or two):
```
cd apps/splat-desktop
bun scripts/make-test-splat.ts ~/Splats/ring.ply
bun run desktop:dev
```

**Controls:** click **Open folder…**, pick the `Splats` folder in your home folder, then click a scene to edit it. Use Chrome or Edge.

**Menu:** once a scene is open, you're in the full SuperSplat editor, and its menus are at the top.

[Full guide →](apps/splat-desktop/README.md)

## tscircuit Desktop

**Design real electronic circuit boards with code**, see them in 3D, and export the files a factory needs to make them.

**Needs Rust first.** Install it from [rustup.rs](https://rustup.rs), then:
```
cd apps/tscircuit-desktop
bun native/build.ts
bun run desktop:dev
```

**Controls:** open the `fixtures` folder inside `apps/tscircuit-desktop` to see a sample board. <kbd>⌘</kbd> + <kbd>S</kbd> (<kbd>Ctrl</kbd> + <kbd>S</kbd> on Windows) saves. Click **Compare engines** to race Rust and TypeScript on your board.

[Full guide →](apps/tscircuit-desktop/README.md)

## Splat Rooms

**Hunt objects in photo-real rooms, in the dark.** Each shot lights up a patch of the room.

**Needs a grown-up:** the rooms come from a dataset that needs a free Hugging Face account and token. See the [full guide](apps/splat-rooms/README.md) for setup, then:
```
cd apps/splat-rooms
bun scripts/fetch-scenes.ts --next 3
bun run desktop:dev
```

| Do this | Keys |
|---|---|
| Look around | Drag the mouse |
| Shoot one splat / spray twenty | <kbd>Space</kbd> / <kbd>Shift</kbd> + <kbd>Space</kbd> |
| Pause | <kbd>Esc</kbd> |

**Menu:** the app opens on it. **How to play** has all the controls. **Quick hunt** drops you in a random room.

## Agent Office

**The cartoon office that helped build Rusty Buns, as one file.** AI helpers sit at desks and write code while you walk around and watch their screens.

**Needs a grown-up:** the helpers are [Claude Code](https://claude.com/claude-code), so someone has to be signed in to it first. Then:
```
cd apps/agent-office
bun run office
```

| Do this | Keys |
|---|---|
| Walk / run | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / hold <kbd>Shift</kbd> |
| Hire a helper, open its screen, ride the elevator | Walk up and press <kbd>E</kbd> |
| Give a helper a job | <kbd>P</kbd> |
| Close a window | <kbd>Esc</kbd> |

**Menu:** <kbd>Tab</kbd> opens it. The first time, the office shows its password once (write it down), then asks you to ride the elevator and add a project. `bun run desktop:build` makes the one-file version.

[Full guide →](apps/agent-office/README.md)

---

## For developers: what each example shows

| Example | Shows | Install size |
|---------|-------|--------------|
| [tscircuit desktop](apps/tscircuit-desktop/README.md) | A real, heavy Vite app as one self-contained binary, with a Rust engine and a TypeScript fallback | Large (the tscircuit toolchain) |
| [fm-daw](apps/fm-daw/README.md) | An FM groovebox: Rust as wasm in the audio thread, the same crate over FFI on the host, a world DO that saves the project | Small |
| [hippo-tycoon](apps/hippo-tycoon/README.md) | A four-player arcade game: solo, couch, LAN party and online rooms from one codebase; the room is a Durable Object on Cloudflare and runs in-process in the binary | Small (three.js) |
| [auto-rig](apps/auto-rig/README.md) | Drop in a model, get a skeleton, skin weights and draggable closed-chain IK; the rigger in Rust and TypeScript with identical results | Small |
| [park-hide-seek](apps/park-hide-seek/README.md) | 3D hide and seek on real Yosemite terrain: campers vs park rangers, vs AI bots or with friends on a LAN | Small |
| [agent-office](apps/agent-office/README.md) | Someone else's Node server (PTYs, WebSockets, a 3D client) as one binary for macOS and Linux: a native addon swapped for Bun's PTY, assets embedded, nothing forked | Medium (downloads the release) |
| [spa-example](apps/spa-example) | An RWSDK / Cloudflare app on the desktop: a world Durable Object, D1 and KV on sqlite | Small |
| [example](apps/example) | Worker mode, plus a probe for the sample Rust crate in `native/crates/rb_hello` | Small |

For demo scripts, the optional Rust engines and troubleshooting, see [DEMO.md](DEMO.md).

### tscircuit desktop

- **Build with Bun, ship without it.** The binary carries the UI, the backend, and both engines.
- **Two engines, same answers.** Rust is up to 22x faster on large boards; TypeScript takes over if Rust can't load.
- **Uses:** a plain Vite app (no Cloudflare), `desktop.host` for backend routes, `desktop.native` to embed a Rust library, `desktop.headers` for CDN assets.

### fm-daw

- **One Rust crate, two builds.** `wasm32` renders live audio in the AudioWorklet; the cdylib runs on the host over `bun:ffi`. Both match the TypeScript engine bit for bit, and you can switch engines mid-groove. `bun run build:native` builds them (optional).
- **Speaker-safe by construction.** Params are clamped in the engine and a limiter holds every sample under −1 dBFS; the tests try to break it.
- **Uses:** spa mode with a world (`desktop.world`) that saves the project to sqlite, `"use server"` actions for bounces, and the same world class as a Durable Object for shared jam rooms on Cloudflare.

### auto-rig

- **Rigging from geometry alone.** Voxelize, take geodesic slices from the thickest point (a Reeb graph), then bind skin weights by voxel distance.
- **Two engines, identical rigs.** The Rust cdylib (over bun:ffi, built by the optional `bun run build:native`) and the TypeScript twin agree bit for bit. *Race the engines* times both.
- **Uses:** a `"use server"` action that calls `desktop.native`, a Web Worker fallback in the plain browser, and [closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js) for the IK.

### hippo-tycoon

- **One world, two homes.** The room is a single class: a Durable Object per room code on Cloudflare, and the same class in-process in the desktop binary, where `desktop.guests` opens it to friends on the LAN.
- **A game with no assets.** The hippos, the town and the drops are three.js primitives, the textures are drawn at startup and the sounds are synthesised.
- **Uses:** `desktop.world`, `desktop.guests`, `/__rb/host` and `/__rb/info` (with the host's LAN addresses), a Worker that vouches identity, a pure deterministic sim with a test that holds it to that.

### park-hide-seek

- **One game, two hosts.** Single player runs the game in the page; a LAN game runs the same code in the world.
- **Each player is sent only what they could see:** the host checks light, range and line of sight past terrain and props, so a ranger's client never receives a hidden camper. Bots play from the same views.
- **Uses:** spa mode with a world class, `guests` opened and closed at runtime with `POST /__rb/host`, `worldSocket()` for guests, and a `desktop.host` route for the LAN address.

### spa-example

An RWSDK app boxed for the desktop: its world Durable Object runs in-process, D1 and KV run on sqlite, and the client connects over the same WebSocket it uses on Cloudflare.

### example

The framework's worker-mode test app: the full Worker bundle running under Bun, with a native probe that loads the sample Rust crate.

## Coming next

A minimal `vite-desktop` template: the smallest app that shows every piece (a Vite page, a host route, and a Rust function with a TypeScript fallback). It installs and builds in seconds, and it's the one to copy.

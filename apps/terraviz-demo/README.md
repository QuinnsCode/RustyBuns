# TerraViz demo

> **What it proves:** someone else's Cloudflare Pages app (a 3D globe with about 100 API routes, D1, KV, R2 and Vectorize) runs on Rusty Buns with none of its code changed. One of the [Rusty Buns](../../README.md#see-it-work) examples.

## Credit

**TerraViz is not ours.** It is built by [The Zyra Project](https://github.com/zyra-project/terraviz), led by Eric Hackathorn ([@Hackshaven](https://github.com/Hackshaven), NOAA Global Systems Laboratory). It brings NOAA's Science On a Sphere datasets to any browser on a 3D globe. The live site is [terraviz.zyra-project.org](https://terraviz.zyra-project.org/). If you use TerraViz, cite it the way its [CITATION.cff](https://github.com/zyra-project/terraviz/blob/main/CITATION.cff) asks (DOI [10.5281/zenodo.20043181](https://doi.org/10.5281/zenodo.20043181)).

This folder is **only a demonstration** of how Rusty Buns maps an existing app onto its primitives. It is not a fork, not a release of TerraViz, and not endorsed by The Zyra Project. No TerraViz file is copied into this repo: [`run.ts`](run.ts) clones the upstream repo onto your machine and runs it there.

## License

TerraViz is licensed under the [Apache License 2.0](https://github.com/zyra-project/terraviz/blob/main/LICENSE). Its [NOTICE](https://github.com/zyra-project/terraviz/blob/main/NOTICE) reads:

```
TerraViz
Copyright 2026 The Zyra Project

This product includes software developed by The Zyra Project
(https://github.com/zyra-project/terraviz).
```

What that means here:

- **Running it from a clone, as this demo does,** needs nothing more than the credit above.
- **Handing someone a TerraViz binary** counts as redistributing their code. Section 4 of the license then requires their LICENSE and NOTICE to ship with it, and a note that `rustybuns init` added `rustybuns.config.ts`. We don't publish TerraViz binaries.
- **The name "TerraViz"** is used only to say where the app comes from. Apache 2.0 grants no trademark rights, and TerraViz's GOVERNANCE.md leaves its name and marks unresolved.
- **Its images and data** (NASA GIBS imagery, NOAA datasets, the skybox) keep their own terms. TerraViz's repo doesn't credit the skybox images, which is one more reason not to repackage them.

## Run it

You need [Bun](https://bun.sh) 1.4+, git and npm. From the repo root:

```
bun install
bun apps/terraviz-demo/run.ts
```

The first run takes a few minutes. The [trial harness](../../scripts/trial-github.ts) clones TerraViz, fetches its Git LFS images and installs its packages. It then runs `rustybuns init`, builds it and boots it once to check it serves. After that, `run.ts` starts the host and prints a link to open. The clone lives in `~/rustybuns-demos/terraviz`, outside this repo. On a Mac the host runs in the trial's sandbox with the network open: no Cloudflare credentials, nothing read from your home folder but the demo's own. (The network has to be open: the globe's imagery comes from NASA GIBS through TerraViz's own `/api/tile` proxy inside the Worker, and the offline profile left the page on "Loading Earth textures" forever.)

Up and down, in one line each:

| | |
|---|---|
| `bun apps/terraviz-demo/run.ts --shared` | the demo to show: TerraViz plus Shared Sphere (below) |
| `bun apps/terraviz-demo/run.ts --shared --binary` | the one-file desktop app, built from the same config, with its path printed. Keep it on this machine: handing it out redistributes TerraViz (see License) |
| `bun apps/terraviz-demo/run.ts --port 4710` | a fixed port; `RB_TOKEN=...` a fixed launch token, so a second window or a test knows the link |
| `bun apps/terraviz-demo/run.ts --fresh` | clone TerraViz's latest again (a newer commit may need a fix on our side) |
| `bun apps/terraviz-demo/run.ts --down` | tear it all down: clone, data, sandbox profiles and logs. Nothing else on the machine changed |

Ctrl-C stops the host; so does killing `run.ts`, which takes the host with it.

## What Rusty Buns gives it, with no edits

- **Pages Functions as a Worker.** `init` spots `functions/` and generates a router in front of TerraViz's handlers, which run unchanged ([#2153](https://github.com/QuinnsCode/RustyBuns/pull/2153)).
- **Every binding has a local twin.** Both D1 databases (about 37 migrations), KV, R2, Vectorize and Analytics Engine run on sqlite on your machine, so it runs without a Cloudflare account.
- **A one-file desktop app.** `rustybuns build desktop` makes a single binary, with TerraViz's source maps left out.
- **The same config deploys to the edge.** The `rustybuns.config.ts` that `init` wrote also describes TerraViz's Cloudflare resources, and `rustybuns plan` prices them before anything is created.

Tried on upstream commit `8cdbb2c` (2026-10-22). TerraViz moves fast, so a newer commit may need a fix on our side. If it does, that's a Rusty Buns gap, not a TerraViz bug.

## Shared Sphere: everyone on one globe

Rusty Buns' first addition to TerraViz rather than a port of it: `bun apps/terraviz-demo/run.ts --shared` boots the same app with the people in the room on the globe. Open the link in a second window (or another browser profile), add `?room=class-7b&name=Ada` to pick a room and a name, and:

- **Everyone's pointer shows on everyone's globe**, as a coloured dot with their name, hidden when it's round the back.
- **Anyone can press Lead.** The others' globes follow the lead's camera and load the lead's dataset with TerraViz's own loader, the way a docent drives a Science On a Sphere room. A follower who drags their own globe stops following, and one click picks the lead back up. Anyone can take the lead; it's a classroom, not a contest.

### Teach a class: one globe, one pair of hands

Add `&teach=<word>` to your own link (`?room=class-7b&teach=apple`) and give the class the link without it. The first word a room hears locks it: you lead the moment you arrive, students see "following Ms Ada (teacher)", and nobody else's Lead works, so no student can steer the teacher's globe. A student may still press **Look around** to explore their own globe and **Follow** to come back. Reload your page with the same word and you are the teacher again; a second person with the word is a co-teacher. **Open room** lets the lock go, and anyone may lead again.

### Tours in step: the slideshow

TerraViz plays Science On a Sphere tour scripts (`tourTasks` JSON: captions, fly-tos, datasets, pauses), and ships two in its catalog. When the lead starts one, every follower's TerraViz plays the same script with its own engine: captions, flights and dataset loads happen on each globe, and the lead's next, previous, pause and stop reach everyone within a quarter of a second. A student in a taught room has no tour strip; the teacher's is the one that counts. A late joiner lands on the lead's slide.

Our own scripts live in [`content/`](content) ([`three-places.json`](content/three-places.json) is a four-stop walk with no datasets, so it plays on a node that has published nothing). `bun run cms` in this folder opens them in the same editor the games use for their words (now with numbers and lists of stops, so a caption or a latitude is a textarea away); restart `run.ts --shared` and the Worker carries the new text. Start one with `?tour=three-places` on your link, or `window.sphere.tour("three-places")`. A full URL works too: `window.sphere.tour("/assets/test-tour.json")` plays TerraViz's Climate Connections. `window.sphere.tours()` lists ours.

### The Rust reader: a tour as slides

The panel's "slide 3 of 5 · The Great Barrier Reef" comes from [`wasm/`](wasm), a small Rust crate (`sphere_tour`) that reads a tour script into slides (the run of tasks up to each pause: its first caption, dataset, fly-to and hold) and says what is wrong with one (`flyTo` off the globe, a `hideRect` that hides nothing, a `pauseSec` without seconds). The Worker serves it as wasm beside the page script, and `window.sphere.slides()` shows what it read. The crate is plain Rust with JSON in and JSON out, so the same file drops into a Rust app as a dependency: TerraViz's own desktop is Tauri, which is where a tour linter would sit if its authors want one. `bun run wasm` rebuilds it (cargo and wasm-pack; the output is checked in, CI never compiles it), `cargo test` in `wasm/` runs its own tests.

**Jump to a state** (for a hands-on check): add `?dataset=<id>&lon=139.7&lat=35.7&zoom=3&lead=1&tour=<name>` to the link, any of them, and the page loads that dataset with TerraViz's own loader, puts the camera there, takes the lead once the room is joined and starts the tour. `window.sphere.jump({ dataset, lon, lat, zoom, bearing, pitch, lead, tour })` does the same from the console or an agent's browser, and `window.sphere.state()` says the room, dataset, whether you lead or follow, whether the room is locked, and the tour's slide.

Still no TerraViz file changes. [`sphere/`](sphere) wraps TerraViz's generated Worker: one path goes to a `SphereRoom` Durable Object per room, a few serve the page script, the reader and the tours, and every HTML page gets one `<script>` tag (HTMLRewriter). The script finds the globe and the tour engine through the `window.app` TerraViz sets itself. [`sphere/build.ts`](sphere/build.ts) builds that host beside the plain one from the config `init` wrote, changed in memory (the entry, a `SPHERE` binding), so `rustybuns.config.ts` stays as it was. [`test/live.test.ts`](test/live.test.ts) boots it from the clone and walks a teacher, a student and a late joiner through the room over real sockets (skipped where there is no clone).

On the desktop the room is Rusty Buns' local Durable Object twin with hibernating WebSockets. The same class is a real Durable Object on Cloudflare, so a deployed TerraViz would put a whole class on one globe; that deploy hasn't been tried. Two limits: the desktop host still listens on loopback behind its launch token, so another machine can't join it yet, and a TerraViz release that renames `window.app`, its `viewports`, `loadDataset`, `playTour` or `tourEngine` would leave the panel saying "connecting", or tours unsynced, with nothing broken underneath.

## Kept working

`.github/workflows/terraviz-weekly.yml` runs a pinned TerraViz commit (`TERRAVIZ_SHA`) through the trial every Monday and opens a `ci-terraviz` issue if it stops serving. The pin keeps TerraViz's own changes from failing it; bump the SHA on purpose. Locally: `bun scripts/trial-github.ts --local --check zyra-project/terraviz@<sha>`.

## Can it be a node? What `prove.ts` checks

TerraViz's own app is a viewer of a hosted node. The same code can also be the node, with the API, both D1 databases, KV, R2 and Vectorize in one local process. `bun apps/terraviz-demo/prove.ts` boots two of them (two data dirs, two ports) and checks the operator's path. It needs the clone `run.ts` builds, changes none of TerraViz's code, and takes a few seconds.

- **Publishing works.** Set `DEV_BYPASS_ACCESS=true` (TerraViz's own switch, honoured only on loopback) and the publisher portal signs you in as an admin with no Cloudflare Access. A fresh node has no identity row, so one `PUT /api/v1/publish/node-identity` provisions it (TerraViz's `init-node` command makes that call). A dataset then goes draft, license, publish, and shows up in `/api/v1/catalog`.
- **Search works, but not as semantic search.** The desktop has no model: a call to `env.AI` throws "isn't available on the desktop". With `MOCK_AI=true` TerraViz embeds text by hashing its words, and the local Vectorize twin ranks by cosine similarity. "ocean temperature" finds "Sea Surface Temperature"; "storm" would not find "hurricane". Real meaning needs Workers AI on Cloudflare, or a model on the desktop ([#2202](https://github.com/QuinnsCode/RustyBuns/issues/2202)).
- **Federation does not work yet, for two reasons.** TerraViz's well-known document advertises `/api/v1/federation/feed` and `/handshake`, but at the commit tried they are not built (they answer with the web page), so no node can subscribe to another. Separately, the desktop shell refuses every request without its per-run launch token, the discovery document included, so a peer could not even read it ([#2203](https://github.com/QuinnsCode/RustyBuns/issues/2203)). The second is ours to fix; the first is TerraViz's roadmap.
- **Where the size goes.** The desktop zip was 56 MB. Gzipped, about 30 MB is the Bun runtime (70 MB raw), 21 MB is imagery in `dist/` (already compressed), and 4.5 MB is source maps TerraViz's build leaves in `dist/`. TerraViz's Tauri dmg is smaller because it uses the system web view and no JavaScript runtime. The runtime is the fixed cost of a node in a box.

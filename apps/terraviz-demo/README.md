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

The first run takes a few minutes. The [trial harness](../../scripts/trial-github.ts) clones TerraViz, fetches its Git LFS images and installs its packages. It then runs `rustybuns init`, builds it and boots it once to check it serves. After that, `run.ts` starts the host and prints a link to open. The clone lives in `~/rustybuns-demos/terraviz`, outside this repo, and `--fresh` clones TerraViz's latest again. On a Mac the host runs in the same sandbox the trial uses: no Cloudflare credentials, no network but localhost, and nothing read from your home folder.

## What Rusty Buns gives it, with no edits

- **Pages Functions as a Worker.** `init` spots `functions/` and generates a router in front of TerraViz's handlers, which run unchanged ([#2153](https://github.com/QuinnsCode/RustyBuns/pull/2153)).
- **Every binding has a local twin.** Both D1 databases (about 37 migrations), KV, R2, Vectorize and Analytics Engine run on sqlite on your machine, so it runs without a Cloudflare account.
- **A one-file desktop app.** `rustybuns build desktop` makes a single binary, with TerraViz's source maps left out.
- **The same config deploys to the edge.** The `rustybuns.config.ts` that `init` wrote also describes TerraViz's Cloudflare resources, and `rustybuns plan` prices them before anything is created.

Tried on upstream commit `8cdbb2c` (2026-10-22). TerraViz moves fast, so a newer commit may need a fix on our side. If it does, that's a Rusty Buns gap, not a TerraViz bug.

## Can it be a node? What `prove.ts` checks

TerraViz's own app is a viewer of a hosted node. The same code can also be the node, with the API, both D1 databases, KV, R2 and Vectorize in one local process. `bun apps/terraviz-demo/prove.ts` boots two of them (two data dirs, two ports) and checks the operator's path. It needs the clone `run.ts` builds, changes none of TerraViz's code, and takes a few seconds.

- **Publishing works.** Set `DEV_BYPASS_ACCESS=true` (TerraViz's own switch, honoured only on loopback) and the publisher portal signs you in as an admin with no Cloudflare Access. A fresh node has no identity row, so one `PUT /api/v1/publish/node-identity` provisions it (TerraViz's `init-node` command makes that call). A dataset then goes draft, license, publish, and shows up in `/api/v1/catalog`.
- **Search works, but not as semantic search.** The desktop has no model: a call to `env.AI` throws "isn't available on the desktop". With `MOCK_AI=true` TerraViz embeds text by hashing its words, and the local Vectorize twin ranks by cosine similarity. "ocean temperature" finds "Sea Surface Temperature"; "storm" would not find "hurricane". Real meaning needs Workers AI on Cloudflare, or a model on the desktop ([#2198](https://github.com/QuinnsCode/RustyBuns/issues/2198)).
- **Federation does not work yet, for two reasons.** TerraViz's well-known document advertises `/api/v1/federation/feed` and `/handshake`, but at the commit tried they are not built (they answer with the web page), so no node can subscribe to another. Separately, the desktop shell refuses every request without its per-run launch token, the discovery document included, so a peer could not even read it ([#2199](https://github.com/QuinnsCode/RustyBuns/issues/2199)). The second is ours to fix; the first is TerraViz's roadmap.
- **Where the size goes.** The desktop zip was 56 MB. Gzipped, about 30 MB is the Bun runtime (70 MB raw), 21 MB is imagery in `dist/` (already compressed), and 4.5 MB is source maps TerraViz's build leaves in `dist/`. TerraViz's Tauri dmg is smaller because it uses the system web view and no JavaScript runtime. The runtime is the fixed cost of a node in a box.

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

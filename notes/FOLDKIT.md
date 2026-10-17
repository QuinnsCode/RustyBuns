# Foldkit: "the Effect of the frontend"?

Checked 2026-10-16. Verdict: **don't adopt it in an existing app; try it once in a small new one, if at all.**

## What it is

[Foldkit](https://github.com/foldkit/foldkit) is a TypeScript frontend framework: The Elm Architecture on top of Effect.
A Schema-defined Model, Messages named for facts, one exhaustive `update`, and side effects as explicit Commands and
Subscriptions. No hooks, no component-local state. It has routing, UI primitives, submodels, test helpers and DevTools
that rewind state and expose it over MCP. A Foldkit program can own the page or be embedded in a React app
(`Runtime.embed`).

From the npm registry: MIT, first published 2025-09-12, 508 releases, latest `0.168.0` (2026-10-11), one runtime
dependency (`parse5`), 2.4 MB unpacked. It is 0.x and in beta, and breaking changes land in minor releases.

The tagline fits only half-way. Effect is a general toolkit that fits anywhere something must be cleaned up or retried.
Foldkit is a whole framework with its own architecture, so adopting it means rewriting the UI around it.

## Where we stand

- Effect is used only on the server and CLI edges: `codesplitter`, `borg`, `packages/cli`, `packages/shell-bun`, and
  the Bun/Node platform packages in the React apps. No frontend imports `effect`. Per AGENTS.md, Effect stays out of
  per-frame code and the sim.
- Our UIs are small React apps (`excalibrawl` ~100 lines of TSX, `what-would-fantano-say` ~280, `hippo-tycoon` ~890,
  `fm-daw` ~1000, `meshy-studio` ~1500) plus Three.js apps with hand-written DOM. `agent-office` and `codesplitter`
  have no TSX at all.
- The versions don't line up. Foldkit 0.168 peers on `effect@4.0.0` and `@effect/platform-browser@4.0.0`. We pin
  `4.0.0-rc.112` in every app, and npm's `effect` is now at `4.0.5` (rc line at `rc.118`). A prerelease doesn't satisfy a
  `4.0.0` peer, so we'd have to bump the whole repo's Effect first.

## Where it could fit

| App | Fit | Why |
| --- | --- | --- |
| `excalibrawl` (React, ~100 lines TSX, Effect on server) | Best candidate | Small UI, a real state machine (brawl rounds, drawing, votes) and an Effect server. One Model/Message vocabulary on both sides is the pitch. |
| `what-would-fantano-say` | Maybe | Same shape: small UI, Effect server. Little state, so little to gain. |
| `hippo-tycoon`, `park-hide-seek`, Three.js apps | No | The game loop and sim are per-frame and stay plain. Their DOM overlays are thin. Foldkit's virtual-DOM update cycle doesn't help a render loop. |
| `fm-daw`, `meshy-studio`, `motion-midi` | No | Large React UIs with audio/3D/canvas state. A rewrite to gain Elm-style discipline isn't worth it, and `Runtime.embed` would only wrap a widget. |
| `agent-office`, `codesplitter` | Not now | No React. `codesplitter` is the contest entry (backburnered, `main` must keep matching the demo). Don't move its UI. |
| `spa-example` / `hello-world` | Template idea | If we want a second starter, a Foldkit one would show Effect end to end. |

## Why not more

- Beta with minor-version breakage, against a repo that already tracks an Effect release candidate.
- Elm-style exhaustive `update` is good for agents (one place to read, one place to change), but our agents already
  work fine in small React files.
- Rewriting working UIs conflicts with "cut before you add"; the PR that adds a second UI framework adds code.

## If we try it

1. Bump `effect` and `@effect/platform-browser` repo-wide to `4.0.x` stable in its own PR (a repo-wide change, so
   CI runs everything).
2. Build a throwaway `apps/foldkit-example` (a counter plus a fetch Command), copying `spa-example`'s layout.
3. Check bundle size against the same page in React, and `bun test` ergonomics for its test helpers.
4. Only if that goes well, port `excalibrawl`'s client.

## Sources

- [Foldkit repo](https://github.com/foldkit/foldkit)
- [Elm Discourse announcement](https://discourse.elm-lang.org/t/foldkit-the-elm-architecture-in-typescript-powered-by-effect/10579)
- npm registry metadata for `foldkit` and `effect` (queried 2026-10-16)

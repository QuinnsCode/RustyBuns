# Full circle: the engine that makes the games that ship on it

The owner's picture (2026-11-08). We built the tools to make our own games, and each tool turned out to be a product.
Put them in a row and it is one loop: a maker opens the office, agents write the game on the engine with the
store's parts, it ships to the library, players find it with their friends, and what the game made goes back on the
shelf for the next maker. The engine and the store, like the big two game engines, plus a game library with
multiplayer built in, plus agents doing the typing.

This page is the picture and the gaps. Each layer's own design stays in its own doc (linked).

## The loop

```
     ┌────────────── Agent Office (Druids skin) ──────────────┐
     │  a maker hires workers, gives them the game idea       │
     └───────────────┬────────────────────────────────────────┘
                     │ workers edit, test, merge
                     ▼
     codeSplitter ── the repo, threads, Mervin merges, checks
                     │ on the engine: Rusty Buns + packages/*
                     │ with parts from the store (models, rigs, terrain, controls)
                     ▼
     eqosys ──────── Studio: the Make and Ship doors; the game lands in the Library
                     │
                     ▼
     Qollab ──────── friends, parties, room codes, seats, saves: multiplayer for free
                     │
                     ▼
     players play ── and what makers publish (a beast sheet, a park, a skin) goes back
                     on the shelf, which the next maker's agents pull in ─┐
                     ▲                                                     │
                     └─────────────────────────────────────────────────────┘
```

## Each piece, and what we already have

| Piece | Like | What it is here | Today |
| --- | --- | --- | --- |
| **Engine** | the engine itself | Rusty Buns: write once, ship to a Worker, a desktop binary or a Linux box ([ROADMAP.md](ROADMAP.md)); pure Rust cores built three ways ([STORES.md](STORES.md)) | built; many games on it |
| **Asset store** | the engine's asset store | the parts our games already share: `packages/models` (seeded three.js models), `packages/rig` and `apps/auto-rig`, `packages/terrain`, `packages/game-controls`, `packages/ui`, `packages/render`; Meshy Studio and the Blender beast-sheet loop make new ones | parts exist as packages; no shelf, no listing, no "add to my game" |
| **Code store** | templates and samples | every `apps/*` is a game or tool a maker can fork: the playground lists them ([apps/playground](../apps/playground/README.md)) | listing exists; no one-click fork into your own studio |
| **The harness** | the editor's play mode | how an agent sees and drives a running game: `window.<game>.state()`, `bun run probe`, WebMCP tools on the page ([WEBMCP.md](../WEBMCP.md)) | per game, by convention; the new-game template should ship one |
| **Office** | the team | Agent Office, our edit of WebDevCody's office, skinned as the Druids grove, inside codeSplitter ([MOVE.md](../apps/agent-office/MOVE.md)) | runs as a Bun binary; the move is [#3423](https://github.com/QuinnsCode/RustyBuns/issues/3423) |
| **Repo and merges** | source control | codeSplitter on Cloudflare Artifacts, Mervin for merges, git hidden from the maker | live |
| **Library** | the game store | eqosys: one account, Home, Library, Saves, Achievements, Studios with the four doors Play, Keep, Make, Ship ([VISION.md](../apps/eqosys/VISION.md)) | live; Make and Ship doors wired |
| **Multiplayer** | the store's friends layer plus a rooms kit | Qollab: Hub a player, Party a room code, Space a group, saves; its own Worker ([QOLLAB.md](../apps/eqosys/QOLLAB.md)) | live for our games; sold alone is [#3978](https://github.com/QuinnsCode/RustyBuns/issues/3978) |

## One box

The engine's in-process Durable Objects and sqlite adapters ([ROADMAP.md](ROADMAP.md), the `ws / stateful` row) mean
many small games can share one Linux host instead of one Worker and set of bindings each. Hot games stay on Cloudflare;
the long tail packs onto a box. That is the scaling story: a studio's tenth game costs close to nothing to keep up.
Not tried with more than one game on a host yet.

## The gaps, in order

1. **The office inside codeSplitter** ([#3423](https://github.com/QuinnsCode/RustyBuns/issues/3423)). Without it a maker
   needs our Mac. Everything after this assumes a maker can hire workers from a browser.
2. **New game from a template** ([#4053](https://github.com/QuinnsCode/RustyBuns/issues/4053)). One command (and one button on the Studio page) that makes a repo in codeSplitter from a
   starter game: the engine, an eqosys sign-in, a Qollab party, a `window.<game>.state()` harness, a probe row. Every
   game we made since #2978 has done these by hand.
3. **The shelf** ([#4054](https://github.com/QuinnsCode/RustyBuns/issues/4054)). A listing of the packages as parts, each with a picture, what it does and the line that adds it, read
   from each package's own `package.json`. Ours first; a maker's own parts later, published from their studio.
4. **Games from other studios in the Library** ([#4055](https://github.com/QuinnsCode/RustyBuns/issues/4055)). Today `APPS` is our list. A studio's game needs a review step before it
   is on everyone's shelf. Designed in [apps/eqosys/LIBRARY.md](../apps/eqosys/LIBRARY.md); the build is
   [#4075](https://github.com/QuinnsCode/RustyBuns/issues/4075), after the template.
5. **Many games on one box** ([#4056](https://github.com/QuinnsCode/RustyBuns/issues/4056)). One Hetzner host running two games' Workers in-process, measured.
6. **Qollab sold alone** ([#3978](https://github.com/QuinnsCode/RustyBuns/issues/3978)), for makers who bring their own
   sign-in.

The first new pieces are 2 and 3: both only use what is already built.

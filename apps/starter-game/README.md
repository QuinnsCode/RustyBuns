# Starter Game

> **What it proves:** a new game's first hour, already done: a small game with an eqosys sign-in, a Qollab party and a harness (`window.starterGame.state()`) an agent reads instead of screenshots. Made from the Rusty Buns starter: `bun run new-game <id>` in the Rusty Buns repo, or **New game** on the eqosys Studio page for a codeSplitter repo of your own.

## Play it

**What it is:** a tiny game of catching falling stars in a basket, made to be copied when you start a new game.

**Play:** not online yet. Run it yourself: `bun install --frozen-lockfile` at the repo root, then `cd apps/starter-game && bun run dev`.

**How to play:** move the basket under the falling stars. A caught star is a point; miss three and the round is over.

**Controls:** Desktop: the mouse or the arrow keys. · Phone: move your finger.

**Account:** not needed: you play as a guest.

## Run it

```
bun install
bun run dev              # in the browser
bun run desktop:dev      # as the desktop app
bun test                 # a round, played by the test
```

## What's in it

| File | What it does |
| --- | --- |
| `src/game.ts` | the game: plain data and one `step`, no DOM. Rewrite this first. |
| `src/main.ts` | the page: draws, reads input, the menu, and `window.starterGame` (the harness) |
| `src/eqosys.ts` | the eqosys sign-in and the Qollab party client, with this game's id |
| `test/game.test.ts` | a round as a player plays it |

## Sign-in and parties

The page plays as a guest until eqosys knows the game. To turn sign-in on:

1. On [eqosys](https://eqosys.qntbr.com), open Studio, then **Add a game**: id `starter-game`, and your site's address.
2. Put the same address in `SIGN_IN_FROM` in `src/eqosys.ts`, and deploy (`bun run deploy`).

Signed in, **Make a party** gives a code to hand out; friends type it in **Join**. The host's **Start** seats everyone
(`state().party.seat`) and starts the round on every page.

## The harness

`window.starterGame.state()` returns the round (phase, score, lives, stars), whether you're signed in, and the party.
`start()` and `aim(x)` drive it. In the Rusty Buns repo, `bun run probe starter-game` reads it from headless Chrome.
When the game grows, grow `state()` with it, and its row in `HANDLES` (`scripts/probe.ts`).

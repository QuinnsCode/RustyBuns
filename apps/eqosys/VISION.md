# eqosys: play, keep, make, ship

The owner's picture (2026-11-06): one account that is a game store and a media library and an IDE and a deploy button at
once. You can come in from the top (play a game, keep your things, then open its code) or from the bottom (write an app, ship
it, and it shows up on everyone's shelf). An idea engine either way.

## The three layers

| Layer | Holds | Code |
| --- | --- | --- |
| **eqosys** (who you are) | accounts, sign-in, tokens, access, the app library, achievements, studios, privacy | `src/*.ts` |
| **Qollab** (who you are with, live) | one Durable Object a player (`Hub`: friends, presence, notes), then one a room (`Party` a room code, `Space` a group), cloud saves, Qlave's voice roster | `src/qollab/` ([QOLLAB.md](QOLLAB.md)) |
| **each app** | its own world, ticks, data and saves' shape | `apps/<app>` |

Qollab is entered only with an app's token (`src/door.ts`), never a session cookie, so it can become its own Worker without
an app changing ([#3816](https://github.com/QuinnsCode/RustyBuns/issues/3816)).

## Two kinds of account

A **person** plays: their library, friends, saves and unlocks. A **studio** makes: an account at any size, one person
(`solo`), a `team` or a `business`, with members (`owner`, `admin`, `maker`) and a shelf of the apps it makes
(`src/studios.ts`). **QNTBR** is the first studio, the super admin's business, made the first time they open eqosys, holding
every app in `APPS` no other studio has claimed.

## Four doors on every app

| Door | Like | What it opens | Today |
| --- | --- | --- | --- |
| Play | a game store | the app's site, with your friends and parties | yes: `play` is the app's origin |
| Keep | a media library | your own things in it: saves, unlocks, later splats and decks | in eqosys already (`eq_saves`, `eq_achievements`) |
| Make | an IDE | its code in codeSplitter, agents and threads beside it | `make` is null until a repo is linked ([#3818](https://github.com/QuinnsCode/RustyBuns/issues/3818)) |
| Ship | a deploy button | what is live, where, since when | `ship` is live or not deployed, from `APPS` ([#3819](https://github.com/QuinnsCode/RustyBuns/issues/3819)) |

## Reach it

`eq_studios`, `eq_studio_make` and `eq_studio_add` in `src/tools.ts`: the Cmd/Ctrl+K palette and WebMCP on eqosys's pages,
`POST /api/tools/<name>`, and `bun apps/eqosys/scripts/eq.ts`. A Studio tab on the home page is
[#3817](https://github.com/QuinnsCode/RustyBuns/issues/3817); deploying it is
[#3820](https://github.com/QuinnsCode/RustyBuns/issues/3820).

# eqosys: play, keep, make, ship

The owner's picture (2026-11-06): one account that is a game store and a media library and an IDE and a deploy button at
once. You can come in from the top (play a game, keep your things, then open its code) or from the bottom (write an app, ship
it, and it shows up on everyone's shelf). An idea engine either way.

## The pitch (2026-11-08, #3972)

- **eqosys:** your home for every Q game: one account with your games, friends, saves and the studio where you make them.
- **Qollab:** realtime rooms for any app on Cloudflare: rooms, seats, parties, presence and saves in one call.

eqosys is who you are; Qollab is who you are with. eqosys is the account and the home. Qollab is the live part it ships with,
and a product of its own: built into eqosys for every Q game, and sold alone to other developers once it takes their own
sign-in (#3978). Qlave stays the voice: a space's voice channels are Qollab's, the audio is Qlave's.

## The words

Pages and pitches use the left column; docs keep the code's names (`Hub`, `Party`, `Space`, the token door) where code is meant.

| Say | Means | Instead of | Whose |
| --- | --- | --- | --- |
| Home | The first page after sign-in: what you played last, a shelf a genre, which friends are on. | the dashboard | eqosys |
| Library | Every game you have played or can play. | apps, access list | eqosys |
| Saves | Your progress, following you to any device. | cloud-save blobs | eqosys shows them, Qollab keeps them |
| Achievements | Every game's, in one place. | (kept) | eqosys |
| Studio | Where you make and ship: its shelf, its people, what is live. | (kept) | eqosys |
| Play, Keep, Make, Ship | The four doors on every app (below). | (kept) | eqosys |
| Friends | People you play with, and what each is doing now. | hub, presence | Qollab |
| Party | A few friends getting ready for one game, behind one room code. | lobby | Qollab |
| Room | Where a game happens; a party starts into one. | world, match | the game, named by Qollab |
| Seat | Your place in a room, kept if you drop and come back. | slot, player index | Qollab |
| Space | A group that lasts between games, with channels. | server, guild | Qollab |
| Room code | The six letters you read out to a friend. | party code | Qollab |

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
every app in `APPS` no other studio has claimed. Another studio's game comes into the Library as a listing, after a
review: [LIBRARY.md](LIBRARY.md).

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

# The Library: games from other studios

Gap 4 of [notes/FULL_CIRCLE.md](../../notes/FULL_CIRCLE.md) ([#4055](https://github.com/QuinnsCode/RustyBuns/issues/4055)).
Today every game in the Library is a row in `APPS` (`src/apps.ts`), added in a PR to this repo. A studio that isn't ours
needs a way in that doesn't go through our PRs, and a review before its game is on everyone's shelf. This page is
that design; the build is [#4075](https://github.com/QuinnsCode/RustyBuns/issues/4075), after the new-game template
([#4053](https://github.com/QuinnsCode/RustyBuns/issues/4053)).

## What a row in APPS does today

A row isn't only a tile. It is a grant, and that is why a stranger's game can't just show up:

| Job | Where | What a row lets the game do |
| --- | --- | --- |
| Sign-in client | `oauth.ts`, `handle.ts` (`returnTo`) | a handoff code goes to its `returns` (or each origin's `/`) |
| Calls from its page | `door.ts` (`cors`) | its origins call `/api/exchange` and `/api/hub` |
| Qollab | `door.ts`, `qollab/*` | a token with its id as `aud` opens a Hub, Party or Space |
| The tile | `app/pages.tsx`, `eq_apps` | a card in its genre's row, linked to its first origin |
| The shelf | `studios.ts` (`house`) | QNTBR holds it until another studio claims it |
| Who may start | `members.ts` (`starts`) | `play` or `member` from a person's first sign-in |

So the review is a review of the origins and returns as much as of the game: once listed, eqosys sends sign-in codes to them.

## Two lists, one answer

`APPS` stays ours: in code, reviewed by PR, and the only place `member`, a native `scheme` or `featured` can come from.
A studio's game is a **listing**, a row in D1 with the same fields plus its studio and a state. `appsOf(conf)` is
`APPS` plus the listings that are listed, read once a minute per isolate. Every caller above asks `appOf(conf, id)` in
`src/listings.ts` instead of the fixed list, and `mayUse` for who: a draft or a game in review answers only its studio.
A listing's id is a plain slug (`rocket-golf`), unique across the Library and kept by its studio once taken (even after
a pull): an id in `APPS` can't be taken, and two studios can't collide. (Studios have no slug of their own yet, and an id
rides in URLs, `aud` and labels, so it has no `/`.)

## The steps

```
  draft ──send──▶ in review ──list──▶ listed ──pull──▶ pulled
    ▲                 │
    └──── refused ◀───┘  (with the reviewer's note; fix and send again)
```

- **Draft.** A studio's owner or admin fills it in: name, genre, origins (https only), returns, card text and a shot.
  It starts `experimental` with `play`. A draft already signs in, but only the studio's own members: the maker
  tests the real sign-in, friends and parties from their real site before anyone else can see it.
- **In review.** Sent from the Studio page's Ship door. eqosys checks what a machine can: each origin answers over
  https, the page loads with no errors, it signs in through eqosys, and its `window.<game>.state()` answers (the
  harness the template ships, the same check `bun run probe` makes on ours). Then a person looks: it plays, its name
  and card don't pass it off as someone else's game, nothing the house rules keep out (the same as codeSplitter's:
  no weapons, sexual or political content), and an `erase` URL if it keeps data per account.
- **Listed.** The tile shows in its genre's row with the studio's name on it, its origins join the CORS set, and
  anyone can sign in. Changing the origins or returns sends it back to review, since those are where codes go;
  card text and the shot change freely.
- **Refused.** Back to the studio with a note. Nothing about it shows.
- **Pulled.** The super admin, or the studio itself, takes it down: the tile goes, sign-ins and tokens with its
  `aud` stop at the door. Players' saves in it are kept 30 days, then erased.

Who reviews: the super admin for now. A reviewer role comes when there are more listings than one person can look at.

## What a studio's game gets, and doesn't

- The shared achievements (`SHARED`) only; its own list comes later, from its studio, not a PR here.
- Friends, parties, rooms and saves through Qollab, the same doors our games use, under the same per-app limits.
- Reports from its players go to its studio in eqosys, not to issues on this repo (`reports.ts` files ours there).
- Its visitors in the studio's own Visitors view, not ours.

## Why it waits for the template

The machine half of the review leans on the harness: the eqosys sign-in, the Qollab party and `window.<game>.state()`
that #4053 puts in every new game. A game made without the template can still be listed; its maker adds the handle by hand.

## What is built

[#4075](https://github.com/QuinnsCode/RustyBuns/issues/4075) built the listings (`src/listings.ts`, migration `20261109000000_listings.sql`),
the four tools (`eq_listing_save`, `eq_listing_send`, `eq_listing_review`, `eq_listing_pull`), the shelf and tile, and one
journey (`test/library.test.ts`). [#4091](https://github.com/QuinnsCode/RustyBuns/issues/4091) added the Studio tab's form by the
Ship door (`/do/listing-save`, `-send`, `-pull`, for owners and admins), the studio's reports inbox (a report from its game is
kept in the `reports` row with its kind, title and body, migration `20261111000000_studio_reports.sql`, and shown under the game
on the Studio tab and in `eq_studios`, the newest 20, the reporter as the same opaque id), and the shared achievements (`catalogOf`
gives a listing the `SHARED` ones its maturity can unlock, and `unlock` reads the maturity through `appOf`). Still to come: the
machine checks ([#4090](https://github.com/QuinnsCode/RustyBuns/issues/4090), after the template).

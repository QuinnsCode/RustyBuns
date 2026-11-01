# Qollab: eqosys's multiplayer layer

Design note from the spike in [#3046](https://github.com/QuinnsCode/RustyBuns/issues/3046). Nothing here is built yet; the issues at the bottom are the build.

## What it is

Qollab is not a product beside eqosys. Anyone using it is already signed in to eqosys, so it is eqosys's
multiplayer layer: the part of the one account that knows who you are playing with. The mental model is a
store-and-launcher account: one meta account across every Q app, carrying friends, presence, parties,
chat and cloud saves, with each app plugging in. A game keeps its own rooms, ticks and sync, as fast as it
is today, and reads user things off the account.

## The split

| Owner | Holds | Never holds |
| --- | --- | --- |
| eqosys (today) | identity, keys, access, the app library, friends and presence (`Hub`, one DO a person) | game state |
| Qollab (new, part of eqosys) | parties (one DO a party), room codes, ready and start, party chat, cloud-save blobs | the shape of a save, a game's live state |
| each game | its world DO, ticks, gameplay sync, the schema of its own saves | a second friends list, a second lobby |

Friends and presence stay where they are. The `Hub` already answers `ask`, `accept`, `drop`, `presence` and
`note` per person; Qollab reads a party member's friends through `hubAsk` and never keeps its own graph.

Everything stays Workers and Durable Objects. Qollab's data is one D1 (`parties`, `saves`) and the party DO's
storage. No table is shared with eqosys's D1 and nothing joins across them: the user id in the token is the
only key that crosses.

## Where it lives

Routes under `apps/eqosys` at `/q/*`, a `Party` Durable Object beside `Hub`, and its own D1 binding. One
Worker, one deploy, one domain, which keeps service-to-service auth to a minimum: a party only ever talks to
the hub through the binding, never over HTTP. If the party traffic ever needs its own scaling it moves to
its own Worker behind the same paths; nothing in a game changes.

## How a game joins

1. The page signs in through `@rustybuns/util/eqosys` as it does today and holds a token (`aud` = the game's app id).
2. The page opens `wss://eqosys.qntbr.com/q/party/<code>?token=...`. Qollab's Worker runs `TokenChecker`
   with `aud` = the token's own `aud`, checks that app id is in `APPS`, and attaches `{ user, app }` to the socket.
   A party is scoped to one app: a token for another app cannot join it.
3. The party DO is the lobby: members, ready flags, a host, chat. When the host starts, the party tells every
   member `{ kind: "start", room, seat }` and the game does what it does now with its own world DO. Qollab's
   job in a session ends at "start"; it stays open only for chat and for a late joiner to be handed the same room.
4. Room codes are minted by the party DO (`RoomMintGate` at the door), six characters, no vowels, 24 hours.

A game that already has a lobby (`park-hide-seek`) deletes it; a game with none (`skate-tech-park`) gets one
for the price of the socket above. The shared client is a small `party()` beside `eqosys()` in
`@rustybuns/util/eqosys`: `make`, `join(code)`, `ready(bool)`, `start()`, `say(text)`, and an `onStart`.

## Answers to the spike's questions

1. **Friends and presence**: stay in eqosys's `Hub`. Qollab reads; it does not own.
2. **Deletion**: `members.ts`'s delete already clears sessions, links, access and the hub. It gains one more
   step: delete the person's `saves` rows and party memberships in the same Worker (one D1 call, no fan-out
   needed while Qollab is in-process). Games stay as they are: they hold no per-account data beyond what the
   token gave them for the session. If a game ever keeps account data, it registers an erase URL in `APPS`
   and eqosys calls it with a signed token (`aud: "erase"`) until it answers 200. Not built until a game needs it.
3. **Service-to-service auth**: there is none to design while Qollab is in-process. The one future case is
   the erase call above, which gets its own `aud` and a 60-second life.
4. **Key rotation**: `jwksOf` already serves up to 8 keys. Rotation is: add the new key, wait longer than the
   longest JWKS cache (`TokenChecker` keeps one a few minutes, and refetches on an unknown key id), switch signing, remove the old one a day later.
   One test signs with key A, rotates to B, and checks a verifier with a stale cache still accepts A until expiry.
5. **Revocation lag**: ten minutes is fine for a lobby. For chat it is not: a muted or banned person must go
   quiet now. The party DO keeps a `muted` set it checks on every `say`, and eqosys's ban writes to the
   person's `Hub`, which the party reads on join. No `tokens_valid_after` table.
6. **Chat safety**: 280 characters a message, `TokenBucket` at 2 a second with a burst of 5 on each socket,
   last 200 messages kept per party and gone with the party, report (a `note` to the host and a row through the game-report path from #3049) and mute per member, and friends-only by default: a party made with `open: false`
   accepts only the host's friends. Public parties come later, with the report path already in place.
7. **Cloud saves**: `PUT /q/save/<slot>` with the token; body up to 256 KB, opaque. Qollab keeps the last 5
   versions a slot, 20 slots an app, 50 MB a person across apps, and never reads a body. Conflict rule: last
   write wins, but the reply carries the previous version's id and time so a game can offer "keep the cloud
   one" itself. Saves live in D1 as blobs for now; R2 when a game needs bigger.

## What is built on

`packages/util`: `Sockets` (`room.ts`), `TokenBucket`, `RoomMintGate`, `originAllowed` (`limits.ts`),
`connectSocket` (`socket.ts`), `TokenChecker` and `Claims` (`token.ts`), the sign-in client (`eqosys.ts`).
`apps/eqosys`: `Hub` and `hubAsk` (`hub.ts`), `APPS` (`apps.ts`), account delete (`members.ts`).

## The build, in order

1. Party join from a token: the `Party` DO, `/q/party/<code>` upgrade, `TokenChecker` on the door.
2. Room code mint and join, `RoomMintGate` and the code format.
3. Ready and start gate, with `onStart` in the shared client and Skate Tech Park as the first adopter.
4. Party chat, friends-only, with mute and report.
5. Cloud saves.
6. Account delete clears Qollab; Park Hide & Seek deletes its own lobby.

Test: one journey with two signed-in players: make a party, join by code, ready up, start, both land in the
same room.

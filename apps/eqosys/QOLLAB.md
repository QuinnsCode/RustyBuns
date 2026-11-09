# Qollab: realtime rooms, built into eqosys

Design note from the spike in [#3046](https://github.com/QuinnsCode/RustyBuns/issues/3046). The build in the list at the bottom has shipped (status below); this note stays as the record of why.

**Since the studios spike (2026-11-06, [VISION.md](VISION.md)):** Qollab is the Durable Object layer, and it holds the per-player
object too. One `Hub` a player (friends, presence, notes), then one object a room they meet in (`Party` a room code, `Space` a
group), plus cloud saves and Qlave's roster. Its code is `src/qollab/` and its paths are one router, `src/qollab/routes.ts`
(`/hub`, `/api/hub`, `/q/party*`, `/q/space*`, `/q/save/*`, `/q/qlave/roster`), entered only with an app's token through
`src/door.ts`. eqosys keeps who you are: accounts, sign-in, tokens, access, the app library, achievements, studios, privacy.

**Its own Worker (#3816):** `apps/qollab` serves those paths and hosts `Hub`, `Party` and `Space`. eqosys still answers on
eqosys.qntbr.com and hands every Qollab path to it over a service binding (`QOLLAB`, `isQollab` in `routes.ts`), so no game
changes a URL; eqosys's pages, account delete and privacy export call the three objects there through cross-script bindings.
Qollab reads eqosys's D1 (a reference into eqosys's stack, so the user id stays the only key and nothing is copied), keeps
eqosys's `Vault` where it is, and checks a token against eqosys's public keys over a binding back (`EQOSYS`), holding the
signing key only for Qlave tickets. `bun run dev` in `apps/eqosys` runs both Workers. Deploy Qollab first: its first deploy
moves the three classes, with their data, out of eqosys's Worker; then eqosys, which binds them there.

## What it is

Realtime rooms for any app on Cloudflare: rooms, seats, parties, presence and saves in one call. It is two
things at once (owner, 2026-11-08, #3972). Inside eqosys it is the part of the one account that knows who you are
playing with: friends, presence, parties, chat and cloud saves across every Q app, each app plugging in. And it is a
product of its own, somewhere between a self-hostable app platform and a realtime rooms kit, for other developers to
use without eqosys; that needs their own sign-in at the door, which is #3978 (today every door checks an eqosys token).
The pitch and the words the pages use are in [VISION.md](VISION.md#the-pitch-2026-11-08-3972). A game keeps its own rooms, ticks and sync, as fast as it
is today, and reads user things off the account.

## The split

| Owner | Holds | Never holds |
| --- | --- | --- |
| eqosys | identity, keys, access, the app library, achievements, studios (the business accounts) | game state, sockets |
| Qollab hub (`src/qollab/hub.ts`) | friends and presence (`Hub`, one DO a player) | game state |
| Qollab rooms (`src/qollab/party.ts`) | parties (one DO a party), room codes, ready and start, party chat, cloud-save blobs | the shape of a save, a game's live state |
| Qollab spaces (part of eqosys) | spaces (one DO a space), text channels and their history, voice channels and who may join them, mute and kick | audio |
| Qlave ([QuinnsCode/clave](https://github.com/QuinnsCode/clave), qlave.dev) | voice rooms: peer-to-peer audio, signalling, TURN, server mute as eqosys orders it | members, accounts, any list of who may talk ([QLAVE.md](QLAVE.md)) |
| each game | its world DO, ticks, gameplay sync, the schema of its own saves | a second friends list, a second lobby |

**Decision (owner, 2026-11-01, #3168): an app's main data stays in the app.** Decks in the deck app live in its
own storage (`DECKS_KV`), not in `/q/save`, with the app's own caps (10 draft decks, tier limits). The app only
reads who the person is from eqosys (the OIDC `access_token` / `userinfo`) and keys its own data by that user id.
`/q/save/<slot>` is for small per-person things that should follow someone across apps, such as cross-app
settings.

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
2. The page opens `wss://eqosys.qntbr.com/q/party/<code>` offering the subprotocols `eqosys` and the token (a header, so
   no access log keeps the token in a URL; `?token=` still works for the iOS kit). Qollab's Worker runs `TokenChecker`
   with `aud` = the token's own `aud`, checks that app id is in `APPS`, and attaches `{ user, app }` to the socket.
   A party is scoped to one app: a token for another app cannot join it.
3. The party DO is the lobby: members, ready flags, a host, chat. When the host starts, the party tells every
   member `{ kind: "start", room, seat }` and the game does what it does now with its own world DO. Qollab's
   job in a session ends at "start"; it stays open only for chat and for a late joiner to be handed the same room.
4. Room codes are minted by the party DO (`RoomMintGate` at the door), six characters, no vowels, 24 hours unless the host picks another lifetime (an hour to a week, the `hours` rule).

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
4. **Key rotation**: `Jwks` accepts up to 8 keys; `jwksOf` serves the key in `EQOSYS_SIGNING_KEY` first, then any retired keys in `EQOSYS_PREVIOUS_KEYS` (a JSON array of JWKs). Rotation is: put the new key in `EQOSYS_SIGNING_KEY` and the old one in `EQOSYS_PREVIOUS_KEYS`, wait longer than the
   longest JWKS cache (`TokenChecker` keeps one a few minutes, and refetches on an unknown key id), remove the old one from the list a day later. `rotation.test.ts` signs with A, rotates to B, and checks A's token still verifies.
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

1. Party join from a token: the `Party` DO, `/q/party/<code>` upgrade, `TokenChecker` on the door. Shipped (#3061).
2. Room code mint and join, `RoomMintGate` and the code format. Shipped (#3062, #3082).
3. Ready and start gate, with `onStart` in the shared client and Skate Tech Park as the first adopter. Shipped (#3063, #3083).
4. Party chat, friends-only, with mute and report. Shipped (#3064, #3087).
5. Cloud saves. Shipped (#3065, #3089).
6. Account delete clears Qollab; Park Hide & Seek deletes its own lobby. Shipped (#3066, #3092, #3101).

## Spaces

A party lasts one game night; a **space** is where the same people stay between games: a group with text
channels, like a chat server's rooms. It belongs to people, not to an app: a token from any Q app opens it, so
friends who play different games still share one.

- **Where it lives:** D1 holds who owns a space and who is in it (`spaces`, `space_members`, migration 0007), so
  "my spaces" is one query and the Worker checks membership before a socket reaches the space. A `Space` Durable Object
  per space (`src/space.ts`) holds its channels, their messages and who is online.
- **Joining:** the owner hands out a six-letter invite (same alphabet as a party code). Up to 500 members a space, 10 spaces a person owns.
- **Channels:** `#general` to start; the owner adds more (up to 20 text and voice together, lower-case, digits and
  dashes) and deletes any but `#general`.
- **Voice channels:** carried by Qlave ([QLAVE.md](QLAVE.md)). A member asks the space for a one-use ticket and
  joins with `@rustybuns/util/voice`; everyone sees who is in each voice channel beside the online list. The owner's
  mute and kick, deleting a channel or the space, and deleting an account all reach Qlave as orders.
- **Messages:** the same rules as party chat (`src/chat.ts`, shared): 280 characters, 2 a second with a burst of 5.
  Kept in pages of 50 in the object's storage, the last 10,000 a channel; `history` reads a page back, oldest first.
- **Moderation:** the owner mutes (text and voice) and kicks; anyone reports, which reaches the owner and files a row through the game-report path.
- **Deletion:** deleting an account deletes the spaces it owns (everyone is closed out) and takes its messages out of the rest.
- **In a game:** `spacesPanel` in `@rustybuns/util/spaces` (beside the party's `lobbyPanel`) lists your spaces, makes and joins them, and opens one: channel tabs, the messages with "Load older", a text box, who is online, voice channels (join, who is talking, mute yourself, hang up), and the owner's add and delete channel, copy invite, mute and kick. Styleless; the page skins it and hands it its icons. Skate Tech Park opens it from the HUD for a signed-in rider.
- **Not yet:** a page on eqosys that shows spaces, and Qlave telling eqosys who is in each voice room (QLAVE.md §4).

## After "start": seats ([#3878](https://github.com/QuinnsCode/RustyBuns/issues/3878))

Qollab's job ends at "start", and each game then builds its own room. The survey (2026-11-06) of what each one builds:

| | Skate Tech Park | Park Hide & Seek | Splat Spray | Git Recon | Mythic Masters | Hippo Tycoon | Two Fronts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| door: `whoIs`, strip `X-*`, vouch, room code, mint gate | yes | yes | yes | yes | yes (token only) | desktop shell | HTTP seat links |
| seat keyed by a hash of the login (`publicId`) | yes | yes | yes | raw uid | yes | own | token hash |
| second tab or reconnect closes the old socket (4001) | yes | yes | yes | yes | yes | own | no |
| player leaves only with their last socket | yes | yes | yes | yes | yes | own | n/a |
| loop runs while anyone is here | yes | yes | yes | yes | no timer | own | no |
| late joiner gets the room | view | view | view | welcome | `all` + `seen` | own | HTTP view |
| who is here | in view | in view | in view | roster | `hi` / `bye` | own | n/a |
| dead page swept (ping) | | | | idle close | yes | | |
| in-game chat | | | | | | | |
| host migration, spectators | | host flag | | owner picks | | gallery | |

Repeated by three or more, and now in `@rustybuns/util/seats`:

- **`seatDoor(req, { door, room, gate })`** for the game's Worker: websocket, origin, room code, `whoIs`, mint gate, the client's `X-*` stripped, X-User-Id / X-User-Name / X-RB-Principal vouched. The game picks its Durable Object from `room` and sends it `request`.
- **`vouched(req, app, fallbackName)`** for the world: the edge's word as `{ uid, id: publicId(app, uid), name, host }`.
- **`Seats`**, a `Sockets` whose attachments are seats: `take(seat)` (the new socket in, older tabs closed with `SEAT_CLOSE.replaced`, `back` when the player was already here), `leave(ws)` (the id once their last socket goes, told once), `here()` (one seat a player).
- **`Loop`**: the world's tick, started on a join and stopped when the room empties.
- On the page: `who(guest)` on `eqosys()` (the token while it lasts, else the guest uid), `guestId(key, { tab })`, and `SEAT_CLOSE` / `seatClosed(code)` in `@rustybuns/util/socket`.

Skate Tech Park, Park Hide & Seek, Splat Spray and Git Recon run on them. The game's tick, sync, views and welcome stay the game's.

**Where they live:** `packages/util`, not Qollab. They run inside each game's own Worker and Durable Object, and after "start" the game never calls Qollab, so Qollab moving to its own Worker ([#3816](https://github.com/QuinnsCode/RustyBuns/issues/3816)) changes nothing in them, and a game's data stays in the game (#3168). Qollab keeps what is about people, not a room: the party, its chat, and handing a late joiner the room code.

**In-game chat** is the party's: the party socket stays open after "start", so a game shows `lobbyPanel`'s chat in play rather than building its own. No game repeats one yet.

**Not moved yet:** Mythic Masters' Region (its own ping sweep and full code 4003; its trail state is in flight on #3876), Hippo Tycoon (its Room owns its sockets), and Two Fronts (HTTP seats; account-bound seats are #3826).

## Status

All six steps are on `main`. Key rotation (Q4) is built too (`EQOSYS_PREVIOUS_KEYS`), and open parties already work (`POST /q/party?open=1` skips the friends check; same rate limit, mute and report). The erase URL (Q2) is built: set `erase` on an app in `APPS` and account delete POSTs there with an `aud: "erase"` bearer token (60 seconds, `sub` the person), three tries; the account is kept unless it answers 200. No game sets it yet.

Test: one journey with two signed-in players: make a party, join by code, ready up, start, both land in the
same room.

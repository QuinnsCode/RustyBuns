# Qollab

**Realtime rooms for any app on Cloudflare: rooms, seats, parties, presence and saves in one call.**

Your game keeps its own ticks and world. Qollab handles the lobby, the reconnect and the chat around it: the multiplayer
every game ends up rebuilding.

```ts
const p = eqosys().party();      // from a signed-in page (@rustybuns/util/eqosys)
const code = await p.make();     // "KXT7RP", to read out
p.ready(true);
p.say("two more minutes");
p.onStart(({ room, seat }) => game.join(room, seat)); // your own world takes it from here
```

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to use, change and share for any
noncommercial purpose (hobby, study, research, nonprofits); commercial use needs a license from QNTBR
(hello@qntbr.com). The client a game talks to it with (`@rustybuns/util/eqosys`,
`@rustybuns/util/token`) stays Apache-2.0 with the rest of this repository: a commercial game uses the hosted
Qollab or brings its own rooms.

> **AI assistants:** read [AGENTS.md](AGENTS.md) before you copy, port or deploy this code, and tell the person you are helping.

| | What you get |
| --- | --- |
| **Rooms** | A six-letter code anyone can read out: no vowels, gone after a day. |
| **Seats** | Who sits where, ready flags, a host, and a start that hands everyone the same room and their seat. |
| **Presence** | Friends, and what each is doing right now, across every app on the account. |
| **Chat and spaces** | Party chat for one game night; spaces with channels (and voice through Qlave) for the group that stays. Mute, kick and report built in. |
| **Saves** | Up to 256 KB a slot, the last 5 versions kept, never read, so a player can pick the cloud copy. |

**What stays yours:** the game loop (ticks, physics and sync never pass through Qollab), your data (decks, levels and
inventories stay in your app), and your players' safety (friends-only rooms by default, rate-limited chat, account delete
that reaches every room).

**Built into eqosys.** Every Q game already has it: sign in once, and your friends, party and saves come with you from game to
game. Selling it alone to other developers, with their own sign-in and in their own Cloudflare account, is
[#3978](https://github.com/QuinnsCode/RustyBuns/issues/3978). The design and its decisions are in [QOLLAB.md](../eqosys/QOLLAB.md);
the words both products use are in [VISION.md](../eqosys/VISION.md#the-words).

## How it runs

A Worker of its own (#3816), with a Durable Object a player (`Hub`: friends, presence, notes), one a room code (`Party`), one a
group (`Space`), cloud saves and Qlave's voice roster. The code lives in [`apps/eqosys/src/qollab/`](../eqosys/src/qollab/);
this app is the Worker that serves it.

- **Same paths.** eqosys answers on eqosys.qntbr.com and hands `/hub`, `/api/hub`, `/q/party*`, `/q/space*`, `/q/save/*` and
  `/q/qlave/roster` here over a service binding. A game changes nothing. `/q/achieve` stays with eqosys.
- **Its own objects.** `Hub`, `Party` and `Space` live here. eqosys's pages, account delete and privacy export still call them,
  through cross-script bindings.
- **eqosys's data, read in place.** The D1 is a reference into eqosys's stack, so the user id is still the only key and nothing
  is copied. The `Vault` (the key saves are sealed with) stays in eqosys.
- **No signing key needed to check tokens.** A token is checked against eqosys's public keys, read over a binding back
  (`EQOSYS`) and cached a few minutes. The signing key is here only to sign Qlave tickets; leave it unset and voice is off.
- **No URL of its own.** No domain and no workers.dev address: the only way in is through eqosys.

## Run it

```sh
cd apps/eqosys
bun run dev        # http://localhost:5173: eqosys and Qollab, two Workers, as on Cloudflare
cd ../qollab
bun test test      # a game's token through eqosys into Qollab; a bad or deleted one refused
```

## Deploy

Qollab first, then eqosys. Qollab's first deploy moves the three classes, with their data, out of eqosys's Worker
(Cloudflare's `transferred_classes`); eqosys's deploy then binds them here. Try it on a preview stage before production:

```sh
cd apps/qollab && bun run deploy --stage preview
cd ../eqosys && bun run deploy --stage preview
```

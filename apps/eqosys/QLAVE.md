# Voice channels: what Qlave does

Qollab spaces ([QOLLAB.md#spaces](QOLLAB.md#spaces)) get voice channels through Qlave (#3389). Qlave's code is
private, so this page is the contract between the two: what eqosys sends, and what Qlave must accept and do. Qlave
may meet it however suits its code. Nothing here says how Qlave carries audio.

Roles stay apart: eqosys says who someone is, Qollab (the `Space` Durable Object) says who may be in which channel,
and Qlave carries the voice.

## 1. Let in whoever holds a ticket

A member asks the space for a voice channel over their space socket. If they may join, the `Space` DO answers with a
**ticket** and Qlave's address. The page hands both to Qlave's browser client.

- The ticket is an ES256 JWT signed with eqosys's key (`sign` in `packages/util/src/token.ts`). Qlave checks it against
  eqosys's public keys at `https://eqosys.qntbr.com/.well-known/jwks.json` (`TokenChecker` there does it, and caches the
  keys). It works the same way the games' servers check their sign-in tokens today.
- Claims: `aud: "qlave"`, `iss` eqosys's origin, `sub` the person's eqosys id, `name` their name, `room` the voice
  room as `space:<space id>:<channel>`, and `exp` at most 60 seconds out. The ticket only gets someone in. Qlave keeps
  them in the room after it runs out.
- Qlave puts the holder in `room` under `name`, and asks for nothing else (no Qlave account, no second sign-in).
  Qlave treats `room` as an opaque string: it doesn't read the space or the channel out of it.
- Qlave refuses a ticket with a wrong `aud`, an expired `exp`, or a bad signature, and refuses any ticket a second time
  (keep each `jti`, or a hash of the ticket, until it expires).

## 2. A browser client a game can load

Games are Vite pages on other origins, so Qlave ships a small ES module they can import (an npm package or a URL):

- `join(url, ticket)`: connects, asks for the microphone, and plays the others. It returns a handle with
  `leave()`, `muteSelf(on)`, `onSpeakers(fn)` (who is in the room and who is talking now, by `sub` and `name`), and
  `onGone(fn)` (closed by Qlave: kicked, the room ended, or the network failed for good).
- It accepts connections from any game origin. The ticket is the auth, not the origin.

## 3. Take orders from eqosys

The owner's mute and kick, account deletes and space deletes all have to reach voice too. eqosys POSTs JSON to Qlave
with a bearer token: an ES256 JWT, the same key, `aud: "qlave-admin"`, 60 seconds. This follows the pattern of
eqosys's erase call (`aud: "erase"`, QOLLAB.md).

| POST body | Qlave does |
| --- | --- |
| `{ "t": "mute", "room", "sub", "on": true \| false }` | Server-mutes (or unmutes) that person in that room. Their own unmute doesn't undo it. |
| `{ "t": "kick", "room", "sub" }` | Drops them from that room now. They need a fresh ticket to come back. |
| `{ "t": "erase", "sub" }` | Their account was deleted: drop them from every room. |
| `{ "t": "end", "prefix": "space:<id>:" }` | The space or a channel was deleted: end every room whose name starts with the prefix. |

Qlave answers `200` once the order is done (or there was nothing to do), so eqosys can retry on anything else
(three tries, as erase does). The address comes from one eqosys setting (`QLAVE_URL`, path `/eqosys`) that the owner sets.

## 4. Tell eqosys who is in a room (optional)

The space shows who is in each voice channel beside the online list. At first the page reports that itself (the
panel tells the space "joined" and "left"). If Qlave can POST roster changes to eqosys
(`{ "room", "in": [{ "sub", "name" }] }`, signed with a key eqosys can check), the list stays right when a tab
crashes. Send it if it's easy. Nothing waits on it.

## Not Qlave's

Who may join a channel, mute lists, channel kinds (`text` or `voice`), invites and members all stay in the `Space` DO
and D1. Qlave never calls the space and keeps no list of members.

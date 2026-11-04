# Voice channels: eqosys and Qlave

Qollab spaces ([QOLLAB.md#spaces](QOLLAB.md#spaces)) have voice channels, carried by Qlave (#3389). Qlave is the
public repo [QuinnsCode/clave](https://github.com/QuinnsCode/clave), live at https://qlave.dev. This page is the
contract both sides build to. eqosys's half is `src/qlave.ts` and `src/space.ts`; Qlave's is `src/lib/qlave/voice.ts`
and `src/sdk/voice.ts` in clave. Its end-to-end test of the whole flow is `tests/e2e/voice.spec.ts` there.

## Who does what

| | eqosys | Qollab (the `Space` DO in eqosys) | Qlave |
| --- | --- | --- | --- |
| Who someone is | Signs them in, signs every token with its one key, serves the JWKS | | Checks tickets and orders against that JWKS |
| Who may talk where | | Members, channel kinds (`text`, `voice`), mute list, kick, invites | Nothing: it trusts the ticket |
| The audio | | | Peer-to-peer WebRTC between browsers, a Durable Object per room for signalling, Cloudflare TURN when a direct path fails. Up to 12 people a room |
| Who is in a voice channel | | Shows it beside the online list, from what each page reports | Knows its own room, but doesn't report it back yet (§4) |

## 1. A one-use ticket into a room

A member's page sends `{ t: "talk", channel: <voice channel id> }` over the space socket. The `Space` DO answers that
socket alone with `{ t: "ticket", channel, url: "https://qlave.dev", ticket }`, and the page passes both to `join`.

- The ticket is an ES256 JWT from `sign` in `packages/util/src/token.ts`: `aud: "qlave"`, `iss: "https://eqosys.qntbr.com"`,
  `sub` and `name` the member, `room: "space:<space id>:<channel id>"`, a fresh `jti`, and `exp` 60 seconds out. No email.
- Qlave refuses a wrong `aud`, a bad signature, an expired ticket, one that lives longer than it should, and any ticket
  a second time (it keeps the `jti`). Once in, the room hands the client a resume ticket for reconnects.
- A voice channel's id is `v` and eight hex digits. Every voice channel id is the same length, so ending one room by
  prefix (`space:<id>:<channel id>`) never reaches another.
- A member the owner has muted gets their mute sent to Qlave's room before the ticket, so they start silent.

## 2. The browser client

`@rustybuns/util/voice` is a copy of clave's `src/sdk/voice.ts` and `src/sdk/qlaveCall.ts`, with no dependencies.
Fix it in clave first, then copy it here. The only change in the copy is that frames and event details are checked
before use, instead of trusted as `any`.

```ts
import { join } from "@rustybuns/util/voice";
const v = await join(url, ticket);           // asks for the microphone
v.onSpeakers((list) => draw(list));          // [{ sub, name, talking, muted, self }]
v.onGone((reason) => note(reason));          // "kicked" | "ended" | "network"
v.muteSelf(true); v.leave();
```

A server mute is enforced by every client: the muted person's own client stops sending, and everyone else's stops playing them.
`spacesPanel` in `@rustybuns/util/spaces` does all of this. After `join` it tells the space `{ t: "voice", channel }`,
and after a leave or `onGone`, `{ t: "voice" }`.

## 3. Orders from eqosys

eqosys POSTs JSON to `https://qlave.dev/eqosys` (`QLAVE_URL` moves it) with `Authorization: Bearer <token>`: an ES256
JWT from the same key, `aud: "qlave-admin"`, 60 seconds.

| Body | When eqosys sends it | Qlave does |
| --- | --- | --- |
| `{ t: "mute", room, sub, on }` | The owner mutes or unmutes a member: once per voice channel | Server-mutes them in that room; their own unmute doesn't undo it |
| `{ t: "kick", room, sub }` | The owner kicks a member, or they leave the space: once per voice channel | Drops them now; they need a fresh ticket to come back |
| `{ t: "erase", sub }` | Their account is deleted | Drops them from every room |
| `{ t: "end", prefix }` | A voice channel is deleted (`space:<id>:<channel id>`), or the space is (`space:<id>:`) | Ends every room under the prefix |

`200` means done (or there was nothing to do), `401` a bad token, `400` a bad order. Neither of those gets better on
a retry, so eqosys drops them. The `Space` DO keeps every other answer in an outbox and its alarm tries again: six
tries, 5 s, 10 s, 20 s, 40 s and 80 s apart. Account delete sends `erase` itself, up to three tries, and doesn't wait on
it: a room is gone once its last person leaves. `curl -X POST https://qlave.dev/eqosys` answers `401`.

## 4. Who is in a room, from Qlave (not built)

Qlave doesn't yet POST who is in each room back to eqosys. Until it does, each page reports joining and leaving,
so a crashed tab can stay listed until its space socket closes.

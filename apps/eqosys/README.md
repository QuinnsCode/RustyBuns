# eqosys

One account for every Q app, games and suite alike. A small RWSDK app on one Worker and one D1 database:
Better Auth holds the accounts, a Durable Object a person holds their friends and who of them is on, and eqosys remembers which app each person first came in through, every app
they've used since, and what they may do in each. Working title.

| Where | What |
| --- | --- |
| `/login?app=&return=&challenge=&state=` | Sign in or sign up (email and password; GitHub and Google once their keys are set), then Continue back to the app. |
| `POST /api/exchange` `{ app, code, verifier }` | The app trades the one-minute code for `{ user, app, source, access, token }`. CORS is open to the app's own origins, so a game with no server can call it from its page. |
| `GET /.well-known/jwks.json` | The public key `token` is signed with (ES256). An app's server or Durable Object checks a token with it and never calls back. |
| `/hub?token=` (WebSocket) | A page's live line to its person's hub: friends, who is on in which app, requests and notifications, sent on connect and after every change. Send ops as JSON frames, plus `{ op: "status", doing }`. Opens only from the token's own app's site. |
| `POST /api/hub` `{ op, … }` | One op with `Authorization: Bearer <token>`, answered with the same state: `state`, `befriend { email }`, `accept { id }`, `drop { id }`, `notify { id, text, link? }` (a friend only; the link on your app's site), `clear`. |
| `/` | Your apps, where you came from, what you may do; your friends and where each is right now, requests to accept or drop, notifications, and a box to ask someone by email. The super admin also sees everyone and grants or takes away a role in an app. |
| `GET /health` | Up or down. Nothing about who is signed up. |

## Hooking an app up

1. Add it to `APPS` in `src/apps.ts`: an id, its origins, and what everyone gets on first sign-in (`starts`, e.g. `["play"]`).
2. Keep a random `verifier` (43+ URL-safe characters), then send the person to
   `https://eqosys.qntbr.com/login?app=<id>&return=<a URL on your origin>&challenge=<base64url SHA-256 of verifier>&state=<anything>`.
3. They come back to `return?code=eq_…&state=…`. Check `state`, then `POST /api/exchange { app, code, verifier }`.
4. Make your own session from the answer. `source` is the app they first signed up through; `access` is their roles in yours.
5. To pass who someone is on to your server or a Durable Object, send `token` along. It is a JWT good for ten minutes
   (`iss` is eqosys's origin, `aud` your app id, `sub` the user id, plus `email`, `name`, `source`, `access`); check it with
   `TokenChecker` from `@rustybuns/util/token` (one per isolate: it fetches the JWKS once, keeps it a few minutes and fetches
   again for a key id it doesn't know), or `verify(token, jwks, { iss, aud })` with a JWKS you hold. `token` is null until
   `EQOSYS_SIGNING_KEY` is set (`bun scripts/keygen.ts` makes one). Park Hide & Seek is the worked example
   (`apps/park-hide-seek/src/ui/eqosys.ts` is the page's side, `src/edge/eqosys.ts` the Worker's).

6. For friends and presence, open `/hub?token=<token>` from your page and say what they're doing with
   `{ op: "status", doing: "hiding in the hedge" }`. Each person's hub is one Durable Object (`src/hub.ts`): it wakes for
   a socket, a frame or a friend's change and hibernates between, with no alarms. A status change costs one request per
   friend. The socket stays open after the token it opened with expires.

Developing your app locally: with `LOOPBACK_RETURNS=1` (on in `bun run dev`), a registered app may also return to
`http://localhost`, `127.0.0.1` or `[::1]` on any port. Leave it off in production.

A code is good once, for a minute, for that app, and only with the verifier: the same shape as OAuth with PKCE.

```sh
bun install --frozen-lockfile   # at the repo root, once
cd apps/eqosys
bun run dev                     # http://localhost:5173, in-memory D1; admin@eqosys.local is the super admin
bun test test                   # sign up in a game, carry on into the suite, grants, refused handoffs, friends on the hub and on /
bun run deploy                  # secrets through varlock (.env.schema)
```

The page on `/` is the same hub by cookie: it reads your state on the way in and its forms post one op each (`/do/befriend`,
`/do/accept`, `/do/drop`, `/do/clear`), so what a friend's game shows and what this page shows is one hub.

Not yet: an app opening the hub (Park Hide & Seek signs in but doesn't say where it is hiding yet).

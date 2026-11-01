# eqosys

One account for every Q app, games and suite alike. A small RWSDK app on one Worker and one D1 database:
Better Auth holds the accounts, a Durable Object a person holds their friends and who of them is on, and eqosys remembers which app each person first came in through, every app
they've used since, and what they may do in each. Working title.

| Where | What |
| --- | --- |
| `/login?app=&return=&challenge=&state=` | Sign in or sign up (email and password; GitHub, Google and Apple once their keys are set), then Continue back to the app. |
| `POST /api/exchange` `{ app, code, verifier }` | The app trades the one-minute code for `{ user, app, source, access, token }`. CORS is open to the app's own origins, so a game with no server can call it from its page. |
| `POST /api/report` `{ kind, title, body, page?, build?, detail? }` | A bug, suggestion or error from a game, with the token as a bearer. Filed as an issue on the RustyBuns repo labelled `external`, `game:<id>` and `bug`/`enhancement`, titled `[external][<game>] Bug: …`, with a header of game, kind, page, build and an opaque reporter id (never an email). Limited to 5 a minute per IP, then 5 an hour and 20 a day per account; 503 until `GITHUB_REPORT_TOKEN` is set. In a page, `eqosys().reportButton()` (`@rustybuns/util/report`) is a corner button that does it all. |
| `GET /.well-known/jwks.json` | The public key `token` is signed with (ES256). An app's server or Durable Object checks a token with it and never calls back. |
| `/hub?token=` (WebSocket) | A page's live line to its person's hub: friends, who is on in which app, requests and notifications, sent on connect and after every change. Send ops as JSON frames, plus `{ op: "status", doing }`. Opens only from the token's own app's site. |
| `POST /api/hub` `{ op, … }` | One op with `Authorization: Bearer <token>`, answered with the same state: `state`, `befriend { email }`, `accept { id }`, `drop { id }`, `notify { id, text, link? }` (a friend only; the link on your app's site), `clear`. |
| `/` | Your apps, where you came from, what you may do; your friends and where each is right now, requests to accept or drop, notifications, and a box to ask someone by email. The super admin also sees everyone and grants or takes away a role in an app. |
| `/delete?app=` | Delete my account, for an iOS app to open (App Store 5.1.1(v)): type your email, everything eqosys holds goes (sign-in, access, friends, who hears you left), then a link back to the app. |
| `POST /api/account/delete` | The same from inside the app, with its token as a bearer: `{ ok: true }`. |
| `GET /.well-known/openid-configuration` | eqosys as an OpenID Connect provider (`src/oauth.ts`): `/oauth/authorize` (PKCE S256 required), `/oauth/token` (a code or a refresh token for `access_token`, `id_token`, and with `offline_access` a `refresh_token`), `/oauth/userinfo`, `/oauth/revoke`. `client_id` is the app's id, `redirect_uri` on its origins or schemes; clients are public. |
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

**Already speak OpenID?** Point the library at `https://eqosys.qntbr.com/.well-known/openid-configuration` with your app id
as the client id, PKCE on and no secret (`token_endpoint_auth_method: none`). The QNTBR site (qbear3) does it with Better
Auth's generic OAuth plugin (`test/openid.test.ts` runs that exact setup); its callback is `https://qntbr.com/api/auth/callback/eqosys`.
The id_token carries `email_verified`, false for an email-and-password sign-up, so don't link it onto an existing account by email.

**Native apps** add their bundle id to `schemes` in `APPS` and come back to `<bundle id>:/eqosys`. Ask for `offline_access` and keep
the refresh token (a month, one use: each refresh hands out the next); `POST /oauth/revoke { token }` on sign-out. The Swift side is
`RustyBunsKit` in `packages/ios-kit` (`EqosysClient`, `EqosysSignIn`).

The sign-in page sits over a sky that turns from day to night and back every six minutes (`src/app/Sky.tsx`, all CSS: one clock property drives the sun and moon on their arc, the dawn and dusk glow, the clouds, the stars and the
panel's paper and ink). The phase comes from the server clock, so a reload carries on where it was; `/login?at=0.75`
starts at a given fraction of the cycle (0 sunrise, 0.5 sunset), and `prefers-reduced-motion` holds it still. The panel's
greeting follows the same hour, a System / Day / Night slider (and a double-click on the sun or moon) pins the sky to day or night and remembers it (`src/app/Theme.tsx`, the page's one script, allowed by hash in the CSP), and its type is Fraunces and DM Sans from Google Fonts (the only two hosts the page's CSP lets in).
The home page (`/`, `?at=` works there too) shares that sky, type and glass (`src/app/Glass.tsx`): a greeting, then every Q
app as a full-width bar with its tile, your access and when you were last in, the ones you use first, then friends.

Its session cookie is `eqosys.session_token`, not Better Auth's default: the QNTBR site sets the default name on all of `.qntbr.com`.

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

The multiplayer layer on top of this account (parties, room codes, ready, chat, cloud saves) is designed in [QOLLAB.md](QOLLAB.md); not built yet.

## Deploy (owner's hands, about 15 minutes)

It serves on `eqosys.qntbr.com` (`BETTER_AUTH_URL` and the `edge` target in `rustybuns.config.ts`). Each secret is one
1Password Password item in the `eqosys` vault, read from its built-in password field:

| Item | Holds | Needed |
| --- | --- | --- |
| `better-auth` | 32+ random characters | yes |
| `admin` | the super admin's email | no, but nobody can grant access without it |
| `signing-key` | the private JWK from `bun scripts/keygen.ts` | no, but apps get no tokens without it |
| `github`, `google` | `client-id` and `client-secret` fields | no; a button shows once both halves are set |
| `apple` | `client-id` (Services ID), `client-secret` (from `bun scripts/apple-secret.ts <teamId> <keyId> <servicesId> < AuthKey.p8`, good six months, so renew it) and optionally the app's bundle id | no; needed before an iOS app turns on GitHub or Google (App Store 4.8) |

Then `cd apps/eqosys && bun run deploy`, open the site, sign up with the admin email and check that "Everyone" shows.

Not yet: an app opening the hub (Park Hide & Seek signs in but doesn't say where it is hiding yet).

App Review wants a fixed account per app: `bun scripts/review-account.ts <appId> <email> <password>` makes it through the app's own handoff (or checks it still signs in).

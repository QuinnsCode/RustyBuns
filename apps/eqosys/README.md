# eqosys

One account for every Q app, games and suite alike. A small RWSDK app on one Worker and one D1 database:
Better Auth holds the accounts, a Durable Object a person holds their friends and who of them is on, and eqosys remembers which app each person first came in through, every app
they've used since, and what they may do in each. Working title.

**Live:** https://eqosys.qntbr.com

| Where | What |
| --- | --- |
| `/login?app=&return=&challenge=&state=` | Sign in or sign up (email and password; GitHub, Google and Apple once their keys are set), then Continue back to the app. |
| `POST /api/exchange` `{ app, code, verifier }` | The app trades the one-minute code for `{ user, app, source, access, token }`. CORS is open to the app's own origins, so a game with no server can call it from its page. |
| `GET` / `POST /q/space`, `POST /q/space/join`, `/q/space/<id>` (WebSocket) | Qollab spaces, with the token as a bearer: groups that last, with text channels (see [QOLLAB.md](QOLLAB.md#spaces)). GET lists yours (`{ spaces: [{ id, name, owner, invite? }] }`, the invite only on ones you own), POST `{ name }` makes one (10 a person) and answers `{ id, invite }`, `join` takes `{ invite }`. The socket is for members only (404 otherwise) and answers to `say`, `history`, and the owner's `channel`, `mute` and `kick`. In a page: `eqosys().space()` (`@rustybuns/util/eqosys`). |
| `PUT` / `GET /q/save/<slot>` | Qollab cloud saves, with the token as a bearer: an opaque body up to 256 KB (413 past it), never read. A slot keeps its last 5 versions, a game 20 slots, a person 50 MB across games (409 / 507 past those). Last write wins; the PUT reply is `{ ok, id, at, previous: { id, at } \| null }` so a game can offer the cloud copy, and `GET ?v=<id>` fetches an older one. GET answers the bytes with `x-save-id` and `x-save-at`. |
| `POST` / `GET /q/achieve` | Achievements, with the token as a bearer: POST `{ id }` unlocks one from the app's catalog in `src/achievements.ts` (404 for any other), answered `{ achievement, new }`; kept the first time, so unlocking again is safe. GET lists the whole catalog for the person, earned first, a secret one hidden until earned. In a page, `eqosys().achieve(id)` (`@rustybuns/util/eqosys`) does it, and keeps unlocks earned signed out until the next sign-in. The home page's Achievements tab shows every game's, each with its badge (a lucide icon, or a letter in the console font). Every game's list opens with the same ones (`SHARED`: `played`, then `alpha` or `beta`, which only unlock while the app is at that stage, else 409). A new unlock tells each friend's hub once (a note "unlocked …"), and the Friends tab shows how many each friend has. |
| `POST /api/report` `{ kind, title, body, page?, build?, detail? }` | A bug, suggestion or error from a game, with the token as a bearer. Filed as an issue on the RustyBuns repo labelled `external`, `game:<id>` and `bug`/`enhancement`, titled `[external][<game>] Bug: …`, with a header of game, kind, page, build and an opaque reporter id (never an email). Limited to 5 a minute per IP, then 5 an hour and 20 a day per account; 503 until `GITHUB_REPORT_TOKEN` is set. In a page, `eqosys().reportButton()` (`@rustybuns/util/report`) is a corner button that does it all. |
| `GET /.well-known/jwks.json` | The public key `token` is signed with (ES256). An app's server or Durable Object checks a token with it and never calls back. |
| `/hub` (WebSocket) | A page's live line to its person's hub: friends, who is on in which app, requests and notifications, sent on connect and after every change. Send ops as JSON frames, plus `{ op: "status", doing }`. Opens only from the token's own app's site. |
| `POST /api/hub` `{ op, … }` | One op with `Authorization: Bearer <token>`, answered with the same state: `state`, `befriend { email }`, `accept { id }`, `drop { id }`, `notify { id, text, link? }` (a friend only; the link on your app's site), `clear`. |
| `/` | Your apps, where you came from, what you may do; your friends and where each is right now, requests to accept or drop, notifications, and a box to ask someone by email. The super admin also sees everyone and grants or takes away a role in an app, and has a Visitors tab (below). |
| `POST /api/visit` `{ site, engaged?, ref? }` | A page's visit beacon (`navigator.sendBeacon`, text/plain, no preflight): a view from a page with no Worker of its own (the Playground), and `engaged: true` on the first tap, key or scroll (the Playground and eqosys's own pages). `site` is `eqosys` from its own origin or an app from one of its origins in `src/apps.ts`, else 403. 204, nothing back. |
| `/delete?app=` | Delete my account, for an iOS app to open (App Store 5.1.1(v)): type your email, everything eqosys holds goes (sign-in, access, friends, who hears you left), then a link back to the app. |
| `POST /api/account/delete` | The same from inside the app, with its token as a bearer: `{ ok: true }`. |
| `GET /api/privacy/export` | Everything eqosys holds about the person as one JSON file (GDPR access and portability), with the session cookie or an app's token as a bearer: one section per entry in `HOLDERS` (`src/privacy.ts`), saves unsealed and in base64, never a password hash or a provider's token. The account page's "Download my data" links here. |
| `GET /api/privacy` | What eqosys keeps, why, on what basis and for how long (the same `HOLDERS` the privacy page lists), plus the person's vault: `region`, consents in force, the whole ledger and the log of requests. |
| `POST /api/apple/events` `{ payload }` | Sign in with Apple's server notifications (`src/apple.ts`): Apple's RS256 JWT, checked against its keys at `appleid.apple.com/auth/keys` for `aud` = `APPLE_CLIENT_ID`. `consent-revoked` signs that person out everywhere (sessions and refresh tokens); `account-delete` deletes their account. Anything Apple didn't sign for us is a 401; 503 until `APPLE_CLIENT_ID` is set. |
| `GET /.well-known/openid-configuration` | eqosys as an OpenID Connect provider (`src/oauth.ts`): `/oauth/authorize` (PKCE S256 required), `/oauth/token` (a code or a refresh token for `access_token`, `id_token`, and with `offline_access` a `refresh_token`), `/oauth/userinfo`, `/oauth/revoke`. `client_id` is the app's id, `redirect_uri` on its origins or schemes; clients are public. |
| `GET /health` | Up or down. Nothing about who is signed up. |

## Visitors: who is really here

The super admin's Visitors tab (`/?tab=visitors&days=7`, and the `eq_visitors` tool for an agent) is codeSplitter's insights for the Q
sites: eqosys itself, the Playground, and any app whose page calls eqosys (counted under that app by its Origin). Every answered request
and every beacon goes into `visits` (`src/visitors.ts`), a row per caller, site and day, sorted by `@rustybuns/util/visitors` into a
person in a browser, an agent (scripts, AI clients, headless or spoofed browsers) or a bot that says so. A **real person** is a browser
whose page then saw a tap, a key or a scroll: crawlers that run scripts never touch the page. It shows real people, browsers, agents,
bots and new accounts over 1, 7 or 30 days, real people a day, the split by site, where real people came from (the referrer's host),
the last day's callers with their browser string, and health (the database's answer time, server errors in the last day).

A caller is a hash of the IP and browser salted with the day and `BETTER_AUTH_SECRET`: no IP is kept and nobody is followed from one day
to the next. The super admin's own callers are marked each time they open eqosys (`visit_staff`) and left out. Writes are gathered for a
second per isolate, one upsert per caller; days past 30 are swept. To count another static site, add its origin to its app in
`src/apps.ts` and copy the Playground's few lines of beacon (`apps/playground/public/index.html`).

## Tools: one set of functions, three doors

`src/tools.ts` holds eqosys's functions (`eq_whoami`, `eq_apps`, `eq_achievements`, `eq_friends`, `eq_saves`, the studio tools `eq_studios`, `eq_studio_make` and `eq_studio_add` ([VISION.md](VISION.md)), the admin's `eq_members` and `eq_visitors`, and
`eq_batch`). Each is a plain function of who is asking and guarded arguments, reachable as:

- **WebMCP** in any page: `app/commands.client.ts` adds the server's list as commands (`@rustybuns/util/commands`), so a browser agent calls them as the signed-in person (no token) instead of screenshotting, and a person finds the same ones in the Cmd/Ctrl+K palette.
- **HTTP**: `GET /api/tools` lists them with schemas; `POST /api/tools/<name>` runs one (session cookie, or an app's token as a bearer).
- **CLI**: `bun apps/eqosys/scripts/eq.ts eq_apps '{"genre":"Sports & Skate"}' --token ...`.

`eq_batch` is the token saver: up to 12 read-only calls in one round trip, each with `pick` (dotted field paths) so only the wanted fields come back.
`eq_execute` is code mode: the agent sends a JavaScript program (`await tools.eq_apps({})`, loops, filters) that runs in a Dynamic Worker with no network (`LOADER` binding, `src/codemode.ts`), calling the read-only tools as the person asking, and only what it returns comes back (50 calls, 10 s, 20k characters). The program Worker reaches the tools through the `EQBridge` entrypoint in `worker.tsx`. A test measures it: a per-app loop costs ~88 tokens as a program against ~874 calling each tool by hand.
`GET /agents` is the one page an agent reads: use `eq_batch` over call-per-fact, `eq_execute` for loops, and after a task
tell the owner what it cost against the alternative. See [WEBMCP.md](../../WEBMCP.md). Add a tool in `tools.ts` and all three doors have it.

## Hooking an app up

1. Add it to `APPS` in `src/apps.ts`: an id, its origins, the exact URLs a sign-in comes back to (`returns`; left out, each
   origin's root `/`, where `@rustybuns/util/eqosys` returns for a page served from its root), and what everyone gets on first
   sign-in (`starts`, e.g. `["play"]`). Any other page on your origin gets no code (#3634).
2. Keep a random `verifier` (43+ URL-safe characters), then send the person to
   `https://eqosys.qntbr.com/login?app=<id>&return=<one of your returns>&challenge=<base64url SHA-256 of verifier>&state=<anything>`.
3. They come back to `return?code=eq_…&state=…`. Check `state`, then `POST /api/exchange { app, code, verifier }` (add `return` and a
   code sent anywhere else is refused).
4. Make your own session from the answer. `source` is the app they first signed up through; `access` is their roles in yours.
5. To pass who someone is on to your server or a Durable Object, send `token` along. It is a JWT good for ten minutes
   (`iss` is eqosys's origin, `aud` your app id, `sub` the user id, plus `email`, `name`, `source`, `access`); check it with
   `TokenChecker` from `@rustybuns/util/token` (one per isolate: it fetches the JWKS once, keeps it a few minutes and fetches
   again for a key id it doesn't know), or `verify(token, jwks, { iss, aud })` with a JWKS you hold. `token` is null until
   `EQOSYS_SIGNING_KEY` is set (`bun scripts/keygen.ts` makes one). Park Hide & Seek is the worked example
   (`apps/park-hide-seek/src/ui/eqosys.ts` is the page's side, `src/edge/worker.ts` the Worker's, through `whoIs` from `@rustybuns/util/token`).

6. For friends and presence, open `/hub` from your page with the subprotocols `["eqosys", token]` (`SOCKET_PROTOCOL` in
   `@rustybuns/util/eqosys`; every eqosys socket takes its token this way, out of the URL) and say what they're doing with
   `{ op: "status", doing: "hiding in the hedge" }`. Each person's hub is one Durable Object (`src/hub.ts`): it wakes for
   a socket, a frame or a friend's change and hibernates between, with no alarms. A status change costs one request per
   friend. The socket stays open after the token it opened with expires, until a sign-out ends that token: signing out
   on the eqosys page, Apple's consent-revoked or `/oauth/revoke` close it. A friend request by email shows the asker
   the email they typed, not a name, until it is accepted, so it never says whether an account has that email.

**Already speak OpenID?** Point the library at `https://eqosys.qntbr.com/.well-known/openid-configuration` with your app id
as the client id, its `returns` as the redirect URIs, PKCE on and no secret (`token_endpoint_auth_method: none`). The QNTBR site (qbear3) does it with Better
Auth's generic OAuth plugin (`test/openid.test.ts` runs that exact setup); its callback is `https://qntbr.com/api/auth/callback/eqosys`.
The id_token carries `email_verified`, false for an email-and-password sign-up, so don't link it onto an existing account by email.

**Native apps** add their bundle id to `schemes` in `APPS` and come back to `<bundle id>:/eqosys`. Ask for `offline_access` and keep
the refresh token (a month, one use: each refresh hands out the next); `POST /oauth/revoke { token }` on sign-out. The Swift side is
`RustyBunsKit` in `packages/ios-kit` (`EqosysClient`, `EqosysSignIn`).

The sign-in page sits over a sky that turns from day to night and back every six minutes (`src/app/Sky.tsx`, all CSS: one clock property drives the sun and moon on their arc, the dawn and dusk glow, the clouds, the stars and the
panel's paper and ink). The phase comes from the server clock, so a reload carries on where it was; `/login?at=0.75`
starts at a given fraction of the cycle (0 sunrise, 0.5 sunset), and `prefers-reduced-motion` holds it still. The panel's
greeting follows the same hour, a System / Day / Night slider (and a double-click on the sun or moon) pins the sky to day or night and remembers it (`src/app/Theme.tsx`, the page's one script, allowed by hash in the CSP), and its type is Lexend from Google Fonts (the only two hosts the page's CSP lets in).
The home page (`/`, `?at=` works there too) shares that sky, type and glass (`src/app/Glass.tsx`): a greeting, then every Q
app as a card (its picture, a kicker, its name and one line, when you were last in and its achievements), games first and
the ones you play on top, then suites. The words on each card are `src/cards.json`, which the owner edits in the card-copy
page and pastes back whole (`src/cards.ts` checks it); an app's picture is `public/cards/<id>.jpg` when it has one, else
drawn key art (`src/app/Art.tsx`).

Its session cookie is `eqosys.session_token`, not Better Auth's default: the QNTBR site sets the default name on all of `.qntbr.com`.

Developing your app locally: with `LOOPBACK_RETURNS=1` (on in `bun run dev`), a registered app may also return to
`http://localhost`, `127.0.0.1` or `[::1]` on any port. Leave it off in production.

A code is good once, for a minute, for that app, and only with the verifier: the same shape as OAuth with PKCE.

**Instant when already signed in.** `/login` with an app's ask, for someone signed in here who has used that app before
(or who just pressed "Continue with…" for it), sends them straight back with a code: no page, no Continue, one redirect.
So a game whose ten-minute token ran out calls `signIn()` again and the player barely sees eqosys. A first visit to an app
from a link still shows the page with Continue. To show it anyway (a "switch account" button), add `prompt=select_account`
(OpenID's `prompt=login` works too).

```sh
bun install --frozen-lockfile   # at the repo root, once
cd apps/eqosys
bun run dev                     # http://localhost:5173, in-memory D1; admin@eqosys.local is the super admin
bun test test                   # sign up in a game, carry on into the suite, grants, refused handoffs, friends on the hub and on /
bun run deploy                  # secrets through varlock (.env.schema)
```

The page on `/` is the same hub by cookie: it reads your state on the way in and its forms post one op each (`/do/befriend`,
`/do/accept`, `/do/drop`, `/do/clear`), so what a friend's game shows and what this page shows is one hub.

## Privacy: a vault a person, in their region

Each person has a `Vault` Durable Object (`src/vault.ts`, the body is `Vault` in `@rustybuns/util/privacy`): the key their cloud saves are
sealed with (AES-256-GCM, bound to user, app and slot), a consent ledger and a log of their requests. Their first sign-in records a
region from `request.cf` (never from anything the client sends): "eu" for the EU, the EEA, the UK and Switzerland puts the vault in
`VAULT.jurisdiction("eu")`, so their key, and so every readable copy of their saves, stays in the EU. People from before vaults, and
everyone else, have region null and a vault anywhere. Deleting the account shreds the vault before anything else, which also makes the
copies in D1's 30-day history unreadable. Without the `VAULT` binding saves are kept unsealed, as before.

Not the Hub: every friend's hub finds another by user id in the global namespace, so hubs stay there; the vault is the only thing that
needs a region. D1 itself is one global database; making a new one in the EU jurisdiction is the owner's call.

What eqosys keeps is one list, `HOLDERS` in `src/privacy.ts`: each part says what it keeps, why, its basis and how long, and exports its
part of the download. The privacy page renders it, so a new table that keeps personal data goes there and both follow. Retention runs
on the everyday paths: report rows go after a year (filed), expired sessions at every sign-in, codes and refresh tokens when new ones are
minted, party seats after a day. Better Auth keeps GitHub's, Google's and Apple's tokens encrypted (`encryptOAuthTokens`); one kept before
that is replaced at that person's next sign-in.

Another app adds the same: a `Holder` list and `dossier()` for its download, and, if it keeps data worth sealing, a `Vault` class over its
own Durable Object storage with `inRegion(ns, regionOf(req.cf), userId)`.

The multiplayer layer on top of this account (parties, room codes, ready, chat, cloud saves) is designed in [QOLLAB.md](QOLLAB.md) and built (routes under `/q/*`, the `Party` and `Space` Durable Objects).

## Apple devices

On an iPhone, iPad or Mac (an iOS app's sign-in sheet included) the login page puts "Continue with Apple" above the
email form, so signing in is Face ID or Touch ID; everywhere else it sits under the form with the other buttons. Apple
gives one person the same id in every app on the team, so a player who signs in with Apple in two Q apps is one eqosys
account. Deleting an account also revokes its Apple link at Apple, which App Review asks for, and when Apple says someone
stopped using Sign in with Apple with us or deleted their Apple account, `POST /api/apple/events` signs them out or deletes
them (register that URL with the Services ID, [#3306](https://github.com/QuinnsCode/RustyBuns/issues/3306)). The button shows once the
`apple` keys below are set ([#2898](https://github.com/QuinnsCode/RustyBuns/issues/2898)).

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

# artstewengine

Have you paid? No? Bye bye. A very small RWSDK app that decides whether qCRM's sealed Rust engine may
open. It is separate from qCRM on purpose: cutting a license off never needs a change to code the
licensee holds. One Worker, one D1 database, no client script.

| Where | What |
| --- | --- |
| `POST /lease` `{ license, host?, version? }` | `200 { ok, key, seconds }` if the license is paid, else `402`. The key decrypts the engine. |
| `GET /health` | Up or down, and whether the sign-in and engine secrets are set. Nothing about who has paid. |
| `/login` | Sign in. The very first visit offers to make the admin account, and only `ADMIN_EMAIL` may. |
| `/admin` | The whole product: counts and a 24-hour bar of leases, add someone who paid (name, optional days), the list with when each last asked and from where, Bye bye / Restore. |
| 401 / 403 / 404 / 500 / 503 | A plain page each. |

Sign-in is Better Auth (`src/auth.ts`) on D1, but `/api/auth` is not mounted: the only ways in are the login
and setup forms, and a hook refuses any email but `ADMIN_EMAIL`. There is no admin API and no CLI; adding a
payer is the form. A license is a random `art_…` string the buyer puts in qCRM's `QCRM_LICENSE`.

qCRM's side is `packages/seal` (the lease) and `apps/qcrm/src/api.ts` (the key route): the wasm ships AES-256-GCM
encrypted (`bun run seal` in apps/qcrm, with `ENGINE_KEY` from varlock), the server asks for a lease once per
lease (the reply's `seconds`, an hour if it names none; it tells this app its host and version) and serves the
key at `GET /api/engine/key`, and the browser decrypts in memory. An outage rides
the last lease for a day; a 402 ends it at once. A visitor can still copy a key out of a paid, running site:
the seal stops an unlicensed copy of the binary, not a licensed one's own users.

```sh
bun install --frozen-lockfile   # at the repo root, once
cd apps/artstewengine
bun run dev                     # http://localhost:5173, in-memory D1; sign in as admin@artstew.local
bun test test                   # set up, add a payer, lease, revoke, restore, in-process
bun run deploy                  # secrets through varlock (.env.schema)
```

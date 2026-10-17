# artstewengine

Have you paid? No? Bye bye. A tiny Worker and one KV namespace that sit apart from qCRM and decide
whether its sealed Rust engine may open. It is separate on purpose: cutting a license off never needs a
change to code the licensee holds.

| Call | What it does |
| --- | --- |
| `POST /lease` `{ "license": "…" }` | `200 { ok, key, seconds }` if `paid:<license>` is in KV, else `402`. The key decrypts the engine. |
| `PUT /paid/<license>` `{ "who", "days" }` | Mark a license paid (admin bearer token). No `days` means until revoked. |
| `DELETE /paid/<license>` | Blow it up. The next lease is a 402. |

qCRM's side is `apps/qcrm/src/seal.ts`: the wasm ships AES-256-GCM encrypted (`bun run seal` in apps/qcrm,
with `ENGINE_KEY` from varlock), the server asks for a lease at most once an hour and serves the key at
`GET /api/engine/key`, and the browser decrypts in memory. An outage rides the last lease for a day; a 402
ends it at once. A visitor can still copy a key out of a paid, running site; the seal stops an unlicensed
copy of the binary, not a licensed one's own users.

```sh
cd apps/artstewengine
bun test test
bun run deploy        # secrets ENGINE_KEY and ADMIN_TOKEN through varlock (.env.schema)
```

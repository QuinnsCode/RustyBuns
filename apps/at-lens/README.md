# AT Lens

> **What it proves:** a social network's open protocol fits in one small Worker. Type a handle and see the [AT Protocol](https://atproto.com/) do its job step by step: the domain gives a DID, the DID gives a data server, and the data server gives typed records. Then watch the account live on the public firehose, and sign in to write a record of our own type back into your repo. No keys, no session store, no bindings. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

- **The walk.** `src/edge/atproto.ts` resolves a handle (an `_atproto` DNS TXT record through Cloudflare's DNS over HTTPS, else `https://<handle>/.well-known/atproto-did`), fetches the DID document (plc.directory, or the host's own `did.json` for `did:web`), checks that the document claims the handle back, and asks the data server (PDS) it names for the repo's collections and records over XRPC. A handle that doesn't point back shows as unverified. Step by step, that is the spec's rule for when a handle can be trusted.
- **Live.** The page opens [Jetstream](https://bsky.network/docs/jetstream/) (the firehose as JSON) filtered to that one DID, so a post, like or follow from any app shows up as it happens. Pick a collection and a second stream counts it across the whole network, per second.
- **The Worker is only there for what a browser can't do**: a DNS lookup, and a handle's own domain, which sends no CORS headers. Each reply is capped in size and time, and a data server has to be an https hostname before it's fetched.
- **Writing.** Sign in with your handle and your own repo's view gets a box that writes a `dev.rustybuns.lens.status` record (the Lexicon is `public/lexicons/dev.rustybuns.lens.status.json`); the live feed shows it coming back off Jetstream a moment later. It's [atproto OAuth](https://atproto.com/guides/oauth) run entirely in the page by `@atproto/oauth-client-browser`: PAR, PKCE and DPoP-bound tokens, with the key and tokens in the page's IndexedDB. The scope is `atproto repo:dev.rustybuns.lens.status?action=create`, so the grant can't post, like, follow or delete. The Worker only serves the client metadata (`/client-metadata.json`, which is the client_id) and resolves handles for the OAuth client with the same walk as above.
- **State is the URL** (`?q=bsky.app&c=app.bsky.feed.post`), so a link opens the same view and an agent's browser can drive it.

## Run it

```
bun install
cd apps/at-lens
bun run edge:dev      # builds the page, serves it with the lookups at http://localhost:8787
```

`bun run dev` alone is Vite with the page's `/api` and `/xrpc` proxied to port 8787, so run `bunx wrangler dev` beside it while working on the page. `bun run deploy` ships it.

Sign-in works locally too: the page moves itself from localhost to 127.0.0.1, where atproto lets a loopback client sign in without published metadata. Deployed, the client_id is `https://<host>/client-metadata.json`, built from the host it's served on.

## What it leaves out

Only creating, and only our record type. Editing or deleting a status, or writing posts, would each need a wider scope. The Lexicon isn't published for resolution yet: that takes a `_lexicon.lens.rustybuns.dev` DNS TXT record and a `com.atproto.lexicon.schema` record in an account we own, and data servers store our records fine without it.

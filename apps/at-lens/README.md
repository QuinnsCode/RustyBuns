# AT Lens

> **What it proves:** a social network's open protocol fits in one small Worker. Type a handle and see the [AT Protocol](https://atproto.com/) do its job step by step: the domain gives a DID, the DID gives a data server, and the data server gives typed records. Then watch the account live on the public firehose. No keys, no sign-in, no bindings. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

- **The walk.** `src/edge/atproto.ts` resolves a handle (an `_atproto` DNS TXT record through Cloudflare's DNS over HTTPS, else `https://<handle>/.well-known/atproto-did`), fetches the DID document (plc.directory, or the host's own `did.json` for `did:web`), checks that the document claims the handle back, and asks the data server (PDS) it names for the repo's collections and records over XRPC. A handle that doesn't point back shows as unverified. Step by step, that is the spec's rule for when a handle can be trusted.
- **Live.** The page opens [Jetstream](https://bsky.network/docs/jetstream/) (the firehose as JSON) filtered to that one DID, so a post, like or follow from any app shows up as it happens. Pick a collection and a second stream counts it across the whole network, per second.
- **The Worker is only there for what a browser can't do**: a DNS lookup, and a handle's own domain, which sends no CORS headers. Each reply is capped in size and time, and a data server has to be an https hostname before it's fetched.
- **State is the URL** (`?q=bsky.app&c=app.bsky.feed.post`), so a link opens the same view and an agent's browser can drive it.

## Run it

```
bun install
cd apps/at-lens
bun run edge:dev      # builds the page, serves it with the lookups at http://localhost:8787
```

`bun run dev` alone is Vite with the page's `/api` proxied to port 8787, so run `bunx wrangler dev` beside it while working on the page. `bun run deploy` ships it.

## What it leaves out

It only reads. Writing a record to someone's repo (a post, or a record under our own Lexicon) means atproto OAuth: a public client-metadata URL, PAR, DPoP-bound tokens, and a session store. That's the next step, not this one.

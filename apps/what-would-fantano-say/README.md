# What Would Fantano Say?

> **What it proves:** an RWSDK app on Rusty Buns can spend an API key safely in public: the secret comes from 1Password through varlock, and a rate limit, Turnstile and an edge cache sit in front of the one paid call. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Drop a track (or paste a YouTube link) and get a parody review in the style of a very online music critic: a score, a verdict (*light 4*, *strong 8*), the best and worst bits. It's a joke site, labelled as parody, not affiliated with anyone real.

## How it stays cheap

- **The song never leaves the browser.** `src/analyze.ts` decodes it with Web Audio and measures tempo, loudness, dynamic range, bass and brightness. It's plain TypeScript with no FFT and no WASM, and it takes milliseconds. The Worker gets about 200 bytes of numbers. There's no upload, R2 or storage.
- **A YouTube link becomes a title, not a download.** The Worker reads the video id and asks YouTube's public oEmbed for the title. Nothing else is fetched.
- **Boxes, not transcripts.** `src/boxes.ts` holds a dozen hand-written archetypes ("abrasive experimental rap", "committee radio pop"…), each with how the critic tends to take that kind of record. The server picks the nearest three from the numbers and the "sounds like" hint, and the model judges against them.
- **One Claude call per review**, with structured output and low effort. Identical requests come from the edge cache for a day.

## The door in front of the key

`src/api.ts`, in order:

1. Bodies over 8 KB are refused, and every field is clamped and trimmed (`parseRequest`).
2. `REVIEW_LIMIT` (Workers Rate Limiting, free): 4 reviews a minute per address.
3. Turnstile's siteverify, before any model call.
4. With no `ANTHROPIC_API_KEY`, or no Turnstile, the review is **canned** (`src/fake.ts`). A half-configured deploy never spends.

The listener's text goes into the prompt fenced in tags and the system prompt treats it as data. The page sends a strict CSP. Set a monthly spend limit on the Anthropic key as well: that's the backstop that actually caps the bill.

## Run it

```sh
cd apps/what-would-fantano-say
bun run dev       # http://localhost:5173, canned reviews, $0
bun test test     # analysis, boxes, request checks, the door
```

## Deploy

Secrets live in 1Password vault `fantano` (`.env.schema`): `anthropic/api-key` and `turnstile/secret`. Both are optional. Then:

1. Create a Turnstile widget for the hostname and put its site key in `turnstileSiteKey` in `rustybuns.config.ts`.
2. `bun run gen` to refresh `wrangler.jsonc` and `.env.schema`, then `bun run deploy`. That runs `rustybuns deploy`, and varlock unlocks the secrets with Touch ID.

`REVIEW_MODEL` picks the model (default `claude-opus-5-5`). `claude-haiku-5-5` is about 40× cheaper per review.

## Not built yet

The boxes are written by hand. Building them from the critic's actual reviews (scores plus a one-line take each, kept offline) is a follow-up.

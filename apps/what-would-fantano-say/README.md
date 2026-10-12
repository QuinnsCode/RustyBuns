# What Would Fantano Say?

> **What it proves:** an RWSDK app on Rusty Buns can put a paid model in front of the public and still cost about $4 per 100,000 uses: the phone does the heavy lifting, and a rate limit, Turnstile, an edge cache and a daily budget sit in front of the one Workers AI call. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Pick a track, drag to your best 15 seconds, and get a parody review in the style of a very online music critic: a score, a verdict (*light 4*, *strong 8*), the best and worst bits, and a share button. It's a joke site, labelled as parody, not affiliated with anyone real. Phone first; on desktop it's the same single column.

## How a review works

1. **On the phone** (`src/app/Critic.tsx`, `src/analyze.ts`, `src/clip.ts`): the browser decodes the file at 16 kHz mono. That covers anything it can play: mp3, wav, m4a/aac, flac, ogg/opus, and the audio in mp4/mov/webm. It then measures tempo, loudness, dynamic range, bass and brightness, suggests the loudest 15 s, and lets you drag the window and preview it. Only that clip leaves the device, as a 480 KB WAV.
2. **On the Worker** (`src/api.ts`): the numbers narrow twelve hand-written boxes (`src/boxes.ts`) to the six nearest. **Clef-omni**, Cloudflare's audio-capable decision model on Workers AI, listens to the clip and answers three typed questions (`src/judge.ts`): which of those six boxes it is, how well made, and how original. It returns probabilities, not text, so nobody can talk it into saying anything.
3. **The text** (`src/write.ts`) comes from templates: Clef's answers set the box and the tone, and the phone's numbers set the best and worst bits. The same clip always gets the same review.

## What it costs

Clef-omni bills $0.15 per million input tokens and about 13 tokens a second of audio. A 15 s clip plus the questions is roughly 300 tokens, about **$0.00004 a review, or ~$4 per 100,000**. `CLIP_SECONDS` in `src/clip.ts` is the lever: 30 s roughly doubles the audio part. These are the docs' numbers; check the first real bills against them.

## The door in front of the model

`src/api.ts`, in order:

1. Bodies over ~650 KB are refused. Every field is clamped and trimmed, and the clip must be a base64 WAV data URL no bigger than a 15 s clip (`parseRequest`).
2. `REVIEW_LIMIT` (Workers Rate Limiting, free): 4 reviews a minute per address.
3. Turnstile's siteverify, before anything is spent.
4. The edge cache: the same clip and questions are answered for free for a day.
5. `BUDGET`, one Durable Object counting today's Clef calls (`src/budget-do.ts`). Past `DAILY_REVIEWS` (25,000, so ~$1 a day at worst) reviews fall back to the free estimate until midnight UTC. Workers AI has no spend cap of its own, so this is the backstop.

With no Turnstile secret, or no AI binding, or a failing call, the review is the **estimate**, worked out from the numbers alone for free, and the card says so. Local dev never has the secret, so it never spends, even though Wrangler connects the AI binding remotely and warns that it could.

## Run it

```sh
cd apps/what-would-fantano-say
bun run dev       # http://localhost:5173: estimated reviews, $0
bun test test     # analysis, clip, boxes, judge, writer, budget, the door
```

## Deploy

The only secret is `turnstile/secret` in the 1Password vault `fantano` (`.env.schema`). Then:

1. `bunx rustybuns add deploy` once, to install the pinned Alchemy set.
2. Create a Turnstile widget for the hostname and put its site key in `turnstileSiteKey` in `rustybuns.config.ts`.
3. `bun run gen` to refresh `wrangler.jsonc` and `.env.schema`, then `bun run deploy`. That runs `rustybuns deploy`, and varlock unlocks the secret with Touch ID.

## Not built yet

- The boxes are written by hand. Building them from the critic's actual reviews is a follow-up.
- A file the browser can't decode (wma, some ALAC on Chrome) gets an error. Converting those on the device too (ffmpeg.wasm, loaded only when needed) is a follow-up.

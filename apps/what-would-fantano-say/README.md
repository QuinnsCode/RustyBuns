# What Would Fantano Say?

> **What it proves:** an RWSDK app on Rusty Buns can put a paid model in front of the public and still cost about $5 per 100,000 uses: the phone does the heavy lifting, and a rate limit, Turnstile, an edge cache and a daily budget sit in front of the one Workers AI call. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Pick a track, drag to your best 15 seconds, and get a parody review in the style of a very online music critic: a score, a verdict (*light 4*, *strong 8*), the best and worst bits, and a share button. It's a joke site, labelled as parody, not affiliated with anyone real. Phone first; on desktop it's the same single column.

## How a review works

1. **On the phone** (`src/app/Critic.tsx`, `src/analyze.ts`, `src/clip.ts`): the browser decodes the file at 16 kHz mono. That covers anything it can play: mp3, wav, m4a/aac, flac, ogg/opus, and the audio in mp4/mov/webm. When it can't (wma, ALAC on Chrome, odd aiff), `src/decode.ts` falls back to **ffmpeg.wasm**, still on the device: `src/app/ffmpeg.ts` is its own chunk, imported only after a decode fails, and fetches the pinned ~30 MB core from jsDelivr (too big for Workers assets) once per visit. The first load never pays for it. It then measures tempo, loudness, dynamic range, bass and brightness, suggests the loudest 15 s, and lets you drag the window and preview it. Only that clip leaves the device, as a 480 KB WAV.
2. **On the Worker** (`src/api.ts`): the numbers narrow twelve boxes (`src/boxes.ts`, see [the boxes](#the-boxes)) to the six nearest. **Clef-omni**, Cloudflare's audio-capable decision model on Workers AI, listens to the clip and answers four typed questions (`src/judge.ts`): which of those six boxes it is, how well made, how original, and whether it's music at all. It returns probabilities, not text, so nobody can talk it into saying anything.
3. **The text** (`src/write.ts`) comes from templates: Clef's answers set the box and the tone, the phone's numbers set the best and worst bits, and it ends on one of his real reviews in that box with a score near this one. The same clip always gets the same review.

Two gags replace the review, for next to nothing. A title or hint that names the critic ("fantano", "needle drop", "melon") gets his own cheesy self-review: *"Well hey, what is going on here? I know me when I know me."* A clip Clef hears as speech with no music behind it gets told it's a podcast. That's the fourth question, which adds about 20 tokens to the call it's already making. Nothing tries to recognise his actual voice: no cheap model does that reliably, and identifying a real person by voice isn't something a parody site should do.

## The boxes

Each box is half written by hand, half built from his real reviews. The hand-written half is the parody: the name, the hint words, the numbers a typical track has, and a one-line take. The real half is where his scores for that kind of record land (the middle half of them), the artists he's reviewed most there, and one actual review per score he's given in that box.

`scripts/build-boxes.ts` builds the real half offline, once. Nothing in the app fetches it, and nothing here calls a paid API:

```sh
bun scripts/build-boxes.ts            # or: bun scripts/build-boxes.ts path/to/reviews.csv
```

- **Scores** come from [andrewjleung/tnd-reviews](https://github.com/andrewjleung/tnd-reviews) (MIT), a public CSV of about 2,650 scored reviews with their genres, pinned to one commit and checked by hash. Each album goes in the box of its first genre that a rule in `RULES` matches. About one in eight has only joke genres and goes nowhere.
- **Takes** come from transcripts you pull by hand, one per album, into `data/transcripts/Artist - Title.txt`. The take is what he says just before the score. That folder is gitignored: only the one-line takes get committed, never the transcripts.
- It writes `data/albums.json` (every album with its score and take, grouped by box; committed, not bundled) and `src/boxes.data.json` (the per-box summary that ships in the Worker, about 14 KB).

Pulling transcripts is the slow, manual part, and the dataset stops in mid-2023. Until some are pulled, the reviews carry scores, not takes.

## What it costs

Clef-omni bills $0.15 per million input tokens and about 13 tokens a second of audio. A 15 s clip plus the questions is roughly 320 tokens, about **$0.00005 a review, or ~$5 per 100,000**. `CLIP_SECONDS` in `src/clip.ts` is the lever: 30 s roughly doubles the audio part. These are the docs' numbers; check the first real bills against them.

## The door in front of the model

`src/api.ts`, in order:

1. Bodies over ~650 KB are refused. Every field is clamped and trimmed, and the clip must be a base64 WAV data URL no bigger than a 15 s clip (`parseRequest`).
2. `REVIEW_LIMIT` (Workers Rate Limiting, free): 4 reviews a minute per address.
3. Turnstile's siteverify, before anything is spent.
4. The edge cache: the same clip and questions are answered for free for a day.
5. `BUDGET`, one Durable Object counting today's Clef calls (`src/budget-do.ts`). Past `DAILY_REVIEWS` (25,000, so ~$1.20 a day at worst) reviews fall back to the free estimate until midnight UTC. Workers AI has no spend cap of its own, so this is the backstop.

With no Turnstile secret, or no AI binding, or a failing call, the review is the **estimate**, worked out from the numbers alone for free, and the card says so. Local dev never has the secret, so it never spends, even though Wrangler connects the AI binding remotely and warns that it could.

## How it's set up

One Worker, declared in `rustybuns.config.ts` (RWSDK entry `src/worker.tsx`, static assets from `dist/client`). `wrangler.jsonc` is generated from it for local dev only; Alchemy owns the real infra. Nothing is stored.

| Binding | What it is | Used for |
| --- | --- | --- |
| `AI` | Workers AI | the Clef-omni call (`src/judge.ts`) |
| `BUDGET` | Durable Object `ReviewBudget` | counts today's Clef calls (`src/budget-do.ts`) |
| `DAILY_REVIEWS` | var, `25000` | the budget's ceiling |
| `REVIEW_LIMIT` | rate limit, 4 per 60 s | per-address throttle |
| `TURNSTILE_SITE_KEY` | var, public | shows the widget; empty means no live calls |
| `TURNSTILE_SECRET` | secret, `op://fantano/turnstile/secret` | siteverify, resolved by varlock at deploy |

Leave out any of `AI`, `BUDGET`, the site key or the secret and every review is the free estimate, which is all local dev ever gets.

## Run it

```sh
cd apps/what-would-fantano-say
bun run dev       # http://localhost:5173: estimated reviews, $0
bun test test     # analysis, clip, decode fallback, boxes and their build, judge, writer, budget, the door
```

## Deploy

The only secret is `turnstile/secret` in the 1Password vault `fantano` (`.env.schema`). Then:

1. `bunx rustybuns add deploy` once, to install the pinned Alchemy set.
2. Create a Turnstile widget for the hostname and put its site key in `turnstileSiteKey` in `rustybuns.config.ts`.
3. `bun run gen` to refresh `wrangler.jsonc` and `.env.schema`, then `bun run deploy`. That runs `rustybuns deploy`, and varlock unlocks the secret with Touch ID.

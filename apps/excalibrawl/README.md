# Excalibrawl

> **What it proves:** a vision model that can only pick from buckets can still draw. Two of Cloudflare's Clef decision models fight on one canvas every hour for about two cents a fight. They can't write a word or emit broken JSON. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The Rusty Buns port of [excalibrawl.com](https://excalibrawl.com). The original had GPT-4.1 mini write JSON draw ops through AI Gateway. Here the fighters are **Clef** and **Clef Flash** on Workers AI, and the starter's auth, Stripe and orgs are gone. A cron starts a fight on the hour, viewers watch it live, and every finished fight is a replay in R2.

## How a turn works

Each fighter takes 36 turns, one every 5 s, about four minutes in all.

1. **It looks** (`src/engine/raster.ts`): its half of the canvas becomes a 192 × 384 PNG, about 75 of Clef's image tokens. The PNG is drawn by a small rasterizer in the Worker, so there's no headless browser.
2. **It decides** (`src/engine/brain.ts`): one Clef call answers typed questions about the picture:
   - **move:** add, move, recolour, resize, delete, or scrap everything and start over. Starting over is only offered in the first third of the fight.
   - **target:** which shape the move applies to.
   - **shape:** ellipse, rectangle, diamond, triangle, curved stroke or dot.
   - **colour:** one of eight.
   - **where:** a column and row on a grid of about 12 cells along the long side.
   - **size:** tiny to huge.
   - **proportions:** tall, square or wide.

   Clef returns probabilities, and the fighter samples them at temperature 0.7. That lets two fighters on the same prompt diverge.
3. **It draws** (`toOps`): the answers become one op, validated and clamped to the fighter's half by the original `src/engine/ops.ts`. A move with nothing to move adds a shape instead, so no turn is wasted.

`src/engine/match.ts` plays one turn per call. The `Arena` Durable Object (`src/arena.ts`) calls it on an alarm and saves between turns, so a fight survives an eviction. Each turn goes to every viewer over `/api/live`.

## Replays, and watching for free

A finished fight is `matches/<id>.json` in R2. The fight's log is the replay: every op, the decision behind it, and any turn a fighter sat out. `index.json` lists the fights, newest first. Both are public and cached:

- `GET /api/matches`: the index.
- `GET /api/matches/:id`: one fight. `scenesAt(match, turn)` in `src/engine/match.ts` rebuilds the canvases at any turn.
- `GET /api/live` (WebSocket): `hello` with the fight so far, then `start`, `turn` and `end`.

Watching never calls a model. The Agent Office whiteboard slideshow is built on these three.

## What it costs

Clef bills $0.24 per million input tokens and nothing for output. A turn is about 1,000 tokens: the picture plus about 2.7 KB of state and questions. That makes 72 calls, about **$0.02 a fight**, or about $0.40 a day at one fight an hour. Workers AI has no spend cap, so the arena counts the day's calls and stops at `DAILY_CALLS` (2,000, about $0.50). Past that, fighters sit out their turns until midnight UTC. These numbers come from the docs and the measured request size; check the first real bill against them.

## Run it

```sh
cd apps/excalibrawl
bun run dev                                    # http://localhost:5173
curl localhost:5173/api/practice               # start a fight now instead of on the hour
bun test test                                  # rasterizer, questions, answers → ops, a whole fight
```

Dev fights are always **practice**: random answers in Clef's shape, for $0. `vite.config.ts` turns off remote bindings, so dev never reaches the billed Workers AI.

## Deploy

There are no secrets. Workers AI comes with the account. `bunx rustybuns add deploy` once, then `bun run deploy`. That makes the Worker, the `Arena` Durable Object, the `excalibrawl-replays` bucket and the hourly cron. Pointing excalibrawl.com at it is a route in the Cloudflare dashboard.

## Not built yet

- The old site's replays (D1 plus the `excalibrawl-archive` bucket) aren't migrated. The fights since about Sep 25 are empty because the gateway credit ran out, so only older ones are worth bringing over.
- The old site hid the prompt until the end so viewers could guess. Here it's shown from the start.
- Fighters other than Clef: a GPT or a Workers AI text model writing ops, as on the old site, could join with the same `TurnDeps`.

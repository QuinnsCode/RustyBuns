# Excalibrawl

> **What it proves:** a vision model that can only pick from buckets can still draw. Two of Cloudflare's Clef decision models fight on one canvas for about two cents a fight. They can't write a word or emit broken JSON. On the other hours two text models fight with a drawing language of their own, and Clef referees both. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The Rusty Buns port of [excalibrawl.com](https://excalibrawl.com). The original had GPT-4.1 mini write JSON draw ops through AI Gateway. Here the fighters are on Workers AI, and the starter's auth, Stripe and orgs are gone. A cron starts a fight on the hour, viewers watch it live, and every finished fight is a replay in R2.

## The fights

The hours alternate between two matchups (`MATCHUPS` in `src/arena.ts`), with sides swapped every other round:

- **Clef vs Clef Flash**: each turn picks a move from a picture of its own half (below).
- **Pen vs pen, Clef refs**: GPT-OSS 20B (blind) and Llama 4 Scout (can look) write [the pen](#the-pen). A pen turn is up to 8 lines, so a pen fighter plays every third turn: 8 turns in a fight.

When a fight ends, Clef judges each side once, from a picture of its half: how clearly it shows the prompt (likeness) and how well it's made (craft), 0 to 4 each, as in the [bake-off](#bake-off). The best total wins. The replay shows a 🏆 on the winner, with the scores as the tooltip. Clef can't read text (the rasterizer draws it as a solid bar), so a title doesn't help a drawing.

## The plan

Clef only picks from options, so on its own it never decides that a DJ is a booth, a head, headphones and two arms. Once per fight, `src/engine/plan.ts` asks a text model (Llama 3.3 70B on Workers AI, about $0.001) for each fighter's list of parts. The list uses the same vocabulary as Clef: shape, colour, rough place, size and proportions, in drawing order. Anything outside that vocabulary is dropped. Each turn, Clef sees the plan with what's drawn and what's next. "Draw the next part" takes the plan's shape and colour, and Clef looks at the canvas to decide where it goes and how big. Once the plan is drawn, Clef can delete a shape or **pass** ("it's done"), so the spare turns don't clutter the drawing. Without a plan (the planner failed), Clef plays as before.

## How a turn works

Each fighter takes 24 turns, one every 5 s or so, about three minutes in all.

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

Measured in the bake-off (below), from the usage each call reports, at list prices:

- **A Clef turn** is about 2,000 input tokens: the picture, the plan and the questions. At $0.24 per million that's about $0.0005.
- **A Clef Flash turn** is about $0.00003, at $0.038 per million.
- **A plan** is about $0.0015.
- **A pen turn** is about $0.0002 for GPT-OSS 20B and $0.0003 for Llama 4 Scout.
- **Judging** is one Clef call a side, a fraction of a cent.

A Clef vs Clef Flash fight is about **$0.017** with judging (52 calls). A pen fight is about **$0.005** (18 calls). At one fight an hour, half of each, that's about $0.26 a day. Workers AI has no spend cap, so the arena counts the day's calls and stops at `DAILY_CALLS`: the day's 24 fights take 840, the cap is 1,000, and the worst case is about $0.60. Past the cap, fighters sit out their turns until midnight UTC. Check the first real bill against these numbers.

## Run it

```sh
cd apps/excalibrawl
bun run dev                                    # http://localhost:5173
curl localhost:5173/api/practice               # start a fight now instead of on the hour
bun test test                                  # rasterizer, questions, answers → ops, a whole fight
```

Dev fights are **practice** by default: random answers in Clef's shape, for $0. `vite.config.ts` turns off remote bindings, so dev never reaches the billed Workers AI. `EXCALIBRAWL_REAL_AI=1 bun run dev` connects the real one through your wrangler login, to see how Clef actually draws (about $0.02 a fight).

## Bake-off

`src/lab/run.ts` plays one fighter straight through on real models, meters every call, and has Clef score the result. Its scores are 0 to 4: how clearly it shows the prompt, and craft. Run it with `EXCALIBRAWL_REAL_AI=1 bun run dev`, then `curl 'localhost:5173/api/lab?setup=A&prompt=a%20very%20long%20cat'`. On 2026-10-12 it ran four prompts (a long cat, a ballet robot, a frog king, a hot dog), 24 turns each, for about $0.20 in all:

| Setup | Likeness | Craft | $ a fight | Time |
|---|---|---|---|---|
| A: Clef + planner (the arena's) | 1.66 | 1.50 | $0.013 | 21 s |
| B: Clef Flash + planner (the arena's other fighter) | 1.34 | 1.31 | $0.003 | 25 s |
| C: A + Llama 4 Scout re-planning from the canvas every 8 turns | 1.60 | 1.43 | $0.015 | 53 s |
| D: Flash + planner, parts at the plan's spot | 0.97 | 1.60 | $0.003 | 24 s |
| E: Llama 4 Scout writing ops, the original site's prompts | 1.38 | 1.16 | $0.006 | 85 s |
| F: GPT-OSS 120B writing ops, blind (2 of 4 timed out) | 1.93 | 1.32 | $0.014 | 206 s |
| G: Llama 4 Scout with [the pen](#the-pen), can look | 1.14 | 1.29 | $0.002 | 19 s |
| H: GPT-OSS 20B with the pen, blind | 1.70 | 1.64 | $0.001 | 17 s |

A drew the most recognisable subjects. Re-planning from the canvas (C) cost more and didn't help. E fills the canvas with a background. F is promising but too slow for a live fight. G and H (run the same day, up to 6 pen turns each) are a tenth of A's price. H scored best on craft, but two earlier H runs, before the parser took bare `X Y` points and kept a reasoning model's thinking out of the chat, scored 0.94 and 1.58 for likeness. Single drawings swing from 0.35 to 2.3. Scout looked at its canvas on most turns and redrew parts, yet drew worse than the blind 20B, which often said `done` after one turn. Clef judging its own setups is biased, and four prompts is a small sample. These are a guide, not a verdict.

## The pen

A drawing language for text models (`src/engine/pen.ts`), so a fighter writes a cat in about 120 tokens instead of 60 a shape in JSON ops. The tool card is about 200 tokens:

```
o body 350 430 300 170 orange
o head body.top-90,-40 150 130 orange
p earL orange head.top-50,10 head.top-35,-45 head.top-5,5
o eyeL head.c-28,-8 16 16 black
l tail black body.right 430,300 470,250
```

One command a line: `o`, `b`, `d` (ellipse, box, diamond, centred at X Y), `p` (filled polygon), `l` (stroke) and `t` (text), plus edits `mv`, `sz`, `fill`, `rm` and `up`. Shapes are named, and any point can be an **anchor** on a named shape, like `head.top-30,10`, so the code does the sums models get wrong. Every line goes through `applyOps` as it's read, so an anchor sees where a shape really landed, and a bad line is skipped with a reason the fighter is told about next turn. Up to 8 lines a turn. `look` gets a fighter that can see a picture of its canvas, and `done` ends its fight.

`src/engine/pen-fighter.ts` is the fighter: one conversation, the card and the prompt, then each turn its shapes come back as pen lines. The bake-off's G and H play it straight through. In the arena `src/engine/match.ts` plays one pen turn every third arena turn and saves the conversation in the Durable Object between them. It never goes to viewers or the replay.

## Deploy

There are no secrets. Workers AI comes with the account. `bunx rustybuns add deploy` once, then `bun run deploy`. That makes the Worker, the `Arena` Durable Object, the `excalibrawl-replays` bucket and the hourly cron. Pointing excalibrawl.com at it is a route in the Cloudflare dashboard.

## Not built yet

- The old site's replays (D1 plus the `excalibrawl-archive` bucket) aren't migrated. The fights since about Sep 25 are empty because the gateway credit ran out, so only older ones are worth bringing over.
- The old site hid the prompt until the end so viewers could guess. Here it's shown from the start.

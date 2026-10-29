# Orbit to ground: what winning the sky should buy below

`bun scripts/interplay.ts` (16 s on a laptop, every number seeded; `--seeds` and `--wars` shrink it). Two layers.

## Method

1. **One ground battle** (layer A) is a tickets-and-posts model in the script, not the three.js sim: four or five posts in a line,
   the last the defender's keep with its turrets; each side fields waves up to the sim's troop cap (4 + 3 an army, 14 at most,
   the defender's garrison two more) out of its tickets (50 an army), 20 s from the front; troopers kill at a rate set by numbers,
   with a run of luck a wave and a form for the day a side; the front moves with the difference and a post flips as it passes;
   the side holding fewer posts bleeds the difference every 4 s (a tie bleeds the attacker), as in sim.ts.
2. Its constants were set against **60 real headless battles** (sim.ts, AI against AI, no assist, 12 a ratio): the attacker won
   58% at 3v3 in 241 s, 17% at 2v3, 92% at 3v2, 0% at 2v4, 92% at 4v2; battles ran 90-303 s, median 188 s. The model lands
   within a few points of each (first table), but overruns every post by 90 s more often than the real sim (10% at 1:1 against
   0 of 24), so its rushes are a stern test of a trickle.
3. Three reinforcement models for the orbit's holder: **today**, one drop of min(40, 8 a ship) at half tickets; a **trickle** of
   R tickets a minute a ship in pods every 20 s, T in all, landing only while the holder has a post to land on (overrun = cut
   off); the trickle **delayed** D s. R in {5, 10, 15, 20}, T in {50, 75, 100, 150}, D in {0, 30, 60, 90}, ships in {1, 2, 3, 5},
   holder:enemy armies 1:1 (3v3), 2:3, 3:2, 1:2 (2v4), 2:1, the holder attacking and defending; 400 seeds a cell, 200 in the sweep.
4. **The campaign** (layer B) is the real engine (newCampaign, aiOrders, declareAttacks, aiRetreats, resolveTurn, deployTurn,
   aiDeploys), AI against AI on the short map, 200 seeds a setting, up to 40 turns, under today's landing constants and five
   variants. landing.ts got a `LandingRules` options object (defaults are today's constants) and `Campaign.landing` carries it.
5. "Rush" below: the enemy holds every post at some moment in the first 90 s; "rush wins" is how often it then wins the battle.

## A. One ground battle

The model with no orbit, against the real sim's shape:

| no orbit, holder:enemy | wins as attacker | wins as defender | overrun by 90 s | length |
|------------------------|-----------------:|-----------------:|----------------:|-------:|
| 1:1                    |              49% |              51% |             10% |  248 s |
| 2:3                    |               8% |              12% |             28% |  177 s |
| 3:2                    |              89% |              92% |              1% |  177 s |
| 1:2                    |               4% |               3% |             36% |  166 s |
| 2:1                    |              97% |              97% |              0% |  166 s |

The holder's win rate by model, two ships over the world (the fleet that usually wins a contested sky):

| holder:enemy, role | none | today | trickle 20/100/0 | trickle 20/100/60 | trickle 20/150/0 |
|--------------------|-----:|------:|-----------------:|------------------:|-----------------:|
| 1:1 as attacker    |  49% |   54% |              68% |               68% |              75% |
| 1:1 as defender    |  51% |   54% |              70% |               70% |              77% |
| 2:3 as attacker    |   8% |   10% |              19% |               19% |              22% |
| 2:3 as defender    |  12% |   14% |              24% |               24% |              32% |
| 3:2 as attacker    |  89% |   90% |              95% |               95% |              98% |
| 3:2 as defender    |  92% |   93% |              96% |               96% |              98% |
| 1:2 as attacker    |   4% |    4% |               8% |                8% |              12% |
| 1:2 as defender    |   3% |    5% |              12% |               12% |              17% |
| 2:1 as attacker    |  97% |   98% |              99% |               99% |             100% |
| 2:1 as defender    |  97% |   97% |             100% |              100% |             100% |

Ships over the world, today's drop against the trickle, and a cap that grows with the fleet (overrun and rush at 1:1):

| model, ships                     | 1:1 att | 1:1 def | 2:3 att | 2:3 def | tickets landed | overrun | rush wins |
|----------------------------------|--------:|--------:|--------:|--------:|---------------:|--------:|----------:|
| today, 1 ship                    |     51% |     52% |      9% |     13% |              7 |     10% |       99% |
| today, 2 ships                   |     54% |     54% |     10% |     14% |             14 |     10% |       99% |
| today, 3 ships                   |     56% |     55% |     11% |     14% |             22 |     10% |       99% |
| today, 5 ships                   |     59% |     59% |     12% |     17% |             36 |     10% |       99% |
| trickle 20/100/60, 1 ship        |     68% |     70% |     19% |     24% |             55 |     10% |       96% |
| trickle 20/100/60, 2 ships       |     68% |     70% |     19% |     24% |             74 |     10% |       96% |
| trickle 20/100/60, 3 ships       |     68% |     70% |     19% |     24% |             80 |     10% |       96% |
| trickle 20/100/60, 5 ships       |     68% |     70% |     19% |     24% |             87 |     10% |       96% |
| trickle 20/50 a ship/60, 1 ship  |     61% |     60% |     14% |     17% |             36 |     10% |       99% |
| trickle 20/50 a ship/60, 2 ships |     68% |     70% |     19% |     24% |             74 |     10% |       96% |
| trickle 20/50 a ship/60, 3 ships |     75% |     77% |     22% |     32% |            113 |     10% |       89% |
| trickle 20/50 a ship/60, 5 ships |     75% |     77% |     22% |     32% |            124 |     10% |       89% |

Rate against cap at D = 60 s, two ships, at 1:1 (holder wins / tickets landed / a rush still wins):

| R \ T |             50 |             75 |            100 |             150 |
|-------|---------------:|---------------:|---------------:|----------------:|
| 5     | 60% / 34 / 99% | 62% / 35 / 99% | 62% / 35 / 99% |  62% / 35 / 99% |
| 10    | 61% / 44 / 99% | 65% / 60 / 97% | 69% / 70 / 96% |  73% / 76 / 95% |
| 15    | 61% / 47 / 99% | 65% / 67 / 97% | 69% / 84 / 96% | 75% / 107 / 91% |
| 20    | 61% / 48 / 99% | 65% / 70 / 97% | 69% / 90 / 96% | 76% / 123 / 89% |

The delay before the first pods, R = 20, T = 100, two ships (overrun, rush and length at 1:1):

| D    | 1:1 att | 1:1 def | 1:2 att | 1:2 def | overrun | rush wins | length |
|------|--------:|--------:|--------:|--------:|--------:|----------:|-------:|
| 0 s  |     68% |     70% |      8% |     12% |     10% |       96% |  300 s |
| 30 s |     68% |     70% |      8% |     12% |     10% |       96% |  299 s |
| 60 s |     68% |     70% |      8% |     12% |     10% |       96% |  297 s |
| 90 s |     68% |     70% |      8% |     12% |     10% |       96% |  294 s |

## B. The campaign

200 AI-against-AI wars a row on the short map; the setting is WIDE_ORBIT/OPEN_SKY/SEALED_BY/SIEGE_TURNS. An "orbit win" is a
sky changing hands (or an empty one taken) over a world where the enemy still holds ground; it "landed" if the new holder owns
a sector there it didn't at the start of that turn, by the end of the next. "Narrows fought" is a space battle over Kessa or
Lumen at some point in the war; "its loser loses" is how often the side that lost the first of them lost the war.

| skies                  | turns | Marines win | orbit wins a war | landed by next turn | Narrows fought | its loser loses | turned back a war |
|------------------------|------:|------------:|-----------------:|--------------------:|---------------:|----------------:|------------------:|
| today 3/4/3/2          |   9.9 |         51% |             11.2 |                 93% |           100% |             60% |               4.6 |
| open 2/6/4/3           |  10.4 |         47% |             11.7 |                 92% |           100% |             59% |               4.5 |
| tight 4/2/2/1          |   9.4 |         50% |             10.7 |                 94% |           100% |             63% |               4.7 |
| always wide 1/4/3/2    |   9.9 |         51% |             11.2 |                 93% |           100% |             60% |               4.6 |
| never wide 99/4/3/2    |   9.9 |         51% |             11.2 |                 93% |           100% |             60% |               4.6 |
| one ship seals 3/4/1/2 |   9.4 |         49% |             10.8 |                 94% |           100% |             62% |               4.7 |

Every war finished inside 40 turns. Four percentage points is the noise at 200 wars.

## Recommendation

- **Trickle, not a drop.** Pods every 20 s at a post the holder still holds, **R = 15 tickets a minute a ship**, **T = min(100,
  50 × ships)**, **D = 60 s** before the first. Nothing lands while the holder has no post (the pods wave off and come back once
  a post is retaken). At two ships that makes the orbit worth about 70% at even odds (from 50%), doubles the holder's chances
  when it's outnumbered 2:3 (10% to about 20%), lands 70-85 tickets over a typical battle and 100 in a long one, and an even
  enemy that takes every post by 90 s still wins 96 times in 100. One ship brings an army's worth (about 60%); two or more
  bring two. Today's drop (14 tickets at two ships, +3 to +5 points) is not felt and goes.
- **Rate only has to deliver the cap.** Battles run three to four minutes AI against AI, so R = 5 never lands its cap (35
  tickets, 62%); from R = 10 up the win rate is set by T alone (61% at T = 50, 65% at 75, 69% at 100, 73-76% at 150). T = 150
  is where it starts to feel like a lock (76%, 110-125 landed), so stop at 100. If three or more ships should feel like a wall,
  raise the ceiling to 150 for `ships >= 3` (76%, and a 1:1 rush still wins 89%); that's a feel call, the band the owner gave
  is 50-100.
- **The delay is free.** D from 0 to 90 s changes nothing measurable; close battles run long enough to land the cap anyway, and
  one-sided ones are over before the pods matter. What keeps a fast rush viable is the cut-off rule, not the delay: with pods
  landing regardless of posts, the same rush would face the full cap. Keep D = 60 so the first pod comes after first contact
  (about 25-40 s in) and reads as an answer to it, not a head start.
- **Landing constants: keep 3/4/3/2.** Across 1,200 wars no variant moved any measure past the noise. WIDE_ORBIT has literally
  no effect in AI play (the AI lands every transport into the one thinnest enemy sector, so the wide front is never used), and
  OPEN_SKY, SEALED_BY and SIEGE_TURNS only bite on landings sent through a sky the sender didn't win, which the AI does only by
  accident (4.6 transports a war turned back). They're a lever for human play, and the right setting is one to judge by feel
  with a person at the table; the sim says there's no balance reason to move them. If the owner wants the sky to matter more
  on the map, SEALED_BY = 2 is the knob that bites soonest (one enemy ship cuts the landing to one, two seal it), and the
  options object makes trying it a one-line change.
- **In the engine:** `applyBattleResult` scales survivors by `tickets / (tickets + reinforcements)`; with a trickle the divisor
  must be what actually landed, so `BattleResult` should carry `landed: PerSide<number>` (or the sim's `reinforced` totals),
  else survivors are undercounted after a short battle.

## What the trickle looks like in the ground sim

- `BattleSpec.reinforcements` becomes the cap (`min(100, 50 * ships)` for the orbit's holder, 0 otherwise) and gains a rate:
  `reinforcements: PerSide<{ cap: number; perMinute: number }>`, `perMinute = 15 * ships`. `POD_EVERY = 20` and `POD_AFTER = 60`
  are sim.ts constants beside `DIG_DROP`.
- In `step`, with the bleed and the waves: every POD_EVERY s after POD_AFTER, for a side with cap left that holds at least one
  post, land `n = min(cap - landed, perMinute / 3)` tickets: `b.tickets[side] += n`, and `round(n)` troopers (Wooka for the
  horde, the next class otherwise) come down around the held post nearest the front, the way the dig-in drop already does
  (`add` near the post, the drop's fx and rumble). Radio: `Drop pods on Fern hollow: +7 (67 of 100)`. With no post held, once:
  `Pods waved off: nowhere to land`, and they resume when a post is retaken.
- HUD, under the tickets: a pod line with a lucide icon (`arrow-down-to-line`), `Pods 67/100 · next 12 s`, greyed with
  `cut off` while no post is held; the enemy's pods land with `Enemy pods inbound` on the radio, so the player feels the
  sky they lost.
- The dig-in's own drop (`DIG_DROP`, 8 tickets) stays: it's earned on the ground and comes to either side.

## Surprising

- Today's orbit bonus is close to nothing on the ground: 14 tickets at two ships is a tenth of a 3-army side.
- Cap over rate. Past R = 10 a ship, landing more tickets faster doesn't raise the win rate at all (69% whether 70 or 90 land):
  the pods decide only the close battles, and those run long enough to land the cap at any rate.
- Battles are shorter than assumed: the real sim's AI-against-AI battles run 2-5 minutes (median 188 s at these sizes), not
  5-15, so "a minute" is a big unit on the ground; a hero playing well stretches them, which is where a trickle pays most.
- The campaign already couples the sky to the ground hard: 93% of orbit wins are followed by a landing within the turn or the
  next, every short-map war has a space battle over the Narrows, and the side that loses the first one loses the war 60% of
  the time. The landing constants are not what drives that; the AI's habit of landing only behind a fleet it just won with is.

## Limits

The battle model's overruns by 90 s (10% at 1:1) are commoner than the real sim's (0 of 24), so the rush figures are
conservative for the trickle. Only AI played both sides; a human hero changes the shape (handicap.ts), and the model has no
vehicles, surges, champions or dig-ins beyond their average effect on the kill rate. The campaign layer never fights a hero
battle, so the trickle's effect on a war is inferred from layer A, not measured; the dice battles' orbit bonus (cover, +1 on
the best die) is untouched by this.

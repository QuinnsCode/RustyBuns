# Two Fronts pre-verification, 2026-10-28

Issues: #2443, #2407, #2267, #2261. Run from main at a0bd966f (jump links, #2567), `bun run dev`, Chrome, plus
`bun apps/two-fronts/scripts/preverify.ts 8` (new: scripted player, every world x side x hero x assist, 8 seeds).

## Checked (applies to all four issues)

| Check | Result | Evidence |
| --- | --- | --- |
| Each world loads by jump link: forest, desert, city, beach, station | PASS | `window.twoFronts.state()` reports shield, canyon, capital, cannon, spaceport |
| Attacker and defender, each hero (default hero per side) lands in the named fight | PASS | state() side/hero match the link, 10 of 10 world x side |
| `end("win")` from each world and side lands on the result view | PASS | state() is null (no live battle) 2.5 s after `end` in 10 of 10 |
| `near=1` puts the AI 45 s into the fight | PASS | state().time 45-52 on drop |
| Console and page errors across all 10 jumps and results | PASS | 0 errors/unhandled rejections captured |
| Frame time, `?quality=low`, station attacking | PASS | median 8.3 ms, p95 10 ms (120 Hz display, 481 frames) |
| Frame time, default tier, all five worlds | PASS | median 8.3 ms, p95 9-10 ms |
| Balance assist on vs off differs | PASS | below: defender hero 89% on vs 98% off; `test/jump.test.ts` pins forces and sim help |
| Station bulkheads: units reach posts | PASS (sim) | no stuck unit; but see FAIL below |
| Battle reaches a result from each side, every world | PASS | 192 scripted battles, none timed out without a result |
| Layout at 390 px wide | **FAIL** | in a 390 px frame the controls hint wraps into a tall narrow column over the field and the post chips and top bar are clipped. Desktop and 820 px fine. The app is mouse and keyboard, so low priority, but nobody has filed it |
| Layout at 820 and 1440 px | PASS | no overflow, HUD intact (iframe screenshots; the extension cannot resize the window) |
| Station: Marines attacking take posts | **FAIL (balance)** | scripted hero won 1 of 32 attacking spaceport (Marines 1/16, Wooka 0/16), against 5-11 of 32 on other worlds |

Scripted bot win rates (hero side wins, 8 seeds per row; the bot is a poor stand-in for a person):

| Hero side | Assist on | Assist off |
| --- | --- | --- |
| Attacking | 19/96 (20%) | 16/96 (17%) |
| Defending | 85/96 (89%) | 94/96 (98%) |

Per world, attacking (marines/wooka), assist on: forest 4+2, desert 1+0, city 4+2, beach 3+0, station 1+0, jungle 2+0 (of 8 each).
Defending (marines/wooka): forest 5+8, desert 8+6, city 8+7, beach 7+7, station 8+7, jungle 7+7.
Full table: `scripts/preverify.ts` output, kept below.

Not reachable by an agent: pointer lock (the automation browser refuses it), so no hand driving.

<details><summary>Full output</summary>

```
shield     attacker marines assist on   hero won 4/8  tickets left 17  298s long  (5578 ms/battle)
shield     attacker marines assist off  hero won 3/8  tickets left 44  247s long  (5890 ms/battle)
shield     attacker wooka   assist on   hero won 2/8  tickets left 4  300s long  (3399 ms/battle)
shield     attacker wooka   assist off  hero won 3/8  tickets left 15  283s long  (3513 ms/battle)
shield     defender marines assist on   hero won 5/8  tickets left 54  326s long  (5370 ms/battle)
shield     defender marines assist off  hero won 6/8  tickets left 57  257s long  (3567 ms/battle)
shield     defender wooka   assist on   hero won 8/8  tickets left 29  320s long  (3969 ms/battle)
shield     defender wooka   assist off  hero won 8/8  tickets left 83  216s long  (2202 ms/battle)
canyon     attacker marines assist on   hero won 1/8  tickets left 11  233s long  (1726 ms/battle)
canyon     attacker marines assist off  hero won 0/8  tickets left -4  200s long  (1500 ms/battle)
canyon     attacker wooka   assist on   hero won 0/8  tickets left -1  206s long  (1299 ms/battle)
canyon     attacker wooka   assist off  hero won 0/8  tickets left -2  206s long  (1708 ms/battle)
canyon     defender marines assist on   hero won 8/8  tickets left 119  225s long  (2167 ms/battle)
canyon     defender marines assist off  hero won 8/8  tickets left 119  167s long  (1108 ms/battle)
canyon     defender wooka   assist on   hero won 6/8  tickets left 25  296s long  (2230 ms/battle)
canyon     defender wooka   assist off  hero won 8/8  tickets left 76  213s long  (1425 ms/battle)
capital    attacker marines assist on   hero won 4/8  tickets left 41  277s long  (3035 ms/battle)
capital    attacker marines assist off  hero won 3/8  tickets left 40  250s long  (2777 ms/battle)
capital    attacker wooka   assist on   hero won 2/8  tickets left 4  300s long  (2664 ms/battle)
capital    attacker wooka   assist off  hero won 3/8  tickets left 11  284s long  (2918 ms/battle)
capital    defender marines assist on   hero won 8/8  tickets left 118  252s long  (3092 ms/battle)
capital    defender marines assist off  hero won 8/8  tickets left 127  169s long  (1686 ms/battle)
capital    defender wooka   assist on   hero won 7/8  tickets left 55  262s long  (3954 ms/battle)
capital    defender wooka   assist off  hero won 8/8  tickets left 85  191s long  (2207 ms/battle)
cannon     attacker marines assist on   hero won 3/8  tickets left 31  261s long  (2555 ms/battle)
cannon     attacker marines assist off  hero won 1/8  tickets left 6  272s long  (3146 ms/battle)
cannon     attacker wooka   assist on   hero won 0/8  tickets left -1  243s long  (1845 ms/battle)
cannon     attacker wooka   assist off  hero won 2/8  tickets left 6  266s long  (2883 ms/battle)
cannon     defender marines assist on   hero won 7/8  tickets left 90  278s long  (3752 ms/battle)
cannon     defender marines assist off  hero won 8/8  tickets left 107  204s long  (3512 ms/battle)
cannon     defender wooka   assist on   hero won 7/8  tickets left 29  311s long  (5211 ms/battle)
cannon     defender wooka   assist off  hero won 8/8  tickets left 87  211s long  (4278 ms/battle)
spaceport  attacker marines assist on   hero won 1/8  tickets left 4  187s long  (2636 ms/battle)
spaceport  attacker marines assist off  hero won 0/8  tickets left -2  160s long  (1950 ms/battle)
spaceport  attacker wooka   assist on   hero won 0/8  tickets left -2  199s long  (2573 ms/battle)
spaceport  attacker wooka   assist off  hero won 0/8  tickets left -2  192s long  (6522 ms/battle)
spaceport  defender marines assist on   hero won 8/8  tickets left 106  279s long  (4686 ms/battle)
spaceport  defender marines assist off  hero won 8/8  tickets left 116  194s long  (3512 ms/battle)
spaceport  defender wooka   assist on   hero won 7/8  tickets left 33  293s long  (6727 ms/battle)
spaceport  defender wooka   assist off  hero won 8/8  tickets left 77  214s long  (2599 ms/battle)
jungle     attacker marines assist on   hero won 2/8  tickets left 18  286s long  (6994 ms/battle)
jungle     attacker marines assist off  hero won 1/8  tickets left 2  259s long  (5747 ms/battle)
jungle     attacker wooka   assist on   hero won 0/8  tickets left -2  244s long  (4167 ms/battle)
jungle     attacker wooka   assist off  hero won 0/8  tickets left 0  283s long  (4623 ms/battle)
jungle     defender marines assist on   hero won 7/8  tickets left 89  270s long  (5171 ms/battle)
jungle     defender marines assist off  hero won 8/8  tickets left 117  193s long  (3541 ms/battle)
jungle     defender wooka   assist on   hero won 7/8  tickets left 36  308s long  (5671 ms/battle)
jungle     defender wooka   assist off  hero won 8/8  tickets left 76  217s long  (3662 ms/battle)
attacker assist on     hero won 19/96 (20%)
attacker assist off    hero won 16/96 (17%)
defender assist on     hero won 85/96 (89%)
defender assist off    hero won 94/96 (98%)
```
</details>

## Paste-ready replacement issues

### #2443 (hero battle each side, handicap)

MANUAL RUN: Two Fronts hero battles from each side, taste only (10 min)
Part of #2409. Pre-checked 2026-10-28 (notes/preverify/two-fronts-2026-10-28.md): jump links load, results reach, no console errors. Scripted player: attacking wins about 20%, defending 89% with the assist (98% without). Whether that feels fair is yours.

1. `cd apps/two-fronts && bun run dev`, open `/?battle=1&world=forest&side=attacker&near=1`. Take the keep: hard but possible? Note result and tickets.
2. Open `/?battle=1&world=forest&side=defender&near=1`. Does the AI attacker with 45% more threaten the keep?
3. Reply: too easy, too hard, or about right, per side. That sets `HUMAN_HANDICAP` and `ATTACKER_HANDICAP`.

### #2407 (Marines and Wooka, assist)

MANUAL RUN: Two Fronts balance assist, how it feels (15 min)
Pre-checked: assist on/off differs (defender hero 89% vs 98% scripted), squad cover and handicap covered by `test/jump.test.ts`.

1. Marines: `/?battle=1&world=desert&side=defender&hero=marines&near=1`, then `...&side=attacker&hero=marines`. Wooka: same with `hero=wooka`. Roughly even against the AI?
2. Stay close to the squad, then ignore it: does staying together keep them alive longer?
3. Add `&assist=off` to one of them. Is the assist ever visible or does it feel like cheating? Is the AI a walkover either way?

### #2267 (station by hand)

MANUAL RUN: drive the Two Fronts station by hand (10 min)
Pre-checked: loads, result reached, no errors, low-tier 8.3 ms median. Only pointer lock needs your hands.

1. Open `/?battle=1&world=station&side=attacker` and again with `&map=yards`.
2. Walk and sprint through the bulkhead doorways to every post. Anything snag (bulkhead, crate, console)? Can you drive the vehicles through the doorways?
3. Fire an orbital strike, watch a gunship pass over the open deck.
4. Any forest leftovers (brown/green chunks, leaf sounds, haze)? File separate issues.

### #2261 (desert, city, beach, station by hand)

MANUAL RUN: play Two Fronts on desert, city, beach and station, taste only (30 min)
Pre-checked: all worlds load, a battle reaches a result from each side, no errors, no unreachable posts. Open item: Marines attacking the station won 1 of 32 scripted battles (others 5-11). Is it just hard, or are bulkheads in the way? Please judge it by hand.

Play each to the end (`/?battle=1&world=<w>&side=attacker&near=1`), watching for units stuck on huts and wrecks, rubble, beach props or bulkheads, posts you can't walk onto, spawns inside cover:
- `world=desert`, `world=city`, `world=beach` (about 8 min each)
- `world=station&side=attacker&hero=marines` (about 8 min)

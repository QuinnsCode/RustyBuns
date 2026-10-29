# Two Fronts: where the redesign is, and the prompt to keep it going

As of 2026-10-29. Round 1 is merged (#2679, #2686), and so are build order item 1, Open / Held / Contested (#2696), item 2, the
reinforcement trickle (#2688), and item 3, one sheet per phase (#2689). Build order lives in issue #2685, one issue per item:
#2690 (planet boards, next; PR #2719 is on it), #2691, #2692. Paste the prompt below to the next worker.

## Where it is

| Piece | State | Where |
| --- | --- | --- |
| Turn banner (year, turn, seat, phase, job, waiting on) | live | `src/war/phases.ts` `banner`, `main.ts` `bannerLine`, `styles.css` `.banner` |
| Rules redesign (open/held/contested, points, cards, the Gale, planet boards, hero space vs ground, trickle) | doc | `docs/REDESIGN.md` |
| Mockups, 390 px first | doc | `docs/mockups/a-banner-stepper.html`, `b-planet-board.html`, `c-battles-and-waiting.html` |
| Orbit-to-ground sim and verdict | script + doc | `scripts/interplay.ts`, `docs/INTERPLAY.md` |
| Landing constants as an options object | live, defaults unchanged | `src/war/landing.ts` `LandingRules`, `Campaign.landing` |
| Hearth cutscene, ten stories, radio lines, lore guide | live | `src/battle/cutscenes.ts` `wookaHearth`, `content/*.json`, `docs/LORE.md` |
| Open / Held / Contested: plaque badges, contested hatch and pulse, swords on attacking arrows, legend, panel chips | live (#2696); three small §2 bits left in #2704 | `src/war/states.ts` `placeStates`, `src/ui/map.ts`, `main.ts` `chip` |
| One bottom sheet per phase: the job as a title and a line, Fleets rows (state, ships there, count, Send, call back), waiting lists, one big button and the waiting chip; phone column with sticky banner and button | live (#2689) | `src/war/sheet.ts` `sheet`, `main.ts` `sailRows` and `waitPanel`, `index.html` `#sheet` and `.bottom`, `styles.css` |
| Reinforcement trickle: pods every 20 s from 60 s at the held post nearest the enemy spawn, cut off with no post, HUD pod chip, `BattleResult.landed` | live (#2688) | `contract.ts` `Pods`, `orbitPods`; `sim.ts` `dropPod`, `POD_AFTER`, `POD_EVERY`; `view.ts` `beatLine`; `rules.ts` `buildSpec`, `applyBattleResult` |

Beyond the landing options object and the trickle, the rules engine is unchanged; the place states are display only. The AI
knows nothing of the new rules (the trickle needs nothing from it: the ground sim lands the pods for both sides).

## The prompt

```
You are picking up the Two Fronts strategy redesign in apps/two-fronts (RustyBuns). Read, in this order:
apps/two-fronts/docs/NEXT.md, docs/REDESIGN.md, docs/mockups/README.md and b-planet-board.html, then the README's "The war table" and
"A turn" entries. Issue #2685 is the build order; items 1 to 3 are done (#2696, #2688, #2689). Take item 4, issue
#2690 (planet boards with warrens and crystal fields), and only that. PR #2719 is already on it: check it first and
build on it rather than starting again. Write "Part of #2685" and "Closes #2690" in the PR.
- Mobile first: check each board at 390 px in Chrome (load the page in a 390 px iframe if the window won't resize;
  Vite's reload drops the iframe, so make it again after an edit) and at 1280 px.

House rules that bite here:
- Never name the two board games that inspired this, nor "spice", "sietch" or the like, anywhere. Our words:
  crystal fields, warrens, the Gale, objective points, command cards.
- Lucide icons, never emojis. No `any`, no `as {..}` on unknown data (bun scripts/boundary-audit.ts must not
  gain a value).
- Run only the test files you touched and `bunx tsc --noEmit -p .` in apps/two-fronts; CI runs the rest.
- Every PR against main, never stacked. Commit, push with --force-with-lease only, open the PR, then
  `gh pr checks <n> --watch`. Fold fixes into the open PR.
- Finish with "N of M done" and name each leftover with its link; nothing stays only in chat. Anything for the
  owner's hands is a MANUAL RUN: issue with the label. Leave the dev server and the Chrome tab open.

Report back with: the PR link, the 390 px and 1280 px screenshots, and the one design call you made that
the mockups didn't settle. Then update this file (Where it is, and the prompt for the next item) in the same PR.
```

## After item 4

Items 5 and 6 in #2685 (#2691, #2692): the Gale, objective
points and command cards. Each wants its own prompt written from REDESIGN.md's section and the matching mockup; the
AI (`src/war/ai.ts`) needs a paragraph in each about how it plays the new rule, or the single-player game goes flat.

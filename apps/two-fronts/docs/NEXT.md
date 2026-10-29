# Two Fronts: where the redesign is, and the prompt to keep it going

As of 2026-10-29. Round 1 is merged (#2679, #2686). Build order lives in issue #2685. Paste the prompt below to the next worker.

## Where it is

| Piece | State | Where |
| --- | --- | --- |
| Turn banner (year, turn, seat, phase, job, waiting on) | live | `src/war/phases.ts` `banner`, `main.ts` `bannerLine`, `styles.css` `.banner` |
| Rules redesign (open/held/contested, points, cards, the Gale, planet boards, hero space vs ground, trickle) | doc | `docs/REDESIGN.md` |
| Mockups, 390 px first | doc | `docs/mockups/a-banner-stepper.html`, `b-planet-board.html`, `c-battles-and-waiting.html` |
| Orbit-to-ground sim and verdict | script + doc | `scripts/interplay.ts`, `docs/INTERPLAY.md` |
| Landing constants as an options object | live, defaults unchanged | `src/war/landing.ts` `LandingRules`, `Campaign.landing` |
| Hearth cutscene, ten stories, radio lines, lore guide | live | `src/battle/cutscenes.ts` `wookaHearth`, `content/*.json`, `docs/LORE.md` |

Nothing in the rules engine has changed yet beyond the landing options object. The AI knows nothing of the new rules.

## The prompt

```
You are picking up the Two Fronts strategy redesign in apps/two-fronts (RustyBuns). Read, in this order:
apps/two-fronts/docs/NEXT.md, docs/REDESIGN.md, docs/INTERPLAY.md (the Recommendation and "What the
trickle looks like" sections), docs/mockups/README.md, then the README's "The war table", "A turn" and
"Orbit → ground" entries. Issue #2685 is the build order; take the first unchecked item there, and only that.

Round 2, item 1: Open / Held / Contested on the live map and panel (REDESIGN.md §2, mockup a).
- A pure function in src/war/ (e.g. `placeState(view, me, orders, attacks)` in a new states.ts) that says, for
  every orbit and sector a seat can see, Open | Held | Contested, from the fogged campaign, this seat's queued
  orders and the declared attacks. Test it in test/ with one table: your ground, empty, enemy ground with and
  without your order into it, enemy orbit with your fleet order, a declared enemy attack on you.
- Draw it in src/ui/map.ts: nothing for Open, a shield badge on the plaque for Held, crossed swords plus a
  pulsing ring and a two-colour hatch over the territory for Contested; an order arrow into a Held place carries
  the swords on its bend. A legend strip under the map in words. Lucide icons via icon("shield"), icon("swords").
- The same chip in words next to every destination in the orders panel (main.ts): Open / Held / Contested.
- Mobile first: check at 390 px in Chrome (load the page in a 390 px iframe if the window won't resize) and at
  1280 px, with a campaign started (Short war, Against the AI, Battle line fleet, Deploy fleet).

Round 2, item 2 (a second PR, after item 1 is open): the reinforcement trickle (INTERPLAY.md). BattleSpec
.reinforcements becomes { cap, perMinute } per side: cap = min(100, 50 × ships) for the orbit's holder, 0
otherwise, perMinute = 15 × ships; POD_EVERY = 20 s, POD_AFTER = 60 s beside DIG_DROP in sim.ts; pods land at the
held post nearest the front through the dig-in drop path; nothing lands while the side holds no post, resumes on
a retake; HUD pod line with icon("arrow-down-to-line") and "cut off"; BattleResult.landed per side so
applyBattleResult divides by what actually landed. Test: a headless battle where the holder loses every post by
90 s receives under 20% of its cap; one that holds a post for 4 minutes receives the cap.

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

Report back with: the PR link, the 390 px and 1280 px screenshots, and the one design call you made that the
mockup didn't settle.
```

## After items 1 and 2

Items 3 to 6 in #2685: one bottom sheet per phase, planet boards with warrens and crystal fields, the Gale, objective
points and command cards. Each wants its own prompt written from REDESIGN.md's section and the matching mockup; the
AI (`src/war/ai.ts`) needs a paragraph in each about how it plays the new rule, or the single-player game goes flat.

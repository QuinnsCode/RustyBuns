# Two Fronts: where the redesign is, and the prompt to keep it going

As of 2026-10-29. Round 1 is merged (#2679, #2686), and so is build order item 1, Open / Held / Contested (#2696). Build order
lives in issue #2685, one issue per item: #2688 (trickle, next), #2689, #2690, #2691, #2692. Paste the prompt below to the
next worker.

## Where it is

| Piece | State | Where |
| --- | --- | --- |
| Turn banner (year, turn, seat, phase, job, waiting on) | live | `src/war/phases.ts` `banner`, `main.ts` `bannerLine`, `styles.css` `.banner` |
| Rules redesign (open/held/contested, points, cards, the Gale, planet boards, hero space vs ground, trickle) | doc | `docs/REDESIGN.md` |
| Mockups, 390 px first | doc | `docs/mockups/a-banner-stepper.html`, `b-planet-board.html`, `c-battles-and-waiting.html` |
| Orbit-to-ground sim and verdict | script + doc | `scripts/interplay.ts`, `docs/INTERPLAY.md` |
| Landing constants as an options object | live, defaults unchanged | `src/war/landing.ts` `LandingRules`, `Campaign.landing` |
| Hearth cutscene, ten stories, radio lines, lore guide | live | `src/battle/cutscenes.ts` `wookaHearth`, `content/*.json`, `docs/LORE.md` |
| Planet boards (§6): Kessa, Lumen, Tarn, Umber (and the horde's two) are six-sector rings; warrens beside every other spaceport; crystal fields pay 4; ground moves only next door; transports carry 2 armies a ship and fly with them; landings onto a hold you hold, next to one, or one assault onto a hold; `drawPlanet` in the system panel | live (#2690) | `src/war/galaxy.ts` `BOARD` `touching` `isHold`, `rules.ts` `landingError` `transports`, `src/ui/map.ts` `drawPlanet` |
| Open / Held / Contested: plaque badges, contested hatch and pulse, swords on attacking arrows, legend, panel chips | live (#2696); three small §2 bits left in #2704 | `src/war/states.ts` `placeStates`, `src/ui/map.ts`, `main.ts` `chip` |

The planet board is the first rules change; the place states are display only. The AI plays the board (`ai.ts`): it lands on the
weakest place the hold rule allows, as many as its fleet carries, and when that is too few to take it, reinforces a hold it
already has and pushes round the ring, walking into empty enemy sectors with its last army. Design calls #2693 left open
(assault landings onto an enemy hold, crystal fields above a capital) were answered yes by the owner and built that way.
Transports that lose the space battle are destroyed with the fleet and their troops go home, so the old "rush through an
enemy fleet" trickle (`landing.ts` sealedBy) no longer happens for landings from another world. Full-map AI wars now run
18 to 92 turns (were 13 to 47): bigger boards; worth a look when objective points (#2692) give a war its end.

## The prompt

```
You are picking up the Two Fronts strategy redesign in apps/two-fronts (RustyBuns). Read, in this order:
apps/two-fronts/docs/NEXT.md, docs/REDESIGN.md, docs/INTERPLAY.md (the Recommendation and "What the
trickle looks like" sections), docs/mockups/README.md, then the README's "The war table", "A turn" and
"Orbit → ground" entries. Issue #2685 is the build order; item 1 is done (#2696). Take item 2, issue #2688, and only that.

Round 2, item 2: the reinforcement trickle (INTERPLAY.md). BattleSpec
.reinforcements becomes { cap, perMinute } per side: cap = min(100, 50 × ships) for the orbit's holder, 0
otherwise, perMinute = 15 × ships; POD_EVERY = 20 s, POD_AFTER = 60 s beside DIG_DROP in sim.ts; pods land at the
held post nearest the front through the dig-in drop path; nothing lands while the side holds no post, resumes on
a retake; HUD pod line with icon("arrow-down-to-line") and "cut off"; BattleResult.landed per side so
applyBattleResult divides by what actually landed. Test: a headless battle where the holder loses every post by
90 s receives under 20% of its cap; one that holds a post for 4 minutes receives the cap. Write "Part of #2685" and
"Closes #2688" in the PR.
- Mobile first: check the battle HUD's pod line at 390 px in Chrome (load the page in a 390 px iframe if the
  window won't resize) and at 1280 px.

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
INTERPLAY.md didn't settle. Then update this file (Where it is, and the prompt for the next item) in the same PR.
```

## After item 2

Items 3, 5 and 6 in #2685 (#2689, #2691, #2692): one bottom sheet per phase, the Gale (it sweeps the planet boards' rings;
warrens and shields shelter), objective points and command cards. Planet boards (item 4) are done (#2690). Each wants its own prompt written from REDESIGN.md's section and the matching mockup; the
AI (`src/war/ai.ts`) needs a paragraph in each about how it plays the new rule, or the single-player game goes flat.

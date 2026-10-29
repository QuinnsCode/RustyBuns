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
| Planet boards (§6): Kessa, Lumen, Tarn, Umber (and the horde's two) are six-sector rings; warrens beside every other spaceport; crystal fields pay 4; ground moves only next door; transports carry 2 armies a ship and fly with them; landings onto a hold you hold, next to one, or one assault onto a hold; `drawPlanet` in the system panel | live (#2690) | `src/war/galaxy.ts` `BOARD` `touching` `isHold`, `rules.ts` `landingError` `transports`, `src/ui/map.ts` `drawPlanet` |
| Open / Held / Contested: plaque badges, contested hatch and pulse, swords on attacking arrows, legend, panel chips | live (#2696); three small §2 bits left in #2704 | `src/war/states.ts` `placeStates`, `src/ui/map.ts`, `main.ts` `chip` |
| One bottom sheet per phase: the job as a title and a line, Fleets rows (state, ships there, count, Send, call back), waiting lists, one big button and the waiting chip; phone column with sticky banner and button | live (#2689) | `src/war/sheet.ts` `sheet`, `main.ts` `sailRows` and `waitPanel`, `index.html` `#sheet` and `.bottom`, `styles.css` |
| Reinforcement trickle: pods every 20 s from 60 s at the held post nearest the enemy spawn, cut off with no post, HUD pod chip, `BattleResult.landed` | live (#2688) | `contract.ts` `Pods`, `orbitPods`; `sim.ts` `dropPod`, `POD_AFTER`, `POD_EVERY`; `view.ts` `beatLine`; `rules.ts` `buildSpec`, `applyBattleResult` |
| Objective points (Frost counts, targets per map, public and secret objectives) and command cards (energy, Fleet and Ground decks, face-up market, Blockade runner, Pinpoint bombardment, Flank, Sky lord, Crystal baron; the AI buys) | live (#2692); Gale deck waits on #2691, Escort / Warren raid / Sappers on #2690 | `src/war/objectives.ts`, `rules.ts` `muster`, `score`, `main.ts` `marketPanel`, `objectivesPanel` |
| The Gale and the year's galaxy event (§5): storm track, attrition, no landings or bombardment under it, defender cover, storm hero battles without strikes or gunships, six events, AI walks garrisons out | live (#2691) | `src/war/gale.ts`, hooks in `rules.ts`, `ui/map.ts` `gale`, `main.ts` `eventNews` |

The trickle, the planet board and the Gale are the rules changes so far (the trickle needs nothing from the AI: the ground sim lands the pods for both sides); the place states are display only. The AI plays the board (`ai.ts`): it lands on the
weakest place the hold rule allows, as many as its fleet carries, and when that is too few to take it, reinforces a hold it
already has and pushes round the ring, walking into empty enemy sectors with its last army. Design calls #2693 left open
(assault landings onto an enemy hold, crystal fields above a capital) were answered yes by the owner and built that way.
Transports that lose the space battle are destroyed with the fleet and their troops go home, so the old "rush through an
enemy fleet" trickle (`landing.ts` sealedBy) no longer happens for landings from another world. Full-map AI wars now run
18 to 92 turns (were 13 to 47): bigger boards; worth a look when objective points (#2692) give a war its end. Points and command cards (#2692) are rules too: wars now end on points, so those run lengths are capped by `WARS` in `objectives.ts`.

The Gale (`gale.ts`) is read off the seed and the turn, keyed on each world's ring so twin worlds share the weather; warrens
and shields shelter from it. The AI walks a garrison of 3 or more out from under it (to a shelter first), and never orders a
landing or bombardment it refuses. The intro map is calm. Left for command cards (#2692): the quiet year's 2 energy (it pays
`QUIET_CREDITS` until then), the ore bloom's point per field, and the Gale deck (Forecast, Steer and Stillness need the Gale's
position stored on the campaign rather than read off the seed). Short sight in a storm hero battle is #2725.

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

Items 5 and 6 in #2685 (#2691, #2692): the Gale (it sweeps the planet boards' rings;
warrens and shields shelter), objective points and command cards. The sheets (item 3) are done (#2689) and planet boards (item 4) too (#2690). Each wants its own prompt written from REDESIGN.md's section and the matching mockup; the
AI (`src/war/ai.ts`) needs a paragraph in each about how it plays the new rule, or the single-player game goes flat.

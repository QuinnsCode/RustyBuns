# Strategy screen mockups

Three static pages (plain HTML, CSS and a few lines of JS, lucide paths inlined as an SVG sprite, no
network) for the redesigned war table: mobile first at 390 px, widening at 760 px to map left, panel
right. Open them in a browser; nothing runs against the app. The map is the short war's real eight
systems, lanes and regions, drawn with the same capped-Voronoi territories as `src/ui/map.ts`.

| File | Shows | Would change |
| --- | --- | --- |
| `a-banner-stepper.html` | The "clear turn": a sticky banner (*Year · Turn · seat*, then *Phase n of 5 · name · job · Waiting on*) with the five-step stepper, the star map with the three place states (Open, Held, Contested), one queued fleet order as an arrow with its count on the bend, and the Fleets phase's single job as a bottom sheet (destinations with state, ships there, +/- and Send). The "Waiting on" chip flips to "Waiting on the Wooka" on a tap, and the big button with it. | `index.html` (banner, sheet and bottom bar replace `#phasebar`, `#topbar`, `#status`, `.turnbox`), `main.ts` (`phaseBar`, `phaseLine`, `waitingLine` fold into one `banner()`; the detail panel becomes a per-phase sheet), `map.ts` (state badges and the contested hatch and pulse), `styles.css` (the 760 px block flips to a desktop breakpoint). |
| `b-planet-board.html` | The planet view for Kessa in Commit: six territories as wedges round the planet (capital, spaceport, shield, two crystal fields, warren), coloured by holder with army counters, the Gale as a hatched band over two of them with a wind mark and an arrow to where it moves next, warrens and crystal fields marked, ships of both sides as chevrons on the orbit ring. The sheet is the landing order: where from, how many, which landing hold, what it costs, and the plain line about the orbit. | `map.ts` (a `drawPlanet()` beside `drawMap()`), `main.ts` (a selected system opens the board; the Commit sheet builds a landing order), `styles.css`; the Gale, warrens and crystal fields need `rules.ts` sector kinds first. |
| `c-battles-and-waiting.html` | The Battles phase: each fight as a card (place, Space or Ground, odds or a fog mark, the trickle line, Dice or Fight it), and under it three framed phone screens for the waiting states: the Wooka answering the attacks, the Wooka in a hero battle, and the post-battle Deploy step. Each shows how the banner's second line and the big button change. | `main.ts` (`battlesPanel`, `retreatPanel`, the deploy hint and `waitingLine` all feed the same banner and button), `styles.css`. |

Design calls: the second banner line answers the owner's five questions in one glance and wraps only the
"Waiting on" part on a phone; the stepper reuses `PHASES` from `src/war/phases.ts` (same icons, same
names); place states are a badge on the name plaque so the map stays the one the owner likes; a phase's
whole job lives in one thumb-height sheet and one orange button; the planet board is turned 30 degrees
so no wedge lies flat and its icon, name and counter stack outwards without crossing.

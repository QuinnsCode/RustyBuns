# Talks

Rusty Buns explained as short slide decks: plain HTML pages, one idea per slide. Open
[index.html](index.html) in a browser. Arrow keys or Space move between slides, N shows the speaker notes, and the
address keeps the slide number (`#4`). Everything a deck needs is beside it: [deck.css](deck.css) (the look) and
[deck.js](deck.js) (the keys, counter and notes).

## The rules for a talk

1. **Words first.** A talk uses only the words in [00-the-words.html](00-the-words.html). A new word goes there first.
2. **Plain enough for high school to retirement.** Simplified Technical English (ASD-STE100) habits: one idea per
   sentence, active voice, short sentences, the same word for the same thing every time. An everyday picture before
   any part name ("a bakery that bakes its own ovens" before "codeSplitter hosts the office").
3. **One human line per slide.** The `.aside` holds the joke, so the plain text stays plain.
4. **Show the shape, not the blueprint.** A talk says what a piece does and why. It never gives file paths, endpoint
   names, data layouts, algorithms or numbers that would let someone rebuild it. One "cute specific" per talk is
   fine when it would make a good conference talk on its own (lines with name tags in talk 1).
5. **Honest status.** Every talk ends with what is live, what is in the oven and what is next. The notes name the doc
   that is the source of truth, so the slide can be kept current.
6. **Credit the donors.** Agent Office is WebDevCody's (MIT); say so wherever it appears. Never name a commercial
   game that inspired one of ours.
7. **No emojis.** Diagrams are inline SVG using the `d-*` classes in `deck.css`, so they work in light and dark.

## The lineup

| # | Talk | State |
|---|---|---|
| 0 | [The Words](00-the-words.html) | ready |
| 1 | [The Frankenstein Code Factory](01-frankenstein-factory.html) | ready |
| 2 | What Rusty Buns is | planned |
| 3 | The example range | planned |
| 4 | The game engine: physics and netcode (with the buffer engine) | planned |
| 5 | Double Dragon, the twin engine | planned |
| 6 | eqosys | planned |
| 7 | Qollab | planned |
| 8 | Sign-in to party to game | planned |
| 9 | The phone setup | planned |
| 10 | Ship it: deploys and tests | planned |

The older talk, "Trying to Max Out" ([setup/](setup/page.html)), has a 3D scene: `bun TALKS/setup/build.ts` writes
`dist/talks/setup.html`.

## The player

`bun TALKS/player/build.ts` writes `dist/talks/player.html`: every ready talk in one page, a playlist beside a
stage, with play (auto-advance at 10 to 60 seconds a slide, with a countdown), step, a slide scrubber, speaker notes
and full screen. It reads the lineup from [index.html](index.html), so a new talk shows up once the index links it.
Publish that file to the "Rusty Buns Talks" artifact (https://claude.ai/artifact/GPLBcVKcoktpo49reFrUHe) to update it.

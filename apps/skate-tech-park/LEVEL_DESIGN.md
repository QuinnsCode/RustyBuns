# Skate Tech Park: filling out the levels

What classic skate-game levels do that a park of loose parts does not, and what we do about each. These are mechanics, described in our own words; our physics stays our own (a giant fingerboard on real terrain).

## What a good level has

1. **Lines, not objects.** A level is a few routes of 6 to 10 beats you can chain without touching the ground: launch, rail, transfer, bank, manual pad, gap, wall. Objects are placed so one's exit speed and heading feeds the next one's entry.
2. **One of each trick surface within sight of the spawn.** Something to grind, something to launch off, something to manual across, something to carve. A new player finds a first score inside ten seconds.
3. **Two heights for every feature.** A low version for the first run and a tall or long one for the line you come back to (a flat bar and a sky rail; a kicker and a quarter pipe).
4. **A set piece per level** that names it and carries the biggest gap or the longest grind.
5. **Goals that teach the map.** Combo scores, a named gap, collectables, a long grind. They send you down the lines you would otherwise skip.

## Rails are one extruded line, not loose bars

A real rail run is a path with a profile, the same idea as the contour ribbons: walk a path, set the bar's height and sideways offset at each step. `railLine` (`src/levels/pieces.ts`) does that with four profiles in `RAIL_LINES`: `kink` (flat, a drop down a set, flat again), `curve` (a quarter turn), `s` (out and back) and `wave` (up and down). It cuts the profile into 2.5 m segments marked `chain`, and the sim carries one grind from a segment to the next (`nextRail` in `level.ts`, up to a 100 degree turn at a joint), so a bend or a drop is one slide, not a string of short ones. Posts stand at the joints. Scatter lays a third of its rails this way.

Still to do: a rail that forks, a rail on the lip of a ribbon's crest (the coping already is one), and a profile of your own in a `ParkSpec`.

## Blocks we can grind on

Already: `ledge` (a long low block), `hubba` (a ledge as tall as the stairs beside it), `rockRidge` and `rockSlab` (grindable granite), the top of a `fallenLog`, the coping on every ribbon, bowl lip and quarter pipe, and the pool terraces. Also in the kit (`src/levels/pieces.ts`):

- **Manual pad** (`manualPad`). A short low box with a flat top, a rise the board rolls up, sited between two bigger features so the line's speed carries across.
- **Bank to ledge** (`bankLedge`). A bank whose top is a ledge, so a line goes up, grinds along, and drops off the end.
- **Down ledge** (`downLedge`). A ledge that falls away along its length (a sloped `y2`, as handrails already have).

To add: a gap-to-ledge, a named `gap` that lands on a ledge instead of the ground.

## Lines, as data

`line(at, steps, { name })` (`src/levels/lines.ts`) lays an ordered list of beats (`kicker`, `bar`, `rail`, `railLine`, `ledge`, `manualPad`, `bankLedge`, `downLedge`) end to end along a heading. After each beat it leaves a gap of its exit speed times 1.5 s (`GAP_SECONDS`), so one beat's exit meets the next one's entry; a step can set its own `exit` speed or a `turn` after it. Put it in a `Site` like any other part. It also records a route (a point at each beat), and a `{ kind: "line", name }` goal completes when the rider passes the points in order, each soon enough after the last, with no bail on the way (`trackRun`). Glacier Point has one: `plateau line`.

Still to do: a kicker's throw distance fixing where the next beat goes (today the gap is a flat 1.5 s of travel), and one line per site with a flat run-up checked.

## Mobile today

A left-thumb stick (steer, throttle) with hold buttons for boost and manual appears once a finger touches the page (`src/touch.ts`); the right half of the screen is the flick pad (`src/gesture.ts`) and the canvas has `touch-action: none`. Still desktop-shaped: the HUD, the parts picker and the key legend, which a phone does not need.

## Chased by something

Park Hide & Seek already has Bigfoot as a hiding target. A Skate Tech Park timed run could use him the other way round: an animal that chases the rider (a moose, a bear, Bigfoot) at a pace just under cruising speed, so standing still or bailing costs you, and a run is "outrun it to the next checkpoint". The animal follows the heightfield and ignores kit; a bail while it is close ends the run. Tuning knob: its speed relative to the rider's boosted speed. In Park Hide & Seek the same code could make Bigfoot a roaming chaser in a late round.

**Built:** `?chase=moose|bear|bigfoot` (`src/chaser.ts`). It stands for 3 s, then runs at 70-80% of the jets' top speed, follows the ground and ignores kit. Within 3 m it has you; a bail within 14 m ends the run and resets. Still to do: checkpoints ("outrun it to the next one") and Bigfoot roaming in a late Park Hide & Seek round.

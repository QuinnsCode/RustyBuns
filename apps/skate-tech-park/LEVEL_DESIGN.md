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

Already: `ledge` (a long low block), `hubba` (a ledge as tall as the stairs beside it), `rockRidge` and `rockSlab` (grindable granite), the top of a `fallenLog`, the coping on every ribbon, bowl lip and quarter pipe, and the pool terraces. To add:

- **Manual pad.** A short low box with a flat top, sited between two bigger features so the line's speed carries across. We have manuals on the ground; the pad is a place to want one.
- **Bank to ledge.** A bank whose top is a ledge, so a line goes up, grinds along, and drops off the end.
- **Down ledge.** A ledge that falls away beside a stair set (a sloped `y2` on a `ledge`, as handrails already have).
- **Gap-to-ledge.** A named `gap` that lands on a ledge instead of the ground.

## Lines, as data

A `ParkSpec` should be able to say "a line": an ordered list of parts with spacing and heading so each exit meets the next entry, with a goal that scores finishing it. The pieces exist; the thing missing is a `line()` that places a chain of them by exit speed (a kicker's throw distance fixes where the rail goes). One line per site, a flat run-up before each, and a gap between beats of about 1.5 s of travel at cruising speed.

## Mobile today

Mostly absent. The page has a viewport tag and uses pointer events for the flick gestures (`src/gesture.ts`), so a drag on a phone does resolve to an ollie or a flick. Everything else is keyboard or gamepad: no throttle, steer, boost or manual on touch, no `touch-action: none` on the canvas (the page scrolls and zooms under a drag), and the HUD and parts picker were laid out for a desktop. A phone player can drag but cannot go. The smallest useful version: a left-thumb stick for steer and throttle, a boost button, a hold-to-manual button, a flick on the right half, and `touch-action: none`.

## Chased by something

Park Hide & Seek already has Bigfoot as a hiding target. A Skate Tech Park timed run could use him the other way round: an animal that chases the rider (a moose, a bear, Bigfoot) at a pace just under cruising speed, so standing still or bailing costs you, and a run is "outrun it to the next checkpoint". The animal follows the heightfield and ignores kit; a bail while it is close ends the run. Tuning knob: its speed relative to the rider's boosted speed. In Park Hide & Seek the same code could make Bigfoot a roaming chaser in a late round.

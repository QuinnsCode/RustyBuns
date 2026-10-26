# Delayed Reaction: where it is going

The owner's direction, 2026-10-26. The first cut was a dark hallway with keys on the floor; this is the game it
became. Three workers built it in parallel from `main` (speed #2347, runner #2349, tunnel #2350) and the README
describes what shipped. What didn't ship moved to [IDEAS.md](IDEAS.md).

## Next: walls with a door, and a turn that never ends (2026-10-26, round 3)

The owner's direction after playing the tunnel round. This section wins where it disagrees with the rest.
Shipped: runner #2359, tunnel #2360, sim and sound #2361, wired together in the PR after them.

- **The endless turn.** The tunnel never stops turning, like an impossible staircase: always rounding a
  corner, always rolling the same way, never arriving. It reads as one long bend that keeps going, not a
  slow wobble back and forth. Same near-white neon grid.
- **Walls, not fences.** Where a call is due, a solid wall fills the tunnel. It has one door, a gap at the
  call's lane, glowing in that lane's colour. The rest of the wall is solid neon grid.
- **You run to the door.** The runner is no longer fixed in the middle: the four pads are four places across
  the floor, far left, left, right and far right. A pad moves the runner there, with a quick sidestep.
- **Through or bounced.** Be in the door's lane on the due beat and you run through it: the boost. Be
  anywhere else and you hit the wall and get knocked back: the runner rebounds, the world slows, the music
  dulls, and it costs a life as a miss does now. A game-show door wall, never named.
- **The delay still rules.** The call is still a ring far down the tunnel and its tail counts down; the wall
  with that colour's door arrives `delay` beats later. Move too early and the wall before it, whose door is
  somewhere else, knocks you back: you carry the queue of doors in your head and move on each due beat.
- **Holds are a corridor.** A hold is a long door: stay in its lane until it ends.
- **The pads still light and the call still echoes.** The timing is hard to read; both stay.

## The world: a tunnel, not a hallway

- An infinite tunnel, lit like a neon grid: thin glowing lines on black, 80s computer-world and rain-soaked
  city neon, not a boxy corridor. Describe it as "neon grid tunnel"; never name a film or game.
- The camera rolls: the tunnel rotates slowly and continuously around its axis, and the runner is always on
  the floor of it, so the floor itself is turning under the camera. Lanes are angles round the tunnel, not
  columns on a floor.
- Calls are **rings of colour** that light up far down the tunnel and rush toward the runner. A ring's
  colour is its lane (pink, amber, cyan, green). The ring is a smooth glowing band, not a slab.
- Speed is a mechanic. The runner is running at lightning speed to escape; this world delays everything.

## The delay: a tail, not a gap

- A call is not one ring: it is a **tail** of rings, like a delay's repeats. Pink, pink, pink, then green,
  green, green: a slow triplet feel on the groove. The first ring is the call; the ring you answer is the
  one `delay` beats on. Rings between are the tail, dimmer each one, so you can see the delay counting down.
- The **fence**: where a ring lands, part of the tunnel's wall is open and part is a "digital slow-down
  fence" (a faint grid). Answer on time and you pass through the open part and **boost**: the tunnel rushes
  faster and the music brightens. Miss and you hit the fence: a slow-down, the world drags, the sound dulls.
- Speed sits between a floor and a ceiling and decays back to the floor on its own, so a perfect run gets fast
  and thrilling and a sloppy one stays slow.

## Hits: fluid particle explosions

- A good answer is a **fluid colour explosion** in the lane's colour: a burst of particles with velocity,
  drag and a little gravity toward the tunnel wall, smearing along the direction of travel, not rings and
  dots. Perfect is bigger and whiter at the core.
- The dub echo re-fires the explosion `delay` beats later, smaller, up to three times (already in
  `src/hallway.ts` as `echoBursts`; keep that behaviour).

## The runner: 80s, with personality

- Not a stick figure. A lean silhouette with a glowing outline, a jacket, hair with movement, a visor or
  sunglasses, a running pose with real stride and lean, arms pumping. Think a neon-lit hero sprinting
  through a computer world. Build it in code (lines and bezier curves on the canvas), no images.
- Idle has a sway. A hit has a punch or a reach toward the lane. A miss stumbles. A boost leans forward
  with a streak behind. Keep the back-and-above third-person view.

## The music: deep dub, slow and heavy

- Half-time drums, a bass whose filter wobbles at a rate each bar picks, a sub, offbeat skank into the
  delay line (in `src/audio.ts`). Stay in that lane: slow, heavy, spacious, the tail of every sound audible.
- Speed changes the tempo of the tunnel, not the music's bpm. Boost opens the filter and adds a hat
  pattern; the fence closes the filter and drops the hats.

## Non-negotiables

- Phone first: four thumb pads, pointer capture, safe areas, no zoom or scroll, test at 390x844 and 844x390.
- `src/sim.ts` stays DOM-free and tested: any new mechanic (speed, boost, the fence) is a sim change with a
  journey in `test/sim.test.ts` before it gets a pixel.
- Colour only comes from calls, answers and the runner's accents. The tunnel itself is a near-white neon.
- No game or film names anywhere: code, comments, docs, commits, PRs.

# Delayed Reaction: where it is going

The owner's direction, 2026-10-26. The first cut (README) is a dark hallway with keys on the floor. This is
the game it is becoming. Three workers build it in parallel from `main`; the leader prompt at the bottom says who owns what.

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
- Boosting makes the next delayed answer harder (everything arrives sooner), so a perfect run gets fast and
  thrilling and a sloppy one stays slow. Speed should sit between a floor and a ceiling, decaying back to
  the floor on its own.

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

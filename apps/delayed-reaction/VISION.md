# Delayed Reaction: where it is going

The owner's direction, 2026-10-26. The first cut was a dark hallway with keys on the floor; this is the game it
became. Three workers built it in parallel from `main` (speed #2347, runner #2349, tunnel #2350) and the README
describes what shipped. What didn't ship moved to [IDEAS.md](IDEAS.md).

## Next: the dub, structured (2026-11-01)

The owner's clearer picture of how a dub song goes for this game, after listening. Wins over the music section below where
they disagree. Shipped as twelve setups in `src/dub.ts` to try out, with `?setup=name` in jump links and
`bun scripts/render.ts --all` to render them.

- **86 bpm, very half-time.** The feel is chilling along in half time on snap claps; the whole thing can speed up 1.3x
  (112 bpm) and still be the same track. The kick is on the one and the clap on the three.
- **Long and structured.** Real 64- and 128-bar tracks, not a loop: intro, a long build, the drop, a break, a rise,
  a second drop and an outro.
- **Long builds, long growls.** A dub growl often extends over 8 or 16 bars. Sometimes a quick rise over a triplet,
  then a cut, and the drop lands.
- **Empty and spread.** Eighth-note effects and grooved hats keep it moving, but it is all more empty and spread than
  the loop was. Drums hit mono, bass hits mono, stabs mostly mono; some stabs can go out wide with reverb.
- **One note, dubbed out.** It is more about one note and dub delaying it out: on the instrument, on the channel or
  bus, or both. There is a synth in there. There is an LFO on many things.
- **Stompy, half-time, tribal.** Toms under the drop on some setups.
- **The dub delays are the delayed reactions.** Same rule as the game: what sounds now comes back `delay` later.
- Still needing ears: which of the twelve has the feel, and what the next round keeps. The render only says the numbers
  are in range.

## Next: round the pipe, camera strapped on (2026-10-26, round 4)

The owner's direction after playing round 3. Wins where it disagrees with what follows.
Shipped: chase camera and lanes round the pipe #2363, the runner's bank #2364.

- **You circle the pipe.** The four places are spread far round the tube: far left and far right are well
  up its sides, so a long move takes you up the wall toward the roof, like a supercar in a tunnel driving
  on the side and then upside down, through a wormhole of harmonics that only the delay gets you out of.
- **The camera is strapped to the runner.** Third person, behind and above, and it rolls with the runner:
  the runner stays bottom-centre and the whole tube swings round them on a move, then settles. You feel
  the lateral move as the world swinging, not as the runner sliding across the screen.
- **The body sells the swing.** The runner banks into a move like a car on a banked curve, harder for a
  longer jump, then comes upright as the camera catches up.

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
  and thrilling and a sloppy one stays slow. A call that rings while you're fast is due sooner (`ring` in `src/sim.ts`), so fast is also harder.

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
- The reference sound is the "Tactical Breach" 24/7 radio by Cyberpunk Coding Music
  (https://www.youtube.com/watch?v=sjSnCKudqj0, channel https://www.youtube.com/@Cyberpunk_Coding_Music):
  minimal, deep, dubby. In its own words: slow muted breakbeats, tactical downtempo, deep controlled sub-bass,
  cold digital textures, nothing busy, every transition seamless. Before touching `src/audio.ts`, put it on
  and match against it: the drums sit back and muted, the sub carries the weight, the delay tail is the
  texture, and nothing ever gets bright or crowded. Listening is the test; there is no numeric target.
- The mix rules, from the owner's listen: drums, sub and bass are mono and dry, dead centre. Synths are the
  wide part: the wobble's saws sit one each side, the pad is spread, and the dub delay is a ping-pong that
  only synths go into (skank, pad, calls, answers). Hits never go round the delay. The groove breathes:
  the bass note moves once a 64-bar phrase, rests one bar in sixteen, and the pad comes once in 32.

## Hearing it without ears (#2491)

`bun scripts/render.ts [?level=5&bpm=140&delay=6&beat=0&stem=bass&setup=snap] [--bars 64] [--out dist/stems] [--check] [--all]` runs the same
`Music` on an `OfflineAudioContext` in headless Chrome and writes `mix`, `drums`, `bass`, `synth` and `dub` WAVs (32-bit float,
fixed seed, so every take is the same take). It prints peak, loudness, clipped samples, stereo width and the share under 120 Hz
per stem, and checks the kicks against the tempo grid; `--check` exits 1 when the mix peaks above -1 dBFS, clips, carries DC,
when the drums leave the centre, or when a kick strays more than 3 ms. The numbers are in `src/stems.ts`.
The same four stems play in the game: add `&stem=drums|bass|synth|dub` to any jump link to hear one part alone.

Built on that: the stab is a minor-seventh chord of detuned saws with a 30 ms pitch drop, soft clipping and a short body, all of it
into the ping-pong; the bass is a sine sub plus a mono FM growl whose cutoff and index breathe over sixteen bars, with the sub ducked
on every kick; the drums swing the offbeat hats and add two ghost snares; and every eighth bar the stab says a two-chord phrase that
the growl answers a bar later. Still needing ears: whether any of that has the soul of the reference. The loop in #2491 (a judge
with audio input scoring renders) is the owner's call on model and cost.

## Non-negotiables

- Phone first: four thumb pads, pointer capture, safe areas, no zoom or scroll, test at 390x844 and 844x390.
- `src/sim.ts` stays DOM-free and tested: any new mechanic (speed, boost, the fence) is a sim change with a
  journey in `test/sim.test.ts` before it gets a pixel.
- Colour only comes from calls, answers and the runner's accents. The tunnel itself is a near-white neon.
- No game or film names anywhere: code, comments, docs, commits, PRs.

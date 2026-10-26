# Delayed Reaction: the wild ideas

The first cut (see the README) is the smallest thing that plays: a keyboard, four pads, a delay, a dub echo. These are the ideas on the table for after that, roughly in the order they would land. Pick, argue, strike.

## The core twist, pushed further

- **The delay drifts.** A level where the delay is a knob the song turns: a bar for eight bars, then it slides to two bars over a phrase while the echo in the music stretches with it. Your queue gets longer in real time and you feel it.
- **Feedback as lives.** Instead of eight misses, the dub feedback is your health. Every answer you land feeds the delay line; miss and the echo dies down; miss enough and the song goes dry and stops. Lose with silence, not a buzzer.
- **Answer the echo of an echo.** A late-level mechanic: some calls want two answers, one at `+delay` and one at `+2·delay`, quieter. The music already does this, the game asks you to do it too.
- **Swapped lanes.** Mid-song the keyboard flips (the pads shuffle colours for a phrase) and the answer lane is the mirror of the call lane. Simon says, but you are told once.
- **Gesture calls.** A call shape per gesture: tap, hold, a swipe across two pads (a glissando), both outer pads at once (a chord), a flick up off the pad (a release you have to throw). Each is its own sound in the echo.

- **Speed you have to answer.** From VISION.md, not shipped: a boost should make the next delayed answer harder,
  everything arriving sooner. Today speed changes only how fast the tunnel and the music feel; the charts stay in
  beats, so the due beat never moves. The next step is a sim change that tightens the window or pulls the next
  call's due beat in while boosted, with a journey in `test/sim.test.ts` first.

## Parkour movement

- **The runner is the cursor.** Keys are platforms. A hold is a slide under a low key. A swipe is a wall-run up to the top rail. The animation is what you did, so a good run looks like a parkour line through the keyboard.
- **Momentum, not lives.** Each hit keeps the runner at speed; a miss stumbles. At full speed the keyboard tilts into a 3D tunnel (the keys are still the same beats, just further away) and the delay reads as distance.
- **First-person phone.** Hold the phone up; the gyro steers which rail the runner is on, the thumbs only answer. Not a plan yet, just the obvious thing to try once movement exists.

## Mini-game rounds

- **Party mode.** Four-bar rounds, each a different rule: answer later, answer the mirror lane, answer only the holds, answer everything except what the keyboard says, answer with your other hand. The rule is shown for one bar, then played for four.
- **Pass the phone.** Hot-seat: each round a different player holds it, the score is one shared echo line. The last player's queue is inherited from the player before them.
- **Call and response for real.** Two phones on a LAN (Park Hide & Seek already has the World host): one player's answers are the other's calls. A duet where you are each other's delay.

## The music

- **Your run is the track.** Every answer is a note into the dub. Record the whole run and let it play back from the menu, so a perfect run is a track you made. Share it as a seed plus a list of offsets.
- **Polyrhythm levels.** A lane in 3 against the kick in 4. The delay in 3 too. Once you can hear it, the queue becomes two queues.
- **Breakdowns.** Every sixteen bars the kick drops out and the echo carries the beat by itself for four bars; you keep answering into silence, and the kick returns on whether you did.
- **Instrument skins.** Same chart, different voice: dub techno, a Rhodes, a steel drum, a choir. The echo colours with it.

## Phone polish

- **Latency calibration by playing.** Eight kicks, tap along, take the median offset: no slider, it's done before level one.
- **One-thumb mode.** Two pads instead of four, the rails collapse to two, for a phone held in one hand on a train.
- **Haptics as the count-in.** Four buzzes before the song so you have the tempo in your hand before you hear it.
- **Install it.** A manifest and a service worker so it sits on the home screen and plays on the subway.

## Agent-office bait

- **Charts as files.** Make `makeChart` one of several chart sources, with a hand-written JSON chart alongside the seeded one, so agents can write levels without touching the generator.
- **The sim is the test.** Any new mechanic lands as a sim change plus one `test/*.test.ts` journey before it gets a pixel. The page stays thin.

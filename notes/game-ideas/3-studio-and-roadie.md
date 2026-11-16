# Game idea 3: Q Studio and Load In, real circuits as gear you carry and cable

Working titles. Two games that share one box of gear:

- **Q Studio**: a studio you walk around in. Pick up an amp, a cabinet and pedals, put them where you want, run
  cables between them, plug in your guitar and play. What you hear is the circuit you cabled, solved sample by
  sample (the [Q Amp](../../apps/fm-daw/CIRCUITS.md) solver), not a recording of one. Friends can be in the room.
- **Load In**: you are the crew for a band. The truck pulls up at a club, the band sends a stage plot and an input
  list, and you have until doors to carry, place and cable everything. Then you run the sound desk through the show,
  and then you strike it all and pack the truck before curfew.

Both run on the same gear: one model, one list of jacks, one circuit (or a cheap stand-in) per piece. A pedal built
for the studio turns up in the roadie's road case, and a fault the roadie learns to find (hum, feedback, a dead
cable) is a fault the studio can have too.

## Why it's ours

Most music games score you on timing. Here the gear itself is the game: a tube amp sounds the way it does because
of its parts, and a mistake you make while cabling is a sound you hear, not a red X. The circuit solver is already
written, tested and fast (2.3× to 3.3× real time for a four-tube amp, more for a pedal). Nobody else ships that in a
web page. The songs come from FM DAW's own songs and patches, so there is no licensed music.

## The shared layer: gear, jacks, cables, a patch

```
Gear   = { id, name, kind, size_m, weight_kg, jacks: Jack[], knobs: Knob[], sound: circuit | dsp | none, model, case }
Jack   = { id, kind: "inst" | "speaker" | "xlr" | "power", dir: "in" | "out", at: [x, y, z] }
Cable  = { kind, length_m, from: [gear, jack], to: [gear, jack], fault?: "dead" | "crackle" | "hum" }
Patch  = { placed: { gear, at, turn }[], cables: Cable[], knobs: { [gear]: { [knob]: number } } }

compile(patch) -> { chains: Link[][], problems: Problem[] }
```

`compile` walks from each source (a guitar, a mic) along the cables to each output (a monitor, the PA) and gives
back the chains the audio thread runs, plus the problems on the way: an input with nothing in it, an instrument
cable used as a speaker cable, a loop, a tube amp with no speaker on it. It is plain TypeScript, no DOM, no Effect,
so it runs in a test, in the studio's audio thread, and in the roadie sim alike.

What runs where:

| Gear | Sound | Why |
|---|---|---|
| Pedals, tube amps, a DI box, a console channel's preamp | Real circuit (`mna.ts`) | Their sound is their clipping; that's the point |
| Power amp and output transformer, with sag | Circuit (CIRCUITS.md Next 3) | Lets "no speaker on the amp" be a real failure |
| Speaker cabinet, mic on the cab | Impulse response, picked by where the mic sits | Convolution is cheap and sounds right |
| Console EQ | Shape (FM DAW's EQ, `src/engine/eq.ts`) | Already written in TS and Rust |
| Delay, reverb, PA, wedges | DSP | Not interesting as circuits |

**The audio budget.** One four-tube amp uses a third to a half of an audio thread. So a client runs at most one or
two live circuit amps: the ones in the chain you are playing or listening to. Gear far from you, or not cabled into
anything, costs nothing. The roadie's show bakes instead: at soundcheck the guitar's dry part is run through the amp
you set up, in a worker, while doors open (a three-minute song takes about a minute), and the show plays the result.

**Where the code lives.** The studio starts inside `apps/fm-daw` (`/studio.html`), where the solver, the worklet
and the seshes already are. When Load In starts, the solver, the rigs and `compile` move to `packages/gear` (no
dependencies, so the per-app CI install keeps working), and the gear models go in `packages/models/src/gear.ts`.
Both apps import both; the packages don't import each other.

**The models** are procedural, in TypeScript (three.js), like the rest of `packages/models`: boxes, grille cloth,
knobs, tubes, cable curves that sag. The clear acrylic look of Q Amp is the house style for the studio's own gear.

## Q Studio

You stand in a room (first person, or third with the camera over your shoulder: the owner picks). Gear stands on a
wall rack and the floor. Pick a piece up, carry it, set it down. Click a jack, walk the cable to another jack, click.
The cable hangs between them. Turn a knob by looking at it and dragging. Plug in your guitar (any audio input) or let
the riff play. Speakers down by default, as on Q Amp.

Rooms: a live room with the amps, a control room with the desk and the monitors, a booth with one mic.

Steps, each usable on its own:

1. **Q Amp on a 3D stage** ([#4570](https://github.com/QuinnsCode/RustyBuns/issues/4570), filed): the clear amp, cab
   and pedals in three.js. The first room.
2. **Gear on cables** ([#4835](https://github.com/QuinnsCode/RustyBuns/issues/4835)): the shared layer above, and a pedal chain of any length (today one pedal slot). Q Amp's page
   gets a patch view: drag cables between jacks in 2D; the 3D room uses the same patch later.
3. **Walk the room** ([#4836](https://github.com/QuinnsCode/RustyBuns/issues/4836)): move, pick up, place, cable and turn knobs in 3D (`@rustybuns/game-controls`), with
   `qstudio.state()` for probes.
4. **More circuits, part 1: the back end of the amp** ([#4837](https://github.com/QuinnsCode/RustyBuns/issues/4837)): push-pull power tubes, the output transformer, supply sag, a
   cabinet impulse response and a mic you can move on the cab (CIRCUITS.md Next 3 and 4).
5. **More circuits, part 2: new parts and new gear** ([#4838](https://github.com/QuinnsCode/RustyBuns/issues/4838)): transistors (Ebers-Moll) for a transistor fuzz and a boost,
   JFETs, live pots; a DI box with a ground lift; a console channel (preamp, Shape EQ, fader) (CIRCUITS.md Next 5).
6. **Record** ([#4839](https://github.com/QuinnsCode/RustyBuns/issues/4839)): the desk's output lands on an FM DAW track in the sesh (needs [#4555](https://github.com/QuinnsCode/RustyBuns/issues/4555)).
7. **Friends in the studio** ([#4840](https://github.com/QuinnsCode/RustyBuns/issues/4840)): a studio is a sesh. The patch, knob turns and who carries what go in the sesh beside the
   groove (the World already holds one per sesh). Each player hears the circuits on their own machine. Hearing a
   friend's guitar live needs audio between players (Qlave), which comes after.
8. **The bench** ([#4841](https://github.com/QuinnsCode/RustyBuns/issues/4841)): draw a pedal (a tscircuit board, which `tscircuit.ts` already reads), and it shows up as a box on the
   floor with your knobs on it. That is what makes it a world people add to rather than a showroom.

## Load In

The day of a show, in four parts. Every venue is a level.

1. **Load in.** The truck backs up to the dock. The band's stage plot (who stands where) and input list (channel 1
   kick, 2 snare, 3 bass DI, 4 guitar mic, 5 vocal) are on a clipboard. Carry the cases in (heavy ones go on a dolly),
   unpack, place the gear on the plot, run power (too much on one wall circuit trips the breaker), run the snake, and
   cable each input to the right channel on the stage box. A clock counts down to doors.
2. **Line check and soundcheck.** Each player plays alone and you hear their channel. Faults are real and you find
   them by ear and by tracing the cable: no signal (a dead cable, a wrong channel), hum (a ground loop: lift the DI),
   crackle (a bad cable: swap it), howl (feedback: the wedge points at the vocal mic, or the gain is too high). The
   guitarist hands you their amp settings; you dial them in, and that tone is baked for the show.
3. **The show.** You're at front of house. The set list plays (FM DAW songs, with the band's parts as stems through
   your patch). Push the guitar for the solo, ride the vocal, answer "more me in my wedge" hand signals. Things go
   wrong: a string breaks (swap the guitar, keep the channel), a cable dies, a wedge starts to ring. A crowd meter shows
   how it's going.
4. **Strike and load out.** Break it all down, coil the cables (over-under, or they tangle next show), pack the cases
   into the truck so they fit and don't slide, and get out before curfew or pay the fine.

**Feedback is computed, not scripted.** A mic picks up the wedge with a gain that depends on the distance, the angle
(a cardioid mic hears little from behind) and the channel's gain and EQ. When that loop gain passes 1 at some
frequency, that frequency rings. A notch in Shape at that frequency, or turning the wedge, fixes it. The same goes for
gain staging (a channel that clips) and the amp with no speaker load (the power-amp circuit from Studio step 4).

**The tour.** Venues grow: a coffee shop with one mic, a club, a theatre with a monitor desk, a festival changeover
with fifteen minutes between bands. Pay buys gear and a bigger truck; a good night gets the next booking. Later, a
crew of friends (a Qollab party): one at the desk, one on stage, one at the dock.

Steps, each usable on its own:

1. **The shared gear package** ([#4842](https://github.com/QuinnsCode/RustyBuns/issues/4842)): the solver, rigs and `compile` move from `apps/fm-daw` to `packages/gear`, the models
   to `packages/models/src/gear.ts`; FM DAW imports them back (after Studio step 2).
2. **One club, load in and line check** ([#4843](https://github.com/QuinnsCode/RustyBuns/issues/4843)): a three-piece band, one stage plot, carry, place, cable, the clock, and the
   faults found by ear. The sim is plain TS with a `loadIn.state()` handle.
3. **The show at front of house** ([#4844](https://github.com/QuinnsCode/RustyBuns/issues/4844)): the desk, the set list from FM DAW songs, the baked guitar, the computed feedback,
   the hand signals, the crowd meter.
4. **Strike and load out** ([#4845](https://github.com/QuinnsCode/RustyBuns/issues/4845)): coiling, packing the truck, curfew.
5. **The tour and the crew** ([#4846](https://github.com/QuinnsCode/RustyBuns/issues/4846)): more venues, pay, gear to buy, and friends as crew.

## Order

Studio steps 1 and 2 come first: they give both games the gear and the patch. After that the two can run side by
side: Studio 3 to 8 in FM DAW, Load In 1 to 5 in its own app. Once either one is playable, its feel gets a hill climb
(a score chased round by round), as the other games do.

## What it costs

Nothing new on the bill. The circuits run on the player's machine. The studio's rooms are FM DAW seshes, which already
run on Durable Objects and back up to R2. Load In is a static game until the crew step, which uses Qollab parties.

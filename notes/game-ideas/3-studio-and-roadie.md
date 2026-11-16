# Game idea 3: Q Studio and Load In, real circuits as gear you carry and cable

Two games that share one box of gear (names kept by the owner, 2026-11-16):

- **Q Studio**: a studio you walk around in. Pick up an amp, a cabinet and pedals, put them where you want, run
  cables between them, plug in your guitar and play. What you hear is the circuit you cabled, solved sample by
  sample (the [Q Amp](../../apps/fm-daw/CIRCUITS.md) solver), not a recording of one. Friends can be in the room.
- **Load In**: a first-person roadie sim, speakers first. Carry the speakers in, pull the cable out, lay the ramps,
  aim the sound at the crowd, from a garage to a big arena. Later the whole job: the band's inputs, the show at the
  desk, strike and the truck.

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

You stand in a room, first person (the owner's call on 2026-11-16, replacing an earlier over-the-shoulder pick; the same
controller as Load In). Gear stands on a
wall rack and the floor. Pick a piece up, carry it, set it down. Click a jack, walk the cable to another jack, click.
The cable hangs between them. Turn a knob by looking at it and dragging. Plug in your guitar (any audio input) or let
the riff play. Speakers down by default, as on Q Amp.

Rooms: a live room with the amps, a control room with the desk and the monitors, a booth with one mic.

Steps, each usable on its own:

1. **Q Amp on a 3D stage** ([#4570](https://github.com/QuinnsCode/RustyBuns/issues/4570), filed): the clear amp, cab
   and pedals in three.js. The first room.
2. **Gear on cables** ([#4835](https://github.com/QuinnsCode/RustyBuns/issues/4835)): the shared layer above, with the pedalboard (its slots and their order, [#4827](https://github.com/QuinnsCode/RustyBuns/issues/4827))
   as one piece of gear in it. Q Amp's page gets a patch view: drag cables between jacks in 2D; the 3D room uses the
   same patch later.
3. **Walk the room** ([#4836](https://github.com/QuinnsCode/RustyBuns/issues/4836)): move, pick up, place, cable and turn knobs in 3D (`@rustybuns/game-controls`), with
   `qstudio.state()` for probes.
4. **More circuits, part 1: the back end of the amp** ([#4837](https://github.com/QuinnsCode/RustyBuns/issues/4837)): push-pull power tubes, the output transformer, supply sag, a
   cabinet impulse response and a mic you can move on the cab (CIRCUITS.md Next 3 and 4).
5. **More circuits, part 2: the gear a stage needs** ([#4838](https://github.com/QuinnsCode/RustyBuns/issues/4838)): a DI box with a ground lift and a console channel
   (preamp, Shape EQ, fader), built from the new parts in [#4826](https://github.com/QuinnsCode/RustyBuns/issues/4826) (transistors, JFETs, pots).
6. **Record** ([#4839](https://github.com/QuinnsCode/RustyBuns/issues/4839)): the desk's output lands on an FM DAW track in the sesh (needs [#4555](https://github.com/QuinnsCode/RustyBuns/issues/4555)).
7. **Friends in the studio** ([#4840](https://github.com/QuinnsCode/RustyBuns/issues/4840)): a studio is a sesh. The patch, knob turns and who carries what go in the sesh beside the
   groove (the World already holds one per sesh). Each player hears the circuits on their own machine. Hearing a
   friend's guitar live needs audio between players (Qlave), which comes after.
8. **The bench** ([#4841](https://github.com/QuinnsCode/RustyBuns/issues/4841)): draw a pedal as a tscircuit board (the board view and part swaps are [#4831](https://github.com/QuinnsCode/RustyBuns/issues/4831)), and it
   shows up as a box on the floor with your knobs on it. That is what makes it a world people add to rather than a
   showroom.

## Load In

**What it is (owner, 2026-11-16):** a first-person sim. You pick up the speaker, pull the cable out across the floor,
and lay the cable ramps over the walkways. Real enough that it could almost be the job, the way a good flight sim
could almost be flying: real weights, real cable lengths, breakers that trip, sound that falls off the way sound does.
Under the same sim, a dial goes down to a cozy game (no clock, light gear, cables that coil themselves), and friends
can join as a crew where half the fun is the mess.

**Speakers first.** The game starts as setting up the sound system: where the speakers go, how they're aimed, how
they're powered and cabled. The rest of the roadie job (the band's inputs, line check, running the show, strike) comes
after, on the same gear.

### The venue ladder

| Rung | Venue | What's new there |
|---|---|---|
| 1 | A garage | One guitar amp: carry it, plug it in, learn the hands |
| 2 | A dive bar | Two powered speakers on stands, a sub, a small mixer; aim for the crowd, keep the bar quiet |
| 3 | A bigger bar | Passive speakers and an amp rack, speaker cable, amp loads, wall circuits that trip |
| 4 | A community event outdoors ([#4859](https://github.com/QuinnsCode/RustyBuns/issues/4859)) | A generator and distro, ramps on every path, the neighbours across the road |
| 5 | A desert night party ([#4860](https://github.com/QuinnsCode/RustyBuns/issues/4860)) | The sound-system crew's wall of speakers, built by you; sand, fuel for twelve hours, sunrise |
| 6 | A small arena ([#4861](https://github.com/QuinnsCode/RustyBuns/issues/4861)) | Speakers that hang: rigging points, a line array, fills |
| 7 | A big arena ([#4862](https://github.com/QuinnsCode/RustyBuns/issues/4862)) | Delay towers, sub arrays, a power plan for a building, and a crew you need |

### Why it's a sim and not a quiz

The numbers are textbook acoustics and electrics, in `packages/gear`: a speaker's level falls 6 dB each time the
distance doubles, drops off outside its coverage angle, and two subs add or cancel depending on where you stand. Two
boxes on one amp channel are a 4 ohm load; a 15 A breaker trips past 1800 W; a long thin speaker cable loses level.
A coverage heat map on the floor shows what the crowd will hear, and walking the room you hear it too.

### The modes

One dial, like a flight sim's assists. **Cozy**: no clock, gear weighs half, cables coil themselves, ramps snap,
jacks glow. **Crew**: in between. **Sim**: real weights, the clock to doors, breakers trip, a short cable is short.
Late doors cost pay and the crowd's mood. Between shows there is a home base (the van, the warehouse, the gear you've
bought), the cozy-sim side of it ([#4846](https://github.com/QuinnsCode/RustyBuns/issues/4846)). Friends join as crew
through a Qollab party ([#4863](https://github.com/QuinnsCode/RustyBuns/issues/4863)): two to lift a sub, one running
cable while another lays ramps.

### The rest of the roadie job, after the speakers

1. **Load in.** The band's stage plot and input list on a clipboard (channel 1 kick, 2 snare, 3 bass DI, 4 guitar mic,
   5 vocal): the snake, the stage box, each input to its channel.
2. **Line check and soundcheck.** Faults found by ear and by tracing the cable: no signal, hum (lift the DI), crackle
   (swap the cable), howl (feedback). The guitarist's amp settings dialled in and baked for the show.
3. **The show.** Front of house: FM DAW songs as the band's stems through your patch, the solo pushed, "more me in my
   wedge", a broken string, a crowd meter.
4. **Strike and load out.** Coil the cables over-under, pack the truck so nothing slides, out before curfew.

**Feedback is computed, not scripted.** A mic picks up the wedge with a gain that depends on the distance, the angle
(a cardioid mic hears little from behind) and the channel's gain and EQ. When that loop gain passes 1 at some
frequency, that frequency rings. A notch in Shape at that frequency, or turning the wedge, fixes it.

### Steps

Tonight's build ([#4849](https://github.com/QuinnsCode/RustyBuns/issues/4849), rungs 1 to 3):

- Wave 1: the app, first-person walk and carry, the garage ([#4850](https://github.com/QuinnsCode/RustyBuns/issues/4850));
  `packages/gear`, the sound and power math ([#4851](https://github.com/QuinnsCode/RustyBuns/issues/4851)); the gear
  models ([#4852](https://github.com/QuinnsCode/RustyBuns/issues/4852)).
- Wave 2: cables and ramps ([#4853](https://github.com/QuinnsCode/RustyBuns/issues/4853)); the dive bar and the heat
  map ([#4854](https://github.com/QuinnsCode/RustyBuns/issues/4854)); hearing the speakers as you walk
  ([#4855](https://github.com/QuinnsCode/RustyBuns/issues/4855)).
- Wave 3: the bigger bar, amp rack and breakers ([#4856](https://github.com/QuinnsCode/RustyBuns/issues/4856)); the
  cozy-to-sim dial and the clock ([#4857](https://github.com/QuinnsCode/RustyBuns/issues/4857)).

After that: the venues above, the crew, then the roadie job: the band's inputs and line check
([#4843](https://github.com/QuinnsCode/RustyBuns/issues/4843)), the show
([#4844](https://github.com/QuinnsCode/RustyBuns/issues/4844)), strike ([#4845](https://github.com/QuinnsCode/RustyBuns/issues/4845)),
the tour ([#4846](https://github.com/QuinnsCode/RustyBuns/issues/4846)). The circuit solver joins `packages/gear` in
[#4842](https://github.com/QuinnsCode/RustyBuns/issues/4842), so the guitar amp in the garage can be the real Q Amp.

## Order

The circuit work has its own map, FM DAW's ANALOG.md ([#4826](https://github.com/QuinnsCode/RustyBuns/issues/4826) to [#4832](https://github.com/QuinnsCode/RustyBuns/issues/4832): more parts, a pedalboard, phasers to
tape echo, profiling a real amp, orderable boards). Every pedal it adds is gear in both games for free, so this plan
files only what the games need on top: the patch, the room, the power amp and cab, the stage gear, and the games.

Load In goes first (speakers, tonight's build [#4849](https://github.com/QuinnsCode/RustyBuns/issues/4849)): it makes
`packages/gear`, the gear models and the first-person controller. Q Studio then stands on them: Studio steps 1 and 2
(the 3D stage and the patch), then 3 to 8 in FM DAW. Once either game is playable, its feel gets a hill climb (a score
chased round by round), as the other games do.

## What it costs

Nothing new on the bill. The circuits run on the player's machine. The studio's rooms are FM DAW seshes, which already
run on Durable Objects and back up to R2. Load In is a static game until the crew step, which uses Qollab parties.

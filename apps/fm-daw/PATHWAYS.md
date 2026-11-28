# Qollab Studio: Learn, Studio, Event

Qollab Studio is a DAW and an event planner in one shared 3D world, where a show is set up in a place that behaves
like the real one. Three words split it, and every task names the problem it shortens:

- **LEARN** is how to set it up and how to use it. It isn't a separate room: each sector gets lessons on its own tools,
  checked on the real gear as you go. LEARN and Sound Guy Simulator (`apps/load-in`) are one thing with two
  storylines: the same gear, models and step checker (`packages/gear` `steps.ts`), told as lessons here and as a
  career from the garage to the arena there. A speaker, amp or rig model built in Qollab Studio is one the game uses.
- **STUDIO** is everything before an event (#6527): the Event Planner, QDAW, Q Instruments, Q Amps, Q Builder, Speakers,
  and **Playground**, your own sesh that friends drop in on from the link (the jam lobby).
- **EVENT** is the live show and the place it happens, for guests, hosts and performers: **The Event**, a planned party
  taken live with its guest list and a listen link for the crowd.

Every app starts on the front door, `/door.html` (`src/paths.ts`, `src/front.ts`). The Door column is where its card lands.

| Lane | App | The real problem | Who | Door | Works end to end today? |
|---|---|---|---|---|---|
| LEARN | [Learn the setup](#1-learn-learn-the-setup) | Nobody teaches cabling, gain staging or a PA unless a tech stands next to you; breaking real gear is a dear way to learn | beginners, students, teachers | `/studio.html`, the gear room; the jam room's `?` card | Yes, five lessons at the gear wall; more to come |
| STUDIO | [Event Planner](#5-studio-event-planner) | Crews guess whether the rig covers the room or the field and whether the power holds, and find out on the night | sound engineers, venues, festival and wedding crews | `/rooms.html`, the studio builder | Yes indoors and out: coverage, delay, power, gear list; out of doors over the night's air, the ground and banks on the field. No wind, forecast or captured terrain yet |
| STUDIO | [QDAW](#2-studio-qdaw) | A music maker in the browser is a toy, or an install and an account first | bedroom producers | `/`, the desk with the demo beat | Yes, one loop at a time (no song mode yet) |
| STUDIO | [Q Instruments](#4-studio-q-instruments) | Synths, classic keys and decks cost a lot and you can't try them first | players, synth-curious, DJs | `/decks.html`, the decks; the sound wall in the gear room | Yes: decks into the room, to a file, to any stream app, a listen link |
| STUDIO | [Q Amps](#6-studio-q-amps-and-q-builder) | Amp sims are black boxes: you can't see why a pedal sounds the way it does | guitarists, speaker DIYers | `/amp.html`, Q Amp; `/speakers.html` | Yes: an amp and pedals solved as circuits; speaker boxes from the makers' drawings |
| STUDIO | [Q Builder](#6-studio-q-amps-and-q-builder) | A DIY kit is a parts list with no feedback: it hums and you can't tell which part did it | pedal and synth DIYers, EE students | `/amp.html`, B on a pedal (its board and build sheet) | Mostly: change parts, add, remove or rewire parts, scope a net, remake and retest, see the board drawn from its Gerbers, print it, download the Gerbers or the kit; a new layout for a changed circuit is still routed in the repo |
| STUDIO | [Playground](#3-event-the-event) | Playing together means a video call, not a place | the band, friends in other cities | `/jam.html`, the lobby (sign in, make a room) | Yes indoors: invite link, guest list, the room's PA from where you stand |
| EVENT | [The Event](#3-event-the-event) | A plan is a drawing until someone stands in it; a far-away crowd gets a flat stream | the client, the crowd | `/rooms.html#party`, the Event Planner's Party panel (Open as event) | Yes: the plan live on its stacks, its guest list and a listen link |

All of them share one account (eqosys), one saved project (the sesh's world) and one gear catalogue, so a person can
move from one sector to the next without starting over: the pedal built in Q Builder is a pedal on Q Amp's floor, the
track recorded through it plays at The Event, and the rig planned in the Event Planner is the PA it plays through.

**The build order** (visual plan: https://claude.ai/artifact/EvSXowEP4iSpRvfjL5zEs5): 0. this regroup;
1. the Event Planner outdoors, sound that travels the way it does in the weather and over the ground
   ([below](#out-of-doors-the-air-the-ground-and-the-land)); 2. the landing page, which shows that off;
3. The Event opened straight from a plan; 4. Q Builder's loop (scope a net, remake it in tscircuit, retest: `/builder.html`, #6021);
5. a lesson in every sector, and QDAW's song mode.

## 1. LEARN: Learn the setup

**Who:** someone who has never cabled a rig, gain-staged a mixer or heard why a room rings. A teacher with a class.

**The walk they want:**
1. Pick a lesson: "plug a guitar into an amp", "patch a synth voice", "set up a PA for a small room".
2. Do it in the room with their hands: carry the box, plug the cable, turn the knob, hear the change.
3. The app says what went right or wrong in plain words, and why.
4. Finish, and the lesson's rig stays as their own room to keep playing in.

**Works today:**
- Three setup lessons, started from the `?` card's "Learn to set it up" row (`src/studio/lessons.ts`, [#5861](https://github.com/QuinnsCode/RustyBuns/issues/5861)): plug a guitar through a pedal into an amp and its cab; patch a sound wall voice (VCO, VCF, VCA, Q Out); set up a small PA (two powered speakers placed apart and aimed at the room's middle, a mic through a mixer, powered on mixer first). All with your hands at the gear wall, on the sesh's own patch. A card at the top left ticks each step off as the gear says so and, when something is in the way, says what and why (straight into the amp, the filter's CV, gain too hot, a speaker facing the wall, a thump). A small warm cone floats over the jack, knob or box the next step is about and moves on as each step goes green; with a cable in your hand it points at where the cable goes ([#6086](https://github.com/QuinnsCode/RustyBuns/issues/6086); `qjam.lesson()` returns its `mark` and `marker`). Leave any time; what you built stays. The steps run on `packages/gear`'s checker (`steps.ts`), the one Sound Guy Simulator's first-minute hints use, and the PA's switch-on order is the catalog's own `thumps`.
- A fourth, "Know your plugs: XLR" ([#6029](https://github.com/QuinnsCode/RustyBuns/issues/6029)): the mic into the mixer, the mixer into a powered speaker's combo input A, its thru on to the next speaker. Each step reads the connector off `@rustybuns/util/connectors`, the same list Sound Guy Simulator plugs by (what it carries, its pins), and an XLR out into an out is refused with why (an out is male, an in female).
- A class card for the teacher (**L**, `src/studio/class.ts`, [#6087](https://github.com/QuinnsCode/RustyBuns/issues/6087)): everyone in the jam room, the lesson each is in, a dot per step done, the step they are on and what is in their way, live. Whoever is stuck comes first. A class is the people in one room: the teacher sends the room's link, and nobody needs an account beyond what the jam room already asks.
- A fifth, "Run an amp rack: power apart from audio" ([#6030](https://github.com/QuinnsCode/RustyBuns/issues/6030)): a power distro, a mixer, a rolling amp rack and two passive 15" tops. Mains go on cables of their own: a cord from the distro into the rack's blue powerCON and the mixer's IEC, and a box whose cord isn't in stays dark with its switch up. The mixer's outs into the amp's XLR inputs, a speakON from each amp channel to a speaker. Then keep the mains off the signal: carry the mixer out front and its cord from the distro lies along its XLRs, so the step asks you to move the distro until the cords leave them at an angle. Power on mixer first, amp last, or it thumps. Every jack in the PA kits now has its real socket from `@rustybuns/util/connectors`, and a cable only goes between sockets that carry the same thing: an XLR out into a speakON, or an amp's speaker line into a powered speaker's combo, is refused in the connector list's words.
- A lesson on a STUDIO app's own page ([#6085](https://github.com/QuinnsCode/RustyBuns/issues/6085)), started from the round cap button at its bottom left or `?lesson=<id>`, on the same checker and card (`src/studio/page-lesson.ts`, `lesson-card.ts`): the Event Planner's "Plan the PA for a field" (`/rooms.html?lesson=plan`, `src/studio/plan-lesson.ts`: two stacks 10 m or more apart either side of the front, aimed at the middle, a generator that holds the rig, the gear list) and Q Amps' "A clean amp, a drive, an echo" (`/amp.html?lesson=amp`, `src/amp/lesson.ts`: Gain down, Q Drive in front at a low Drive, Q Tape in the amp's loop), and Q Builder's "Swap one part and hear why" ([#6173](https://github.com/QuinnsCode/RustyBuns/issues/6173), `/amp.html?lesson=build`, `src/amp/build-lesson.ts`: Q Drive on with its board open, its clipping diodes D1 and D2 swapped for germanium, then LEDs, each read off the solved circuit as the volts it peaks at against silicon's, and a capacitor or resistor swapped by mistake told what it does instead). The cap button on `/amp.html` lists both of its lessons. QDAW's and Q Instruments' wait in [#6171](https://github.com/QuinnsCode/RustyBuns/issues/6171) and [#6172](https://github.com/QuinnsCode/RustyBuns/issues/6172). The journeys are `test/sector-lessons.test.ts` and the last one in `test/pa-builder.test.ts`.
- The jam room's "What you can do here" card (`?`, `src/studio/help.ts`) and the key strip: what each key does where you stand.
- The studio builder's Why line and ring time per seat (`/rooms.html`): change a wall's material and hear and see the room change.
- QDAW's lesson, "Make a beat" ([#6171](https://github.com/QuinnsCode/RustyBuns/issues/6171)), on the desk (`/?lesson=beat`, or the cap button at the bottom left; `src/beat-lesson.ts`): starting it empties the groove's Kick, Snare and Hat rows (one undo puts them back), then a kick on every beat, a snare on 2 and 4, hats on every "and", and play it. Each step reads the project's own drum rows as the grid lights them, and says why when a hit is missing or the snare lands on 1 and 3 with the kick. The journey is `test/qdaw-lesson.test.ts`.
- The sound wall's build sheets explain each module in plain words (`B` in the gear room, [WALL.md](WALL.md)).
- Q Instruments' lesson, "Mix one track into the next" ([#6172](https://github.com/QuinnsCode/RustyBuns/issues/6172), `/decks.html?lesson=mix` or the round cap button at the bottom left, `src/dj/lesson.ts`): a track on each deck, play A, match B's tempo to A's, start B on A's beat in the headphones, cross the fader over. Each step reads the decks' own tempo, beat grid, cue and crossfader, so the card says why when B runs at another tempo (how many seconds it takes to slip a beat), starts where the room can hear it, or lands so many ms off A's kick. The journey is `test/decks-lesson.test.ts`.
- Sound Guy Simulator (`apps/load-in`) already teaches load-in, cabling and aiming speakers as a game, level by level.

**Missing:** lessons past the first four (gain-staging a desk, why a room rings; speakON, powerCON and IEC lessons wait for typed cables in the room, with power run apart from audio, [#6030](https://github.com/QuinnsCode/RustyBuns/issues/6030)). The lessons need the sesh's gear room, so a page with no World (plain `vite`) can't take them.

## 2. STUDIO: QDAW

**Who:** a producer who wants a music maker in the browser, with no install and no account.

**The walk:**
1. Open `/`, press Space: a beat plays.
2. Play notes on the keyboard, press R to record, draw in the piano roll.
3. Bring sound in: Record audio (a mic or a guitar), Record MIDI, Import audio, Import MIDI, or drop a file.
4. Shape it: the Mixer, Shape (EQ), the Amp insert (Q Amp on a track), web and native plugins (CLAP, Audio Units).
5. Bounce it to a file.

**Works today:** all five steps ([README: Use it](README.md#use-it), [Play](README.md#play)).

**Missing** ([README: Next](README.md#next), [Known limits](README.md#known-limits)): song mode (chain patterns
into a whole song), a sidechain from the kick, drawing automation by hand, input monitoring, MIDI clock. The synth
voices can't go through the Amp insert yet ([CIRCUITS.md: Next](CIRCUITS.md#next)).

## 3. EVENT: The Event

**Who:** a band, or friends in different cities who want to play together in a place, not a video call.

**The walk:**
1. Open `/jam.html`, sign in with eqosys, pick a character.
2. Make a room: pick a studio (or the one you built in path 5) and name it.
3. Copy the invite link and send it.
4. A friend opens the link, walks in, sits at an instrument; the leader grants who plays, edits and mixes.
5. Play together on the same beat; the desk records it; the room's guest list keeps who may come back.
6. Optional: a phone as a remote for the desk (`/remote.html`), an agent at the desk over MCP (`scripts/studio-mcp.ts`).

**Works today:** all six steps (front door `src/studio/door.ts`, grants `src/grants.ts`, guest lists `src/guest-list.ts`).

**From the Event Planner** (#6020): the Party panel's **Open as event** puts the open party live (with none open, it makes
one from the room as planned) and opens its room, which plays from the same stacks, aim and power, with the sesh's own
guest list and the decks' listen link. **Client walk-through** opens the same room with `?walk=1`: the planned PA plays a
test set (`src/studio/walk-set.ts`) on that page alone, so a client walks the site and hears it before the show.
`qrooms.event(walk?)` gives the link; `qjam.state().pa.sources` is the same list as `qrooms.pa().sources`. The journey
is `test/event.test.ts`.

**Missing:** the character is a stand-in until [#4987](https://github.com/QuinnsCode/RustyBuns/issues/4987); the
rooms' look is a climb ([#5365](https://github.com/QuinnsCode/RustyBuns/issues/5365)). Pedals, amps and cables
stand on the gear wall in every room (`src/studio/gear-wall.ts`, #5393).

## 4. STUDIO: Q Instruments

**Who:** a DJ who practises at home, plays a party in a room, and wants the set heard outside the room too.

**The walk:**
1. Open `/decks.html`: two decks and a four-channel mixer. Add music (files stay on your computer), a folder, or a YouTube link.
2. Practise: sync, cue, hot cues, loops, scratch, master tempo, MIDI controller learn.
3. Take it to a room: in a jam room, click the DJ table; your master goes to the room's PA over WebRTC
   (`src/studio/pa-line.ts`), and every listener hears it from the room's speakers, from where they stand (`pa-room.ts`).
4. Take it out: record it to a file to post later, or send a listen link to people outside the sesh.

**Works today:** all four steps. The listen link ([#5878](https://github.com/QuinnsCode/RustyBuns/issues/5878)): the
radio button beside REC opens it; name the set, press Go live, and send the link (`/listen/<id>`, the same each time
from this browser). The decks' MediaRecorder sends the master as a WebM chunk a second (Opus, 128 kb/s) over a socket to
one `Listen` Durable Object per set (`src/listen.ts`), which keeps the stream's header and the bytes since the latest
cluster for whoever comes in late, and passes each chunk on to every listener. The listener's page (`listen.html`,
`src/dj/listen-page.ts`) shows the set's name, the track list as each track comes in and a Play button, and plays it
through MediaSource a few seconds behind; no sign-in. Stop, or closing the decks, ends it for everyone. Limits: a link is
held by the key in the DJ's browser (one live set per DJ; a second tab going live takes over), the free limits (16 listeners a set, 4 hours a set,
16 set-hours a month: README, Free live sets), a cap on chunk size and rate, and per-address gates on going live and listening. It costs about
$0.006 per set-hour whatever the crowd (the object is awake for the set; messages it sends aren't billed). The journey
is `test/dj-live.test.ts`. The recording in step 4: REC in the decks' header (on `/decks.html` and at the DJ
table) records the master, what the room's PA gets, to a file on your computer (`src/dj/record.ts`: Opus in WebM, or
AAC in Safari), with a track list beside it naming each track and the time it came in (its deck playing with the fader
and its crossfader side open). Nothing is uploaded. A YouTube deck plays in YouTube's own player, so it is never in the
recording; the button says so. Audio in and out (the cable button, `src/dj/io.ts`) sends the master to any output on
your sound card as well as your speakers (an interface, or a virtual cable into OBS or a stream app), so a DJ streams
the set wherever they like with nothing hosted by us; and brings any input (a turntable, a mic, another computer) onto
mixer channel 1 or 4. Picking an output needs Chrome, Edge or Firefox; Safari plays to the default.

**Missing:** going live from Safari (it records only MP4, which the link doesn't take) and from the desktop app (no
Listen object there); a listener on an iPhone needs Safari 17.1's MediaSource for WebM. There is no saved
library either (tracks load each visit), and MIDI learn is checked only with fed messages, not a real controller.

## 5. STUDIO: Event Planner

**Who:** a sound engineer, a venue owner or a festival crew who must decide which speakers, where, aimed how, on
what power, before the truck is loaded.

**The walk they want:**
1. Draw the space: its size, what the walls, floor and ceiling are made of, where the crowd stands.
2. Put the rig in: pick the speakers, place and aim each stack, splay a line array.
3. See it: a coverage map over the floor (how loud, how even), the room's ring time, the delay from far stacks.
4. Hear it: walk the floor and listen from any spot.
5. Check it holds: amps, breakers, the generator.
6. Take it away: a gear list, a power plan and the plan drawing.

**Works today:**
- Step 1: the studio builder (`/rooms.html`, `src/studio/builder.ts`): size, materials, panels, booths, seats.
- Step 2: a room, indoors or out, picks one of five rigs (`@rustybuns/gear` `SYSTEMS`; the owner picks one in the jam room's Settings, #6420). The PA tool stands a stack on the ground, Move drags it, Turn aims it, and the PA panel turns it, splays its
  tops and sets a line array's pins (#5863). Indoors the stacks are the room's own `pa` (with none, a club stack
  stands either side of the decks), drawn in the builder and on Walk in, with the same power check and gear list (#5883).
- Step 3: the Coverage button draws the PA's mids and highs over the floor, on the blueprint or the 3D view's floor (`src/studio/coverage.ts`),
  and the PA panel gives the floor's level and how even it is. It is `@rustybuns/gear`'s `coverage` of the very boxes
  `pa-room.ts` plays the set from (`paSources`), so the map is what you hear on Walk in. The Delay button marks where the far stacks land late on the blueprint
  (`pa-room.ts` `arrivals`, from `hearSpeaker`'s delay): amber past 10 ms (a smear), red past 30 (an echo, a delay tower's
  place), the ms written across the floor. Ring time and a clap at each seat. Out of doors the map, the delay marks and the
  Walk-in sound all cross the same field ([below](#out-of-doors-the-air-the-ground-and-the-land)).
- Step 4: Walk in opens the room; `pa-room.ts` plays each speaker from its place, aimed, late by distance, with the room's ring.
  The Party panel's Client walk-through does the same with a test set on the PA, and Open as event makes the plan The
  Event ([path 3](#3-event-the-event)).
- Step 5: the PA panel's power check (`@rustybuns/gear` `powerPlan`): the amp racks, each rack's and each powered stack's
  breaker, and the generator (the smallest that holds, or the one you pick), with the reason when one gives out.
- Step 6: **Gear list** saves every box, amp rack, the generator and distro, each cable run cut to a reel's length,
  and the power plan (`gearList`); **Plan drawing** saves the blueprint with the coverage map on it as an SVG.
- `window.qrooms`: `pa()` (with `field`: the air, ground, speed of sound and banks), `level(x, z)`, `delay(x, z)`, `pickStack(i)`, `showMap()`, `showDelay()`, `view()`, `download("list" | "plan")`; the journey is
  `test/pa-builder.test.ts`.

### Out of doors: the air, the ground and the land

Out of doors the sound crosses a field (`@rustybuns/gear` `field.ts`, #6018), and `coverage`, `levelAt` and `splAt` take
it, so the map, the Walk-in sound (`pa-room.ts` `roomField`, carried by every speaker) and the delay marks stay one model.
No wave solver: a fair try at the physics from the standards.

**Works today:**
- **Air:** the PA panel's Air and ground section sets the night's temperature and relative humidity. They set how fast
  the highs fade with distance (ISO 9613-1, checked against its table) and the speed of sound, so the delay marks move with
  the evening (a freezing night lands the far stack later than a hot one). Walk in hears the same air dull the far stack.
- **Ground:** grass, trodden soil, tarmac or water under the crowd (ISO 9613-2's ground factor, its octave-band method):
  hard ground hands back up to 3 dB, grass soaks the low mids near the ground.
- **Land:** banks on the field as a height map (`banks`): the panel's mountain button stands one across the picked stack's
  throw, the plan draws each, and a crest between a stack and a listener cuts the highs behind it (a thin screen, the
  barrier loss in place of the ground term) on the map and on Walk in. A captured venue brings its own ground: once the
  splat is in, `groundMap` reads its floor off the points (a 32 by 32 raster at most, the venue's `land`), sampled
  bilinearly and flat outside it (`heightMap`), the higher of it and any bank where both are (`highest`).
- `qrooms.edit({ t: "field", tempC, humidity, ground })`, `{ t: "bank", at, yaw, len, h }`, `{ t: "unbank", index }`;
  `qrooms.pa().field`. The journey is the third test in `test/pa-builder.test.ts`; the ISO table is `packages/gear/test/field.test.ts`.

**Missing:**
- Banks stand on the plan only: the builder's 3D view and the Walk-in room are still flat, and a bank can't be dragged or
  turned on the plan yet.
- Wind, a forecast for the date, noise at the site's edge and wind load on the stacks (later, by the owner's call).


## 6. STUDIO: Q Amps and Q Builder

Q Amps is playing it (step 1, and the speaker boxes on `/speakers.html`); Q Builder is opening it up (steps 2 to 7).
Q Builder has a page of its own, `/builder.html` ([#6021](https://github.com/QuinnsCode/RustyBuns/issues/6021)): every pedal with a board, with a scope, the remake, and **Build it**: the board as a fab would make it, drawn from the kit's own Gerbers and drill file (top and bottom, `src/kit/gerber.ts`), Print (the schematic, both sides of the board and the parts list with your swaps, on A4), and the Gerbers or the whole kit as a zip. Q Amp's build sheet (B on a pedal) has the same kit.

**Who:** a guitarist or synth DIYer who wants to hear a pedal or a module, change its parts, and solder the real one.

**The walk:**
1. Play it: Q Amp (`/amp.html`) and the pedal wall, the sound wall in the gear room (`/studio.html`). Each pedal and
   module is a real circuit solved as you play ([CIRCUITS.md](CIRCUITS.md), [WALL.md](WALL.md)).
2. Change it: open the board view, click a part and pick another: a clipper's diodes, a capacitor's or a resistor's
   value (a step up or down, the nearest part you can buy). The bench plays it with the knob down, centred and up
   first, and turns a change away with the reason if it won't solve. Your parts stay with that pedal. On
   `/builder.html`, **Change the circuit** goes past values ([#6423](https://github.com/QuinnsCode/RustyBuns/issues/6423)):
   add a resistor, capacitor or diode between two nets (From starts on the scope's net), take a part off, or move one
   of its ends to another net. The same bench check runs first; the scope, Play and the remake follow. A 100nF from
   the fuzz's clipping diodes to ground takes that net's top end from about 50 to 16. These changes are Q Builder's
   own (not on Q Amp's pedal yet), and the schematic stays the stock drawing, with the changes listed beside it.
3. Bring your own board: drop a tscircuit board's circuit JSON on Q Amp's floor; the bench checks it solves, then it is the fourth pedal.
4. Scope it (`/builder.html`): click a trace on the schematic, or a net in the list, and the scope shows the volts there while
   the riff plays through the circuit (and at its loudest note when nothing plays), with how far it swings and how
   much of the time it sits at its peak: swap the fuzz's diodes to ground for germanium and that net clips at 0.26 V
   instead of 0.5, flatter. Remake and retest writes your parts into the board (`<board>-yours.tsx`, tscircuit
   source with your values and diode part numbers, and its circuit JSON), plays the same riff through the remake and
   your board, and says whether they match, and how far yours is from the stock board (`src/circuit/builder.ts`).
5. Build it: Q Builder's Build it card (or B on Q Amp) shows the board from its Gerbers and prints the sheet; download the kit zip: Gerbers, `bom.csv`, `pnp.csv`, `order.csv` (a part
   number for every part), the front panel and a plain-words build sheet (`src/kit/`). `bom.csv` and `order.csv`
   carry your parts. A swap is a value in the same holes, so the Gerbers stay the stock board's, and the
   sheet says so. A changed circuit (a part added, removed or rewired) doesn't fit the stock board: Build it says it
   needs a new layout and holds back the Gerbers and the kit, and the remade `-yours.tsx` has its traces written again
   from the new nets, to route in tscircuit.
6. Order it: send the Gerbers to a fab, upload `order.csv` to a parts shop.
7. Close the loop: record the built board, play the same riff through the sim, compare.

**Works today:** steps 1 to 5. Step 6 is by hand with the files from step 5. The scope runs the built-in riff through the
circuit on its own thread, not your guitar through Q Amp's audio thread, and only the clip pedals are on `/builder.html`.

**Missing:**
- Routing a new layout for a changed circuit (or a new footprint) happens in the repo (`circuits/<board>.tsx` from
  the remake, then `bun scripts/boards.ts <board>`), not in the app. The schematic doesn't redraw a changed circuit,
  and Q Amp's pedal plays the stock circuit with your swaps, not Q Builder's added or rewired parts. tscircuit itself is parked (`apps/tscircuit-desktop`: it pins zod 3).
- A board dropped on the bench plays and turns its knobs, but has no board view yet, so its parts can't be changed in the app.
- No board has been built yet, so step 7 has never run. A prototype order is the owner's call, with its price.
- Selling kits or built boards needs owner decisions first (compliance, the hardware licence, price per board: [ANALOG.md](ANALOG.md#8-from-the-screen-to-your-hands)).

## The front door

`/door.html` (also `/` and `/paths`) is the landing page ([#6019](https://github.com/QuinnsCode/RustyBuns/issues/6019)). Its hero fills the first screen: a live field at dusk
(`src/hero.ts`, drawn by `src/front-hero.ts`), two stacks and the map of their highs (4 kHz, `@rustybuns/gear`'s outdoor model) on the
grass. The Air and Humidity sliders and the Bank button change the map, and **Hear it from the back** loops a beat through an EQ
set by what the field took from each band at the back; they hide behind one small thermometer button in the field's corner,
an easter egg. 
The field is the menu: LEARN, STUDIO and EVENT are three lanes down the grass, each with its word painted on the floor and a button
standing on it (hemyviz's floor names). The field stands behind the whole page, crowded up under the title; under it each lane's shelf follows the last. Scrolling off
the field slides the lane buttons up into the tabs along the top (`morph` in `src/front-hero.ts`), and the lane whose shelf you are
reading darkens the others, stands in a beam of light and flies the camera up over it, so the map fills the screen behind the
cards. Each lane's card on the field, and its open shelf, lists its apps as links (#6527). Studio's line is a console prompt, "Build your set / speaker / signal / pedal / song / plugin",
each word rolling to the next and opening its app; Event's weighs "experience". Headings and buttons wear
the viewer's Settings > You font (`src/studio/fonts.css`). A lane button, its strip of grass or a tab scrolls to its shelf (a link to `#learn`, `#studio`, `#event` lands there). The eqosys account chip (Sign in, or your
name and Sign out) sits top right over the sky, and at the right end of the tabs once you scroll off the field; it is the jam
room's own client, so one sign-in is both. Each lane's paths
stand down the page like a console's memory card screen (`src/front-shelf.ts`): each a thing turning in the dark (the guitar,
a speaker stack, the desk's own screen from `public/door/daw.jpg`, a turntable, an amp on its cab, the drive's real board from
`circuits/drive.pcb.svg`, a mic for Playground, a stage wedge for The Event), each swinging a quarter turn each way of its front, the one nearest the middle fastest, scrolling swinging them all, and each glass card sliding
in as it comes onto the screen. One WebGL renderer draws only the things on the screen, at 30 frames a second at most; with
reduced motion each is drawn once. Beside each thing, a Lucide icon, a short name, a line on what you do there, and Open,
on that app's first step ([#5860](https://github.com/QuinnsCode/RustyBuns/issues/5860)). Only the
Playground and The Event ask you to sign in; the rest work signed out. Every page has a way back: **Paths** first in the row of doors
along the top (`src/way.ts`), or the round house button in the corner of the decks and the studio builder
(`mountBack`). Then the pedal-to-show chain, what works today and a word for crews and classes (`CHAIN`, `LIVE`, `PITCHES` in `src/paths.ts`).
`qdoor.state()`, `qdoor.lane("studio")` (null closes it), `qdoor.shelf()` (each thing: on the screen, picked, drawn) and `qdoor.hero.state()` / `qdoor.hero.set({ tempC, humidity, bank })` for probes; `test/front-door.test.ts` opens each lane and checks its cards, and that the field darkens at the back with dry air and behind a bank, and `test/front-door-paths.test.ts` walks every card to its first step and back at
phone and desktop sizes. A bare visit to `/` (and to `/paths`) lands here; the desk is `/desk`, and an old `/?room=` link still opens its sesh.

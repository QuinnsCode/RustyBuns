# Qollab Studio: Learn, Build, Play

Qollab Studio is a DAW and an event planner in one shared 3D world, where a show is set up in a place that behaves
like the real one. Three words split it, and every task names the problem it shortens:

- **LEARN** is how to set it up and how to use it. It isn't a separate room: each sector gets lessons on its own tools,
  checked on the real gear as you go. LEARN and Sound Guy Simulator (`apps/load-in`) are one thing with two
  storylines: the same gear, models and step checker (`packages/gear` `steps.ts`), told as lessons here and as a
  career from the garage to the arena there. A speaker, amp or rig model built in Qollab Studio is one the game uses.
- **BUILD** is six sectors, each aimed at one real problem.
- **PLAY** is The Event: what you built, played live for people who walk in.

Every sector starts on the front door, `/door.html` (`src/paths.ts`, `src/front.ts`). The Door column is where its card lands.

| Word | Sector | The real problem | Who | Door | Works end to end today? |
|---|---|---|---|---|---|
| LEARN | [Learn the setup](#1-learn-learn-the-setup) | Nobody teaches cabling, gain staging or a PA unless a tech stands next to you; breaking real gear is a dear way to learn | beginners, students, teachers | `/studio.html`, the gear room; the jam room's `?` card | Yes, four lessons at the gear wall; more to come |
| BUILD | [Event Planner](#5-build-event-planner) | Crews guess whether the rig covers the room or the field and whether the power holds, and find out on the night | sound engineers, venues, festival and wedding crews | `/rooms.html`, the studio builder | Yes indoors and out: coverage, delay, power, gear list; out of doors over the night's air, the ground and banks on the field. No wind, forecast or captured terrain yet |
| BUILD | [QDAW](#2-build-qdaw) | A music maker in the browser is a toy, or an install and an account first | bedroom producers | `/`, the desk with the demo beat | Yes, one loop at a time (no song mode yet) |
| BUILD | [Q Instruments](#4-build-q-instruments) | Synths, classic keys and decks cost a lot and you can't try them first | players, synth-curious, DJs | `/decks.html`, the decks; the sound wall in the gear room | Yes: decks into the room, to a file, to any stream app, a listen link |
| BUILD | [Q Amps](#6-build-q-amps-and-q-builder) | Amp sims are black boxes: you can't see why a pedal sounds the way it does | guitarists, speaker DIYers | `/amp.html`, Q Amp; `/speakers.html` | Yes: an amp and pedals solved as circuits; speaker boxes from the makers' drawings |
| BUILD | [Q Builder](#6-build-q-amps-and-q-builder) | A DIY kit is a parts list with no feedback: it hums and you can't tell which part did it | pedal and synth DIYers, EE students | `/amp.html`, B on a pedal (its board and build sheet) | Partly: change parts, drop in a tscircuit board, download the kit; no scope yet |
| PLAY | [The Event](#3-play-the-event) | A plan is a drawing until someone stands in it; a far-away crowd gets a flat stream | the band, the client, the crowd | `/jam.html`, the lobby (sign in, make a room) | Yes indoors: invite link, guest list, the room's PA from where you stand |

All of them share one account (eqosys), one saved project (the sesh's world) and one gear catalogue, so a person can
move from one sector to the next without starting over: the pedal built in Q Builder is a pedal on Q Amp's floor, the
track recorded through it plays at The Event, and the rig planned in the Event Planner is the PA it plays through.

**The build order** (visual plan: https://claude.ai/artifact/EvSXowEP4iSpRvfjL5zEs5): 0. this regroup;
1. the Event Planner outdoors, sound that travels the way it does in the weather and over the ground
   ([below](#out-of-doors-the-air-the-ground-and-the-land)); 2. the landing page, which shows that off;
3. The Event opened straight from a plan; 4. Q Builder's loop (scope a net, remake it in tscircuit, retest);
5. a lesson in every sector, and QDAW's song mode.

## 1. LEARN: Learn the setup

**Who:** someone who has never cabled a rig, gain-staged a mixer or heard why a room rings. A teacher with a class.

**The walk they want:**
1. Pick a lesson: "plug a guitar into an amp", "patch a synth voice", "set up a PA for a small room".
2. Do it in the room with their hands: carry the box, plug the cable, turn the knob, hear the change.
3. The app says what went right or wrong in plain words, and why.
4. Finish, and the lesson's rig stays as their own room to keep playing in.

**Works today:**
- Three setup lessons, started from the `?` card's "Learn to set it up" row (`src/studio/lessons.ts`, [#5861](https://github.com/QuinnsCode/RustyBuns/issues/5861)): plug a guitar through a pedal into an amp and its cab; patch a sound wall voice (VCO, VCF, VCA, Q Out); set up a small PA (two powered speakers placed apart and aimed at the room's middle, a mic through a mixer, powered on mixer first). All with your hands at the gear wall, on the sesh's own patch. A card at the top left ticks each step off as the gear says so and, when something is in the way, says what and why (straight into the amp, the filter's CV, gain too hot, a speaker facing the wall, a thump). Leave any time; what you built stays. The steps run on `packages/gear`'s checker (`steps.ts`), the one Sound Guy Simulator's first-minute hints use, and the PA's switch-on order is the catalog's own `thumps`.
- A fourth, "Know your plugs: XLR" ([#6029](https://github.com/QuinnsCode/RustyBuns/issues/6029)): the mic into the mixer, the mixer into a powered speaker's combo input A, its thru on to the next speaker. Each step reads the connector off `@rustybuns/util/connectors`, the same list Sound Guy Simulator plugs by (what it carries, its pins), and an XLR out into an out is refused with why (an out is male, an in female).
- The jam room's "What you can do here" card (`?`, `src/studio/help.ts`) and the key strip: what each key does where you stand.
- The studio builder's Why line and ring time per seat (`/rooms.html`): change a wall's material and hear and see the room change.
- The sound wall's build sheets explain each module in plain words (`B` in the gear room, [WALL.md](WALL.md)).
- Sound Guy Simulator (`apps/load-in`) already teaches load-in, cabling and aiming speakers as a game, level by level.

**Missing:** lessons past the first four (gain-staging a desk, why a room rings; speakON, powerCON and IEC lessons wait for typed cables in the room, with power run apart from audio, [#6030](https://github.com/QuinnsCode/RustyBuns/issues/6030)), a marker over the gear the next step is about, and a teacher's view of a class's progress. The lessons need the sesh's gear room, so a page with no World (plain `vite`) can't take them.

## 2. BUILD: QDAW

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

## 3. PLAY: The Event

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

## 4. BUILD: Q Instruments

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
held by the key in the DJ's browser (one live set per DJ; a second tab going live takes over), 200 listeners a set
(`LISTEN_EARS`), a cap on chunk size and rate, and per-address gates on going live and listening. It costs about
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

## 5. BUILD: Event Planner

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
- Step 2: a room, indoors or out, picks one of five rigs (`@rustybuns/gear` `SYSTEMS`; the rig cards, `rig-cards.ts`, draw each to
  scale). The PA tool stands a stack on the ground, Move drags it, Turn aims it, and the PA panel turns it, splays its
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
  Event ([path 3](#3-play-the-event)).
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
  barrier loss in place of the ground term) on the map and on Walk in.
- `qrooms.edit({ t: "field", tempC, humidity, ground })`, `{ t: "bank", at, yaw, len, h }`, `{ t: "unbank", index }`;
  `qrooms.pa().field`. The journey is the third test in `test/pa-builder.test.ts`; the ISO table is `packages/gear/test/field.test.ts`.

**Missing:**
- Banks stand on the plan only: the builder's 3D view and the Walk-in room are still flat, and a bank can't be dragged or
  turned on the plan yet.
- The land from a splat capture's height map, not only drawn banks.
- Wind, a forecast for the date, noise at the site's edge and wind load on the stacks (later, by the owner's call).


## 6. BUILD: Q Amps and Q Builder

Q Amps is playing it (step 1, and the speaker boxes on `/speakers.html`); Q Builder is opening it up (steps 2 to 6).
Both start on Q Amp today; Q Builder gets a page of its own with its scope.

**Who:** a guitarist or synth DIYer who wants to hear a pedal or a module, change its parts, and solder the real one.

**The walk:**
1. Play it: Q Amp (`/amp.html`) and the pedal wall, the sound wall in the gear room (`/studio.html`). Each pedal and
   module is a real circuit solved as you play ([CIRCUITS.md](CIRCUITS.md), [WALL.md](WALL.md)).
2. Change it: open the board view, click a part and pick another: a clipper's diodes, a capacitor's or a resistor's
   value (a step up or down, the nearest part you can buy). The bench plays it with the knob down, centred and up
   first, and turns a change away with the reason if it won't solve. Your parts stay with that pedal.
3. Bring your own board: drop a tscircuit board's circuit JSON on Q Amp's floor; the bench checks it solves, then it is the fourth pedal.
4. Build it: B opens the build sheet; download the kit zip: Gerbers, `bom.csv`, `pnp.csv`, `order.csv` (a part
   number for every part), the front panel and a plain-words build sheet (`src/kit/`). `bom.csv` and `order.csv`
   carry your parts. A change is always a value in the same holes, so the Gerbers stay the stock board's, and the
   sheet says so.
5. Order it: send the Gerbers to a fab, upload `order.csv` to a parts shop.
6. Close the loop: record the built board, play the same riff through the sim, compare.

**Works today:** steps 1 to 4. Step 5 is by hand with the files from step 4.

**Missing:**
- Changing the layout or a footprint (a new part, a bigger cap) happens in the repo (`circuits/<board>.tsx`, then
  `bun scripts/boards.ts <board>`), not in the app. tscircuit itself is parked (`apps/tscircuit-desktop`: it pins zod 3).
- A board dropped on the bench plays and turns its knobs, but has no board view yet, so its parts can't be changed in the app.
- No board has been built yet, so step 6 has never run. A prototype order is the owner's call, with its price.
- Selling kits or built boards needs owner decisions first (compliance, the hardware licence, price per board: [ANALOG.md](ANALOG.md#8-from-the-screen-to-your-hands)).

## The front door

`/door.html` names LEARN, BUILD and PLAY, each over its row of cards, each card with a Lucide icon, a short name and a line on what you do there, and
opening on that sector's first step ([#5860](https://github.com/QuinnsCode/RustyBuns/issues/5860)). Only The
Event asks you to sign in; the rest work signed out. Every page has a way back: **Paths** first in the row of doors
along the top (`src/way.ts`), or the round house button in the corner of the decks and the studio builder
(`mountBack`). `qdoor.state()` for probes; `test/front-door.test.ts` walks every card to its first step and back at
phone and desktop sizes. `/` is still the desk, so a link someone was sent lands where it always did.

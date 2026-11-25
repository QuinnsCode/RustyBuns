# Qollab Studio: the six ways in

Qollab Studio is one app with six doors. Each door is a different person with a different job, and each one walks
a path through the same pieces: the desk (FM DAW), the 3D rooms, the DJ decks, the studio builder, the gear
(`packages/gear`) and the circuits (`circuits/`, Q Amp, the sound wall). This file names each path: who walks it,
where they come in, the steps they take, what works today and what is missing. Work on Qollab Studio should make one
of these walks shorter or less broken. When a step changes, change its line here.

Every path starts on the front door, `/door.html` (`src/paths.ts`, `src/front.ts`). The Door column is where its card lands.

| Path | Who | Door | Works end to end today? |
|---|---|---|---|
| [1. Learn to set it up](#1-learn-to-set-it-up) | a beginner, a student, a teacher | Learn the setup: `/studio.html`, the gear room (plug the guitar into an amp); the jam room's `?` card | Yes, three lessons at the gear wall; more to come |
| [2. Make a track](#2-make-a-track-the-daw) | a bedroom producer | Make a track: `/`, the desk with the demo beat | Yes, one loop at a time (no song mode yet) |
| [3. Jam with friends](#3-jam-with-friends-the-metaverse) | a band, friends far apart | Jam with friends: `/jam.html`, the lobby (sign in, make a room) | Yes, sign in to invite link to playing together |
| [4. DJ a set and stream it](#4-dj-a-set-and-stream-it) | a DJ | DJ a set: `/decks.html`, the decks with the demo tracks | Yes: into the room, to a file, out of your sound card to any stream app, and a listen link of our own |
| [5. Plan a sound system](#5-plan-a-sound-system-cad-for-speakers) | a sound engineer, a venue, a festival crew | Plan a sound system: `/rooms.html`, the studio builder | Partly: room acoustics and a rig pick, no coverage map or gear list |
| [6. Build the circuit](#6-build-the-circuit-tscircuit-to-your-hands) | a pedal or synth DIYer | Build the circuit: `/amp.html`, Q Amp; the gear room | Partly: play, change parts, download a kit with your parts; nothing built yet |

All six share one account (eqosys), one saved project (the sesh's world) and one gear catalogue, so a person can
move from one path to the next without starting over: the pedal you built in path 6 is gear on the floor in path 3,
the rig you planned in path 5 is the PA your set plays through in path 4.

## 1. Learn to set it up

**Who:** someone who has never cabled a rig, gain-staged a mixer or heard why a room rings. A teacher with a class.

**The walk they want:**
1. Pick a lesson: "plug a guitar into an amp", "patch a synth voice", "set up a PA for a small room".
2. Do it in the room with their hands: carry the box, plug the cable, turn the knob, hear the change.
3. The app says what went right or wrong in plain words, and why.
4. Finish, and the lesson's rig stays as their own room to keep playing in.

**Works today:**
- Three setup lessons, started from the `?` card's "Learn to set it up" row (`src/studio/lessons.ts`, [#5861](https://github.com/QuinnsCode/RustyBuns/issues/5861)): plug a guitar through a pedal into an amp and its cab; patch a sound wall voice (VCO, VCF, VCA, Q Out); set up a small PA (two powered speakers placed apart and aimed at the room's middle, a mic through a mixer, powered on mixer first). All with your hands at the gear wall, on the sesh's own patch. A card at the top left ticks each step off as the gear says so and, when something is in the way, says what and why (straight into the amp, the filter's CV, gain too hot, a speaker facing the wall, a thump). Leave any time; what you built stays. The steps run on `packages/gear`'s checker (`steps.ts`), the one Sound Guy Simulator's first-minute hints use, and the PA's switch-on order is the catalog's own `thumps`.
- The jam room's "What you can do here" card (`?`, `src/studio/help.ts`) and the key strip: what each key does where you stand.
- The studio builder's Why line and ring time per seat (`/rooms.html`): change a wall's material and hear and see the room change.
- The sound wall's build sheets explain each module in plain words (`B` in the gear room, [WALL.md](WALL.md)).
- Sound Guy Simulator (`apps/load-in`) already teaches load-in, cabling and aiming speakers as a game, level by level.

**Missing:** lessons past the first three (gain-staging a desk, why a room rings), a marker over the gear the next step is about, and a teacher's view of a class's progress. The lessons need the sesh's gear room, so a page with no World (plain `vite`) can't take them.

## 2. Make a track (the DAW)

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

## 3. Jam with friends (the metaverse)

**Who:** a band, or friends in different cities who want to play together in a place, not a video call.

**The walk:**
1. Open `/jam.html`, sign in with eqosys, pick a character.
2. Make a room: pick a studio (or the one you built in path 5) and name it.
3. Copy the invite link and send it.
4. A friend opens the link, walks in, sits at an instrument; the leader grants who plays, edits and mixes.
5. Play together on the same beat; the desk records it; the room's guest list keeps who may come back.
6. Optional: a phone as a remote for the desk (`/remote.html`), an agent at the desk over MCP (`scripts/studio-mcp.ts`).

**Works today:** all six steps (front door `src/studio/door.ts`, grants `src/grants.ts`, guest lists `src/guest-list.ts`).

**Missing:** the character is a stand-in until [#4987](https://github.com/QuinnsCode/RustyBuns/issues/4987); the
rooms' look is a climb ([#5365](https://github.com/QuinnsCode/RustyBuns/issues/5365)). Pedals, amps and cables
stand on the gear wall in every room (`src/studio/gear-wall.ts`, #5393).

## 4. DJ a set and stream it

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

## 5. Plan a sound system (CAD for speakers)

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
- Step 2: an open-air room picks one of five rigs (`@rustybuns/gear` `SYSTEMS`; the rig cards, `rig-cards.ts`, draw each to
  scale). The PA tool stands a stack on the ground, Move drags it, Turn aims it, and the PA panel turns it, splays its
  tops and sets a line array's pins (#5863).
- Step 3: the Coverage button draws the PA's mids and highs over the floor on the blueprint (`src/studio/coverage.ts`),
  and the PA panel gives the floor's level and how even it is. It is `@rustybuns/gear`'s `coverage` of the very boxes
  `pa-room.ts` plays the set from (`paSources`), so the map is what you hear on Walk in. Ring time and a clap at each seat.
- Step 4: Walk in opens the room; `pa-room.ts` plays each speaker from its place, aimed, late by distance, with the room's ring.
- Step 5: the PA panel's power check (`@rustybuns/gear` `powerPlan`): the amp racks, each rack's and each powered stack's
  breaker, and the generator (the smallest that holds, or the one you pick), with the reason when one gives out.
- Step 6: **Gear list** saves every box, amp rack, the generator and distro, each cable run cut to a reel's length,
  and the power plan (`gearList`); **Plan drawing** saves the blueprint with the coverage map on it as an SVG.
- `window.qrooms`: `pa()`, `level(x, z)`, `pickStack(i)`, `showMap()`, `download("list" | "plan")`; the journey is
  `test/pa-builder.test.ts`.

**Missing** ([#5883](https://github.com/QuinnsCode/RustyBuns/issues/5883)): stacks you place indoors (a room's PA is still a stack either side of the decks), the delay from far
stacks on the map, and the coverage map in the 3D view.

## 6. Build the circuit (tscircuit to your hands)

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

`/door.html` names all six paths, each a card with a Lucide icon, a short name and a line on what you do there, and
each card opens on that path's first step ([#5860](https://github.com/QuinnsCode/RustyBuns/issues/5860)). Only the jam
room asks you to sign in; the rest work signed out. Every page has a way back: **Paths** first in the row of doors
along the top (`src/way.ts`), or the round house button in the corner of the decks and the studio builder
(`mountBack`). `qdoor.state()` for probes; `test/front-door.test.ts` walks every card to its first step and back at
phone and desktop sizes. `/` is still the desk, so a link someone was sent lands where it always did.

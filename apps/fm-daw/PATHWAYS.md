# Qollab Studio: the six ways in

Qollab Studio is one app with six doors. Each door is a different person with a different job, and each one walks
a path through the same pieces: the desk (FM DAW), the 3D rooms, the DJ decks, the studio builder, the gear
(`packages/gear`) and the circuits (`circuits/`, Q Amp, the sound wall). This file names each path: who walks it,
where they come in, the steps they take, what works today and what is missing. Work on Qollab Studio should make one
of these walks shorter or less broken. When a step changes, change its line here.

| Path | Who | Door | Works end to end today? |
|---|---|---|---|
| [1. Learn to set it up](#1-learn-to-set-it-up) | a beginner, a student, a teacher | the jam room's `?` card | No: help for keys only, no guided setup |
| [2. Make a track](#2-make-a-track-the-daw) | a bedroom producer | `/` | Yes, one loop at a time (no song mode yet) |
| [3. Jam with friends](#3-jam-with-friends-the-metaverse) | a band, friends far apart | `/jam.html` | Yes, sign in to invite link to playing together |
| [4. DJ a set and stream it](#4-dj-a-set-and-stream-it) | a DJ | `/decks.html` | Into the room and to a file, yes; a live link out, no |
| [5. Plan a sound system](#5-plan-a-sound-system-cad-for-speakers) | a sound engineer, a venue, a festival crew | `/rooms.html` | Partly: room acoustics and a rig pick, no coverage map or gear list |
| [6. Build the circuit](#6-build-the-circuit-tscircuit-to-your-hands) | a pedal or synth DIYer | `/amp.html`, the gear room | Partly: play, swap parts, download a kit; no board editor in the app, nothing built yet |

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
- The jam room's "What you can do here" card (`?`, `src/studio/help.ts`) and the key strip: what each key does where you stand.
- The studio builder's Why line and ring time per seat (`/rooms.html`): change a wall's material and hear and see the room change.
- The sound wall's build sheets explain each module in plain words (`B` in the gear room, [WALL.md](WALL.md)).
- Sound Guy Simulator (`apps/load-in`) already teaches load-in, cabling and aiming speakers as a game, level by level.

**Missing:** no guided lessons in Qollab Studio itself. The help card says which key does what, not how to set
anything up ([#5861](https://github.com/QuinnsCode/RustyBuns/issues/5861)). Lessons should reuse Sound Guy Simulator's step checks (`next.ts`, `assists.ts`) rather than write new ones.

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

**Works today:** steps 1 to 3, and the recording in step 4: REC in the decks' header (on `/decks.html` and at the DJ
table) records the master, what the room's PA gets, to a file on your computer (`src/dj/record.ts`: Opus in WebM, or
AAC in Safari), with a track list beside it naming each track and the time it came in (its deck playing with the fader
and its crossfader side open). Nothing is uploaded. A YouTube deck plays in YouTube's own player, so it is never in the
recording; the button says so.

**Missing:** the listen link: people outside the sesh hearing the set live, no sign-in and no seat
([#5878](https://github.com/QuinnsCode/RustyBuns/issues/5878): priced, waits on the owner's yes). There is no saved
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
- Step 2, in part: an open-air room picks one of five rigs (`@rustybuns/gear` `SYSTEMS`); the rig cards (`rig-cards.ts`) draw each to scale.
- Step 3, in part: ring time and a clap at each seat; the gear package has `coverage` and each box's spec sheet.
- Step 4: Walk in opens the room; `pa-room.ts` plays each speaker from its place, aimed, late by distance, with the room's ring.
- Step 5: `@rustybuns/gear` works out amps, breakers and generator load (Sound Guy Simulator uses it).
- Sound Guy Simulator already has aiming and a coverage heat map on the floor in several venues.

**Missing:** placing and aiming stacks by hand in the builder, the coverage map there, and step 6 (gear list,
power plan, a printable plan): [#5863](https://github.com/QuinnsCode/RustyBuns/issues/5863).

## 6. Build the circuit (tscircuit to your hands)

**Who:** a guitarist or synth DIYer who wants to hear a pedal or a module, change its parts, and solder the real one.

**The walk:**
1. Play it: Q Amp (`/amp.html`) and the pedal wall, the sound wall in the gear room (`/studio.html`). Each pedal and
   module is a real circuit solved as you play ([CIRCUITS.md](CIRCUITS.md), [WALL.md](WALL.md)).
2. Change it: swap parts (clipping diodes, caps) and hear the change.
3. Bring your own board: drop a tscircuit board's circuit JSON on Q Amp's floor; the bench checks it solves, then it is the fourth pedal.
4. Build it: B opens the build sheet; download the kit zip: Gerbers, `bom.csv`, `pnp.csv`, `order.csv` (a part
   number for every part), the front panel and a plain-words build sheet (`src/kit/`).
5. Order it: send the Gerbers to a fab, upload `order.csv` to a parts shop.
6. Close the loop: record the built board, play the same riff through the sim, compare.

**Works today:** steps 1 to 4. Step 5 is by hand with the files from step 4.

**Missing:**
- Editing a board happens in the repo (`circuits/<board>.tsx`, then `bun scripts/boards.ts <board>`), not in the app ([#5864](https://github.com/QuinnsCode/RustyBuns/issues/5864)). tscircuit itself is parked (`apps/tscircuit-desktop`: it pins zod 3).
- No board has been built yet, so step 6 has never run. A prototype order is the owner's call, with its price.
- Selling kits or built boards needs owner decisions first (compliance, the hardware licence, price per board: [ANALOG.md](ANALOG.md#8-from-the-screen-to-your-hands)).

## The front door

Today the doors are separate pages, and a newcomer lands on whichever link they were sent. The paths only feel like
one product when the front door names all six and each one opens on its first step. That door is [#5860](https://github.com/QuinnsCode/RustyBuns/issues/5860).

# What each talk is about

One line per talk, high level, in the owner's words. Edited in the doc
https://claude.ai/artifact/WYWHBbbqQ2YTZvFdkG1496; this file is the copy in the repo. Slides come after.

## Tone for every talk

A science show. Ask a question, run the experiment in front of the room, show what happened. Think Bill Nye or
MythBusters: curious, hands-on, human, not a product pitch.

## The talks, in order

1. **Rusty Buns: From Concept to Keyword to Dreams.** Server vs worker vs storage vs memory and the rest, and how Rusty
   Buns aims to write you app code once and run it on a laptop, a server, Cloudflare. It has opt-in Rust client or
   server side that fall back to TypeScript. Lots of Venn diagrams: where the three places agree, and where they don't.
   Rusty Buns is the framework, or "the stack" as we said two years ago, before AI agents.
2. **The Frankenstein Code Factory.** Building on those Rusty Buns primitives to make my own app primitives, so the
   stack can spawn whatever piece a job needs. How can I, and we, succeed with it? codeSplitter is built on Rusty Buns
   and hosts WebDevCody's Agent Office. Rusty Buns grew out of my game engine, so that same engine lets me swap the
   office's Node for Bun and run my game pieces inside it. Rusty Buns running Rusty Buns running someone else's office.
3. **The Game Engine or Actually where it all started.** Rusty Buns was born from 1) wanting single player desktop
   experience 2) wanted my grass to render better no joke. Went down a path for TS interop with Rust across platforms.
   How our multiplayer games work: the server holds the true game and steps it in ticks, the screen smooths between
   frames, and the buffer engine is on the way. Includes the twin sim: the same game rules in TypeScript and Rust that
   must give identical results, and how we keep them identical. Follows straight on from talk 2.
4. **The Audio Engine.** The FM DAW. Its sound engine is one Rust crate, running as wasm in the browser's audio thread
   and natively on the host, matching the TypeScript engine bit for bit. Many sound parts are reasonable Rust crates,
   and other systems programming can be built on and around them. We also now have the TsCircuit emulating analog amps
   to be distortion amps / pedals too! So we have a daw do what? feed that digital signal through the tscircuit circuit
   and capture signal back for some audio processing with like real live but digital circuits haha.
5. **The Example Range.** The example apps (games, work tools, other frameworks' apps) and what each kind proves about
   the engine.
6. **eqosys.** The one account across our apps: sign-in, library, saves, achievements, friends, privacy controls, and
   what a game calls to use it.
7. **Qollab.** The multiplayer layer: hubs, parties, spaces and voice. It gets players into a game room, then stays out
   of the game.
8. **Sign-in to Party to Game.** The whole path from signing in with eqosys, to a Qollab party, to a seat in a game
   room, including how the game checks the token.
9. **Ship It.** How code gets from an agent to production: PR tests, the builder Mac, release rings, and the owner
   deploying.

## Slide drafts

Talk 1 slide tables live in the doc's "Talk 1 slides" tab. The style is locked: J, black and orange (the owner's pick).
`drafts/talk1.html` shows ten content options for each of talk 1's 42 slides in that style, one tab per point (`#p3`
opens point 3), published as https://claude.ai/artifact/9J1LWKbxnYYewFTxdPc6MM (capabilities `db` and `user`). Option 1
is always the doc's wording. The owner's pick per slide is in its `content` collection, one document per slide (`t1-s1`
to `t1-s42`): `{ option, note }`.

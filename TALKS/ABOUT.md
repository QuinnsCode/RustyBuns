# What each talk is about

One line per talk, high level. The owner corrects these first; slides come after.

**Tone for every talk:** a science show. Ask a question, run the experiment in front of the room, show what happened.
Think Bill Nye or MythBusters: curious, hands-on, human, not a product pitch.

0. **Rusty Buns Keywords**: server vs worker vs storage vs memory and the rest, and how Rusty Buns aims for the most
   overlap possible so you write once and run anywhere. Lots of Venn diagrams: where the laptop, the server and the cloud
   agree, and where they don't.
1. **The Frankenstein Code Factory**: building on those primitives to make my own app primitives, so the stack can spawn
   whatever piece a job needs. How can I, and we, succeed with it? codeSplitter is built on Rusty Buns and hosts
   WebDevCody's Agent Office. Rusty Buns grew out of my game engine, so that same engine lets me swap the office's Node
   for Bun and run my game pieces inside it. Rusty Buns running Rusty Buns running someone else's office.
2. **What Rusty Buns Is**: the framework, or "the stack" as we said two years ago, before AI agents. Write an app once
   and run it on a laptop, a server or Cloudflare, with optional Rust parts that fall back to TypeScript.
3. **The Game Engine**: how our multiplayer games work: the server holds the true game and steps it in ticks, the
   screen smooths between frames, and the buffer engine is on the way. Follows straight on from talk 1.
4. **Double Dragon**: the game sim written in both TypeScript and Rust that must give identical results, and how we
   keep them identical.
5. **The Audio Engine**: the FM DAW. Its sound engine is one Rust crate, running as wasm in the browser's audio thread
   and natively on the host, matching the TypeScript engine bit for bit. Many sound parts are reasonable Rust crates, and
   other systems programming can be built on and around them.
6. **The Example Range**: the example apps (games, work tools, other frameworks' apps) and what each kind proves about
   the engine.
7. **eqosys**: the one account across our apps: sign-in, library, saves, achievements, friends, privacy controls, and
   what a game calls to use it.
8. **Qollab**: the multiplayer layer: hubs, parties, spaces and voice. It gets players into a game room, then stays out
   of the game.
9. **Sign-in to Party to Game**: the whole path from signing in with eqosys, to a Qollab party, to a seat in a game room,
   including how the game checks the token.
10. **Ship It**: how code gets from an agent to production: PR tests, the builder Mac, release rings, and the owner
    deploying.

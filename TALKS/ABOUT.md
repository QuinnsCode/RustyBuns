# What each talk is about

One line per talk, high level. The owner corrects these first; slides come after.

0. **The Words**: a glossary of the terms the other talks use. Probably folded into the talks rather than a talk of its own.
1. **The Frankenstein Code Factory**: codeSplitter, our git host, holds the code for Agent Office and for itself, so AI agents in the office can change both, and a person approves every change before it goes live.
2. **What Rusty Buns Is**: the framework. Write an app once and run it on a laptop, a server or Cloudflare, with optional Rust parts that fall back to TypeScript.
3. **The Example Range**: the example apps (games, work tools, other frameworks' apps) and what each kind proves about the engine.
4. **The Game Engine**: how our multiplayer games work: a server-authoritative sim in ticks, interpolation on the client, and the buffer engine in progress.
5. **Double Dragon**: the game sim written in both TypeScript and Rust that must give identical results, and how we keep them identical.
6. **eqosys**: the one account across our apps: sign-in, library, saves, achievements, friends, privacy controls, and what a game calls to use it.
7. **Qollab**: the multiplayer layer: hubs, parties, spaces and voice. It gets players into a game room, then stays out of the game.
8. **Sign-in to Party to Game**: the whole path from signing in with eqosys, to a Qollab party, to a seat in a game room, including how the game checks the token.
9. **Ship It**: how code gets from an agent to production: PR tests, the builder Mac, release rings, and the owner deploying.

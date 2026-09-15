# RustyBuns
Your web app, shipped as a native binary, with a server you can move anywhere.

The core offer

"Your web app, shipped as a native binary, with a server you can move anywhere."

Three SKUs, each a fixed-scope deliverable with a named artifact at the end.

SKU 1 — Desktop Binary

For: anyone with a React/Vite app who wants a downloadable product without Electron.

Deliverables:

Signed, notarized installers for macOS (arm64/x64), Windows, Linux — one bun build --compile matrix, frontend embedded via --asset
Launcher: opens in the user's Chrome in --app mode with the client's icon; server lifecycle bound to the launcher (--no-orphans); single-instance lock; per-launch auth token
Local persistence on bun:sqlite; offline by default
Auto-update channel (manifest + signed delta downloads)
CI pipeline that produces all three platforms on tag

What they get: a .dmg, .msi, .AppImage, and a release pipeline they own.

SKU 2 — Portable Backend

For: teams who want single-player and multiplayer, or laptop and cloud, to be the same code.

Deliverables:

Their domain logic refactored behind the ports contract (Ctx/Socket/Storage/Reporter) — platform-free core
Three shells, all passing the same test suite: local (SKU 1), Docker (Hetzner/Fly/anything), Cloudflare Durable Object
Bun.SQL adapters: SQLite local, Postgres in the box, D1 on the edge — one query layer
Graceful drain on deploy, memory-pressure eviction, Redis pub/sub when they need more than one box
Binary WebSocket protocol with backpressure handling; load test report at N clients × tick rate

What they get: docker compose up and a wrangler deploy of the same engine that ships in the desktop build.

SKU 3 — Native Acceleration

For: the app that has a hot path TS can't hold — inference, media, data, physics.

Deliverables:

Profile first: --cpu-prof-md report identifying the actual hot functions (they get the report either way)
Rust crate behind bun:ffi for the server-side hot path, or wasm-bindgen worker for the client-side one, with capability negotiation so the app degrades cleanly where the native path is absent
Reference modules you've pre-built and can drop in: local LLM/whisper inference, image pipeline (Bun.Image first, Rust when it isn't enough), columnar data via Polars/DuckDB, vector search
Cross-platform cdylib build matrix + memory-ownership contract documented

What they get: the same app, 10–50× faster on the one thing that was slow, and a doc explaining who owns every pointer.

Packaging
Starter — SKU 1 only. Fixed price, ~3 weeks.
Product — SKU 1 + 2. Most customers land here. This is the "local-first with a cloud twin" story.
Performance — all three. Games, AI tools, research apps.
Retainer — Bun/Rust version tracking (1.x moves fast), signing cert renewals, dependency audits via bun audit fix, on-call for the eject path.
The three sentences you say in the meeting
You keep your web app and your web team; nothing is rewritten.
One codebase becomes a desktop binary, a Docker container, and an edge deployment — same server, three targets.
When something's slow, we drop that one function into Rust; nothing else changes.
What not to promise

Console targets, pixel-identical rendering across browsers, native menus/tray, mobile. Say it up front — it's why the price is a fraction of a native rebuild.

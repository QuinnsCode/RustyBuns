---
name: rustybuns-apps
description: Start work in one app under apps/ (a game, eqosys, qCRM, codeSplitter, an example). Gives the app's brief in one call instead of paging its README and notes.
---

# Working in one app

1. `bun run brief <app>` (no app: every app, one line each). It prints, from the app's own files: what the app is,
   its README sections, its notes files (VISION.md, LEVEL_DESIGN.md, ...) with their titles, its license note,
   its scripts, its tests and the one-line command to run one, its port, and its page handle.
2. Read only the notes the task needs. A licence note (eqosys, qCRM, QView3D, geoboxq) means read that app's
   `AGENTS.md` before copying code out of it.
3. A page handle means `bun run probe <app> [path] [--js <expr>]` reads its state as JSON; use that before a screenshot.
   A new game gets a handle and a row in `HANDLES` (`scripts/probe.ts`), and then `brief` shows it too.
4. Run the test files you change, from the app's folder (the brief gives the line). CI runs the rest.

How to build with Rusty Buns in general (config, bindings, guards, tests) is the `rustybuns` skill. The repo's
rules are `AGENTS.md`. A fact about one app that the next agent needs goes in that app's README or a notes file
in its folder, where `brief` will find it, not in this skill.

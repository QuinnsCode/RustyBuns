# @rustybuns/util

The small helpers every Rusty Buns app shares: guards, bytes, JSON replies, rate limits, game rooms, sockets,
eqosys sign-in and more. Plain TypeScript files, one per job; import the one you need
(`import { obj, str } from "@rustybuns/util/guard"`). `bun run outline --api packages/util` lists every export.

## Three sides

Each module says where it runs, in [api.json](api.json):

| Side | Runs in | May import |
| --- | --- | --- |
| `shared` | a page, a Worker, Bun | only other shared modules (no packages, no `node:`) |
| `web` | a page | shared and web |
| `server` | a Worker or Bun | shared and server |

So a shared type or guard is written once and both ends of the wire import it. A shared module also works as
a plain file somewhere else: `bun scripts/util-api.ts --copy guard http <dir>` copies it and the shared modules it
imports, nothing more.

## Two speeds

- **Stable** (`stable` in api.json: the root, `guard`, `bytes`, `http`, `limits`, `room`, `socket`, and what the root
  re-exports). Their exports are written down in [API.lock](API.lock), one signature a line. Adding an export is
  free: run `bun scripts/util-api.ts --update`. Changing or removing one takes
  `bun scripts/util-api.ts --update --break "why"`, which writes the change and the reason to `BREAKING.md` for the
  stable ring's release notes. Keeping the old export beside the new one is usually kinder.
- **Moving** (everything else). No promise: change it as the apps need.

## Lab

`src/lab/` is the wild end. Drop a file in (`src/lab/my-idea.ts`) and import it as `@rustybuns/util/lab/my-idea`:
no side, no lock, no api.json line. Only lab files may import lab, so nothing stable stands on it. When an idea
earns its keep, move it up to `src/`, give it a side, and it is a normal module.

## The check

CI runs `bun scripts/util-api.ts`: every module has exactly one side, imports go the right way, nothing outside lab
imports lab, and the stable exports match API.lock.

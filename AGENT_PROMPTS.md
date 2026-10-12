# Prompts for your agent

Paste one of these into your coding agent (Claude Code, Codex, Cursor, anything that runs shell commands), in your app's repo. Each one is a single job with a stopping point. None of them deploys or spends money; the deploy step is yours.

Start with the first. Each one after it picks up where the one before it stopped.

## 1. Try it: your app as a desktop app

```text
Try Rusty Buns (https://github.com/QuinnsCode/RustyBuns) on this repo, on a new branch.
Rusty Buns boxes a Vite web app as a desktop binary and a Cloudflare deploy. It needs Bun 1.4+.

1. Find the web app. If the repo root isn't it (a frontend/ or apps/web folder), work in that folder.
2. Add it as a dev dependency with this repo's package manager: @rustybuns/cli and @rustybuns/shell-bun.
3. Run `rustybuns init` (through the package manager: npx, pnpm exec, bunx). Read everything it prints.
   If it refuses, it says why and what to try. Follow that, don't reach for --force.
4. Run `rustybuns build desktop --dev`, then `RB_NO_BROWSER=1 rustybuns run desktop`. It prints a
   URL with a token. Open it (or curl it) and check the app's pages load.
5. Stop the host. Commit rustybuns.config.ts and whatever init wrote, nothing under .rustybuns/.

Don't deploy anything, don't run `rustybuns deploy`, and don't touch .env files or credentials.
Tell me: what init detected, what worked, what didn't, with the exact error text.
```

## 2. Plan the web deploy

```text
This repo has a rustybuns.config.ts. Get it as far as a Rusty Buns plan, without deploying.

1. Run `rustybuns add deploy` (it pins Alchemy and Effect).
2. Run `rustybuns plan`. It typechecks the generated stack, builds the app and asks Cloudflare
   what would change. If it says it isn't logged in, stop and tell me: I'll run
   `rustybuns login cloudflare` myself.
3. If plan says the app is desktop-only, tell me why (init printed a reason) and stop.

Don't run `rustybuns deploy`. Show me plan's list of billable resources and anything it warned about.
```

## 3. A frontend with its own server

For a Vite frontend that talks to a server of its own in another folder (an `api/` with `node server.js`, its `vite.config` proxying `/api`). `init` keeps such an app desktop-only and prints a `backend:` line naming the server. When it finds the server's file it also writes `targets.desktop.server`, and the desktop host runs that server for you: try prompt 1 first. This prompt is for the server that can't run that way (a native addon, a server init couldn't find), or for taking it to the web.

```text
`rustybuns init` made this app desktop-only because its Vite dev server proxies some paths to a
separate backend (see the `backend:` line it printed, and server.proxy in the vite config).
Rusty Buns can't run that backend as it is (targets.desktop.server isn't set, or doesn't cover it).

Read the backend and list every route the frontend calls, and what each one needs (files, a
database, cookies, outside APIs). Then propose, without writing it yet, the smallest way to
answer those routes from desktop/host.ts (Rusty Buns' Bun host: `fetch(req, ctx)` returns a
Response or null, and ctx.dataDir is a folder for the app's data). Say what would not carry over.
Wait for my go-ahead before changing code.
```

## 4. Tell us what broke

```text
Rusty Buns didn't work on this repo. Write a bug report I can paste into
https://github.com/QuinnsCode/RustyBuns/issues/new, and don't file it yourself:
- the repo's shape: framework, package manager, where the app and any server live
- the commands you ran, in order, with the exact output of the one that failed
- `rustybuns version` and `bun --version`
Leave out anything secret: tokens, .env values, private URLs.
```

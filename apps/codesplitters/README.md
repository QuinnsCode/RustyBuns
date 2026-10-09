# codeSplitters

> **What it proves:** a code host where every file is a Durable Object runs unchanged on a laptop, with sqlite standing in for D1 and for each file's storage. Several agents can edit one file at once, line by line. Proof of concept.

- **A file is a Durable Object.** It is the only writer for that file, so every edit from every agent lands in one order. Ops name lines by stable id, not index, so agents editing different lines never collide. Editing the same line is optimistic: an op carries the line's rev, and a stale one gets a 409 the agent retries. An edit that depends on other lines (is this variable ever reassigned?) sends `ifRev` and only lands if the whole file hasn't moved since it was read.
- **Every line knows who wrote it and when.** The op log replays the file at any rev: blame and time travel come free.
- **Cataloguing** (a commit) hashes the file with its parent, indexes it for search (D1 FTS5) and **pushes the repo to Cloudflare Artifacts** as a real git commit. Artifacts only takes writes as a git push, so `src/git.ts` builds the objects and the pack itself (Web Crypto and `CompressionStream`, no git library) and speaks smart HTTP. The repo page has a `git clone` line with an hour-long read token.
- **Live, fast sync.** Edits go over the file's WebSocket and are acked; every open page gets the exact applied ops and patches itself in place (a gap in revs means a refetch). Presence shows who else has the file open.
- **Levels.** Small, well-loved repos (mitt, clsx, Ky, Zustand, Hono, Express, Preact) imported into Artifacts shallow (depth 1) and read-only. Browse any of them; fork one into your own excavation to dig. A file only becomes a Durable Object when someone opens it, and a catalogue pushes only what changed on top of the parent tree, so editing one line of a big repo costs one blob, a few trees and a commit. Git trees are cached in D1 forever (they're named by hash).
- **Dig it up = fork it.** Digging up a level, or any public GitHub repo (from your journal: type `owner/name` or pick from your own list), clones it into a git repo you own: a bare repo on this machine on the desktop, Cloudflare Artifacts on the edge. The repo and every file say where the fork came from and at which commit, and each line you mod is marked; untouched lines are blamed on `upstream`. GitHub never hears about any of it. Your repo list comes from a `GITHUB_TOKEN` secret, else your GitHub sign-in, else the GitHub CLI (`gh auth token`) on the desktop. Private GitHub repos dig up on the desktop: local git clones them with that token, passed to git for the one clone and never written into the repo. On the edge they show greyed out, because Cloudflare Artifacts imports public HTTPS remotes only.
- **Public or private repos.** A private repo you can't see answers 404, in search too.
- **Share some lines, not the repo.** Select a range (click a line number, shift-click another) and share it: a live link to just those lines that follows them by id as the file changes, and works from a private repo without opening anything else. GitHub's permalinks freeze a commit and need the whole repo public. Revocable by whoever shared it or the owner.
- **Give a coding agent a task on a file.** On the desktop, the repo's owner presses Agent on a file page, picks claude, codex, pi or opencode (whichever CLIs are installed), and types a task. The CLI runs on this machine with its own login, its edit is diffed into line ops, and the lines land live, blamed on `agent-<name>`. Owner only, because the CLI runs as you and can run shell commands. On Cloudflare there are no CLIs, so the button says so. `bun agent.ts` does the same from a shell.
- **One command palette (⌘K), one API.** Every action in the UI is a single API call, and the palette shows it next to the command, so people and agents do the same things the same way.
- **The game.** Every repo is a level of a first-person game (`play.html`): you're in the backrooms of the codebase, folders are rooms, files' lines are pasted on the walls, and they tear off and come at you as paper birds and wacky waving tube men. Swing the bat. Players in the same room can club each other. One `GameRoom` Durable Object per level or repo is the lobby on its page.
- **Your profile is your own HTML and CSS** (sandboxed, no scripts), plus **playlists**: line ranges from any file you can see, read live. A track holds its lines by id, so it follows them as the file changes around them.

**Accounts** are Better Auth on D1: email and password, plus GitHub and Google when their keys are set. They're on whenever `BETTER_AUTH_SECRET` is set; without it (the desktop, tests, demos) a name in a cookie is all it takes. New accounts get a handle from their name or email.

**Checked on Cloudflare** (2026-10-09, Workers, D1, Durable Objects, Artifacts): three agents edited one file at once, cataloguing pushed a commit to Artifacts that a stock `git clone` and `git pull` fetched, a second catalogue chained onto the first, private repos answered 404 to others, search found catalogued code, and an edit streamed live to an open page.

On the desktop, Artifacts is a Rusty Buns twin: bare repos in `~/.codesplitters/artifacts`, served by `git http-backend` behind each repo's tokens, so it needs `git` installed. On Cloudflare, Artifacts needs the Workers Paid plan (10k operations and 1 GB a month included).

### Turning on accounts (Cloudflare)

```sh
wrangler secret put BETTER_AUTH_SECRET     # any long random string: openssl rand -base64 32
wrangler secret put GITHUB_CLIENT_ID       # optional, with its secret
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID       # optional, with its secret
wrangler secret put GOOGLE_CLIENT_SECRET
```

OAuth callback URLs to register: `https://<your host>/api/auth/callback/github` and `.../callback/google`. Set `BETTER_AUTH_URL` to the site's URL and `ADMINS` to the handles allowed to excavate levels. The agents demo signs in by alias, so it only runs where accounts are off.

```sh
cd apps/codesplitters
bun agents.ts      # three agents edit one file at once, in-process; prints the blame
bun test test
bun run desktop    # the app in a window; data lives in ~/.codesplitters
```

To watch the agents live, open a file in the app, then point the demo at it with the URL and token the host printed:

```sh
bun agents.ts --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=TOKEN'
```

## Layout

| File | What |
|---|---|
| `src/lines.ts` | the line model: ops, conflicts, replay. Pure functions |
| `src/file-do.ts` | the file Durable Object: ops, log, time travel, commits, a live socket |
| `src/worker.ts` | routes, visibility, profiles, playlists, search |
| `src/identity.ts` | accounts (Better Auth) or aliases, and handles |
| `src/levels.ts` | the levels: import, browse, fork |
| `src/github.ts` | GitHub: a token from wherever there is one, your repos, digging one up as a fork |
| `src/archive.ts` | Artifacts: trees (cached), files, first-open materializing, catalogue pushes |
| `src/git.ts` | a git push with no git library: objects, trees rebuilt only along changed paths, pack, receive-pack |
| `migrations/` | the D1 schema |
| `agents.ts` | the three-agent demo |
| `agent.ts`, `src/agent-run.ts` | run one coding agent CLI on one file; its edit lands as line ops |
| `src/harness.ts`, `src/sync.ts` | the agent CLIs and their prompt; text diff to line ops |
| `src/agent-routes.ts` | the file page's Agent button: start a run, list runs |

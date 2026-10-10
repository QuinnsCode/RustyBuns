# codeSplitters

> **What it proves:** a code host where every file is a Durable Object runs unchanged on a laptop, with sqlite standing in for D1 and for each file's storage. Several agents can edit one file at once, line by line. Proof of concept.

- **A file is a Durable Object.** It is the only writer for that file, so every edit from every agent lands in one order. Ops name lines by stable id, not index, so agents editing different lines never collide. Editing the same line is optimistic: an op carries the line's rev, and a stale one gets a 409 the agent retries. An edit that depends on other lines (is this variable ever reassigned?) sends `ifRev` and only lands if the whole file hasn't moved since it was read.
- **Branches and merges, by line.** An agent opens a branch (`POST /api/repos/:o/:r/branches`) and edits with `?branch=name`: the first time it touches a file, that file's Durable Object forks a copy of itself, every line id and rev intact. Reviewing the branch (`GET .../branches/:name`) shows each file's ops against main as it is now, and any conflicts. A merge (`POST .../branches/:name/merge`) is a three-way merge by line id that main's file applies in one batch, each line keeping its author: lines only one side touched merge cleanly, and so does a line or block one side moved and the other edited (the edit, and any lines added under it, follow it), the same new line added at the same spot on both sides (it lands once), and a line both sides changed in different words (one re-indents, the other changes an argument). Conflicts are a line both sides rewrote in the same words (or one renamed a word the other newly uses), a stretch both sides reshaped (lines added or deleted where the other side changed one too, like two rewrites of one function: one conflict for the whole stretch, as git would), and the same line added on both sides in different places (it would land twice). Each is settled with `resolve: {path: {lineId: "branch" | "main"}}`. Any conflict anywhere merges nothing. A branch that changes what runs at build or deploy time (`package.json`, lockfiles, `rustybuns.config.ts`, `wrangler.*`, `.rustybuns/`, `alchemy.run.ts`, Dockerfiles, `build.ts`, `vite.config.*`, CI files) says so in the review, every changed line shown, and when the owner's next commit to main would deploy, the merge waits for "I've read the build changes" (`build_ok: true`). Branches come from crew and agents, and an agent can be prompt-injected. This is built on the line-op log, not git branches, so blame and live sync work the same on a branch; git hears about it when main is catalogued.
- **Every line knows who wrote it and when.** The op log replays the file at any rev: blame and time travel come free.
- **Cataloguing** (a commit) hashes the file with its parent, indexes it for search (D1 FTS5) and **pushes the repo to Cloudflare Artifacts** as a real git commit. Artifacts only takes writes as a git push, so `src/git.ts` builds the objects and the pack itself (Web Crypto and `CompressionStream`, no git library) and speaks smart HTTP. The repo page has a `git clone` line with an hour-long read token.
- **Live, fast sync.** Edits go over the file's WebSocket and are acked; every open page gets the exact applied ops and patches itself in place (a gap in revs means a refetch). Presence shows who else has the file open.
- **Levels.** Small, well-loved repos (mitt, clsx, Ky, Zustand, Hono, Express, Preact) imported into Artifacts shallow (depth 1) and read-only. Browse any of them; fork one into your own excavation to dig. A file only becomes a Durable Object when someone opens it, and a catalogue pushes only what changed on top of the parent tree, so editing one line of a big repo costs one blob, a few trees and a commit. Git trees are cached in D1 forever (they're named by hash).
- **Dig it up = fork it.** Digging up a level, or any public GitHub repo (from your journal: type `owner/name` or pick from your own list), clones it into a git repo you own: a bare repo on this machine on the desktop, Cloudflare Artifacts on the edge. The dig box (home page and your profile) searches GitHub, or takes anything you copied there: a page URL, a remote, a `git clone` or `gh repo clone` line. A visitor's dig is temporary, so nobody's experiment runs up the bill: it lasts a day, and once `DIG_CAP` digs (default 20) are live the oldest goes first, rows, file Durable Objects and git together. Admins' digs keep. The repo and every file say where the fork came from and at which commit, and each line you mod is marked; untouched lines are blamed on `upstream`. GitHub never hears about any of it. Your repo list comes from a `GITHUB_TOKEN` secret, else your GitHub sign-in, else the GitHub CLI (`gh auth token`) on the desktop. Private GitHub repos dig up on the desktop: local git clones them with that token, passed to git for the one clone and never written into the repo. On the edge they show greyed out, because Cloudflare Artifacts imports public HTTPS remotes only.
- **Public or private repos.** A private repo you can't see answers 404, in search too.
- **Share some lines, not the repo.** Select a range (click a line number, shift-click another) and share it: a live link to just those lines that follows them by id as the file changes, and works from a private repo without opening anything else. GitHub's permalinks freeze a commit and need the whole repo public. Revocable by whoever shared it or the owner.
- **Private lines in a public repo.** Select some lines and make them private: only the repo's crew (owner and collaborators) reads them. Everyone else gets a placeholder in the same place (the line's id and number stay, its text is blank): on the file page, in blame and time travel, on the live socket, in shares, playlists and branch reviews. A commit pushes the blank line to git and indexes it blank for search, so the remote never holds the real text; walls in the game come from git, so they're blank too. Privacy follows the line by id, so editing it keeps it private, and branches hide the same lines. A clone, a preview or a deploy gets the public text, so for now the crew reads private lines in the app and over the API. Text already pushed before you marked it stays in git's history, so treat a leaked secret as leaked. `POST /api/repos/:o/:r/do/private?path= {lines: [ids], private}`.
- **Cut: some lines out, run, shared, merged back.** Select lines and press Cut (`POST /api/repos/:o/:r/cuts {pieces: [{path, from, to}]}`): the cut is those lines plus what they use: the file's imports and declarations they use, and, following relative imports into the repo's other files, the declarations they import and what those use in turn (packages aren't followed). Add more ranges for anything else you want in it, like a test that covers them. It's a branch, `cut-<id>`, whose files start as just those lines with their ids and revs, so the cut page edits them like any branch and Merge into main is the same line-by-line merge; lines that were never in the cut are left alone. Run tests (`POST /api/cuts/:id/run`, the repo's owner) runs `bun test` on the cut alone, on the desktop or in the agent sandbox's container for admins on Cloudflare, and marks each test's line pass or fail in the gutter, plus any cut line a failure's stack points at. Share hands out `/api/cuts/:id/share`, whose card (`card.png`, drawn in the Worker with no image library) shows the code and its result when the link unfurls on X, and a Post to X button. The card is set in DejaVu Sans Mono; pick Geist Mono, the app's own code font, in the Share panel (`?font=geist` on the share link). `scripts/card-font.ts` rasterizes another monospace font into the card's format.
- **Give a coding agent a task on a file (super experimental, run at your own risk).** On the desktop, the repo's owner presses Agent on a file page, picks claude, codex, pi or opencode (whichever CLIs are installed), and types a task. The CLI runs on this machine with its own login, its edit is diffed into line ops, and the lines land live, blamed on `agent-<name>`. Owner only, because the CLI runs as you and can run shell commands. On Cloudflare the Worker can't run them, so the button says so unless hosted agents are on (below). `bun agent.ts` does the same from a shell.
- **Rusty Buns fit.** Every repo page says how easily `rustybuns init` could ship the repo as a desktop binary, a Worker and a server: ready, likely, needs work or poor, with the reasons. It reads the top level, `package.json` and any vite config, and asks the CLI's own detector (`@rustybuns/cli/fit`), so the two never disagree. Frameworks `init` doesn't infer yet (Next.js, SvelteKit, React Router / Remix, Nuxt) link to the issue tracking them; `node:http` servers, native addons and monorepo roots pull the verdict down. `GET /api/repos/:o/:r/fit`.
- **The dependency doctor.** On the repo page the owner turns it on and tunes it: how often (6 hours to a month), up to which level (patch, minor, major), how old a release must be (3 days by default, since a bad or hijacked release usually gets pulled within days), and what never to touch. It only proposes a version the current range doesn't already allow, so the lockfile's own updates aren't churned. What's worth taking lands on a branch, `deps-<date>`, edited by `agent-deps` and ready to merge. With tests on (the owner's choice, since it runs the repo's own code), each update is first installed and tested in a throwaway clone that is deleted afterwards: a temp dir on the desktop, or on Cloudflare a fresh `AGENT_SANDBOX` container per try, for the site's admins only (it's there only with hosted agents on, `CODESPLITTERS_AGENTS=1`, and bills container time); if they break together, each is tried alone and only the passing ones go on the branch. The owner can also pick a coding agent (claude, codex, pi or opencode) to fix an update that broke the tests, on the desktop: in the same kind of clone, with the update installed, it gets the failing output, the package's changelog, the repo's commits that touched the package and where it's used, and patches as many files as it needs; the tests run after each try, up to the owner's limit (3 by default). A fix that passes lands on the same branch, blamed on `agent-<harness>`; one that doesn't is left out with its last output. It runs from the Worker's hourly Cron Trigger (`crons` in `rustybuns.config.ts`), which Rusty Buns runs as a minute timer on the desktop.
- **Deploy for real.** Next to preview deploys, the owner ships the repo's Rusty Buns stack to a stage they pick (`prod` by default) and leaves it up: clone, install, deploy, check. Only a person ships. The owner presses Deploy, or turns on "ship when I commit to main", and then only their own commits ship it; crew and agents (the dependency doctor too) never start a deploy. A commit during a deploy ships once more afterwards. A stack that adopts live resources ships only once the owner marks the repo as production. Every deploy is logged (who, which commit, which stage, the result and the end of its output). Desktop only, with the logins on this machine.
- **Webhooks for CI/CD.** The owner adds webhook URLs to a repo, each hearing some of `commit` (main catalogued and pushed to git), `branch.opened`, `branch.merged` and `deploy.finished`. Each delivery is GitHub-shaped JSON (a `push`, a `create`, a merged `pull_request`, a `deployment_status`), signed with HMAC-SHA256 of the body in `X-CodeSplitters-Signature: sha256=…` using the hook's secret, shown once. Every delivery is logged with the answer it got; a failed one is tried again from the Cron Trigger after 1, 5, 30 and 120 minutes, and any can be sent again by hand. `GET|POST /api/repos/:o/:r/hooks`.
- **One command palette (⌘K), one API.** Every action in the UI is a single API call, and the palette shows it next to the command, so people and agents do the same things the same way.
- **The game.** Every repo is a level of a first-person game (`play.html`): you're in the backrooms of the codebase, folders are rooms, files' lines are pasted on the walls, and they tear off and come at you as paper birds and wacky waving tube men. A file's type guards (`isRecord(x): x is …` and friends) crawl off its wall as noodle monsters, knots of their own lines that follow you from room to room; each hit snaps off a strand. Swing the bat. Players in the same room can club each other. One `GameRoom` Durable Object per level or repo is the lobby on its page. Pick a mode in the lobby: **horde** (the above), **wreck it** (a panic room: everyone smashes the walls, lava lamps and furniture made of the code, against the clock; nothing in the real repo is touched), or **smash the removed** (from a file's History or one of its commits: every line the diff took out is a desk, chair, shelf or lamp clad in that text; the lines it put in stand in ink, untouchable). What's broken is kept by the room for the round, so everyone, late joiners too, sees the same wreckage. Each material has its own synth impact: thud, crash, shatter, splinter, then debris settling.
- **Your profile is your own HTML and CSS** (sandboxed, no scripts), plus **playlists**: line ranges from any file you can see, read live. A track holds its lines by id, so it follows them as the file changes around them.

**Accounts** are Better Auth on D1: GitHub, Google, or email and password, from a drawer on the right. They're on whenever `BETTER_AUTH_SECRET` is set; without it (the desktop, tests, demos) a name in a cookie is all it takes. After signing in, everyone picks a handle of six or more characters (`POST /api/handle {name}`, with `GET /api/handle?name=` checking it as you type), once and for good: it's shown as `@handle` everywhere. Short handles are an admin's to give out: `POST /api/admin/handles {handle, email}`, and whoever first signs in with that email, verified (GitHub or Google), gets it without picking. Aliases on the desktop can be any length. No person gets an `agent-` handle (signup, alias login or grant): those are the collaborators coding agents edit as.

**Rate limits** (`src/limits.ts`) cap what costs money or invites abuse: sign-ins and new accounts per IP, and per handle digs (Artifacts imports), GitHub lookups on the site's token, code search, new repos and files, live line edits, commits (Artifacts pushes), shares and collections, and hosted agent runs. Each counts in fixed windows in D1, and a request over its cap gets a 429 with `retry-after`. Line edits count the same whether they're POSTed or sent over the file's WebSocket: the Worker works out who a socket counts as when it opens, and the file's DO counts each edit, answering one over the cap with a `nack` that carries `retryAfter`. Only requests from the internet count (Cloudflare stamps them with `cf-connecting-ip`), so the desktop and the Worker's own calls never do, and admins are never limited. Admins tune each rule on the rate limits page (the gauge in the top bar, `#/admin/limits`; `GET|PUT /api/admin/limits`): its cap, its window, and what happens to a caller over it. **Reject** answers 429, **log** lets the request through and notes it, and **flag** lets it through and lists the caller at the top of the page. The page shows this window's hits and callers per rule, plus a week's log of each time a caller first went over in a window, each with a reset (`POST /api/admin/limits/reset {who, rule?}`) that clears their counts. The hourly cron clears windows that have ended, and log entries older than a week.

**Checked on Cloudflare** (2026-10-09, Workers, D1, Durable Objects, Artifacts): three agents edited one file at once, cataloguing pushed a commit to Artifacts that a stock `git clone` and `git pull` fetched, a second catalogue chained onto the first, private repos answered 404 to others, search found catalogued code, and an edit streamed live to an open page.

On the desktop, Artifacts is a Rusty Buns twin: bare repos in `~/.codesplitters/artifacts`, served by `git http-backend` behind each repo's tokens, so it needs `git` installed. On Cloudflare, Artifacts needs the Workers Paid plan (10k operations and 1 GB a month included).

### Deploying (Cloudflare)

`rustybuns deploy` owns the live site: Alchemy took over the wrangler-made Worker `codesplitters` and D1 `codesplitters-db` on 2026-10-09 (`targets.edge.adopt`), Durable Object storage intact. Its state is local (`.alchemy/`, gitignored); with an empty state the next deploy adopts them again rather than making new ones.

```sh
cd apps/codesplitters
export CLOUDFLARE_ACCOUNT_ID=<your account id>        # wrangler can see more than one account
export CLOUDFLARE_API_TOKEN=$(npx wrangler auth token | tail -1)   # reuse wrangler's login instead of Alchemy's OAuth link
bun ../../packages/cli/src/index.ts plan              # expect no changes, or only updates
bun ../../packages/cli/src/index.ts deploy --yes
```

### Turning on accounts (Cloudflare)

A deploy replaces the Worker's bindings with the config's, so secrets set with `wrangler secret put` are dropped by the next one. Export them in the deploying shell instead; the config only declares the ones that are set:

```sh
export BETTER_AUTH_SECRET=...     # any long random string: openssl rand -base64 32
export GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...   # optional
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...   # optional
bun ../../packages/cli/src/index.ts deploy --yes
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

To put a real coding agent (claude, codex, pi or opencode, installed and logged in) on a file: it edits a copy on disk, and its edit is diffed back into line ops under its own name. If someone changes a line it also changed, it re-runs on the new text (`--retries`, default 2). After the last run their version is kept and the conflicts are printed.

```sh
bun agent.ts --harness claude --url http://127.0.0.1:PORT --cookie 'rb_token_PORT=TOKEN' \
  --as agent-claude --repo owner/name --path src/app.ts --task "add a doc line to every function"
```

Each CLI brings its own login and model. `--model` is passed straight through.

| Harness | Install | Login / model |
|---|---|---|
| `claude` | `npm i -g @anthropic-ai/claude-code` | `claude` once to log in |
| `codex` | `npm i -g @openai/codex` | `codex login`, or a custom provider in `~/.codex/config.toml`. Runs in its workspace-write sandbox |
| `pi` | `npm i -g @earendil-works/pi-coding-agent` (1.x; the old `@mariozechner` package is too old for the flags used here) | Defaults to Google, so pass `--model provider/id` (e.g. `anthropic/claude-sonnet-4-5`) with that provider's key in the env, or log in with `/login`. opencode's free tier refuses pi |
| `opencode` | `npm i -g opencode-ai` | `opencode auth login` and a `--model provider/id` from that provider. The free `opencode/*` models refuse runs with codeSplitters' locked-down permissions (no shell), so they don't work here |

> **⚠️ Super experimental, run at your own risk.** Coding agents run real CLIs that can edit files and run shell commands, and hosted runs spend your API keys. They're off by default on Cloudflare: a deploy only includes them when you set `CODESPLITTERS_AGENTS=1` along with the keys.

On Cloudflare a Worker is a V8 isolate: it has `node:fs` now, but it can't start the agents' CLIs (claude, codex, pi and opencode are native programs that run shell commands). So when `AGENT_SANDBOX` is bound (deploy with `CODESPLITTERS_AGENTS=1`), the file page's Agent button (`POST /api/repos/:o/:r/agents`, or `bun agent.ts ... --hosted`) runs the agent in a container instead. Each run starts its own container (`sandbox/Dockerfile`: every CLI plus a small server), hands it the file, and stops it when the agent is done, so nothing bills while idle; `AGENT_SANDBOX` caps it at two at once on the `basic` size. The CLIs log in with whichever secrets are set: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), `OPENAI_API_KEY`, `CODEX_API_KEY`. Containers need the Workers Paid plan. A container can't reach the host, so it works with accounts on, and it needs them: hosted runs bill the site's keys, so only an owner listed in `ADMINS` can start one, and with aliases anyone could claim an admin's handle. Without `BETTER_AUTH_SECRET` the deploy refuses `CODESPLITTERS_AGENTS=1` and the route answers 501. Each run's container only gets its own CLI's keys.

## Layout

| File | What |
|---|---|
| `src/lines.ts` | the line model: ops, conflicts, replay. Pure functions |
| `src/file-do.ts` | the file Durable Object: ops, log, time travel, commits, a live socket |
| `src/worker.ts` | routes, visibility, profiles, playlists, search |
| `src/branches.ts` | branches: forking a file onto one, review, merge |
| `src/identity.ts` | accounts (Better Auth) or aliases, and handles |
| `src/levels.ts` | the levels: import, browse, fork |
| `src/github.ts` | GitHub: a token from wherever there is one, your repos, digging one up as a fork |
| `src/archive.ts` | Artifacts: trees (cached), files, first-open materializing, catalogue pushes |
| `src/noodles.ts` | the game's noodle monsters: finds a file's type guards and their line ranges |
| `src/git.ts` | a git push with no git library: objects, trees rebuilt only along changed paths, pack, receive-pack |
| `migrations/` | the D1 schema |
| `src/sync.ts` | an agent's text edit to line ops: a Myers diff that keeps line ids, and a rebase onto the file as it is now |
| `src/harness.ts` | the coding-agent CLIs and the prompt each one gets |
| `src/agent-run.ts` | runs an agent on a file: snapshot, edit in a sandbox, diff, post, re-run on conflicts |
| `src/sandbox.ts` | the container Durable Object hosted agents run in |
| `src/cuts.ts` | cuts: picking lines and following what they use across files, the cut's branch, running its tests, the share page |
| `src/card.ts`, `src/font.ts`, `src/font-geist.ts` | the cut's social card: a PNG drawn with a bitmap of DejaVu Sans Mono, or Geist Mono |
| `src/fit.ts` | the Rusty Buns fit check: how easily `rustybuns init` could box the repo |
| `sandbox/` | the container image: the CLIs, and the server that runs one on one file |
| `agents.ts` | the three-agent demo |
| `agent.ts` | one real coding agent on one file |
| `src/hooks.ts` | outgoing webhooks: the owner's hooks, signed deliveries, the log, retries |
| `src/agent-routes.ts` | the file page's Agent button: start a run, list runs |

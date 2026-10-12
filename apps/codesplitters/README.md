# codeSplitters

**A code host for the agentic era. Every line is its own record, every agent and person edits live, and git keeps going even when other gits don't.**

**Never let your git quit.** Run it as a desktop app and your git lives on your machine, syncing out to the cloud instead of the cloud syncing in to you. If a cloud dies, you and your agents keep going.

Git was built for one person at one keyboard sending a patch by email. Now a dozen coding agents work on one repo at once, around the clock, and humans review what they make. That's automated development, a software factory, and the floor it runs on should be built for it. codeSplitters takes git apart and puts it back together at the scale of a single line:

- **Lines, not files, are the unit.** Every line has a stable id, an author and a history. Three agents can edit one file at the same moment and never step on each other.
- **It's still real git.** A commit is a real `git push` to Cloudflare Artifacts. `git clone` works, `git pull` works, your tools work.
- **People and agents use the same API, in the same ways.** The ⌘K palette, a REST API with an OpenAPI spec, personal tokens, OAuth, WebMCP in the browser, and now an **MCP server**. If you can click it, your agent can call it.
- **Then why not just deploy your app as well?** The repo knows how to ship itself: preview deploys, real deploys, a log of every one. Only a person presses the button.

Live at **[codesplitter.notryanquinn.workers.dev](https://codesplitter.notryanquinn.workers.dev)**. It's a proof of concept, built for Cloudflare's Artifacts challenge, and it moves fast.

## What it does for you

The highest-value things, in order:

1. **Point your agents at one repo, all at once, safely.** Claude Code, Codex, pi and opencode edit line by line, live, blamed by name (`agent-claude`). Stale edits get a 409 and retry; nothing is silently overwritten. Agents work on branches, and a three-way merge **by line id** settles what git would call a conflict (a moved block that someone else edited, the same line added twice). What's left is a card each on the branch's merge page: keep main's, the branch's, both, or write it, with a suggestion when both sides added words at one spot and an Ask button for a coding agent's answer. Agents settle the same conflicts over MCP, the CLI or WebMCP.
2. **Your git keeps going when the other git doesn't.** Make a repo a mirror of GitHub, GitLab or any git URL. When upstream goes down, you keep editing, committing, branching and running agents. The Upstream panel says it's down and how many commits are waiting, and it catches up by itself once upstream answers. It never force-pushes.
3. **Make your code private one line at a time.** Select some lines in a public repo and make them private. Everyone else sees a blank line in the same place: on the page, in blame, in search, in git. Your crew gets a second git remote with the real text. Ship the open-source repo with the secret sauce still secret.
4. **Share some lines, not the repo.** A live link to just a range, which follows those lines by id as the file changes. It works from a private repo, too.
5. **Hook it to your AI in one command.**
   ```sh
   claude mcp add --transport http codesplitters https://codesplitter.notryanquinn.workers.dev/api/mcp
   ```
   It signs in with OAuth. Every tool is an operation in the OpenAPI spec, so the MCP server and the API never drift, and the ones that can't be undone (merge, delete, deploy) are marked so your client asks first.
   Or from your shell, no checkout needed (Bun or Node 18+):
   ```sh
   curl -fsSL https://codesplitter.notryanquinn.workers.dev/install.sh | sh
   codesplitters login     # paste a token from your profile page
   codesplitters tools     # every MCP tool, as a command
   codesplitters triage    # something broke? your coding agent asks what, digs in, drafts the issue
   ```
6. **Deploy it.** Every repo says how easily [Rusty Buns](../../README.md) could ship it, then ships it: to Cloudflare, to a Railway or Hetzner box, from your desktop or from the site with a write-only, sealed deploy key.

## Git here, git there, git everywhere

| Where | What holds the git | What you get |
|---|---|---|
| The live site | [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) | A repo per project, made by an API call, cloneable by anyone you hand a token |
| Your desktop | Bare repos in `~/.codesplitters`, served by `git http-backend` | Any size, private GitHub repos, your own machine's credentials |
| GitHub, GitLab, anywhere | A mirror, both ways | Two-way sync through outages, branches pushed upstream and pulled back |
| Your agent's context | MCP, OpenAPI, WebMCP | The repo as tools: `read_file`, `edit_lines`, `start_branch`, `merge_branch`, `deploy` |
| A phone | `#/m/owner/repo` | Start an agent, watch its run, review and merge its branch from the couch |

## Why Artifacts is rad

Running git at scale used to mean running a git server: disks, backups, auth, garbage collection, a fleet. Artifacts makes a git repo a Cloudflare primitive, like a KV namespace or a D1 database. You make one from a Worker with an API call, hand out a token scoped to that one repo, and anyone's stock `git clone` just works.

That changes what a repo is for. When repos are that cheap, you make one per project, per fork, per experiment or per agent. You let a visitor dig up any GitHub repo into a fork they own for a day, then throw it away. That's what a software factory needs: lots of small, disposable, real git repos, and no server to babysit.

The catch is that Artifacts only takes writes as a `git push`. So codeSplitters builds git's objects and pack itself, in the Worker, with Web Crypto and `CompressionStream` and no git library, and speaks git's smart HTTP protocol. Each commit pushes only what changed on top of the parent tree, so editing one line of a big repo costs one blob, a few trees and a commit. Repos too big even for Artifacts (Bun, Alchemy) are kept in R2, packed into chunks and dug in parallel off a queue.

## The free desktop app: own your git, put it wherever you want

You want to git commit, but is your git committed to you?

Most code hosts keep the real repo in their cloud and sync it down to you. When the host is down, so are your pushes, your checks, your merges and every agent waiting on them. The desktop app turns that around. Your git lives on your machine, in bare repos under `~/.codesplitters`, and syncs **out**: mirrored both ways to GitHub, GitLab or any git remote you can reach. When one of them goes down, you keep editing, committing, branching, running checks and merging, and your agents keep working. It catches up by itself once upstream answers, and it never force-pushes.

You say where git truth lives, on your profile: codeSplitters, the artifact (this copy's git) or GitHub, or ask each time. We don't mind which. Mirrors sync both ways whatever you pick, and the setting only says whose side wins when both changed the same lines or upstream rewrote its history. **Your git history never goes extinct**: whatever one side drops stays in its own git (this copy keeps it under `refs/kept/`), and every line here keeps its history, for the present and the future.

Don't let your git quit on you or your agents.

What if git was your deploy, your build, your friends, your history, yours, only yours? As public as you want it to be, private as you want it to be: here, there, everywhere. A line by line privacy model, making it easier to share more with human and agent alike. Git in control of your git. Git over your old relationship with git. Git in charge of your history.

codeSplitters is one codebase that runs as a Cloudflare Worker and as a desktop app on your machine. [Rusty Buns](../../README.md) gives every Cloudflare binding a local twin: sqlite for D1 and for each file's Durable Object, local bare repos for Artifacts, in-process queues, the Worker's cron as a minute timer. Same code, nothing forked.

On the desktop you get the things a Worker can't do: coding agents run on your machine with your own logins, private GitHub repos clone with your `gh` token, any repo size, and mirrors that keep your git going through someone else's outage. It's free and it's yours: your data lives in `~/.codesplitters`.

```sh
cd apps/codesplitters
bun install
bun run desktop        # the app in a window
bun run desktop:watch  # the same, rebuilt and restarted on every save
```

There's no downloadable build yet; that's one command from source.

## Everything else it does

- **Blame and time travel for free.** The op log replays any file at any rev, so every line knows who wrote it and when.
- **Live sync.** Edits go over each file's WebSocket. Every open page patches itself in place, and presence shows who else is there, people and agents apart. An agent holds the lines it was given while it works, you can hold lines of your own, and you can lift any claim.
- **Agents have faces, lines take stamps.** An agent's profile (`#/u/agent-claude`) says who runs it, on which harness, the repos it works in, its runs and a 30-day pulse of its line edits. Stamp a line, not a pull request: a reaction that stays on the line by id through edits, shows on its blame and on both people's profiles, whoever wrote it, person or agent.
- **A code city, not a contributions chart.** Every person's profile has a city: a district per public repo, a building per file, tall where it's long and lit orange where lines landed lately, white stone where people wrote it and black glass where agents did. Whoever has one of its files open right now walks its streets, and you can walk them too, with its owner and their other followers (`/play.html#c/<handle>`). It has a postcard to share, private repos are never in it, and its owner can switch it off.
- **Dig it up = fork it.** Any level, or any public GitHub repo, becomes a git repo you own. Paste a URL, a remote or a `gh repo clone` line.
- **Levels.** Loved open-source repos to browse and fork: mitt, Hono, Preact, Cloudflare's own (Agents, workerd, PartyKit, Sandbox SDK and more), and the stack this is built on (RedwoodSDK, Effect, React, Alchemy, Bun).
- **Cut some lines out.** Select lines, and the cut follows what they use across files. Run its tests alone, share a card of it on X, and merge it back line by line.
- **The dependency doctor.** It proposes updates on a branch on your schedule, skips releases too new to trust, tests them in a throwaway clone, and can hand a breaking one to a coding agent to fix. It also checks each dependency against [OSV](https://osv.dev) for known vulnerabilities: a vulnerable one moves to its first fixed release right away (past the level and the minimum age), and one with no fix yet is flagged as exposed.
- **The supply-chain watch.** Every hour it reads the status pages of the platforms agents lean on (Anthropic, OpenAI, GitHub, npm, Cloudflare) and OSV's new malicious-package advisories (`MAL-…`), and checks every repo's dependencies against them, doctor on or off. A range that could install a poisoned version shows up in the repo's Dependencies section. Optionally, once a day, Claude searches the news for compromised packages too, shown beside them as unverified.
- **Webhooks for CI/CD.** GitHub-shaped, HMAC-signed, retried on a queue.
- **Checks, ours and GitHub's, in one panel.** A commit to main or a branch pushed upstream starts check runs here, on GitHub Actions, or both. A mirror pulls the Actions jobs for each sha it sent up back in, beside codeSplitters' own, and can post its own results to GitHub as `codesplitters/<name>` statuses. The desktop runs its own queue, so checks just run there. Bring your own runners too: they pull work (`POST …/checks/claim`), so one behind a firewall or on a laptop works, and `scripts/runner.ts` is the whole loop to wrap around any build. On Cloudflare they can run in a container per run, off unless you turn it on (it bills container time). A monorepo checks each workspace a change touches, and the ones that depend on it, rather than everything. Checks planned from package.json install first (`bun install`, frozen when there's a `bun.lock`), since a runner's fresh clone has no node_modules. Required checks gate Merge, scoped by path when you like (a change in `apps/a` doesn't wait on `b-tests`), and agents watch them with the `checks` MCP tool the way they'd run `gh pr checks`. GitHub is the backup, not a dependency: running checks here is always on offer, and while GitHub is down the desktop checks here in its place, merges on its own checks passing, and lets GitHub's verdict catch up on main once the mirror syncs.
- **Build changes are flagged.** A branch that touches `package.json`, a lockfile, a Dockerfile, CI or the deploy config shows every changed line, and its merge waits for a person to say they've read them. Agents can be prompt-injected; this is where it gets caught.
- **Accounts and limits.** GitHub, Google or email sign-in. Rate limits on everything that costs money, which an admin can set to reject, log, flag or queue.
- **The game.** Every repo is a level: the backrooms of the codebase, where the lines tear off the walls as paper birds and you swat them with the rolled-up README. Bop your friends in the lobby.

### Point your CI here

Make a CI token for the repo (`POST /api/repos/:owner/:repo/checks/tokens`), then set your CI's GitHub API base URL (the GitHub Enterprise option) to `https://<this site>/api/gh/v3` and use that token as its GitHub token.
Its commit statuses and check runs show up in the repo's checks as `external` runs, and required ones gate Merge.

## Hard to copy

What would take someone else the longest to build:

- **A merge by line identity, not by text.** Lines keep their ids through edits, moves and branches, so a merge knows a moved block is the same block. Git guesses that from text.
- **A git push in a Worker with no git library.** Objects, trees rebuilt only along changed paths, the pack and receive-pack, plus a fresh start that moves a full repo to a new Artifact with the very same tree.
- **One codebase on the edge and the desktop.** Durable Objects, D1, Artifacts, Queues and Cron all have local twins, so the desktop isn't a port. It's the same app.
- **Private lines in a public repo**, kept blank in git, in search and on the live socket, with a second remote for the crew.
- **Git that survives an outage**: a two-way mirror that merges without a checkout, stops at a clash or a force-push, and never loses a commit.
- **A safety model for agents that ship.** Agents get branches, containers and their own keys, never deploy keys. Deploy keys are write-only and sealed; only a person deploys. Hosted agents run in throwaway containers that bill nothing while idle.
- **One API, every surface.** The palette, REST, OpenAPI, tokens, OAuth, WebMCP and MCP all come from one list, and a test fails if they drift.

> **⚠️ Super experimental.** Coding agents run real CLIs that can edit files and run shell commands, and hosted runs spend real API keys. They're off by default on Cloudflare. Run it on a machine you trust and read the code before you point it at anything that matters.

## Read more

- [REFERENCE.md](REFERENCE.md): every feature in detail, every route, deploying the site, accounts, hosted agents and deploys, and where the code lives
- [Rusty Buns](../../README.md): what lets the same app run on the edge and on your desktop

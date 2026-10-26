# Security audit, October 2026 (round 3 at the end: agentic attack)

How we keep a malicious or prompt-injected agent from hurting the code, the secrets or the people using what we host. It covers every surface, from the API to the desktop: what's done, what isn't, and what free Cloudflare features can add. Every open item is an issue labelled `security`; the ones only you can do are also `manual run`.

## The threat in one paragraph

Agents write most of this repo, and codeSplitter lets other people's agents into theirs. So we assume any one agent can be turned against us: a poisoned README, a dependency, or another agent's message can prompt-inject it. It then has whatever its process has: files, env, the `gh` login, the tokens it was given. The goal is that one bad agent can't leak a production secret, rewrite history on `main`, or act as someone else. Today that holds better on the hosted site than on this laptop.

## Secrets: varlock, and who holds the keys

**Done.** Agents never handle secret values:

- `apps/codesplitter/.env.schema` is committed with names and `op://codesplitter/…` references only, never values. An agent can read it to learn what the app needs.
- `experimental.wheel: "human"` means varlock resolves those references at `plan`/`deploy` through the 1Password app behind Touch ID. Any `OP_TOKEN` is ignored. The values go straight into Cloudflare's secret store and the running Worker reads them from there, so nothing is written to disk.
- No secret has ever been committed: a scan of every ref in history for key and token patterns found none. GitHub secret scanning and push protection are on.
- `.env*` and `.dev.vars` are gitignored. This PR adds `.dev.vars.*`, `*.pem`, `*.key`, `*.p12` and `.npmrc`.
- `rustybuns triage` tells its agent never to read `.dev.vars`, `.env*` or `op` values.

**The weak spot is the laptop, not varlock.** Runtime injection only protects a secret that isn't already sitting somewhere else:

- Agent Office passed its whole environment to every worker (#643). Secret-shaped names are now dropped (`apps/agent-office/live/env.ts`), but a secret under an innocent name still reaches them. The guard refuses `ps e` / `ps -E` (#642), but since an agent runs as you, a script can still read the office process's own environment; the fix is workers as their own user (#667).
- Every agent runs as you. `gh auth token`, `~/.config`, Alchemy's plaintext state (`.alchemy/state`) and the office's session secret and pty token are all readable (#667).
- Nothing stops an agent from running `op` while you're at the keyboard and approving Touch ID out of habit. The deny-list in #649 makes that a visible prompt instead of a habit.

The REFERENCE notes that the 1Password path "has not been run against a real vault yet". The codeSplitter deploys now run through it, so that line is stale and can go once you confirm.

## Per surface

### GitHub: CI and `main`

| Done | Not done |
| --- | --- |
| Workflows use `pull_request`, never `pull_request_target`, so fork PRs get no secrets | **`main` has no protection or ruleset.** Any agent with your `gh` login can push, force-push or delete it (#652) |
| Default token is read-only at the repo level; **this PR** also says `permissions: contents: read` in each workflow | `*-v*` tag pushes do a real drop and a public release; tags aren't restricted (#652) |
| `--frozen-lockfile` everywhere, Bun pinned, no install scripts or `trustedDependencies` | ~~Actions pinned by tag, `rust-toolchain@stable` is a moving branch~~ Fixed in #650: pinned by SHA, Dependabot keeps them current; installs skip releases under 3 days old |
| **Fixed in this PR:** a branch PR that edited `scripts/drop.ts` ran it with the R2 token and `DROP_SECRET` in env, since `--dry` was only a flag the script could ignore. PR runs now get no secrets, and the plan's JSON reaches the shell through `env:` instead of being pasted into it | ~~No CODEOWNERS, no Dependabot for actions, npm publishes from a laptop without provenance~~ Fixed in #650: CODEOWNERS (bites once the ruleset requires owner review), `npm-publish.yml` with trusted publishing and `--provenance` |

### Agent Office (local desktop app)

| Done | Not done |
| --- | --- |
| Binds `127.0.0.1`, with a password and an HttpOnly signed cookie; WebSocket and uploads check Origin | **Any agent can read the pty-host token and the office session secret and password**. It can then type into any terminal, or sign in to the office. The guard hook refuses the reads, but a script still can; the fix is workers as their own user (#667) |
| `workers.json` keeps hashes of the hook tokens, not the tokens, and the guard refuses `ps e` / `ps -E`, so a worker can't take another's token to act as it (#642) | |
| The hook port needs each worker's own bearer token; agents can't send themselves home or message shells | Workers inherit the office's env less secret-shaped names; a secret under an innocent name still gets through (#643) |
| No `--dangerously-skip-permissions`; hire/home/tell go through Claude Code's permission prompt | `send_home` with forced cleanup deletes another agent's uncommitted work. `tell_worker` passes prompts between agents unchecked. The `office-workers` CLI skips the MCP prompt (#644) |
| Default `send_home` keeps a branch with unpushed commits. The Host header is allowlisted (DNS rebinding) and the unpacked client is checked against the binary's hash every start (#651) | Agents aren't confined to their worktree |

### RustyBuns hosts (`packages/shell-bun`, `packages/cli`)

| Done | Not done |
| --- | --- |
| Desktop: `127.0.0.1`, per-launch token, SameSite=Strict cookie, Origin must match Host, timing-safe compares; the browser gets a one-time launch code, not the token. A cached native dylib is checked byte for byte against the embedded one before every dlopen (#651) | Dev runs still load `native/dist` under the current folder (compiled binaries don't) |
| `/__rb/host` and `/__rb/action` are host-only (guests 403, box 404), with bodies checked field by field and `Object.hasOwn` lookups. Off loopback `/__rb/host` needs a passphrase of 12+ characters, or makes one up (#651) | A passphrase given at launch (`--join`, `RB_JOIN`) isn't held to that length |
| Box: `/__rb/prof` doesn't exist without a ≥16-character secret; `boxOnly` keeps secrets off the edge Worker | Box `/health` and `/__rb/mem` are public (small info leak, by design for now). A Hetzner box is plain HTTP |

### codeSplitter web app and API

| Done | Not done |
| --- | --- |
| Better Auth: email/password, GitHub, Google. OAuth tokens are encrypted at rest; a password reset signs out other sessions | **No CSP, HSTS, nosniff or frame-ancestors** except on the OAuth consent page (#647) |
| `cst_` tokens are SHA-256 hashed, always expire, read or write scope, never admin, kept out of cookie-only routes | No Origin check on cookie POSTs, so CSRF protection is SameSite=Lax alone (#647) |
| Private repos return 404 to non-readers; search and shares filter by access | No Turnstile; rate limits are D1 counters (#647, #623) |
| `theme_html` renders in a scriptless sandboxed iframe; the client escapes everything | Alias login (no password) is the fallback when `BETTER_AUTH_SECRET` is missing. varlock makes it required, but the code should still fail closed on the edge (#647) |
| Workers Logs redact query strings | No audit log for tokens, collaborators, visibility or deletes (#648). CI tokens expire (90 days by default) and invites are stored hashed since round 3 |

### codeSplitter MCP, CLI and invited agents

| Done | Not done |
| --- | --- |
| MCP uses the same `cst_` bearer and the same route checks as the API. OAuth 2.1 uses PKCE S256, rotating refresh tokens and a loopback-only redirect for unregistered clients | **An invited agent can un-hide private lines, record a passing check under any name, and commit straight to `main`.** Its token works on every repo and survives removal (#645) |
| Agents can't deploy (`agent-` handles are refused) and can't touch visibility, collaborators, hooks or tokens on someone else's repo | `destructiveHint` covers only 4 tools and is advisory (#648) |
| Commit authors are set by the server, so authorship can't be forged. Users only get **read** Artifacts tokens; write tokens are internal with a 5-minute TTL. There's no force-push API; a fresh start is owner-only | A check command gets the runner's own write token (#618) |

### codeSplitter sandboxes and deploys (Containers)

| Done | Not done |
| --- | --- |
| A fresh container per agent run, with only that harness's LLM key; the agent CLI and the repo's own code run as two separate non-root users | ~~**DeployRunner runs collaborator-merged code with the owner's unsealed deploy key**, and the output masking only catches the exact string~~ Fixed for #646: a hosted deploy runs only the owner's own commits, or a tip they approved after reading the diff, and the clone must be the commit checked. Desktop deploys are held the same way (#682) |
| Deploy keys are sealed with AES-GCM under `DEPLOY_SECRETS_KEY`, with a rotation slot | ~~The dependency doctor's `install` runs lifecycle scripts next to the LLM keys~~ Fixed for #646: install and tests run as a user that can't read the agent's environment or home, and the server takes one request. Containers still have open egress (#681) |
| Hosted agents, cuts and the dependency doctor are admin-only while `ADMINS` is set | |

## Free Cloudflare features we're not using yet

All of these are free on the plan we're on:

- **WAF managed ruleset, Bot Fight Mode, one rate-limiting rule** on `/api/auth/*`: dashboard switches (#653).
- **Cloudflare Access** (free up to 50 users) on the admin paths, so a stolen admin cookie still needs your login (#653).
- **Turnstile** on sign-up, password reset and invite claim (key: #653, code: #647).
- **The Workers rate-limit binding** in front of the auth routes, so a burst never reaches D1 (#647).
- **Security headers** set in the Worker itself (#647).
- **Security event and usage notifications**, plus an API-token audit (#653).

## What you need to wire up

Only you can do these. Each is a `MANUAL RUN` issue with the clicks and a check:

1. **#652, GitHub:** a ruleset on `main` (no force-push or delete, require a PR and checks), a tag rule for `*-v*`, Dependabot alerts, and a `drops` environment that holds the R2 secrets.
2. **#653, Cloudflare dashboard:** WAF, bots, an auth rate-limit rule, Access on admin, a Turnstile widget with its secret in 1Password, and notifications.
3. **#654, this machine:** rotate the office password and secret, remove secret exports from the shell that starts the office, and trim the `gh` token's scopes.

#652 is the most important: one ruleset turns "an agent could rewrite `main`" into "an agent can open a PR".

## Order to fix the rest

1. #667: agents can read the office's session secret and pty token, and secrets under innocent names in the shell's environment (#643 drops the secret-shaped ones).
2. #645 and #646: collaborator agents on codeSplitter reach private lines, checks and the owner's deploy key.
3. #649: a committed deny-list and hook. It's a speed bump, not a sandbox, but it stops the casual leak.
4. #647: headers, Origin checks, Turnstile and failing closed.
5. #644, #648, #650, #651, #618: everything else.

## Round 3, October 14: agentic attack

The first two rounds were about what an agent *holds* (secrets, the `gh` login, `main`). This one is about what an agent *reads*: a prompt-injected agent is one that was handed text by a stranger and took it as orders. We went surface by surface asking three questions. Where does untrusted text (an issue, a PR, a file, a log, another agent's message) reach an agent's prompt, and is it marked as data? What can an agent do with a token or a hook that a person wouldn't? And what does the guard on this laptop miss?

### Fixed in this round

**The guard hook (`.claude/hooks/guard.ts`)**, probed with the bypasses an agent would try. All of these passed before and are blocked now, each with a test:

- `/usr/bin/env`, `set`, `declare -x`, `typeset -p`, and interpreter one-liners that dump `process.env` or `os.environ` (grepping the source for the string is still fine).
- `c''at .env`, `\cat .env`, `cat .env*`, `cat .en[v]`, `ln -s .env x`, `mv`, `tar`, `curl -d @.env`, and a script given a secret file as an argument.
- The credential files every agent, running as you, could read: `~/.config/gh/hosts.yml`, `~/.npmrc`, wrangler's config, the agent CLIs' own logins, `~/.ssh/id_*`, `~/.aws/credentials`, `~/.netrc`, `*.pem`.
- The other roads to the GitHub token: `gh auth status -t`, `git credential fill`, `security find-generic-password`.
- `gh api` writes that move `main`, make a tag, commit through `contents`, `merges` or `releases`, dispatch a release workflow, or run a GraphQL mutation.
- `git config` keys that run a command in every worktree of the shared `.git`: `core.fsmonitor`, `core.sshCommand`, `core.pager`, `diff.external`, `filter.*`, `credential.helper`, `include*`, `alias.*`.
- The office's whole data tree (`.agent-office/` less `worktrees/`): people's sign-ins under `homes/`, every terminal's scrollback, `chat.jsonl`, and writes into `prompts.json`, `queue.json`, `workers.json` or the hook scripts other workers run. Grep's `glob` is checked too. `.claude/settings.json` carries the same names as a second layer.

**Agent Office (`apps/agent-office/live`)**:

- A prompt from one agent to another loses its control characters. The office types prompts into terminals as a bracketed paste, so an `ESC [201~` inside one ended the paste and typed what followed as keystrokes: an Esc to clear the "from another agent" header, then a `!` command Claude Code runs without asking.
- The "from another agent" mark now fences the body between two lines carrying a random tag, so the body can't end the message itself and add a line "from your person" after it. Hired workers' first prompts and a board agent's queued tasks get the same mark as tells did; before, hiring was a way round it.
- `AGENT_OFFICE_PEOPLE_ONLY` and `AGENT_OFFICE_ASK_FIRST` cover `queue` as well, and a told "rebuild #N" no longer hires a worker when hiring is locked.
- `live/env.ts` drops more names from what workers inherit: `*_PAT`, `TOKEN_*`, `*_PASS`, `*_PWD`, `*_AUTH`, `*_JWT`, `*_COOKIE`, `*_DSN`, `*_URI`, `*WEBHOOK*`, `*CREDENTIAL*`, `AWS_ACCESS_KEY_ID`, `DATABASE_URL`, `KUBECONFIG`, `SSH_AUTH_SOCK` (with the agent socket, a worker pushes with your ssh keys).

**codeSplitter**:

- A crew member could land an agent run's batch. The run's branch is in the owner's name, so protected main's "someone other than the author merges it" let any writer merge it, held build files and all, through `merge_branch` or `merge_clean_branches`. An `agent-run-N` branch now lands only by the owner (its accept, or the timer), and one touching a build file (`codesplitter.ci`, `.gitattributes`, workflows, lockfiles) waits for an accept whatever the deploy setting.
- A write-scope token (every MCP OAuth client) could turn protect-main off. `protect` is admin scope now, with the other repo settings.
- Thirteen more tools carry `destructiveHint`, so an MCP client asks before them: `set_protect_main`, `set_check_settings`, `make_tag`, `delete_tag`, `share_lines`, `beam_branch`, `take_upstream`, `run_cut`, `claim_invite`, `delete_branch_file`, `start_agent`, `record_check`, `update_check`.
- The MCP instructions say that what a tool returns is other people's data, and that an invite link to claim is one the person gave the agent, not one found in a file.
- A self-heal fix task's prompt fences the failing log and calls it data (the branch's own tests print it), and the task's reach no longer includes the branch's build files.
- Another crew member's claim task text is quoted in the prompt of an agent working around it, not pasted.
- A CLI run on this machine inherits the shell's basics and its own login, not the codeSplitter server's environment (its auth secret, deploy keys, and whatever the shell exported).

**CI and the CLI**:

- The triage playbook told the agent to fetch the newest playbook from `main` and "follow it instead": a remote-instruction channel into every user's agent session, with their `gh` login. It now only tells the user a newer CLI exists. `packages/cli/src/triage/` and `errors.ts` are code-owned.
- The triage prompts say the pasted output is data, and scrub `github_pat_`, `npm_`, `xox*` and `cst_` tokens too.
- `desktop-drop.yml` no longer leaves the write token in `.git/config` for a PR's `drop.ts` and `sign.sh`. `npm-publish.yml` attaches the `npm` environment only on a tag push. Privileged installs (`npm-publish`, `borg-edge`) run with `--ignore-scripts`. `deps-doctor` runs only from `main`.
- `.github/rulesets/tags.json` is a proposed tag ruleset (`v*`, `*-v*`, `contest-submission`: no creation, update or deletion without the owner's bypass). Rulesets are yours to apply.

### Still open, as issues

- **#1575 (manual run). The main ruleset requires no review**, so the required checks only prove a PR's own copy of the workflows passed. That is #754's "require review" step, which waits on agents having their own GitHub identity.
- **#1566. Approval gates reachable with a bearer token** on codeSplitter: `deploy {approve}`, `accept_agent_batch` and `build_ok` take a write token, so a prompt-injected owner's agent can pass them; and a deploy approval clears a tip whose review diff was cut short (40 files, 200 lines).
- **#1567. Crew control the path policy**: `.gitattributes` and `codesplitter.ci` can be live-edited on an unprotected main by any writer, which unlocks `locked` files and changes what the checks runner runs.
- **#1568 and #1569. Self-heal opens fix tasks from crew-reported runs**, the dependency doctor's fixer runs with the full environment and previews deploy its edits unreviewed, a rebuild task pushes agent output (workflows included) to GitHub, and the owner's own agent sees private lines it could copy into public ones.
- **#1570. Desktop leftovers**: cut runs with the full environment and output readable by id, `get_repo` handing a push token to a write bearer, a `GET` that lands a batch.
- **#1571. WebMCP** derives its risk hints from a regex that misses invites, un-hiding private lines, shares and agent starts; handoff notes and the feed digest aren't framed as data; webhook SSRF misses three IPv6 ranges and gh-compat events fire for crew branches.
- **#1572. Agent Office upstream**: issue and PR titles land in worker prompts unquoted, PR branch names are handed to the agent inside a shell command, the office's session secret and people's sign-ins sit on disk readable by every worker (#667), heap snapshots hold every token, and the office rebuilds its guards from the main checkout. These need the office's author.
- **#1573. Agent Office defaults**: `ASK_FIRST` is off out of the box, and the Allow/Deny card shows 400 characters of a 20,000-character prompt.
- **#1574. CI**: the drop job's GitHub Release wants its own job with `contents: write`, `borg-edge` holds the Cloudflare token at job level across `bun install`, and a `dry` dispatch of `desktop-drop` still attaches the `drops` environment.

## Round 4, October 14: code quality and the data boundaries

A sweep of `apps/codesplitter/src` for where a type was claimed rather than checked: request bodies, stored JSON, third-party answers and D1 rows. No high findings. SQL interpolations (about 40) are all constants or placeholders; every write route checks access; tokens are hashed, expire and are compared by hash; redirects go to validated URIs only; no secret reaches a response or a log.

### Fixed in this round

- **The file Durable Object checked nothing it was sent.** The Worker forwards a client's body to it raw, and it cast `ops`, `claims`, `private`, `release` and `commit` straight to their types. Now `parseOps` (lines.ts) checks every op over HTTP and the socket alike: the three kinds and their fields, one line per text (up to 10,000 characters), at most 5,000 ops a batch, and an unknown kind is refused instead of being taken for a delete. Claims and private lines check their ids, task text and times; a commit message is text, cut at 1,000 characters.
- **`Env.DB` was `any`**, so every query result was untyped and the `as` casts on rows were the only typing. It is now a structural D1 type; the 44 sites that read rows as `any` name their columns with `first<Row>()` / `all<Row>()`.
- **`readBody`** returned whatever JSON the client sent under an object type; a string or array now reads as an empty body.
- **Stored JSON** (`agent_runs.result`, beams' files and stacks, cuts' paths, feed ids, OAuth redirect URIs, waits_on, profile top8 and hidden, board rows) is parsed with `parseJson(s, fallback)`: one bad row spoils one entry, not the whole listing with a 500.
- **Check-run URLs** from CI tokens and from GitHub (`target_url`, `details_url`, `html_url`) keep only http(s) up to 2 KB (`httpUrl`); a `javascript:` or `data:` link was stored and rendered before (the CSP blocked it from running).
- **Board `hits`** over 4,000 characters were cut into invalid JSON, breaking every later board read; they are now a 400.
- **Profile `bio` and `theme_html`** have a size (1,000 characters and 64 KiB).
- **A user name from the URL** reached the "hasn't made a page yet" note unescaped (page.ts); the file DO's `rev`/`since` query is built with `URLSearchParams` rather than pasted; a worktree's `from` can't start with `-`; GitHub's tree, OSV's results and `/user` are shaped before they're walked.

### Still open, as issues

- **#1818.** A repo's `.npmrc` can point the owner's home npm token at plain http or a private host (desktop).
- **#1819.** A removed crew member's `/share` read token lives up to 7 days.
- **#1820.** A token held to one repo reads other repos through search, game walls and playlists.
- **#1821.** Fixed: page assets are capped at 50 files per account, a page file's text at 1 MB, an oversize body is refused on `content-length` before it is read, and `PUT /api/me/page*` counts under a new `page` rule (60 an hour).
- **#1822.** Anonymous `gitpath` requests fan out to GitHub (about 41 calls) with no rate rule.

Smaller caps not taken this round, each a line or two when wanted: board rows (8 KB each, 50 clashes), agent log lines (2,000 characters), `junit` and `external_id` on checks, a hex check on the `sha` in gh-compat paths, and `esc()` on the tier and state fields in mervin-watch.html (local feed data).

### What the guard still can't do

It runs from the worktree, so an agent that edits `.claude/hooks/guard.ts` or writes `~/.claude/settings.json` turns it off for its own session; CODEOWNERS makes the merge of such a change yours. It matches `Bash|Read|Grep|Write|Edit`, not Glob or WebFetch. It checks names, not symlink targets. It can't follow `push.default` tricks to `main`; the ruleset can. It is a speed bump, as its header says, and #667 (workers as their own user) is still the fix.

## Round 5, October 23: the security-audit skill, run on codeSplitter

The first run of the vendored Cloudflare security-audit skill (`.claude/skills/security-audit`, added in #2160). Profile `quick`, scoped to `apps/codesplitter`, source only (no OS-enforced sandbox on the host, so no target code ran), commit 26e223b9. Nine hunters over nine units, one coverage critic, then a fresh verifier per candidate: 15 candidates, 8 confirmed, 2 need validation, 5 rejected. 29 of a 30-agent budget. This is partial coverage: the critic named ten more units that were not reviewed (listed below). The run's report, findings and coverage ledger are outside the repo, in the owner's `~/security-audit-skill/RustyBuns/run-1/`.

### Fixed in this round

Each with a test that fails without the fix (the web client and socket changes are covered by typecheck only):

- **A write token cleared a deploy** (medium). The commit route marked a commit made through an API, OAuth or MCP token as the owner's own, which clears it for a hosted deploy; `POST /deploy` without `approve` then ran the repo's install and config code with the provider keys in its environment. #1566 had closed `approve`, accept and `build_ok` but not this door. A token's commit no longer clears a deploy (`deploy-hosted-review.test.ts`).
- **Crew could land `.gitattributes` and `codesplitter.ci` through a merge** (low). #1567's owner-only rule covered live edits; a branch merge, or a revert or pick onto main, went round it. Both now refuse a non-owner (`journey.test.ts`).
- **A health-page link could inject markup** (high, with the item under Still open). `#/health/<owner>/<repo>` put the two segments into an `href` unescaped. They are escaped now. That alone ends the injection; the page-script half below is defence in depth.
- **A protected main still took live edits over the file socket** (low). The WebSocket upgrade skipped the protect-main check the HTTP routes make, so a crew member's socket could edit main's live document. On a protected main a non-owner's socket now reads only.

### Confirmed, still open

- **User page scripts run on the app origin** (fixed). The page route now answers 403 to a script, worker or worklet load whose `Sec-Fetch-Site` is `same-origin`; the sandboxed page frame is cross-site to its own files, so it still runs. A separate origin would be stronger, and is still the long-term fix (#2292). Images and media now load from the page's own files, uploads and data URLs only; a page that wants outside `https:` images adds `<meta name="codesplitter-outside-media" content="allow">` to its index.html, and visitors then see a notice (#2291).
- **An agent batch's accept isn't bound to what was reviewed** (medium, fixed). Only the run's agent and the owner can write `agent-run-*` (ops, sockets, file delete, and now `hunks/reject`, which skipped the lock). When the batch finishes, the run keeps a hash of its whole branch (`pending.hash`, `branchHash` in `branches.ts`); Accept sends the hash of the batch it showed, and it lands only when the branch still matches both. A branch that changed since (the agent wrote it again, or the owner edited it by hand) waits, held, with a fresh hash, to be read again; the timer won't land it either. The owner leaving a stretch out takes the new hash, as they read it. Still open: Accept on a file page shows that file's hunks, not the whole branch (#2296).
- **Marking a line private doesn't scrub committed text from search and public HEAD** (search fixed, git left). Marking now re-indexes the file with the line blank. Public git HEAD keeps the text until the file's next commit (#2293), and history keeps older text regardless.
- **A check run follows symlinks as the owner** (fixed). `localMachine` read and write refuse a path whose folder resolves outside the clone or whose file is a symlink.
- **The dependency doctor's merge tests run unscrubbed** (fixed). `inClone` uses `checkEnv` (an empty HOME and TMPDIR) for installs, tests and the fixer. Overlaps #1568 and #1570.

### Needs validation

- **Open file sockets outlive revocation** (partly fixed). Access is checked once at the upgrade. Removing a collaborator, or flipping a repo to private, now has every file's Durable Object close that person's sockets (`revokeSockets`, `revoke-sockets.test.ts`). Turning protect-main on closes everyone else's sockets on main's files, so they reconnect read-only. Still open: the deployed behaviour of a hibernated socket's close is unchecked (MANUAL RUN #2290). Local and deployed plans are in the run's `NEEDS-VALIDATION.md`.
- **Account linking may adopt an unverified password account.** Email sign-up needs no verification and account linking is on. If Better Auth links a provider-verified sign-in onto it and keeps the password, the attacker keeps a working login on an account that earns handles, the admin handle included. Needs the library installed to read (#2297).

### Rejected after verification

Conflict-agent runs gated on the repo owner (the owner's own policy, capped at 30 hosted runs a day); share links outliving a privacy flip (the documented capability link; the crew-removal half is #1819); the doctor's `.npmrc` registry fetch (needs an owner action, blind GET; overlaps #1818); the identity cache key (needs a planted cookie on the deployed host); root symlink following in the doctor container (no secret reachable on that path; use `readInside` anyway).

### Not reviewed (the critic's list)

Check claim and pass integrity (`checks.ts`: can a crew member claim an auto-queued required check and pass it unrun?); every other path into main (cuts, beams, mirror landing); beam links (`GET /api/beams/:id`, 48-bit id, no repo access check); the `via 'job'` re-dispatch against the human-only gates; GitHub token scope; the other ~250 `innerHTML` sinks in `client.html`; game-room sockets; repo `.npmrc` hosts feeding the container egress allowlist; the route families nobody listed. The next run starts from this list (#2295), and saved programs (#2195), which shipped after the run, get their own review (#2294).

## Round 6, October 25: the units round 5's critic didn't review (#2295)

A hand review of the first units on round 5's list, source only, no target code run. Not the full skill run with a coverage ledger; the rest of the list is still unreviewed and stays below.

### Fixed in this round

- **A repo's `.npmrc` could open the doctor container to any host** (low). `npmrcHosts` fed every registry host a repo named into the egress allowlist, including plain http, localhost and the metadata address. Only https hosts that aren't private are allowed now (`deps.test.ts`). A public host a repo names is still reachable; that is what a private registry needs.
- **Beam ids were 48 bits** (low). A beam link is its only key. New ids are 128 bits; old ones still resolve (`beam.test.ts`).

### Reviewed, open as issues

- **Claim and pass integrity** (medium): https://github.com/QuinnsCode/RustyBuns/issues/2320. Hand-queued runs are safe (#645 and its follow-up); auto-queued ones are not.
- **Beam links outlive a privacy flip**: https://github.com/QuinnsCode/RustyBuns/issues/2321.

### Reviewed, nothing found

`GET /api/beams/:id` does not leak across repos (the row is joined to its live repo); `DELETE` is limited to the beamer and the owner; `POST .../checks` refuses a non-owner's non-queued status; a stale runner can't report after its claim lapses.

### Still not reviewed

Cuts and mirror landing as paths into main; the `via 'job'` re-dispatch against the human-only gates; GitHub token scope; game-room sockets; the other ~250 `innerHTML` sinks in `client.html`; the route families nobody listed. The next run starts here (#2322), with saved programs (#2294).

## Round 7, October 25: cuts, mirror landing and job re-dispatch (#2322)

A hand review of three more units from round 6's list, source only, no target code run. Not the full skill run with a coverage ledger.

### Fixed in this round

- **A queued job lost its token** (low, defence in depth). A request an API token queued under a rate-limit rule (`limit_jobs`) is replayed to the app as the person (`actingAs`, via `job`), so `byToken` was false and the gates that refuse tokens (accept a batch, `build_ok`, approve a deploy, clear a deploy on commit) would have let it through. Only dig, preview and the doctor can queue today, and none sits behind those gates, so nothing was reachable; a rule made queueable later would have been. A replay of a token's job now still counts as the token's (`queued-by-token.test.ts`).

### Reviewed, nothing found

- **Cuts** (`cuts.ts`): a cut only writes a branch (forks of main's files), never main; it reaches main through the branch merge, which has the policy-file and protect-main rules from round 5. Running one is the owner's.
- **Mirror landing** (`mirror.ts`): a push into the repo's own git lands as the owner, but only the owner gets a remote that writes, and the mirror, branch and tag routes are owner-only. `POST /api/mirrors` takes `file://` and local paths on purpose: it needs git on the machine, which is the desktop, whose one person is the owner.

### Still not reviewed

Moved to #2339: GitHub token scope; game-room sockets; the other ~250 `innerHTML` sinks in `client.html`; the route families nobody listed.

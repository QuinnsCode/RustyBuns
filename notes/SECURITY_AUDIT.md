# Security audit, October 2026

How we keep a malicious or prompt-injected agent from hurting the code, the secrets or the people using what we host. It covers every surface, from the API to the desktop: what's done, what isn't, and what free Cloudflare features can add. Every open item is an issue labelled `security`; the ones only you can do are also `manual run`.

## The threat in one paragraph

Agents write most of this repo, and codeSplitters lets other people's agents into theirs. So we assume any one agent can be turned against us: a poisoned README, a dependency, or another agent's message can prompt-inject it. It then has whatever its process has: files, env, the `gh` login, the tokens it was given. The goal is that one bad agent can't leak a production secret, rewrite history on `main`, or act as someone else. Today that holds better on the hosted site than on this laptop.

## Secrets: varlock, and who holds the keys

**Done.** Agents never handle secret values:

- `apps/codesplitters/.env.schema` is committed with names and `op://codesplitters/…` references only, never values. An agent can read it to learn what the app needs.
- `experimental.wheel: "human"` means varlock resolves those references at `plan`/`deploy` through the 1Password app behind Touch ID. Any `OP_TOKEN` is ignored. The values go straight into Cloudflare's secret store and the running Worker reads them from there, so nothing is written to disk.
- No secret has ever been committed: a scan of every ref in history for key and token patterns found none. GitHub secret scanning and push protection are on.
- `.env*` and `.dev.vars` are gitignored. This PR adds `.dev.vars.*`, `*.pem`, `*.key`, `*.p12` and `.npmrc`.
- `rustybuns triage` tells its agent never to read `.dev.vars`, `.env*` or `op` values.

**The weak spot is the laptop, not varlock.** Runtime injection only protects a secret that isn't already sitting somewhere else:

- Agent Office passed its whole environment to every worker (#643). Secret-shaped names are now dropped (`apps/agent-office/live/env.ts`), but a secret under an innocent name still reaches them. The guard refuses `ps e` / `ps -E` (#642), but since an agent runs as you, a script can still read the office process's own environment; the fix is workers as their own user (#667).
- Every agent runs as you. `gh auth token`, `~/.config`, Alchemy's plaintext state (`.alchemy/state`) and the office's session secret and pty token are all readable (#667).
- Nothing stops an agent from running `op` while you're at the keyboard and approving Touch ID out of habit. The deny-list in #649 makes that a visible prompt instead of a habit.

The REFERENCE notes that the 1Password path "has not been run against a real vault yet". The codeSplitters deploys now run through it, so that line is stale and can go once you confirm.

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

### codeSplitters web app and API

| Done | Not done |
| --- | --- |
| Better Auth: email/password, GitHub, Google. OAuth tokens are encrypted at rest; a password reset signs out other sessions | **No CSP, HSTS, nosniff or frame-ancestors** except on the OAuth consent page (#647) |
| `cst_` tokens are SHA-256 hashed, always expire, read or write scope, never admin, kept out of cookie-only routes | No Origin check on cookie POSTs, so CSRF protection is SameSite=Lax alone (#647) |
| Private repos return 404 to non-readers; search and shares filter by access | No Turnstile; rate limits are D1 counters (#647, #623) |
| `theme_html` renders in a scriptless sandboxed iframe; the client escapes everything | Alias login (no password) is the fallback when `BETTER_AUTH_SECRET` is missing. varlock makes it required, but the code should still fail closed on the edge (#647) |
| Workers Logs redact query strings | No audit log for tokens, collaborators, visibility or deletes. CI tokens never expire. Invites are stored in plaintext (#648) |

### codeSplitters MCP, CLI and invited agents

| Done | Not done |
| --- | --- |
| MCP uses the same `cst_` bearer and the same route checks as the API. OAuth 2.1 uses PKCE S256, rotating refresh tokens and a loopback-only redirect for unregistered clients | **An invited agent can un-hide private lines, record a passing check under any name, and commit straight to `main`.** Its token works on every repo and survives removal (#645) |
| Agents can't deploy (`agent-` handles are refused) and can't touch visibility, collaborators, hooks or tokens on someone else's repo | `destructiveHint` covers only 4 tools and is advisory (#648) |
| Commit authors are set by the server, so authorship can't be forged. Users only get **read** Artifacts tokens; write tokens are internal with a 5-minute TTL. There's no force-push API; a fresh start is owner-only | A check command gets the runner's own write token (#618) |

### codeSplitters sandboxes and deploys (Containers)

| Done | Not done |
| --- | --- |
| A fresh container per agent run, as a non-root user, with only that harness's LLM key | **DeployRunner runs collaborator-merged code with the owner's unsealed deploy key**, and the output masking only catches the exact string (#646) |
| Deploy keys are sealed with AES-GCM under `DEPLOY_SECRETS_KEY`, with a rotation slot | The dependency doctor's `install` runs lifecycle scripts next to the LLM keys; containers have open egress (#646) |
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
2. #645 and #646: collaborator agents on codeSplitters reach private lines, checks and the owner's deploy key.
3. #649: a committed deny-list and hook. It's a speed bump, not a sandbox, but it stops the casual leak.
4. #647: headers, Origin checks, Turnstile and failing closed.
5. #644, #648, #650, #651, #618: everything else.

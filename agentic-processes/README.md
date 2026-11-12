# Agentic processes: inventory

This is a list of how RustyBuns runs its agents, sorted by what could travel to another repo. Nothing in the repo
points here yet, and nothing has moved. It is a list to pick from. Once the picks are made, the portable
pieces get copied in here, with RustyBuns names (Bob, Mervin, codeSplitter, app paths) swapped for placeholders.

Legend: **Copy** = works elsewhere as it is. **Generalize** = the idea travels, but names and paths need swapping.
**Stays** = RustyBuns only.

## 1. The agent rulebook (`AGENTS.md`, `CLAUDE.md`)

`CLAUDE.md` is one line, `@AGENTS.md`, so every harness reads the same file. Sections of [AGENTS.md](../AGENTS.md):

| Section | Verdict | The portable core |
| --- | --- | --- |
| Tools: CLI first | Copy | Shell CLI over an MCP server, and WebMCP only for what needs the signed-in page |
| Ephemeral worktrees: already installed | Generalize | The hire step installs deps, so agents don't reinstall |
| Tests: CI runs the suite | Generalize | Run only the tests you changed, CI runs the rest. No reruns of passing tests. Test journeys, not source text. Delete unreachable cases. The builder Mac part stays. |
| One call, not a loop | Generalize | Wrap chores (CI wait, issue brief, symbol outline) in one command that returns a short answer |
| Docs heal themselves | Generalize | A docs script fixes the generated parts and checks links, and CI runs `--check` |
| Check what comes in | Generalize | Parsed data is `unknown` until a guard narrows it, and an audit allowance that only goes down |
| Effect: where it fits | Generalize | Use the library at the edges for cleanup, cancellation and retry, never per frame (only for TS+Effect repos) |
| Cut before you add | Generalize | Grep before writing a helper, pull duplicates up, aim for net-negative PRs. The helper list stays. |
| codeSplitter is the contest entry | Stays | |
| Finishing: say what is left | Copy | "N of M done", every leftover becomes an issue, a worker or a question, and done means back on `main` |
| Manual runs | Copy | Owner-hands work gets its own `MANUAL RUN:` issue with a label, steps and a time |
| Secrets and pushes | Generalize | Agents never fetch secrets, never push main or tags, never touch shared `.git`. Never name the commercial game an example copies. |

## 2. Claude Code config (`.claude/`)

| File | Verdict | Notes |
| --- | --- | --- |
| `settings.json` deny-list | Copy | Blocks secret reads, `op`, `gh auth token`, force pushes, pushes to main, env dumps. Drop the RustyBuns paths. |
| `hooks/guard.ts` (+ test) | Generalize | A PreToolUse guard that catches what the deny-list misses. It imports `scripts/remote-ci.ts` for the builder valve, and that part gets cut. |
| `skills/rebuild-pr/SKILL.md` | Generalize | Merge main into a PR, resolve so both sides survive, test narrowly, terse report. Swap the codeSplitter `layout` line. |
| `skills/security-audit/SKILL.md` | Copy | Already agent-neutral |

## 3. Chore scripts (`scripts/`, run as `bun run <name>`)

| Script | Lines | Verdict | Depends on |
| --- | --- | --- | --- |
| `pr.ts` (+ test) | 106 | Copy | `gh`, and the `guard` from `packages/util` (bring it along) |
| `issue.ts` (+ test) | 68 | Copy | same |
| `outline.ts` (+ test) | 80 | Copy | `typescript` |
| `conflict-markers.ts` (+ test) | 58 | Copy | none |
| `migration-numbers.ts` (+ test) | 47 | Copy | none (numbered migrations) |
| `boundary-audit.ts` + `.allow.json` | 106 | Generalize | the allowance file starts fresh |
| `docs.ts` | 108 | Generalize | the README examples table is RustyBuns' own |
| `climbs.ts` (+ test) | 130 | Generalize | hill climbs: a score chased one round per worker, baton prompt inside |
| `manual-runs.ts` + lib + html | 94+ | Generalize | Yes/No walk through `MANUAL RUN:` issues. The `RUNS` table is per app. |
| `preflight.ts` | 91 | Stays for now | needs Mervin (`apps/codesplitter`) and `packages/util/overlap.ts` |
| `remote-ci.ts` (builder) | 271 | Stays for now | two-Mac setup. The idea, "tests run off the office machine", is in MAC_SETUP part 4. |
| `probe.ts` | 87 | Stays | per-game `window` handles. The idea (a `state()` handle beats screenshots) is one line in the rulebook. |
| `packages/util/src/guard.ts` | | Copy | `obj`/`str`/`num`/`arr`/`opt` runtime guards that the scripts above import |

## 4. GitHub side (`.github/`)

| File | Verdict | Notes |
| --- | --- | --- |
| `rulesets/main.json`, `tags.json` | Copy | PRs only, required checks, and the reason `gh pr merge --auto` waits for CI |
| `workflows/typecheck.yml`, `apps.yml` + `scripts/ci-apps.ts` | Generalize | Test only the apps a PR touched, and everything when shared code moves |
| `CODEOWNERS`, `dependabot.yml` | Generalize | |
| the rest of `workflows/` | Stays | desktop, t3-bun, terraviz, npm publish |

## 5. Docs that explain the method

| Doc | Verdict | Notes |
| --- | --- | --- |
| [OPS.md](../OPS.md) | Copy | "Things are functions": one operation behind HTTP, MCP, WebMCP, CLI and a skill (`packages/ops`) |
| [EFFECT.md](../EFFECT.md) | Copy (TS+Effect repos) | |
| [AGENT_PROMPTS.md](../AGENT_PROMPTS.md) | Generalize | The format travels: paste-ready prompts, one job each, with a stopping point and no spend |
| [notes/WORKER_COLLISIONS.md](../notes/WORKER_COLLISIONS.md) | Generalize | Why parallel workers collide, and the smallest fix |
| [notes/TOKEN_LEDGER.md](../notes/TOKEN_LEDGER.md) | Generalize | How to measure what agents spend, and its levers |
| [COSTS.md](../COSTS.md) | Generalize | The "writing apps that stay cheap" section |
| [notes/SECURITY_AUDIT.md](../notes/SECURITY_AUDIT.md) | Generalize | Numbered audit rounds, with fixes and tests in one PR |
| `apps/agent-office/` (Dexter, Ester, ledger, MOVE.md) | Stays | The office itself. Dexter, which names hand-done chores from transcripts, could become its own tool later. |
| README, EXAMPLES, FRAMEWORKS, signing, MAC_SETUP and the rest | Stays | product docs |

## 6. Your working style (memory in `~/.claude/projects/.../memory/`, outside the repo)

About 60 feedback memories, which are the "how I like to work" rules. They are personal, and some name private
setup, so they would be rewritten as a generic user-level `CLAUDE.md` rather than copied. The ones that travel:

- **Reporting:** progress count + leftovers, merge warnings up front, owner merges green PRs, explain in plain words,
  flag down when waiting (AskUserQuestion), commands not before AskUserQuestion, show plans before building, keep scope modest
- **Git and PRs:** never stack PRs, check the PR is open before pushing, done = back on main, git ops confirm no data loss,
  large PRs + clear loose ends, issue fixes fast, stay on the worker's branch
- **Safety and spend:** no surprise cloud bills, secrets via a vault, sandbox untrusted repo runs, GitHub writes need
  permission, close an issue only after sign-off, small commands with no `rm` globs, no python edit scripts
- **Workers:** discrete tasks for fresh workers, overnight runs never idle, only the owner sends workers home, parallel work through a merge tool
- **Issues:** repo issues are the board, board lanes, manual-run issues (taste only, agents pre-verify), climbs hop forward,
  judge scores run high
- **UI taste:** icons over wrapping words, Lucide icons and no emojis, E2E at every screen size, leave the live demo open, timers on timed runs

Stays: everything that names an app, a person, a Mac, or a third-party project to keep hands off.

## Open questions before the move

1. Copy or move? Copying leaves RustyBuns untouched, as asked. Moving would need this repo to point here.
2. What shape? Plain folder of markdown + scripts, a template repo, or a Claude Code plugin (skills + hook + settings in one install).
3. Does the working-style list become a user-level `~/.claude/CLAUDE.md`, so it follows you to every repo with no copy per repo?

# Agentic processes

How RustyBuns runs a team of coding agents, written up so another repo can work the same way, with or without
Claude Code. It's documentation only. Nothing in RustyBuns reads or points at this folder, and the
live setup (`AGENTS.md`, `.claude/`, `scripts/`, `.github/`) stays where it is.

## The docs

| File | What it is | Where it goes in a new repo |
| --- | --- | --- |
| [AGENTS.template.md](AGENTS.template.md) | The rulebook with placeholders: tests, chores, docs, checks, finishing, manual runs | Copy to the repo root as `AGENTS.md`, fill it in |
| [GUARDRAILS.md](GUARDRAILS.md) | Secrets, git, ownership and money rules, plus the three layers that enforce them | Summarize it in `AGENTS.md`, then set up whatever layers your harness and host have |
| [WORKING_STYLE.md](WORKING_STYLE.md) | How the owner likes agents to report, scope, merge and hand off | Your agent tool's per-person instructions, so it follows you to every repo |
| [CHORE_TOOLS.md](CHORE_TOOLS.md) | Specs for one-call tools (PR checks, issue brief, outline, preflight and more) | Build the ones you need, and list them in `AGENTS.md` |
| [PLAYBOOKS.md](PLAYBOOKS.md) | Rebuild a PR, merge waves, parallel workers, hill climbs, manual runs, audit rounds, prompts | Link it from `AGENTS.md` |
| [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md) | Things are functions, check what comes in, cut before you add, effects at the edges, tests | Link it from `AGENTS.md` |

## Starting a new repo

1. Copy `AGENTS.template.md` to `AGENTS.md`, and point any harness-specific file (`CLAUDE.md`, `.cursorrules`) at it in one line.
2. Turn on a branch ruleset for `main`: PRs only, with the checks required (GUARDRAILS.md, layer 3).
3. Add your harness's deny-list and pre-call hook if it has them (layer 2).
4. Build the PR-checks and issue-brief tools first. They save the most context.
5. Create the `manual run` label.

## Where each piece came from in RustyBuns

Kept so a later change here can be carried over. Links go to `main` on GitHub.

| Source | Became |
| --- | --- |
| `AGENTS.md` (Tools, Worktrees, Tests, Docs, Check what comes in, Cut before you add, Finishing, Manual runs) | AGENTS.template.md, CODE_PRINCIPLES.md |
| `AGENTS.md` (Secrets and pushes), `.claude/settings.json`, `.claude/hooks/guard.ts`, `.github/rulesets/` | GUARDRAILS.md |
| `scripts/pr.ts`, `issue.ts`, `outline.ts`, `help.ts`, `test-bites.ts`, `preflight.ts`, `conflict-markers.ts`, `migration-numbers.ts`, `boundary-audit.ts`, `docs.ts`, `manual-runs.ts`, `climbs.ts`, `probe.ts` | CHORE_TOOLS.md |
| `.claude/skills/rebuild-pr`, `.claude/skills/security-audit`, `AGENT_PROMPTS.md`, `notes/WORKER_COLLISIONS.md` | PLAYBOOKS.md |
| `OPS.md`, `EFFECT.md` | CODE_PRINCIPLES.md |
| The owner's feedback to agents, gathered across sessions | WORKING_STYLE.md |

Left out because they only make sense here: the builder Mac and its valve, the merge tool (Mervin) and
Agent Office, codeSplitter's contest rules, per-app helper lists, and the product docs.

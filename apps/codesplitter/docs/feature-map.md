# codeSplitter feature map

Demo video script: [demo-video.md](demo-video.md). Every feature, grouped by what it's for, plus what's missing. Letting an agent in safely: [agent-takeover.md](agent-takeover.md). The long version of each is in [REFERENCE.md](../REFERENCE.md); the pitch is in the [README](../README.md).

## Editing: the line is the unit

- Every line has a stable id, an author and a history.
- A file is a Durable Object: one writer per file, so every agent's edits land in one order.
- Live sync over each file's WebSocket; open pages patch in place.
- Stale edits retry instead of clobbering: a 409 on a changed line, a merge when the words differ, `ifRev` for edits that depend on the whole file.
- Blame and time travel from the op log, replayed from snapshots (every 2,000 edits).
- Presence: who's in a file, people and agents apart.
- Claims: agents hold the lines they work on, you can hold lines, a waiting line queues them, soft claims only announce intent.
- Test results in the gutter.
- Search code, per repo and across repos.
- Cut: select lines, follow what they use across files, run their tests alone, merge back by line.

## Branches and merges

- Branches built on the op log, so blame and live sync work on them; stacked branches.
- Three-way merge by line id: moved blocks, same line added twice, renames across a file.
- Conflict cards (main, branch, both, write your own), suggestions, an Ask button for a coding agent, offered only once the merge parses and tests pass.
- Per-path merge rules in `.gitattributes` (`merge=union`, live-edit mode, who settles leftovers).
- Hunk-by-hunk review (accept or reject).
- Merge plan and dispatch hint: which open branches will clash, before a task starts.
- Merge lint: conflict markers, unparsable files, undefined names.
- Build changes flagged: `package.json`, lockfiles, Dockerfiles, CI and deploy config need a person to say they've read them.
- Agent budgets: past a cap, an agent stops and leaves a DONE / NEXT / BROKE / DONT note.
- Beam a branch: squash into one clean commit with a link, a `git am` patch and an inbox.

## Git

- Real git: a commit is a `git push` to Cloudflare Artifacts, and `git clone` works.
- Git objects and packs built in the Worker with no git library.
- Two-way mirrors with GitHub, GitLab or any URL; they survive upstream outages and never force-push.
- "Where git truth lives" setting, and `refs/kept/` so history never goes extinct.
- Dig up (fork) any public GitHub repo or level; temporary digs clean themselves up; upstream tracking with "Take them".
- The vein: history view with revert, cherry-pick and tags.
- Big repos in R2, packed into chunks and dug off a queue.
- Monorepo awareness.
- Private GitHub repos on the desktop.

## Privacy and sharing

- Private lines in a public repo: blank in the page, blame, search and git, with a second remote for the crew.
- Public or private repos; crew; invites by handle, email or link (humans and agents have separate doors).
- Share some lines: a live link to a range that follows by line id.
- Share cards for X.

## Agents

- Claude Code, Codex, pi and opencode, blamed by name (`agent-claude`).
- Hosted agents in throwaway containers (admins only, on a budget); local agents on the desktop with your own logins.
- Plan first; agents redo work after a rebase.
- Agent CLI (`codesplitter tools`, `codesplitter triage`).
- MCP server, OpenAPI, REST, personal tokens, OAuth, WebMCP and the ⌘K palette, all from one list, with a test that fails on drift.
- Agents have faces: profile with harness, who runs them, repos, runs and a 30-day pulse.
- Built for prompt injection: agents get branches and containers, never deploy keys.

## CI and checks

- Check runs on codeSplitter, GitHub Actions, or both; GitHub statuses posted back as `codesplitter/<name>`.
- Bring-your-own runners that pull work; checks in a container per run (off by default).
- Point external CI at the repo through the GitHub-compatible API.
- CI for a public repo on your own machine: fork PRs never mirror.
- Required checks gate Merge, scoped by path; monorepo checks cover touched workspaces and their dependents.
- CI that heals itself: an agent gets the failing log, two tries, then a person.
- Webhooks: GitHub-shaped, HMAC-signed, retried on a queue.

## Dependencies and supply chain

- The dependency doctor: scheduled updates, minimum release age, throwaway-clone tests, an on-fail chain, ranked packages, preview deploys, dig for future releases.
- OSV vulnerability checks.
- Supply-chain watch: hourly platform status pages and malicious-package advisories.

## Deploy

- Rusty Buns fit score per repo.
- Deploy to Cloudflare, Railway or Hetzner, from the desktop or the site.
- Write-only sealed deploy keys; only a person deploys.
- Preview deploys, ship on commit, a production guard, a deploy log, adopting what's already live.
- Secrets from 1Password via varlock.

## Social (what exists)

- Follow people, agents, repos and line ranges.
- Home feed of line events from what you follow, grouped per person or agent run, with an agent-written digest.
- Stamps on lines (+1, heart, binoculars, shovel, gem, skull, lgtm) that follow the line by id.
- Profiles with your own HTML, a code city (walkable with followers), repos and playlists.
- Playlists of code; levels to browse and fork.
- The game: the backrooms, code-birds, bopping friends in the lobby.
- gitpath: a repo's commit graph as a 3D highway, with a game.

## Platform

- Desktop app (a binary for every OS) running the same code as the Worker, with local twins of every binding.
- Accounts (GitHub, Google, email); rate limits that queue; gem tiers; admin insights.
- Phone view at `#/m/owner/repo`.
- Your mods.

## Gaps

**Is a social feed missing?** No: the home feed, follows, stamps, profiles and the city are the social layer. What's missing is the part where people talk to each other.

Obvious gaps, roughly by how much they'd be missed:

1. **Comments and discussion.** Nowhere to say anything on a line, hunk, branch or beam. Stamps react but can't explain. Line-anchored threads that follow the line by id would fit the model and make review a conversation.
2. **Notifications and an inbox.** Beams have an inbox, but there is no general one: a mention, a stamp on your line, a review request, a failed check on your branch, a finished agent run. The feed shows what happened, not what needs you.
3. **Issues, or a task list agents can claim.** Work is tracked on GitHub; nothing here says "this needs doing" and lets an agent or person take it. It would pair with the dispatch hint and agent budgets.
4. **Review requests and approvals.** Reviewing hunks exists, but there is no "ask Dan to review this" or "approved by" on a merge, and required reviewers aren't a merge gate the way required checks are. Issue #754 covers agent identity plus required review.
5. **Discovery.** You can follow what you already know about. There's no explore or trending page, no repo search by topic, and no "people working near these lines".
6. **Stars or watches, and mentions.** Follow is close to a star. `@handle` in a commit, card or comment doesn't link or notify.
7. **Teams or orgs.** A crew is per repo. There's no group that owns several repos, with shared billing, tokens and defaults.
8. **Releases.** Tags exist, but there are no release notes or published artifacts per tag.
9. **A public activity stream for agents.** Agent profiles show a pulse. A live "what are agents doing across the site" page would suit a proof of concept that is mostly agents.

If I picked one: **comments on lines**, with notifications. It's the smallest piece that turns the feed from a log into a place, and it uses what the app already does best, anchoring things to line ids.

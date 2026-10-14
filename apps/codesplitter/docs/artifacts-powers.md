# What Artifacts lets codeSplitter do that GitHub can't

A research note, written 2026-10-14 from the [Artifacts docs](https://developers.cloudflare.com/artifacts/), Cloudflare's launch and contest posts, and what Cloudflare staff said on X. The last section lists what we use today and what we leave on the table.

## What Artifacts is

Cloudflare's own framing: a versioned filesystem that speaks Git, built for agents first ([launch post](https://blog.cloudflare.com/artifacts-git-for-agents-beta)). Underneath, each repo is a Durable Object running a Zig-to-Wasm git server on DO SQLite, with R2 snapshots and KV for tokens. It is "not quite a Durable Object, not quite a sandbox": you get a DO's one-owner-per-repo, cheap-by-the-millions shape, with the git protocol as the only interface.

Pieces worth knowing:

- Repos are made, forked and imported by API (`create`, `fork`, `import`), with no server to run. Forks start with the source's history and then diverge on their own tokens and lifecycle.
- Tokens are scoped to one repo, `read` or `write`, with a TTL. Your Worker decides who gets one; Artifacts doesn't do user auth.
- Git notes are supported natively. Cloudflare's examples: prompts and agent attribution attached to a commit without changing it.
- Event subscriptions (open beta): `repo.pushed` (with ref, before, after and commits), `cloned`, `fetched`, `forked`, `imported`, `created`, `deleted`, and token created/revoked, delivered to a Queue consumer or a Workflow. `triggers.events` can start a Workflow per push.
- Push-to-deploy: a push can run a CI Workflow in sandboxes (`@cloudflare/ci`) and end in `wrangler deploy`, including Workers for Platforms. Workers Builds adds branch previews.
- ArtifactFS mounts a big repo blobless and hydrates files on demand, so a sandbox starts in seconds instead of waiting on a clone. It works with any git remote.
- Namespaces carry an EU or US jurisdiction, fixed at creation. Metrics cover ops, pulls, pushes and errors.
- Limits: 1 GB per repo, 32 MB per blob, 2,000 git requests per 10 s per repo, 2,000 control-plane requests per 10 s per namespace, unlimited repos and namespaces. Billing starts October 14-15, 2026 ($0.15 per 1,000 operations, $0.50 per GB-month, with free tiers).

The contest post says what Cloudflare wants: not "GitHub as it exists today with agents added on top." Its open questions are the ones to answer: how do agents learn what others are doing, what happens on conflicting changes, how do you review it all, and how do you track why a change was made.

## What staff said on X

Less than the docs. I found these, and could not find posts from Kenton Varda or Sunil Pai on Artifacts:

- Dillon Mulroy (co-author of the launch post): ["build your companies future source code infrastructure on artifacts"](https://x.com/dillon_mulroy/status/2047547330182672407). He also pitches it for any versioned state you want to share, fork or roll back, not only code. Replies asked whether any production Cloudflare repos run on it yet.
- Ashley Peacock's launch-week threads show import from GitHub then plain `git clone`, and [isomorphic-git inside a Worker](https://x.com/ashleypeacock/status/2046218907464147313) committing and serving content with history.
- [Anthony Ronning](https://x.com/anthonyronning/status/2063335931558625594) asked whether it works as agent state on top of git, "trackable, reproducible, replayable sessions", with no confirmed answer. The launch post already describes that (per-session repos, time travel, fork from any point).

## What we can do that GitHub can't

GitHub's unit is a repo that a human creates, a pull request that a human opens, and a rate limit sized for people. Ours is a repo that is as cheap as a KV key, writable in any order by many agents, with lines as the unit. The interop is the point: the same repo is a real git remote, a live per-file WebSocket, an MCP/OpenAPI/WebMCP tool set, a two-way GitHub mirror, and a desktop bare repo.

Ideas, roughly by payoff. Each says what we do today.

1. **Git notes as the "why" layer.** Write one note per commit with prompt, agent, model, budget spent, check results, the claims it held and its DONE/NEXT/BROKE/DONT note, under `refs/notes/codesplitter`. It travels with `git clone` and a mirror, so the reason outlives us. GitHub shows no notes. Today we keep this in D1 and line stamps, and none of it is in the git. This directly answers the contest's "why, not just what."
2. **Push events as the front door.** Subscribe to `repo.pushed` on a Queue, so a plain `git push` from a laptop or a stranger's agent gets the same checks, merge lint, build-change flags and line-id indexing as an edit in the UI. Today codeSplitter is the only writer to its Artifacts. With events, Artifacts becomes a public door and we react, and `cloned`/`fetched` give us "who is reading this" for free.
3. **Tournaments.** Fork one baseline N times (`defaultBranchOnly`, cheap), race N agents on the same task, show the candidate diffs side by side, ship one, delete the rest. Because merges are by line id, the losers' good lines can still be lifted into the winner. The contest names "comparing multiple candidate changes" and "which should ship." GitHub makes a fork a heavyweight, human-owned thing.
4. **Tokens as capabilities.** Mint a short-lived `write` token per agent session, a `read` token per reviewer or share link, and revoke on a budget cap or a claim lost. Revocation and issue events land in the audit log. Today we hold our own tokens and agents never see Artifacts credentials; this would let an agent's own `git` talk to its own scoped repo.
5. **A repo per session, not only per project.** Persist an agent container's working tree to a session repo, so a run is time-travelable and hand-off is a fork from any commit. Cloudflare does this internally for its sandboxes. It also gives takeover (a person or another agent picks up mid-run) a cloneable artifact instead of a log.
6. **Non-code state in git.** Per-repo agent memory, project config with rollback, and the task board as files in a sidecar repo that any agent can clone, diff and revert. Dillon's "any versioned state" pitch, and it keeps agent context in a place any harness can read.
7. **ArtifactFS for agent containers.** Blobless-mount the repo in the agent sandbox so it starts working in seconds. It does not help repos over the 1 GB cap, so the R2 chunk path for Bun and Alchemy stays.
8. **Push-to-deploy and previews per branch.** Workers Builds or an events-triggered CI Workflow could give every agent branch its own preview URL on the branch card. We have our own deploy path; this is the cheaper one to adopt for previews.
9. **Namespaces as the tenancy and compliance boundary.** One namespace per org gives isolation, per-namespace metrics and an EU/US jurisdiction. It is also the shard when a namespace nears its rate limit.

## Cautions

- Writes come only as a `git push`, so every commit builds a pack. That is already handled in the Worker; it stays the main cost to watch once billing starts.
- The 2,000 git requests per 10 s per repo cap is about 200 per second. Agents that poll git would hit it. Serve reads from our DOs and D1, and keep Artifacts for pushes, clones and forks.
- The docs don't say what consistency a read gets after a write, or how snapshots restore. Don't build a flow that depends on either until they do.
- Event payloads truncate commits and messages (`commitsTruncated`, `messageTruncated`); read the repo for the truth.
- Still beta, billing starting, and the launch post and changelog differ on whether billing begins on the 14th or 15th.

## What we use now, and what we don't

Used: `create`, `fork` (digs, levels, archives, fresh start), `import`-style forks of public repos, `createToken` for downloads, and the repo as the clone-able source of truth ([agent-takeover.md](agent-takeover.md)).

Not used yet: git notes, event subscriptions, Workers Builds and `@cloudflare/ci`, ArtifactFS, per-session repos, namespace jurisdictions, read tokens for sharing, token revocation as a control. Ideas 1 and 2 are the smallest steps and unlock most of the rest.

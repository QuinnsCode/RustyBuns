# How do I stop an agent wiping out my code?

The question every team asks before handing an agent a repo. This is the answer in layers, what each one stops, and what a stress test of "the agent goes rogue" should try. The long version of each control is in [REFERENCE.md](../REFERENCE.md).

## Is Artifacts just for git files?

Yes. Cloudflare Artifacts is a git repo as a primitive: made by an API call, cloneable with a token, and written only by `git push`. codeSplitter uses it for exactly that and nothing else: the commit log of each repo.

Anything that isn't git history goes elsewhere. Screenshots and other hand-off files belong in R2, handed to the agent as a presigned PUT URL (it can write that one key, nothing else). Big repos that don't fit Artifacts are already kept in R2 as chunks. So Artifacts is the durable, cloneable source of truth; it isn't a thin file system.

## The layers

Outermost first. A rogue agent has to get through each one.

1. **Identity.** An agent that joins by invite gets a token held to that one repo. It can't make tokens, can't be an admin, can't open sockets, and removing it from the crew revokes the token. Personal tokens are `read` or `write`, always expire (30 days by default), and only their hash is stored. A read token can't call a write at all.
2. **Its own branch.** A hosted agent run works on `agent-run-<id>`. Its batch waits (8 seconds by default, longer if someone holds it) before it merges, and a person can look, hold, accept or reject. A line someone changed on main in the meantime keeps their version.
3. **Gates a person has to open.** A batch that touches build or deploy files (`package.json`, lockfiles, Dockerfiles, CI) or that required checks hold waits for an accept. Required checks gate Merge, scoped by path.
4. **Budgets.** A run has a token budget per path. Past it, it hands off, escalates or downshifts instead of grinding on. Site-wide caps (30 hosted runs a day, 600 container minutes) count everyone, admins included.
5. **Containers with the internet off.** Hosted agents and deploys run in throwaway containers whose HTTP and HTTPS go through an allow-list gate. Names outside it don't resolve.
6. **No keys, no deploys.** Deploy keys are write-only and sealed. Only a person ships; no `agent-*` handle can deploy. A hosted deploy refuses any commit the owner didn't write or read, so code a prompt injection plants waits on a branch.
7. **History you can't quietly rewrite.** Every line has an author and an op log, so blame and time travel work after the fact. The mirror to GitHub, GitLab or any URL never force-pushes; if upstream rewrites history it stops and asks, and commits it drops are kept under `refs/kept/`.
8. **A trail.** The security audit log (tokens, crew, invites, visibility, webhooks, deploy keys, repo deletes) is append-only, and says who, signed in how, and from where.
9. **Your own gateway.** Every operation that can't be undone or ships code (delete a repo, merge, commit, deploy) is marked `x-codesplitter-risky` in the OpenAPI spec and `destructiveHint` over MCP, so a gateway or client can require approval.

## Stress test: try to take it over

Run each as a write token or an invited agent, against a scratch repo.

| Attack | Should happen | Layer |
| --- | --- | --- |
| Rewrite every line of main | Lands on `agent-run-<id>`, waits for the countdown, a person rejects it | 2 |
| Edit `package.json` or CI config to run something | Held until a person accepts | 3 |
| Same, but with the review clock at 0 (`AGENT_REVIEW_MS=0`) | Writes main directly. Nothing stops it except history | 7 |
| Delete the repo | Needs a write token, and the repo's name typed back. Its git goes with it | 9 |
| Make itself a longer-lived token | Refused, token management takes the cookie | 1 |
| Reach another repo with an invite token | 403 | 1 |
| Deploy, or read a deploy key | No route reads a key; deploy refuses `agent-*` | 6 |
| Exfiltrate from the container | Host not on the allow-list, 403 | 5 |
| Plant an injection in a README that an agent reads | It can only write its branch; deploys wait for a person | 2, 6 |
| Spin up runs until the bill hurts | Hits the daily site-wide cap | 4 |
| Force-push the GitHub mirror | The mirror never forces | 7 |

## Gaps, said plainly

- **Delete is final.** A repo delete removes its rows and its git together. Nothing is soft-deleted. The real backup is a GitHub mirror that someone else controls, and that's the first thing to recommend.
- **A personal write token can do what its owner can**, delete included. Only invited agents are held to one repo. Scope personal tokens down, or put the risky operations behind approval.
- **Human or token commits to main are not held.** The review window is for hosted agent runs. A write token that commits directly lands on main immediately (undoable from history, not blocked).
- **No required reviewer yet.** Issue #754 covers agent identity plus required review as a merge gate.
- **No per-token rate or blast-radius cap.** A token is limited by the owner's rate limits, not by "at most N lines changed".

What to tell someone who asks: let the agent in by invite, leave the review window on, mirror to a remote you own, and require approval on the risky operations. Then the worst case is a branch you reject, not a repo you lose.

# The life of code, and where codeSplitter's panels sit in it

From a weekend-warrior slop app to a scaled production app, for people, agents and creators. This maps each phase to what exists and what is missing. It starts with the question that prompted it: bringing your own build machine.

## External build machines: mostly built

A runner is a loop that pulls work: claim the oldest queued run, clone it, run the command, stream the log, report. `scripts/runner.ts` is that loop and `POST …/checks/claim` is the protocol (`src/checks.ts`). It needs no inbound port, so a laptop, a Hetzner box or a Mac mini on a shelf all work. The desktop drains its own queue, and on Cloudflare a per-repo `CiRunner` Durable Object runs each check in a container (`src/ci-runner.ts`).

So "connect on bun via port" is already the design, and it is better than a port because the box dials out. What is missing is the product around it:

| Gap | Size | Notes |
| --- | --- | --- |
| A runner list in the repo (label, last seen, current run, names it accepts) | small | `claimRun` already takes a label. Store a `runners` row on each claim or heartbeat and show it in a panel. |
| One-line setup shown in the UI (copy a command with the token filled in) | small | The command is `bun scripts/runner.ts owner/repo --label …`; a scoped token is minted from the panel. |
| Pin a check to a runner or label (`runs-on`) | small | `--names` exists on the runner side; the check's settings need a `runner` label so a GPU or macOS check waits for the right box. |
| Provisioning a box with Alchemy (Hetzner/Railway/Fly), runner installed, auto-destroy when idle | medium | `DeployRunner` already holds `HCLOUD_TOKEN` and `RAILWAY_API_TOKEN`. This is a new "Runners" resource kind. It spends money, so it needs a price shown first, an idle timeout and a cap. |
| Warm caches (bun install, cargo target) between runs | medium | Only matters on provisioned boxes; the Cloudflare containers are fresh each run by design. |

So the first slice, without provisioning, is hard-ish only in the UI: a Runners panel plus a `runs-on` label. Provisioning is a second PR.

## The phases, and the panel for each

The repo page today (`views.repoDetails`) has: About, Upstream, Mirror, Crew, Beam, Branches, Rusty Buns, Dependencies, Deploy, Preview deploy, Webhooks, Audit log, Delete. They are in the order they were added, not the order code lives its life.

| Phase | Today | Gap |
| --- | --- | --- |
| 1. Dig it in (fork, clone, mirror, import) | Upstream, Mirror, Beam | Home has no single "dig" door. `github:` import, `git clone`, paste-a-URL and drag-a-folder should be one box. |
| 2. Explore | file tree, backrooms, Vein, search | Fine. |
| 3. Edit | line editor, claims | Fine. |
| 4. Share (and share others') | Crew, line shares, invites | "Share someone else's code" is Beam; give it a name that says so. |
| 5. Plug AI in (full agentic, local collab, remote collab) | Agents panel (hosted), harness settings, WebMCP | Three modes are not named anywhere. Offer them as one choice: hosted agent, my machine's agent via `scripts/agent`, a friend's agent invited by token. |
| 6. Test | checks inside Branches | Not a panel of its own. Needs Runners (above) beside the run list. |
| 7. Stage and build | Preview deploy | Fine, but sits far from Deploy. |
| 8. Infra for the tests | none | Runners panel. |
| 9. Infra for the app | Deploy, Alchemy stacks | Fine. |
| 10. Scale | `scale.ts`, Rusty Buns | Not surfaced as a step. |

## Proposal: group the panels by phase

Keep the dock, rail and accordion as they are. Change only what the panels are grouped under and the order the rail shows them. Six groups, one row of rail icons each:

1. **Get**: Upstream, Mirror, Beam
2. **Work**: Branches, Agents, Crew
3. **Check**: Checks, Runners (new), Dependencies
4. **Stage**: Preview deploy
5. **Ship**: Deploy, Webhooks
6. **Scale**: Rusty Buns, limits

A small "where am I" strip above the rail (Get, Work, Check, Stage, Ship, Scale) lights the phase the repo is in and gives one call to action, for example "no checks yet: add one", "checks pass: preview it", "preview is good: deploy". A weekend app never leaves the first three. Someone scaling lives in the last two. That is the same product at both ends.

## Suggested order of work

1. Runners panel: `runners` table, heartbeat on claim, copy-paste setup command. No spend.
2. `runs-on` label on checks.
3. Phase grouping and the "where am I" strip (client only).
4. Alchemy-provisioned runners, with a price, an idle timeout and a cap.

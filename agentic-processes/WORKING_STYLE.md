# Working style

How the owner likes agents to work, gathered from the feedback they've given across many sessions.
This is about the person, not the repo, so it carries to any project and any agent tool. Put it wherever your
harness keeps per-person instructions, or paste it at the top of a long task.

## Reporting

- **Count and leftovers, every time.** Every status opens with "N of M done" and links each undone
  item. "PR is open" is not a status.
- **Merge warnings first.** The first line of a merge hand-off is "Safe to squash-merge #N" or
  "DON'T merge #N yet", plus the order when there are several.
- **Plain words.** Explain a PR as what it changes for a person, not as a diff summary. Keep reports short.
- **Check before you ask.** The owner merges green PRs, so check whether a PR already merged before asking about it.
- **Show plans, don't hide them.** A status question gets the status and a plan the owner can see.
  No plans written silently to a markdown file.
- **Flag down when waiting.** When you need the owner, ask with the harness's question prompt, not a
  question trailing at the end of a long message. Give commands to run in a plain message that ends
  the turn, not right before the question prompt, where they may be hidden.
- **Guide by hand.** When the owner has to do something: name the machine, give one instruction at
  a time, label every password prompt, check each claim before you make it, and prefer a script to copy-paste.
- **One step at a time on live runs.** Walking through a dashboard: check the state, give one action,
  and wait. No stacked checklists.

## Scope

- **Keep scope modest.** Ship the core. Extras become follow-up issues.
- **Fix issues fast.** Fix it, add one test, push. No optional proof detours.
- **Large PRs, clear loose ends.** Fold related fixes into the open PR rather than opening many
  small ones, and file every unresolved item as an issue with a link.

## Git and PRs

- **Never stack PRs.** Every PR goes against `main`. Land the shared base first. Stacked PRs have lost work twice.
- **Check the PR is open before pushing to it.** If it already merged, you're on `main` now.
- **Done means back on `main`** after the squash merge.
- **Before any risky git step**, confirm there's no data to lose (clean tree, nothing unpushed), say so, then go.
- **Stay on your own branch.** Don't make side branches inside a worker's worktree.
- **Parallel workers on the same files** all start from `main`, and a merge tool settles the overlap afterwards.

## Workers and long runs

- **Fresh worker per discrete task.** Reuse a worker while it has room, and hire a fresh one past about
  150k tokens of context.
- **Overnight runs never idle.** An unattended run never ends a turn in the middle of a task, and ships a
  first PR within the hour.
- **Only the owner sends workers home.** Work outside the repo gets an issue.

## Issues

- **The issue tracker is the board.** Todos are repo issues, not a separate project board.
- **Lanes:** current need, future idea, backburner, third party. Priority is the owner's call alone.
- **Manual runs are taste only.** Agents check everything a harness can. The `MANUAL RUN:` issue
  holds only what needs the owner's eyes or hands.
- **Hill climbs** (a score chased round by round) move forward: each round opens a "rounds N+" issue and
  closes the old one. Agent judges score about 2 points higher than the owner would, so read their scores as direction only.

## Money

- **No surprise bills.** Price it first, use the smallest resources and the cheapest model with guards, count the
  fan-out, and destroy test resources after checking them.
- **Own the infrastructure when it's cheap to own.** For example, a search index runs locally first, never on a hosted vector database bill.

## UI taste

- **Icons over wrapping words.** A label that would wrap becomes an icon with the word as a tooltip.
- **One icon set, no emojis**, in UI, PRs, issues and replies.
- **Every screen size.** A UI change gets tried at phone, tablet and desktop widths before the PR.
- **Leave the live demo open** (dev server and browser tab) after a visual change, so the owner can look.
- **Timers on timed runs:** a ticking clock up or down, fixed width, with an info tip.
- **A soft but bold house look.** The UI is a styleless controls core with an optional skin.

## Code

- **Your own mechanics.** Real physics or your own ideas, not conventions borrowed from a commercial game.
- **Generate assets in code** (seeded procedural models) before reaching for a separate 3D tool.

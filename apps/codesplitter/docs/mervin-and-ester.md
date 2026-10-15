# Mervin and Ester: git, rethought for a swarm

**Neither of them is AI.** Mervin settles merges and Ester sorts red checks, and both are plain deterministic code:
no model, no prompt, no sampling, no tokens spent. The same inputs give the same answer every time, in
milliseconds, for free.

They exist because of one finding about working with a swarm of agents.

## The bottleneck moved

The usual story is that agents are not smart enough yet. We did not find that. In the week of October 7 to 14 this
repo merged 966 pull requests, up from 9 a day to 150-216 a day, built by many agents working at once.
Intelligence was not what ran short. What ran short was **parallel intelligence per minute per dollar**: how much
useful thinking you get out of N agents at once, for each minute and each dollar spent.

The bottleneck was git, and the habits around it. Git was built for people who commit a few times a day and who
usually notice each other. Nobody had needed boundaries that held at this speed, because nobody had moved this fast.
So every agent that finished work collided with the others at the same few places, and the collisions cost minutes
and tokens that bought no new thinking:

- Two agents add a line to the same list. Text-wise, that is a conflict. An agent then spends a turn, and its
  tokens, redoing a merge it did not need to do.
- Two agents each number a migration `0042`. Git merges it clean and it breaks at deploy.
- A check goes red and nobody can tell whether the PR caused it, whether it was already red on `main`, or whether it
  is flaky. An agent reads logs to find out, and often fixes what it did not break.

The number is not a feeling. Of the 1,038 PRs in the history, 23% jammed on `main` and 12% had a red run, and the
jam rate climbed with the crowd: 18% when 0-2 other PRs were open, 51% when 10 or more were. More agents did not mean
proportionally more shipped work. Past a point they meant more of one agent waiting on another. The full counts, and
how they are measured, are in [jams.md](jams.md).

You can watch that week happen. Every dot below is one of its PRs, coloured by what it was waiting on, and the red
spike is the night of October 13, when 18 PRs sat stuck on git at once. The page behind it, `/swarm-watch.html`, lets
you drag through the week and shows which file the stuck agents piled into (`bun scripts/swarm-week.ts` collects it).

![1,000 PRs in a week, one dot each](swarm-week.svg)

## So: rethink git, sideways

The fix is not a smarter agent standing in the way of the collisions. It is to take the collisions out of the path,
with machinery that is cheap and always right about the part it covers, and to hand an agent or a person only what
is truly a judgment call. We call it a horizontal rethink of git: not a better agent on top, but a change
to the layer under every agent, so any number of them can work side by side.

### Mervin: the merge guy

Mervin ([mervin.md](mervin.md)) is the merge engine. Every line of a file has its own id, so two agents who touch
different lines never collide, and two who add to the same list both keep their lines. When both really changed the
same stretch, Mervin hands back a card with the context needed to answer it, rather than a conflict marker. He also
reads the open PRs and puts the ones that clash into waves, so two agents find out early instead of at merge time.

What he is held to, on repos that are not ours:

| Test | Result |
|---|---|
| Fights seen coming, expressjs/express (202 PRs, 67 fought) | the merge plan flagged 84% at 98% precision |
| Files git gave up on, git/git (470 files, 400 conflicted merges) | 43% settled to exactly what the person committed, 6% close, 39% handed back as a card, 13% settled to other text |

Those are the honest numbers, including the 13%. See [mervin.md](mervin.md) for how to rerun both.

### Ester: the tester

Once the merges stopped being the slow part, the testers were next, so Ester ([mervin.md](mervin.md#ester-the-tester))
weeds that out the same way. When the board's check goes red she sorts every failing test by who owns it:

| Owner | Meaning | What happens |
|---|---|---|
| main | fails on `main` too | ignored; not the swarm's |
| flaky | passed when only the failing run was repeated | noted, retried |
| own | an app a PR with its own red CI touches | that PR fixes its own CI first |
| wait | the same, but that CI is still running | held until it finishes |
| blocks | only the merged tree breaks it | the PRs that touched that app are named as suspects |

Only `blocks` stops a merge. She also keeps a running record, so she can say which dependencies hurt, which checks
are slowest, and what a rerun costs. These are easy, deterministic wins: nobody asks a model whether a test that fails
on `main` is the PR's fault.

## What this adds up to

On this repo's own history, jammed PRs stayed open 0.79 hours against 0.22 for clean ones and took 2.6 commits against
1.1, about 136 extra hours and 360 extra commits. Our estimate is that Mervin removes roughly half to four fifths of
that, going by the scores above. For red checks, about 100 hours passed between a PR's first red run and its merge,
and Ester's share of it is the time spent working out whose failure it was. That is an estimate from other repos'
scores and from this repo's counts, not a measurement of either helper on this one, and the counts are a floor:
a jam is detected from commit titles and force pushes, so quiet ones are missed. The method and its limits are in
[jams.md](jams.md).

## Where the AI goes

Models are still the point. They write the code. The rest of the system exists so their tokens go to writing it.
When Mervin or Ester hands something back, it is a card with the context to answer it, which is the one place a model
or a person is worth the cost.

- [mervin.md](mervin.md): the engine, the scorecard, the board and Ester's commands.
- [jams.md](jams.md): where a swarm got stuck, counted from this repo's history.
- [mervin-engine.md](mervin-engine.md): running it locally and on Cloudflare.

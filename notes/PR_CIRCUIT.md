# PR board circuit

How a PR gets to `main`, as a circuit board you can play like a tour: https://claude.ai/artifact/HBgxGjHXHkH7qRCPXJD4pi,
built from [pr-circuit.html](pr-circuit.html). Publish that file to the same URL to update it.

Each button traces one trip: all green, red from your change, red on many PRs, red but not the code, main moved, and the
checks after a merge. Each step answers what is here, what gets you here and what gets you out, in short plain sentences
(ASD-STE100 style). Solid lines exist; dashed lines are ideas.

The data is in the page's script: `nodes` (the boxes), `edges` (the lines), `about` (each box's words) and `trips` (the
steps of each button). Change them when the flow changes.

Open questions:

- A test that passes only some times: the rule is to file an issue and not loop on it, but nothing says how that one PR
  then gets to green unless the test spreads far enough for Ester's watch.
- The release rings are drawn as built. [RELEASE_RINGS.md](RELEASE_RINGS.md) and the ring workflows say parts of them
  wait on the owner's permission.

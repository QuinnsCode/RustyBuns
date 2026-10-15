# Test audit (#1681, #1733)

## Timings (codeSplitter, local, one JUnit run of `hooks`, `tokens`, `journey`, `conflicts`)

Every test is under 1 s; the slowest is 0.9 s (token rate limits), and a boot of `local()` is cheap (about 0.1 s).
Merging files into journeys therefore buys little wall-clock time. Cut for value, not for boot cost.

## Done

- `journey.test.ts`: repo, push, collaborators, protect main, branch, merge, agent batch, policy files (#1684).
- `tokens.test.ts`: the six token tests are one journey on one app (6 boots to 1).

## Not done (own issues if wanted)

- Hook and conflict journeys: both files share per-test fixtures (`got` outbox, branch names) and cover distinct corners; folding them would only hide failures.
- The same pass on `packages/cli`, `packages/shell-bun` and `apps/agent-office`.
- A whole-suite per-test timing run: AGENTS.md forbids it locally; take it from a CI JUnit artifact.

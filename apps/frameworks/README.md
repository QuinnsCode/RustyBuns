# Framework samples

One small app per web framework, written the way that framework's own Cloudflare guide says, so we can check that
`rustybuns init` reads it and the desktop host runs it with no edits. They are test beds, not apps to play with:
the games and tools are one level up, in [`apps/`](../), and the list of those is [EXAMPLES.md](../../EXAMPLES.md).

Each one meets the [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract) (a counter in KV that survives a
restart), checked by [`scripts/counter.ts`](../../scripts/counter.ts). CI runs a sample's test when it changes, and
all of them when `packages/` does, so a change to the CLI that breaks a framework shows up on the PR that made it.
[FRAMEWORKS.md](../../FRAMEWORKS.md) has the matrix: which framework, which build output, and what has been verified.

The samples have no Cmd+K menu, unlike the other apps with a page. A menu would add `@rustybuns/util` and client code,
some to samples that ship none, and that changes what they test.

They stay in this repo, not their own, for that reason: a separate repo would test against a published CLI, after the
breaking change had already merged.

An app's id is still its folder's name (`astro-example`), so CI rows, artifacts and tiers didn't change when they moved
here. Scripts find the folder with `appDir` from [`scripts/app-dirs.ts`](../../scripts/app-dirs.ts).

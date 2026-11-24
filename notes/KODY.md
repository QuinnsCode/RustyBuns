# Kody: where we could help

Kody (kody.codes, repo `kody-hq/kody`, Kent C. Dodds and Epic Web) is "your agents' cloud": an agent's
memory, keys, code and automations kept in one place and reached over MCP from any host. It runs on
Cloudflare Workers, D1, KV and Durable Objects, with a small MCP surface (`search` plus a Code Mode
`execute`), the same bet codeSplitter made. Read on 2026-11-23 from the README, `CONTRIBUTING.md`,
`docs/use/community-packages.md` and the open issues (45). Nothing was sent to kody.codes.

## What the rules allow

- **A pull request to `kody-hq/kody` needs a signed CLA**, even for a one-line docs fix. The person
  signs once by commenting a fixed phrase on the PR. That is a legal grant, so it is the owner's call,
  never an agent's.
- **A public Kody package needs no CLA.** Anyone with a Kody account publishes one to `/community`;
  others fork it in one click. It needs a root `README.md` and `AGENTS.md`. This is the open door.
- License: the Kody License (FSL 1.1 based) is free for personal, family, nonprofit and classroom use;
  anything else emails them. Kody's `packages/cli` is MIT.

## What his board says he needs

Most of the 45 open issues are tagged `needs-kent` (his decisions) or are filed by his own bot,
`kody-bot`, as `Friction:` reports from his agent loop (`ship-pr`). A few are `agent-ready`:
TypeScript 7 (#1190, waits on 7.1), a polish pass (#2050), flag cleanups with dates on them. Those
are small and his own agents already take them. A stranger's PR there helps little.

## Where we could actually help

1. **A public Kody package from something we already have.** Picks that fit how Kody agents work:
   - The guard kit (`@rustybuns/util/guard`): check what comes in, the guard is the type. MIT, no Bun
     or DOM, copies out with `bun scripts/util-api.ts --copy guard <dir>`. Kody's #4337 ("most
     capabilities silently strip unknown input fields") is the same problem from the other side.
   - Mervin's merge order (preflight's "Merge after #N"): his `ship-pr` loop merges many agent PRs.
   - `bun run pr <n>`: one call that waits for a PR's checks and prints the failing step's tail.
2. **Learn from him.** His bot files a `Friction:` issue each time an agent loop hits a wall, with
   cost in minutes. That is Dexter's job here, written down per hit instead of found later in
   transcripts. Worth copying into Dexter. His CLA check reads signers from a branch outside the
   `main` ruleset, a neat trick if we ever take outside PRs.
3. **Say thanks where he asks for it.** His Discord (`kcd.im/kody-discord`) is where users talk. A
   short note from the owner that codeSplitter and Kody share the Code Mode bet would land better than
   any patch.

Not on the list: moving our office's memory or secrets onto Kody. Secrets stay in 1Password through
varlock, and memory stays local.

## Be kind to his stuff

Read the repo through `gh` a few calls at a time; never load-test, crawl or script kody.codes or
kody.run. Any comment, issue, PR, Discord post or package publish goes out only when the owner says so.

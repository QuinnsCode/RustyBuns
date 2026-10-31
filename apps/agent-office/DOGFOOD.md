# Dogfooding codeSplitter from the office

Two ways to run codeSplitter out of the office. The first works today; the second is the plan in [MOVE.md](MOVE.md).

## Today: the local office, pointed at codeSplitter

The office already talks to codeSplitter ([`codesplitter/`](codesplitter/index.ts)). It is off until you turn it on, and
the repo it watches has to exist on codeSplitter first.

1. **Put RustyBuns on codeSplitter as a mirror.** Make `QuinnsCode/RustyBuns` a mirror of the GitHub repo (see the mirror
   section of the [codeSplitter README](../codesplitter/README.md)). Make it **pull-only** at first: syncs only fetch, so
   codeSplitter never writes to GitHub and the real repo can't be hurt by a bad test.
2. **Sign the office in.** Run `codesplitter login` once (or set `CODESPLITTER_URL` and `CODESPLITTER_TOKEN`). The token
   stays on your machine; the office's server makes the calls. A running desktop app is found by itself.
3. **Turn it on.** In the office, ⚙️ Settings › You › codeSplitter: switch it on and enter the repo as `owner/name`.
   Each of the 📌 issues, 📋 queue and 🔀 PR boards then gets the codeSplitter mark, with a dot when its twin has news.
   The mark means the office *watches* codeSplitter, not that the office runs in it.
4. **Use it.** Add a task to the 📋 queue in the office page. The dispatch hint asks codeSplitter which open branches already touch those
   files and offers to queue anyway or wait. Workers keep pushing to GitHub as before.
   The hint runs in the page only: `office-workers hire` from a shell skips it.
5. **Note what breaks.** File each rough edge as an issue, so the next round of fixes comes from using it.

This tests the board, the dispatch hint and the "hung in X" notes. Workers still run in local worktrees and merge through
GitHub.

## Next: workers that run in codeSplitter

To have workers edit line by line through codeSplitter, and merge through Mervin, the office has to run there. That is the
`office-preview` stage ([PREVIEW.md](PREVIEW.md), [#1412](https://github.com/QuinnsCode/RustyBuns/issues/1412)), and it
is not built: the Durable Object for the queue and roster, the 3D client served from the Worker, and the four gaps in
MOVE.md (PTY over WebSocket, container lifetime, cost cap, auth). Deploying it is a MANUAL RUN for the owner.

A stepping stone that needs none of that: point a single worker at a throwaway codeSplitter repo and have it use the
codeSplitter MCP server (`claude mcp add --transport http codesplitter <site>/api/mcp`) for its edits, with the office
still hosting the desk.

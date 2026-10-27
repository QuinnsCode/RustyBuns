# WebMCP and code mode

An agent's context is its budget. Tokens spent reading tool schemas, screenshots or a whole file it
needed three lines of are tokens it doesn't spend on the feature or on checking its work. Rusty Buns
apps hand agents their actions in the smallest shape the job needs: a CLI first, an MCP server in
**code mode**, and **WebMCP** tools in the page for whatever needs the signed-in person. This page has
the numbers we can show and how to reproduce them. codeSplitter shows the same as a page at
[`/webmcp`](https://codesplitter.notryanquinn.workers.dev/webmcp).

## The numbers

| | Without | With | |
|---|---|---|---|
| Listing codeSplitter's MCP tools | 30,240 tokens (all 138) | 1,054 tokens (code mode's 4) | 29× less |
| Clearing 20 TODOs in a 300-line file, listing included | 36,822 tokens, tool by tool | 1,220 tokens, one program | 30× less |
| Share of a typical session's peak context (86k, the median here) taken by the tool list | 35% | 1.2% | |

Across this repo's own agents, 2 to 27 October 2026: 1,687 sessions, 8.27B input tokens, 97.8% of
them read from cache, and 62,749 shell calls against 774 on-demand tool loads (the
[token ledger](notes/TOKEN_LEDGER.md)). 1,490 commits landed on main in the same days.

## Code mode

codeSplitter's MCP server lists four tools instead of 138: `search_tools` and `describe_tools` find
and explain the rest on demand, `execute` runs a JavaScript program the agent writes (each tool is
`await tools.<name>({...})`), and `call_tool` is the door to the risky ones. The file's lines stay in
the program, and only what it returns comes back. A program that worked can be saved by name and
rerun with new input. Add `?mode=tools` to the server's URL for the plain list. See
[codeSplitter's README](apps/codesplitter/README.md) and `apps/codesplitter/src/codemode.ts`.

## WebMCP

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a page register its actions as tools
(`document.modelContext`), so an agent in the browser calls them and reads a small JSON answer instead
of taking a screenshot (roughly width × height / 750 tokens on Claude, about 1,400 for 1280 × 800),
finding a button and taking another to check. Where we use it:

- **codeSplitter.** Every ⌘K palette command on the current page is a tool, plus `current_page`,
  `open_page`, `list_files`, `read_file`, line picking and `list_conflicts` / `settle_conflict`. They
  are registered again on every route, so an agent sees only this page's tools. Risky commands carry
  `destructiveHint`, so the client can ask first. See [the audit](apps/codesplitter/docs/webmcp-audit.md).
- **Agent Office.** Its triage tools (`mem_stats`, `mem_history`, `take_cpu_profile`, `list_profiles`,
  `read_profile`, `heap_snapshots`) answer in text, the hottest frames of a profile rather than the
  `.cpuprofile` itself. See [Agent Office](apps/agent-office/README.md).
- **Skate Tech Park.** Eight tools; `skate_line` rides a whole line of moves in one call, code mode for
  a game. See [its README](apps/skate-tech-park/README.md).
- **Any Rusty Buns server.** `targets.box.webmcp: true` adds `mem_stats`, `take_cpu_profile` and
  `mem_history` to the box's pages. See [the reference](REFERENCE.md).
- **This docs site.** The reading settings and theme are tools, so an agent can change them for you
  ([ACCESSIBILITY.md](ACCESSIBILITY.md)).

WebMCP runs as the signed-in person, in their page, so the agent never holds a token or a password.
Use it for what needs that page; the CLI and MCP cover the rest ([OPS.md](OPS.md)).

## The guard rails

The tokens saved go to reading the diff, running the test and reviewing the change. Making agents
this capable is only worth it with limits they can't talk past:

- A code mode program runs in a Worker of its own with no network (`globalOutbound: null`); its only
  way out is the tools.
- It acts as the token that ran it, with that token's scope and rate limits, and never sees the token.
- Tools that ship code, change who can get in or see what, or can't be undone aren't callable from a
  program. They go through `call_tool`, so the person is asked.
- A program naming a tool that doesn't exist is refused before it runs, and every call's arguments
  are checked against the tool's schema.
- At most 100 tool calls, 20 seconds and 20,000 characters back per program.
- A box's profiling secret is handed to the page once, kept in that tab, and never shown to the agent.

## How we measured, and what we haven't

- Code mode: `cd apps/codesplitter && bun test test/codemode.test.ts` prints both comparisons. Tokens
  are counted as characters ÷ 4 on the exact JSON sent and received. Last run 27 October 2026.
- Sessions and cache: every assistant turn's usage in this machine's transcripts
  ([method](notes/TOKEN_LEDGER.md#method)).
- Screenshots: an estimate from the published image-token rate, not a measured run.

Not shown yet: one browser task done side by side with screenshots and with WebMCP; the live walk of
every codeSplitter view is still open
([#1424](https://github.com/QuinnsCode/RustyBuns/issues/1424)). And in this repo the shell does most of
code mode's job (locally it was called twice): code mode is for agents that reach codeSplitter over MCP.

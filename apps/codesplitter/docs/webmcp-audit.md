# WebMCP tools against the UI: audit and gaps

> **Snapshot, state at 2026-10-31:** #1425 (the selection tools) has merged, so the lines below that call them "not on `main`" or "if it lands" are out of date. The walk it lists is still a read of `client.html`, not a live run (#2979).

Written for [#1424](https://github.com/QuinnsCode/RustyBuns/issues/1424). This is a **read of
`src/client.html` (`readTools`, `webTools`, `commands`)**, not the live walk. The live walk (call
`current_page` and every tool once per view in a signed-in Chrome, `document.modelContext`) is still
to do; the checklist at the bottom is what it should confirm. The selection tools
(`deselect_lines`, `select_all_lines`, `invert_selection`, `expand_selection`, `select_matching`,
`select_lines_by`, `selected_lines`) are in the open line-picking PR (#1425), not on `main`, so they
are audited only as a list of things to check.

## How the tools are made

`webTools()` runs at the end of every `route()` (and once more when the agents poll lands on a file
page). It aborts the last route's registrations and registers `readTools()` plus one tool per palette
command from `commands()`, named by `toolName(title)`. Every tool but the reads runs through
`asAgent`, which waits for the route a command started and answers with `now: where()`.

## Tools by view

| View | Read tools | Palette-derived tools |
| --- | --- | --- |
| any | `current_page`, `agent_guide`, `open_page`, `list_files`, `read_file` | `search_code`, `home`, `about_codesplitter`, `privacy_...`, `api_reference`, `connect_your_ai_mcp`, `go_to_<level>` per ready level; signed in: `new_repo`, `your_profile`, `your_feed`; admin: `insights`, `rate_limits`, `survey_scaling_walls` |
| repo `r` | same | add a file, invite, make public/private, delete, start a branch, merge a branch, merge every clean branch, run checks, set where checks run, show checks, fetch GitHub's checks, phone view, show limits, clone command, play backrooms |
| file `f` | same, plus `list_conflicts`/`settle_conflict` only make sense on a branch page | everything for a repo, plus share, stamp, hold/let go, lift a claim, make private, cut, commit, give `<harness>` a task, stop agents |
| level `l` | same | fork, play (only when the level is `ready`) |
| cut `c`, share `s`, profile `u`, search | same | none of their own (only the "Anywhere" set) |
| branch merge `b` | same, `list_conflicts`, `settle_conflict` | repo set is not offered (the view is `b`, not `r`/`f`) |

`select_lines` is registered on every page. Off a file page it throws "no such line on this page",
which does not say to open a file first.

## Gaps (a person can click it, no tool)

1. **Edit a line.** Double-click, Enter saves. No tool; an agent has only the REST/MCP edit. Needs
   `edit_line` (`path`, `line`, `text`), answering with the new `rev` and the line.
2. **Copy, move or delete the picked lines.** No tool.
3. **Selection state**: `select_lines` takes a single `from`/`to`; no way to read what is picked
   except `current_page` (`sel`). Covered by #1425 if it lands.
4. **Cut page (`#/c/...`), share page (`#/s/...`), profile page.** The pages' own buttons (open a
   cut's lines, remove a share, edit profile or security settings, tokens) have no tool. Only
   `current_page` and `open_page` work there. Needs a read of what each button does before deciding
   which are worth a tool.
5. **Level page**: only fork and play. Browsing a level's file uses `list_files`/`read_file`, which do
   handle levels. OK.
6. **Branch merge page**: the `Merge` button itself (`settle_conflict` says nothing lands until it is
   pressed) has no tool, and nor does the repo-page "Merge a branch" command on `#/b/...`, because
   `commands()` only registers repo commands for `r`/`f`. An agent can settle every card and then
   cannot finish. High value.
7. **Branch picker.** `pickBranch` (view a branch's files instead of main) is a click with no tool;
   `Start a branch` is there, switching to it is not.
8. **Agent run controls** other than "give a task" and "stop every agent on this file":
   stop a single run, read a run's output.
9. **Comments/checks beyond `show_checks`**, which only toasts its answer rather than returning it
   (see below).

## Things that look wrong from the code

- **The tool's schema follows the pick only at the next route.** Titles embed the pick
  (`Share 4–12` becomes `share`, `Share lines…` becomes `share_lines`; `Stamp lines +1…` and
  `Stamp 4–12 +1` become `stamp_lines_1` and `stamp_1`). The set is rebuilt on route and on the agent
  poll, not when the pick changes, so after `select_lines` the old `share_lines` (needs `input`)
  stays registered and `share` does not appear. Both end up doing the right thing (the typed one
  works with or without a pick), but a tool list diffed before and after a pick is not stable.
  Fix: one tool per verb that takes an optional `lines`, defaulting to the pick, and re-register on a
  pick change or drop the pick from the name.
- **Several tools answer with a toast, not data.** `show_checks`, `share` (copies the link to the
  clipboard of a page that is probably hidden; the result carries `copied`, good), `commit`, the
  merges. `asAgent` returns `now` but the tool's own answer is `undefined`. An agent cannot read the
  new commit sha, the merged branch list or the check runs without a second call.
- **Name collisions are dropped silently.** `seen` keeps the first of two equal `toolName`s, so two
  levels with titles that differ only by digits ("Level 1", "Level 2" both become `go_to_level`) leave
  one tool. Worth a live check on the home page.
- **`open_page` is marked `readOnlyHint`** but navigates; harmless, but `consequentialHint` aside,
  it does change the page the human is looking at.
- **Reads cannot be ranged.** `read_file` returns every line with its author; a 5,000-line file is one
  big answer. Add `from`/`to`.

## "Too much" line

Keep a tool when one click or key does it and an agent would otherwise need several calls or DOM
poking. By that test:

- Keep: everything in `readTools`, `settle_conflict`, share, cut, stamp, hold, make private, start a
  branch, merge, commit.
- Fold or drop: the "Go to <level>" tools (one per level; `open_page #/l/<slug>` does the same), `home`,
  `about_codesplitter`, `privacy_...`, `api_reference`, `connect_your_ai_mcp`, `your_profile`, `your_feed`
  and the three admin pages (all only rename `open_page`'s argument), `phone_view_...`, `play_...`
  (it leaves the page for `/play.html`, so an agent loses its tools), and `copy_the_git_clone_command`
  (it copies to a clipboard no agent can read; `current_page` or `read` should return the command).
- Merge: `search_code` with `open_page #/search/<q>`, but keep `search_code` if it returns the hits.

## Live walk checklist

For each view (home, repo, file, level, cut, share, profile, branch merge page, search):

- [ ] `current_page`, then every registered tool once. Note any that throw, hang, or answer with a
  stale `now`.
- [ ] After `open_page` and after an in-page redraw (agent poll), no tool is missing or duplicated.
- [ ] Palette commands that depend on a pick are right before and after `select_lines`.
- [ ] Selection tools from #1425: each answers what the gutter, the status bar `Ln` and the Share/Cut/Private
  buttons show.
- [ ] A selection tool on a repo page says what to open instead.
- [ ] Two levels whose titles differ only by digits: both tools exist.

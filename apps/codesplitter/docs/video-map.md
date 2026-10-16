# Video map: script, shots, features, PRs

One page that ties the demo video together. Each shot of the silent take ([feature-walkthrough.md](feature-walkthrough.md)) sits on a beat of the contest script ([demo-video.md](demo-video.md)), and under each is the tour chapter that shows it (`src/features/<slug>.json`, played from `#/demos`) and the merged PRs that built it. Use it to check that every line of the dub is backed by something that shipped, and to see what is still not on camera.

Numbers are merged PRs touching `apps/codesplitter` as of 2026-10-14 (352 of them; the headline ones are listed). Open PRs that touch the story are at the bottom.

## Shot to PR map

| Shot | Dub line (short) | Script beat | Tour chapter | Merged PRs behind it |
| --- | --- | --- | --- | --- |
| 1 | Git for people and agents on one file | Hook (0:00) | `welcome-tour`, `getting-started`, `show-around`, `demos` | #1253 show-around, #1795 welcome tour (hello-world dug up), #1796 `welcome --box`, #1811 `#/demos`, #1325 landing and README voice |
| 1b | The cost: agents looping on a conflict | Hook | none (terminal take) | `apps/agent-office/ester/dexter.ts` compares tokens and turns; #1089/#1147 third conflict round goes to fresh eyes; #1808 why Mervin and Ester exist |
| 2 | The line is the unit; blame, time travel | The line (0:20) | `blame`, `time-travel`, `own-history`, `levels` | #1383 gitpath history from before codeSplitter, #1649 where a swarm got stuck from history; the line-id core predates this list |
| 2b | Same edit, no retry loop | The line | `same-line`, `live-together` | #995 line locks 3: word-level rebase of stale line edits (#928) |
| 3 | Presence: a person and two agents | Agents first-class (1:30) | `presence`, `agents` | #1315 who's here in the corner, #1616 hosted refuses an `agent-` handle from the user cookie, #1639/#1661 hosted harnesses |
| 4 | Two agents, one file, a stale write retries | Two agents, one file (3:00) | `multiplayer`, `live-together`, `same-line` | #995 stale-edit rebase, #1050 live edits enforced per path, #1489 firehose glow by edit rate, #1795 firehose edit in the tour |
| 5 | A claim queues the second agent | Two agents, one file | `claims` | #925 design, #963 leases everywhere, #979 cap fix, #992 wait in line and soft intents, #1517 repo picks who goes first |
| 6 | Mervin settles what git calls a conflict | Merge and review (4:30) | `smart-merges`, `watch-mervin` | #1396 Mervin named in plan, page and API; #1479 board merges open PRs in a sandbox; #1506 merge round recorded and replayable; #1619 and #1754 watch Mervin live; #1161, #1264, #1266 engine fixes; #1787 comment wording; #903 merge every clean branch |
| 6b | No model call; corpus 49% / 39% / 13% | Merge and review | `smart-merges` | #1332 scorecard, #1398 rails corpus, #1415 Mergiraf comparison, #1417 plan as a predictor; the numbers are in [mervin.md](mervin.md) (43% solved plus 6% close = 49%, 39% cards, 13% wrong) |
| 7 | Merge plan, hunk review, person signs off | Merge and review | `plan-first`, `build-changes`, `safe-updates` | #1164 plan in waves, #1778 wave plan for any two branches, #1780 plan and tiers on the merge page, #1566 approve and accept need a signed-in person, #1604 only the owner edits `.gitattributes` |
| 8 | DONE / NEXT / BROKE / DONT hand-off | Context kept (6:00) | `agents-rebase`, `hosted-agents` | #1091 agent budgets per path with a terse hand-off note, #1116 owner's notes carried in, #1119 and #1136 real token counts, #1147 fresh eyes, #1571 framed hand-off notes and feed digest |
| 9 | Private lines | not in the contest script | `private-lines`, `visibility` | #1333 design note and 13 flows; [private-lines.md](private-lines.md) |
| 10 | Share a range, open it signed out | not in the contest script | `share-lines` | #1601 share links and a one-day read token, #1666 wrecking-room and backrooms links from Share lines |
| 11 | Mirror a GitHub repo, Upstream catches up | not in the contest script | `private-github`, `cheap-big-repos` | #1035 pull-only mirrors, #1209 clashing mirror branch takes main, #1275 pull-only dig, #1493 folder mirrors, #1561 Sync now spinner, #1770/#1774/#1780 mirror box |
| 12 | `claude mcp add`, `codesplitter tools` | Ease of use | `agent-cli`, `fix-with-your-agent`, `api-tokens` | #1805 connect commands drop the old entry, #1704 OpenAPI and MCP parity, #1583 CLI first then MCP then WebMCP, #1341 home section for the human hand and the agent's eye |
| 13 | `git clone`, push, see it land | It is real git (6:45) | `clone`, `commit-to-git` | #1707 file-edit path and the clone/push story, #1601 clone command with a read token, #1439 and #1284 dig and clone speed |
| 14 | Deploy button, readiness | Ease of use | `deploy`, `deploy-all-over`, `ship-on-commit`, `preview-deploys` | #1490 deploy and health map, #1501 Ship panel switches, #1765 deploy lane on the watch page, #1795 "why not deploy it" |
| 15 | Repo link and README run steps | Close (7:15) | `getting-started` | #1648 demo script and checklist, #1712 `demo-check`, #1806 this walk-through |

Where the shot order and the contest script differ: the walk-through puts Mervin (6) before hand-off (8) and adds private lines, share lines and mirroring (9 to 11) that the contest script does not mention. They are the "only this can do" group; keep them if the cut has room, they are not scored beats.

## Features not on any shot

Tour chapters with no shot, so they are either extra material for a longer cut or candidates to drop from the pitch:

`backrooms` and the wrecking room (#1772, #1758, #1724, #1768), the TV view (#1762, #1750), `profile` pages (#1716, #1751), the dependency doctor (`doctor`; #886, #1686, #1682), `cut`, `desktop` and `every-os`, `search`, `palette`, `webhooks`, `varlock`, `prod-guard`, `adopt-live`, `file-is-a-do`, `temp-digs`.

Shots with thin PR cover, worth a look before recording:

- **3 (agents apart from people on the presence strip):** only #1315 and the handle-guard PRs. Confirm on the deployed app that `agent-claude` and `agent-codex` show as agents in the strip, not just in blame.
- **8 (the hand-off note):** `demo-check` does not walk it (see [demo-video.md](demo-video.md)). Rehearse it by hand.
- **1b and 2b (token counter):** needs a real run of `bun apps/agent-office/ester/dexter.ts`, no mock.

## Script, with shot numbers

The 7:30 contest cut, annotated with the shots that cover each beat:

| Time | Beat | Shots |
| --- | --- | --- |
| 0:00 | Hook | 1, 1b |
| 0:20 | The line | 2, 2b |
| 1:30 | Agents are first-class | 3 |
| 3:00 | Two agents, one file | 4, 5 |
| 4:30 | Merge and review | 6, 6b, 7 |
| 6:00 | Context kept | 8 |
| 6:45 | It is real git | 12, 13, 14 |
| 7:15 | Close | 15 |

The silent take runs about 3:30 and the dub makes it 5 to 7 minutes, so for the contest's 5 to 10 minute window hold shots 2, 4, 6 and 8 longer. Submissions close October 14, 2026, 11:59 PM PDT.

## Open PRs that touch the story

| PR | What | Shot |
| --- | --- | --- |
| #1807 | Tour: a scrub bar to drag back to any step | 1, and the `#/demos` take |
| #1814 | Link previews: meta description, og:description, twitter tags | 10, 15 |
| #1810 | Docs are programmatic and tied to versions | 15 |
| #1802 | Remote runs on the builder Mac over SSH | none |
| #1804 | Windows and Linux signing guide | none |

## Refresh

```sh
git log --format='%h %ad %s' --date=short -- apps/codesplitter | grep -E '\(#[0-9]+\)$'
gh pr list --state open --json number,title
```

Add a row when a PR changes what a shot shows; leave the rest of the 352 in git.

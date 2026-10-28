# Agent Office pre-verification, 2026-10-28

Run through `bun run demo --scenario <name>` (apps/agent-office README, "Jump to the state") in Chrome. All 13 scenarios
loaded at 390, 820 and 1440 px (same-origin iframes of each width, 2.5 s settle) and at the real 1512 px window, with the
buttons clicked through `window.rbDemo` and the page's own buttons. Screenshots were taken at 1512 px only: the browser
window would not go narrower, so the 390 and 820 results are measured (no horizontal overflow, canvases scale to 354 / 784 / 1068 px
wide), not looked at.

One real bug found and fixed in this PR (ester/index.ts): `GET /__rb/helpers` returns `tally: null` until Mervin keeps a tally.
Ester's badge poll merged the whole reply into its three states, then threw on `null.phase` when it rescheduled itself, so after
the first poll **her, Mervin's and Dexter's badges stopped refreshing** (no live dot, no "On it", no card update) on every office
that has no `mervin-tally.jsonl`. It showed in the demo as one unhandled rejection per page load, on all 13 scenarios. Fixed by
reading only the three helpers, through `helperState` (screens/read.ts). After the fix, wall-ester-running polled `/__rb/context` 4 times in 7 s (every 2 s while a run is going) and Ester's badge showed `running`; before, it polled once.

## #2513 setup page

| Item | Result | Evidence |
| --- | --- | --- |
| setup-first-run: three steps, "Nothing is connected yet", Connect GitHub on | PASS | page text |
| setup-no-client-id, setup-sign-in-code, setup-builder-down, setup-signed-in, setup-two-accounts render | PASS | no overflow at 390/820/1440 |
| setup-sign-in-code: "I typed the code" button adds the account (green, read-only) | PASS | `test/demo.test.ts` |
| setup-two-accounts: both cards, Test on each keeps it `ok` | PASS | `/__rb/connections` after Test |
| Revoke removes one card, the other stays | PASS | statuses after Revoke: `octo-demo:ok` only |
| setup-test-red: stale account is red (down), Test keeps it red, Revoke drops it | PASS | screenshot: red dot on stale-demo. It is red when the page loads, before any Test (the card text says "Test turns it red") |
| build Mac card: reachable + last night's builds; builder-down shows its setup line | PASS | "2 of 3 built, failed: skate" |
| No console errors | PASS after fix (FAIL before: `Cannot read properties of null (reading 'phase')`, 13 of 13 scenarios) | |
| Phone width (390) layout | PASS (measured, not looked at) | scrollWidth <= width |
| Real GitHub sign-in, Keychain entry gone after Revoke, ssh start, a real worker's `git push`, the phone | OWNER HANDS | |

## #2520 GitHub writes card and grants

| Item | Result | Evidence |
| --- | --- | --- |
| writes-ask-pending: card "Gizmo asks first", push detail, Deny / Always / Allow | PASS | screenshot, 15:00 countdown |
| Always: card goes, push goes through, grant `push` / repo / any worker saved | PASS | `/__rb/grants` |
| Next push (another worker) does not ask; `git status` never asks; `gh pr merge` still asks | PASS | stage log, `/__rb/asks` |
| Settings list shows the new grant right after Always | **NOTE** | the list is drawn when Settings opens and not redrawn, so with Settings already open it still says "Nothing is allowed always" until reopened. Only the demo stage keeps Settings open; in the office check by reopening Settings |
| writes-grants: two grants listed; add (repo, kind, worker) with Allow always; Revoke | PASS | rows after add and after revoke |
| Empty repo refused with "repo should look like owner/name" | PASS | |
| Phone width | PASS (measured) | no overflow |
| A real Claude worker's `git push` through the real hook | OWNER HANDS | |

## #2425 and #2430 wall screens

| Item | Result | Evidence |
| --- | --- | --- |
| wall-gitpath: six open PRs as cars between open and main, red 104 and 103, merges rolling past main, "3 merged in 24h" | PASS | screenshot |
| Click a car opens its PR | PASS (code path only) | the stage's PR URLs are fake; click a real one in the office |
| wall-mervin: 80%, "4 of 5 conflicts avoided, 2 held early", file tiles, all-time "79% of 52 · 14 PRs" top right | PASS | screenshot |
| wall-ester-running: clock ticks (0:46 to 0:53 in 5 s), three PR blocks pulse | PASS | two screenshots |
| wall-ester-red: #101, #102 green and #103 red, "#103 breaks the stack", Cheap fix button | PASS | screenshot |
| Cheap fix queues "Fix #103 for Ester (haiku, low effort)" | PASS | stage queue |
| Three screens evenly spaced, no overflow at 390 / 820 / 1440 | PASS | canvas widths 354 / 784 / 1068 |
| gitpath on your repo's busiest files ("No history yet" vs data), 3D wall spacing and text size, a real Ester run of minutes | OWNER HANDS | the stage draws flat canvases, not the 3D wall |

## #2568 box first-run and whole-log page

Not checked: PR #2566 is still open, and these pages need the box. Run again after it merges.

## Ready-to-paste: #2513 (setup page)

```
**About 10 minutes, your hands.** Pre-checked by an agent on 2026-10-28 with `bun run demo` (notes/preverify/agent-office-2026-10-28.md): every state renders, Test / Revoke / second account / sign-in code / builder card work, no console errors, no overflow at 390 / 820 / 1440 px. What is left needs your accounts.

1. On the office Mac: `cd apps/agent-office && AGENT_OFFICE_GITHUB_CLIENT_ID=<client id> bun run office` (client id from #2499).
2. Settings, Connections: Connect GitHub with a real account, type the code at github.com/login/device. Does it feel clear? (a code you can read, a link that opens)
3. Connect a second account. Revoke one: Keychain Access no longer lists it under `agent-office-github`.
4. Start the office from a plain ssh session: the PR board still loads.
5. On your phone (`bun run office:phone`, `/lite`): do steps 2 and the ask card once and say if the buttons are easy to hit.

Try the look first, no sign-in: `bun run demo --scenario setup-signed-in` (http://127.0.0.1:4720/?scenario=setup-signed-in)
```

## Ready-to-paste: #2520 (GitHub writes card)

```
**About 5 minutes, your hands.** Pre-checked 2026-10-28 with `bun run demo` (notes/preverify/agent-office-2026-10-28.md): the card, Deny / Always / Allow, Always lets the next push through, `git status` never asks, grants add and revoke. Left:

1. In the running office, have a real Claude worker run `git push` on a repo with no grant: the card appears over the office. Press Always; the next push goes through.
2. Open Settings > You > GitHub writes: the grant is listed, Revoke works.
3. Taste: is the card easy to see and press on a phone?

Look first: http://127.0.0.1:4720/?scenario=writes-ask-pending (`bun run demo --scenario writes-ask-pending`)
```

## Ready-to-paste: #2425 and #2430 (wall screens, one issue)

```
**About 8 minutes.** Pre-checked 2026-10-28 with `bun run demo` (notes/preverify/agent-office-2026-10-28.md): gitpath cars, Mervin's share and tiles and all-time tally, Ester's ticking clock and PR blocks, Ester red with Cheap fix queueing a Haiku task, no overflow at 390 / 820 / 1440. A bug that stopped Ester's badge from refreshing is fixed in the same PR as the notes. Left, in your office after `bun run office:update`:

1. Settings > You > Wall screens: tick gitpath, Mervin and Ester. Do the three thin screens look evenly spaced, and is the text big enough from where you stand?
2. gitpath on your repo: does it draw your busiest PRs? "No history yet" means the office cannot read your repo as you.
3. Click Ester (real run, a few minutes): does the clock tick and do tiles appear?
4. Taste: Mervin's little robot walks over the "4 of 5 conflicts avoided" caption. Fine, or keep it clear of the text?

Look first: `bun run demo --scenario wall-gitpath` (also wall-mervin, wall-ester-running, wall-ester-red) at http://127.0.0.1:4720/?scenario=<name>
```

## Ready-to-paste: #2568 (box pages)

Unchanged until PR #2566 merges; then pre-check it and keep only the taste and real-box items.

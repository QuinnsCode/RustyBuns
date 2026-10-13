# Private lines: where they earn their keep

A design note, not a feature. Private lines already work (see [REFERENCE.md](../REFERENCE.md), "Private lines in a public repo"). The question: which flows are they the best answer to, and what's missing to make those flows one click?

**Short answer:** private lines are the only way to show a file to someone and still hold back parts of it, by line, reversibly. That makes them a *handoff* tool more than a secrets tool: share the whole thing, mask the part that isn't theirs, take the mask off later. Three gaps stop that flow from being obvious: a way to write without reading, a way to hide from agents too, and a one-click "mask everything matching this".

## 1. What they do today

| Reader | Sees private lines | Why |
|---|---|---|
| Owner and collaborators (the crew) | Real text, flagged | `x-codesplitter-crew: 1` on the file Durable Object read |
| Anyone else who can read the repo | A blank line with its id and number | Same read with the header `0` |
| Shares, playlists, search, blame, time travel, live socket | Blank for non-crew | Every read goes through the same `view` |
| Git remote | Blank, with a second crew remote holding the real text | Commit pushes the blank copy; the crew remote gets the real one |
| Agents | Real text, since agents join as collaborators | They are crew |

Privacy follows the line **by id**, so edits keep it private, branches hide the same lines, and un-privatizing is one toggle (`POST do/private {lines, private}`) with nothing to untangle in history.

The last row matters for the idea behind this note: today "private" means *private from the public*, not *private from the AI*. An agent you hired reads everything you did.

## 2. Use cases, by flow

Each is the same move (mask, share, unmask), for a different reason.

**Handoff**

1. **Repair job.** Someone fixes one file in your repo (a freelancer, a friend, a stranger's agent). You mask what isn't theirs, they work, you unmask. Today they must be read-only, so they can *see* the repo but not change it. See gap A.
2. **Review without the crown jewels.** Open the repo to an outside reviewer or auditor with pricing logic, keys-adjacent config or an unreleased algorithm masked.
3. **Interview and take-home.** Ship a real codebase as the exercise; the reference solution sits in the same file, masked. Unmask after the deadline.
4. **Teaching.** An instructor's answer key lives in the starter repo as private lines. Students clone the public text; the crew clone has the solutions. Unmask a lesson at a time.

**Demos and streams**

5. **Stream-safe.** Mask scattered lines (⌘-click) before going live, unmask after. Already the intended use; see "right-click is ours on the code".
6. **Bug report.** Share the three failing lines, plus the lines around them for context, with the rest masked. Pairs with "share some lines, not the repo".

**Open source**

7. **Public repo with a private core.** The product is open; the hosted-only parts (billing hooks, abuse rules, tuning constants) are masked in the same file, so there is one file, one history, no fork to keep in step.
8. **Embargoed fix.** A security patch lives in the repo as private lines; unmask the day it ships. The crew remote already holds the real text in the meantime.
9. **Vendor and license carve-outs.** A third-party snippet you may not redistribute stays masked in the public view.

**Agents**

10. **Keep the AI out.** Mask what a model must never read (customer data in fixtures, a proprietary prompt), then run agents on the rest. See gap B.
11. **Two-pass work.** An agent works the public lines while a person fills the private ones, or the reverse, in one file with no merge conflict because the lines are separate ids.

**Housekeeping**

12. **Staged disclosure.** Mask a whole new feature until launch day; unmask it in one batch.
13. **Secrets that slipped in.** Mask first, rotate second. It stops new readers, not git history: the REFERENCE caveat stands.

## 3. Gaps that would make the best flows one click

**A. Write without reading (the repair job).** A writer today is crew, and crew reads private lines, so "let them fix the file without seeing the rest" has no role to hang on. A *contributor* role would read as a non-crew reader, may edit and branch on public lines, and have its branch merged by the usual line-id merge, which leaves private lines alone because it never touched their ids. It needs: edits to a private line from a contributor answer 403; inserting beside a private line is fine; the merge plan shows private lines blank to the reviewer if they are a contributor too.

**B. Hide from agents, not only the public (use 10).** Add a second level, say `crew-only` versus `human-only`: a human-only line is blank to agent reads even when the agent is crew, and an agent's edit to it is a 409 like a held line. Today's mask stays the default. The agent harness reads files with the crew header set, so this is a change at that read, not a new store.

**C. Mask by pattern.** "Make private every line matching `/sk_live_\w+/`, or all of `fixtures/customers/*`" turns a per-line chore into a rule, and the same rule can run on new lines as they land. A rule is just a saved selector that calls the existing toggle.

**D. A handoff link.** One action that creates an invite for a contributor, lists what will be masked, and carries an expiry; at expiry it revokes itself and, optionally, unmasks. This is the repair-job flow as a button.

**E. Show the mask.** Non-crew readers see an empty placeholder with no hint of why. A label ("private, 3 lines") and a count in the file header would make shares and reviews less confusing without leaking text.

## 4. Recommendation

Build **A** first. It is the only one that turns private lines from a display option into a collaboration model, and it is the flow the feature was imagined for. **B** is cheap once A lands and is the strongest pitch for anyone worried about AI. **C**, **D** and **E** are polish on top.

Out of scope here: encrypting private text at rest, per-person visibility (a line private from some crew but not others), and anything about the leaked-history caveat, which no mask can fix.

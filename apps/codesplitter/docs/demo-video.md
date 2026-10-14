# Demo video script

The contest needs a 5-10 minute demonstration video ([rules](contest-rules.md), section 4). An entry without one is void. Entries close **October 14, 2026, 11:59 PM PDT**. Recording and uploading is the owner's; this is the script to record from.

Target 7:30, hard ceiling 9:30. Record the live deployment on a fresh repo, not a staged page, so it matches what judges open. Leave `main` alone after submitting until October 21 and tag the submitted commit `contest-submission`.

## Order follows the judging weights

Scored 1-5 each: originality as agent collaboration (50%), several agents at once (25%), ease of use (25%). Lead with the first; it also breaks ties.

| Time | Beat | Show | Weight |
| --- | --- | --- | --- |
| 0:00 | Hook | One sentence: git for people and agents who edit the same file at the same moment. The line, not the file, is the unit. | 50% |
| 0:20 | The line | Open a file. Point at stable line ids, author per line, blame, time travel. | 50% |
| 1:30 | Agents are first-class | Claude Code and Codex each work a branch. Blamed by name (`agent-claude`), claims on lines, presence with agents apart from people. | 50% |
| 3:00 | Two agents, one file | Both edit the same file live. Pages patch in place, a stale edit retries instead of clobbering, claims queue the second agent. | 25% |
| 4:30 | Merge and review | Merge two branches that clash. Conflict card, merge plan before the task starts, hunk-by-hunk review, a person approves build-file changes. | 25% |
| 6:00 | Context kept | An agent hits its budget and leaves a DONE / NEXT / BROKE / DONT note; the next agent picks up from it. | 25% |
| 6:45 | It is real git | `git clone` the repo, push a commit, see it land. Cloudflare Workers and Artifacts named out loud. | 50% |
| 7:15 | Close | Repo link (`apps/codesplitter`), where the README run instructions are. | all |

Feature detail for each beat: [feature-map.md](feature-map.md), [line-locks.md](line-locks.md), [agent-takeover.md](agent-takeover.md), [merge-solutions.md](merge-solutions.md).

## Rules for the recording

- Show the product, not slides. No narration over a loading spinner; cut it.
- No weapons, sexual or political content, and no mention of competitor products.
- Say "git" once as the foundation, then show users never needing to see a git error.
- Keep the cursor still while a live update lands so judges can see it patch.
- Do a dry run the day before against the deployed worker; fix anything that fails in the app, not in the edit.

## Submission checklist

- [ ] Video recorded, 5-10 minutes, uploaded and public to anyone with the link.
- [ ] Repo link points to `apps/codesplitter`.
- [ ] README run instructions followed once on a clean machine.
- [ ] "Yes" to the terms in the application.
- [ ] `contest-submission` tag requested through a PR (agents never push tags).
- [ ] Winner attends Cloudflare Connect, San Francisco, October 21.

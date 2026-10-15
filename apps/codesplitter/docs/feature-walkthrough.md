# Feature walk-through (silent take, dub later)

Record the screen with no talking, then lay the voice over it in Audacity. So every shot below is something to do with the mouse and keyboard, how long to hold on it, and one line to say on the dub. The contest cut and its timings are in [demo-video.md](demo-video.md); this is the same story in the order that screen-records cleanly, with the best features first.

## Before you hit record

- Live deployment, fresh repo, signed in. `bun run demo-check --url <app> --cookie <session>` first, so nothing fails on camera.
- Seed `apps/agent-demo` (the snack-vote Worker) so two agents have something real to edit.
- Have two coding agents ready on separate branches (Claude Code and Codex), plus the browser at one window size for the whole take.
- Move slowly and pause 2 seconds after every click. The cursor stays still while a live update lands. Cut any spinner in the edit.
- Name the take by shot number in the file (`s03-two-agents.mov`) so the dub lines up.

## Shots

| # | Shot (silent) | Hold | Dub line |
| --- | --- | --- | --- |
| 1 | Home page, open a repo, open one file | 6s | Git for people and agents editing the same file at the same moment. |
| 1b | The problem, shown: a terminal where an agent hits a rebase conflict, reads the file, rewrites it, retries, conflicts again (3 rounds, token counter climbing) | 20s | Every dumb merge conflict an agent fixes is tokens, on the priciest model, spent on plumbing. |
| 2 | Click a line: stable id, author per line, then blame and time travel | 15s | The line is the unit, not the file. Every line knows who wrote it. |
| 2b | Same edit in codeSplitter: no retry loop, the line just lands. Counter stays flat | 10s | Same work, no waterfall. |
| 3 | Presence strip: a person and two agents (`agent-claude`, `agent-codex`) on the file | 8s | Agents are first-class. They show up by name, apart from people. |
| 4 | Both agents edit the same file. Lines patch in place, cursor still. One edit retries after a stale write | 25s | Two agents, one file, and nothing gets silently overwritten. |
| 5 | A claim on a line queues the second agent | 10s | Claims keep them from stepping on each other. |
| 6 | Merge two branches that clash. Open the merge page: conflict cards | 15s | Mervin settles what git would call a conflict, without spending tokens. |
| 6b | Mervin card: settled by line id, no model call. Then the corpus numbers: 49% match what the person committed, 39% he asks, 13% other text | 15s | Not AI. A deterministic engine, so the model only sees what is left. |
| 7 | Merge plan, then hunk-by-hunk review. Approve a build-file change as a person | 15s | A person still signs off on the risky parts. |
| 8 | An agent hits its budget and leaves a DONE / NEXT / BROKE / DONT note. The next agent picks it up | 20s | Context is kept, so the next agent starts where the last one stopped. |
| 9 | Select lines in a public repo and make them private. Show the blank line in a second window | 15s | Ship the open-source repo with the secret sauce still secret. |
| 10 | Select a range and copy the share link. Open it signed out | 10s | Share some lines, not the repo. |
| 11 | Mirror a GitHub repo, then show the Upstream panel catching up | 12s | Your git keeps going when the other git doesn't. |
| 12 | Terminal: `claude mcp add --transport http codesplitter <url>/api/mcp`, then `codesplitter tools` | 15s | One command hooks it to your AI. |
| 13 | Terminal: `git clone` the repo, push a commit, see it land on the page | 15s | It is real git, on Cloudflare Workers and Artifacts. |
| 14 | Deploy button: the repo's Rusty Buns readiness, then the deploy | 15s | And it ships what you just built. |
| 15 | Hold on the repo link, then the README run instructions | 6s | Repo is `apps/codesplitter`. Run instructions are in the README. |

About 3:30 of screen. The dub adds breathing room, so expect 5 to 7 minutes finished. If you need the contest's 5 to 10 minute cut, hold shots 2, 4, 6 and 8 longer; those carry the 50% and 25% judging weights.

## The idea to land

Agents wait on each other in series: one hits a conflict, spends a round of model calls fixing it, and the next one then conflicts with that fix. A growing share of an increasingly expensive token budget goes to cleaning up merges, not building. It is the agentic version of waterfalling on the client: serial round trips that were never needed. Two layers remove them, and shots 1b, 2b and 6b show each:

- **Sync layer** (shots 4 and 5): edits go over each file's WebSocket, claims queue instead of collide, and a stale edit to a line someone just changed still lands when they changed different words. Most conflicts never form.
- **Mervin** (shot 6b): merges by line id, so a moved block someone else edited or a line added twice settles without a model. Only what is truly ambiguous reaches an agent, and then with the reasons each side changed the file.
- **Line by line** (shot 2): the line id is what makes both possible. Files and diffs can't say what a line is across a move; ids can.

Use the corpus numbers exactly as in [mervin.md](mervin.md) (`bun scripts/mervin-corpus.ts`), and show the token counter from a real run, not a mock: `bun apps/agent-office/ester/dexter.ts` compares tokens and turns.

## Why this order

1. Hook and the line (1 to 3): the originality score is half the judging, so the unit-is-a-line idea comes first.
2. Several agents at once (4 to 8): the live edit, the merge, and the hand-off note are the concurrency and context-preservation points.
3. Things only this can do (9 to 11): private lines, shared ranges, a mirror that survives upstream going down.
4. Ease of use (12 to 15): one command in, real git out, one click to deploy.

## Dubbing

Read the dub lines one at a time against the silent take and leave a beat between them. Where a line runs longer than its hold, freeze the last frame in Audacity's partner editor rather than speeding up. Say "git" once as the foundation and show people never seeing a git error.

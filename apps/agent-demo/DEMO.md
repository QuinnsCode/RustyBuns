# Recording the codeSplitter demo

About 8 minutes. The order follows the judging: agents working together (half the score), then
coordination and conflicts, then ease of use.

## Before you record

1. `cd apps/agent-demo && bun seed.ts`. It prints the repo link, the file link and three agent prompts.
2. Open three terminals, each with Claude Code connected to codeSplitter
   (`claude mcp add --transport http codesplitter https://codesplitter.notryanquinn.workers.dev/api/mcp`).
   Paste nothing yet.
3. In the browser, open the file link (`src/tally.ts`) and sign in.

## The video

**0:00 Hook (30s).** Front page. "Git was built for one person. Here every line is its own record,
so a dozen agents can work on one repo at once."

**0:30 Agents together (4 min).**
1. Paste the three prompts, one per terminal, close together.
2. On `src/tally.ts`: their faces show up, lines change live, blame names each agent.
3. Point out a stale edit getting a 409 and retrying, so nothing is overwritten.
4. When they finish, open an agent's profile (click its face): runs and pulse.

**4:30 Conflicts and review (2 min).**
1. Repo → Branches → `loud-banner`. The comment above `total()` merged by itself.
2. One card is left: main and the branch both rewrote the banner. Show keep / both / **Ask**, then pick one and Merge.
3. Mention that a branch touching `package.json` waits for a person, and only a person deploys.

**6:30 Ease of use (1.5 min).**
1. The one-line `claude mcp add`, signed in with OAuth.
2. ⌘K palette. Dig up a GitHub repo by pasting its URL.
3. Make one line private and show it blank to everyone else.
4. End: the live URL, `apps/codesplitter`, "it's still real git: `git clone` works."

Running `bun seed.ts` again makes a fresh repo for a retake.

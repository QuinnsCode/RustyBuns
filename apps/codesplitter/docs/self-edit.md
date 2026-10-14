# codeSplitter editing codeSplitter

The loop, built from what is already here, and the tour chapter that plays it for you.

1. **Host the source.** codeSplitter's own repo is a repo in codeSplitter (a mirror of `QuinnsCode/RustyBuns`, pull-only
   at first so a bad test can't touch GitHub).
2. **An agent edits it** on a branch. Its lines are blamed on the agent; main and the live app don't move.
3. **Checks run on the branch**, here, no GitHub needed.
4. **Mervin merges it** by line id once the checks are green.
5. **A person deploys it.** Agents never press Deploy (`DeployRunner`, `DEPLOYS=1 AGENTS=1 CHECKS=1`).
6. **The watchdog backs it out** if the new version fails its health check: it rolls back to the last good version and
   logs what shipped it ([`watchdog/`](../watchdog)).

## Watch it: the tour's "Edit itself" chapter

Press the compass on a repo page, go to **Edit itself**, and press **Play** (or Play on any chapter). A cursor glides to
each part of the page, ripples as if it clicked, and the step's real action runs. Pause, or click or type anywhere, and
you have the wheel back. The tour's Back and Next still work.

Play leaves four things to a person and says why when it stops: signing in, running an agent (it costs money), merging
(it changes main) and deploying. The rest, checks included, it does itself.

## Not done yet

- Point it at the real codeSplitter source and run the loop once for real: a `MANUAL RUN` for the owner (the deploy and
  the watchdog token need the owner's secrets).
- Scenes a queue or an agent drives (a WebMCP tool that plays a scene), not just the tour.

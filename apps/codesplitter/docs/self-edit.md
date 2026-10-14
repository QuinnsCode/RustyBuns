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

## Scenes: a person, a queue or an agent

Each tour chapter is a scene, and its steps are data (a target, what it says, the real action). Three things drive one,
through the same steps and the same rule that sign-in, running an agent, merging and deploying stay a person's:

- **A person**: Back, Next, Play.
- **A queue**: the card's Queue button (or shift-click) turns the chapter icons into "play this next" picks, so it works
  from a keyboard or a phone; the palette's "Queue a scene…" does the same. "Up next" shows the queue and ✕ clears it.
- **An agent**: the WebMCP tools `list_scenes`, `play_scene` (with an optional `queue`; given `owner`/`repo` it opens the
  repo's file page itself) and `scene_step`. The palette's "Play a scene…" starts one too.
- **A slice**: a scene is a chapter (`code`) or some of its steps (`code:2-3`, `code:2`), so an agent can learn one feature. A step glides the
  fake cursor to its target and runs the real action; on a person's step it answers `held` (or `skip: true` moves past).

Reduced motion shortens the cursor's waits and drops the ripple.

## Not done yet

- Point it at the real codeSplitter source and run the loop once for real: a `MANUAL RUN` for the owner (the deploy and
  the watchdog token need the owner's secrets).

// GET /api/openapi.json  the API as OpenAPI 3.1, so an agent outside the browser
// (Claude Code, or a gateway like Executor that turns a spec into tools) can drive
// codeSplitters with a personal API token (tokens.ts). It covers every ⌘K palette
// command (client.html commands()) and the reads each view makes. Operations that
// can't be undone, or ship code, carry `x-codesplitters-risky: true`: a gateway's
// policy should ask a person before it calls them. An agent can sign in with OAuth
// instead of a copied token (the `oauth` scheme, oauth.ts).
//
// Written by hand, next to the routes: a route that changes shape changes here too
// (test/tokens.test.ts checks each operation answers).

import { OAUTH_SCOPES } from "./oauth.ts";

type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str = (description?: string): Schema => ({ type: "string", ...(description && { description }) });
const int = (description?: string): Schema => ({ type: "integer", ...(description && { description }) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description && { description }) });
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema =>
  ({ type: "object", properties, ...(required.length && { required }), ...(description && { description }) });
/** An object whose shape is spelled out in words, not fields: it changes more often than this file would. */
const loose = (description: string): Schema => ({ type: "object", additionalProperties: true, description });

interface Op {
  id: string; summary: string; tag: string; description?: string;
  query?: Record<string, Schema & { required?: boolean }>;
  body?: Schema; ok?: Schema; status?: number;
  /** Needs no token: public reads answer anyone. */
  open?: true;
  /** Can't be undone, or ships code. */
  risky?: true;
}

const repo = "/repos/{owner}/{repo}";
const filePath = { path: { ...str("the file's path in the repo, like src/app.ts"), required: true } };
const onBranch = { branch: str("an open branch's copy of the file, instead of main's") };

/** Every operation, by path and method. Path parameters are in {braces}. */
const OPS: Record<string, Record<string, Op>> = {
  "/session": { get: { id: "whoami", summary: "Who this token acts as, its scope and when it expires", tag: "Account", ok: obj({ mode: str("token"), user: str(), token: obj({ id: str(), label: str(), scope: str(), expires_at: int("ms") }) }) } },
  "/me": {
    get: { id: "get_me", summary: "Your profile row", tag: "Account", ok: ref("User") },
    put: { id: "update_me", summary: "Change your bio, page HTML, whether your pulse is public, or where git truth lives", tag: "Account", description: "Only the fields you send change.",
      body: obj({ bio: str(), theme_html: str("any HTML and CSS, rendered in a sandbox"), pulse: bool("false: only you see your pulse"),
        git_truth: { type: "string", enum: ["ask", "codesplitters", "artifact", "github"], description: "whose side your mirrors take when they and upstream changed the same lines or upstream rewrote its history: ask (stop and wait, the default), codesplitters (the edits here), artifact (this copy's commits; uncommitted edits still ask) or github (upstream's)" } }), ok: ref("User") },
  },
  "/users/{name}": { get: { id: "get_user", summary: "A profile, a person's or an agent's: its repos you may see, its collections, its following and follower counts, and the stamps it gave and got", tag: "Account", open: true,
    description: "An agent's handle starts agent- (agent-claude). Its profile adds `agent`: the harness, who runs it, the repos it works in, its line edits, its pulse per day and its runs, all from repos you may read.",
    ok: obj({ user: ref("User"), repos: arr(ref("RepoSummary")), playlists: arr(ref("Playlist")),
      following: int("how many people, agents, repos and line ranges it follows that you may see"), followers: int("how many follow it"),
      stamps: obj({ given: arr(ref("Stamp")), got: arr(ref("Stamp")) }),
      agent: loose("an agent's only: {harness, run_by: [{name, runs}], repos, lines, pulse: [{day, runs, lines}], runs: [{id, owner, repo, path, status, started, applied, task?}], run_count}") }) } },
  "/users/{name}/city": { get: { id: "get_city", summary: "A person's code city: a district per public repo, a building per file (height from lines, glow from how lately lines landed, agent from how much agents wrote), and who's in town", tag: "Account", open: true,
    description: "Private repos are never in it. 404 when its owner has switched the public city off, to anyone but them. The postcard is GET /api/users/{name}/city.png.",
    ok: loose("{name, public, districts: [{repo, x, z, size, buildings: [{path, lines, agent, last, glow, x, z, w, h}]}], present: [{who, repo, path, at}], files, lines, visit}") } },
  "/me/city": { put: { id: "set_city", summary: "Switch your public code city off, or back on", tag: "Account", body: obj({ public: { type: "boolean" } }), ok: obj({ public: { type: "boolean" } }) } },
  "/me/following": { get: { id: "list_following", summary: "Everyone and everything you follow: people, agents, repos and line ranges, newest first", tag: "Following",
    description: "A private repo, and lines in one, are listed only while you're its crew.", ok: arr(ref("Follow")) } },
  "/follows": { post: { id: "follow", summary: "Follow a person or an agent (name), a repo (owner, repo), or some lines (owner, repo, path, from, to)", tag: "Following",
    description: "Lines are followed by id, so the follow keeps up as they move. Following what you already follow answers that follow (200). Only the crew can follow a private repo.",
    body: obj({ name: str("a handle, @ optional"), kind: { type: "string", enum: ["user", "agent"], description: "for a name; agent-… names are agents by default" },
      owner: str(), repo: str(), path: str("a file in the repo, to follow lines in it"), from: int("first line number, from 1"), to: int("last line number") }),
    ok: ref("Follow"), status: 201 } },
  "/follows/{id}": { delete: { id: "unfollow", summary: "Stop following something (its follow id, from list_following)", tag: "Following", ok: ref("Ok") } },
  "/me/feed": { get: { id: "feed", summary: "Your home feed: line edits from the people, agents, repos and lines you follow, grouped per person or agent run, with your latest digest", tag: "Following",
    description: "Only repos you may read. Each group has a one-line summary, its files, and its raw events (who, where, how many lines, when; never the text).",
    query: { since: int("ms since the epoch; a week ago by default, 30 days at most") },
    ok: loose("{since, through, follows, groups: [{key, who, run, bot, lines, sets, inserts, deletes, first_at, last_at, files: [{owner, repo, path, lines, after: {people, agents}}], summary, events}], digest}") } },
  "/me/feed/digest": {
    get: { id: "feed_digest", summary: "Your latest feed digest, written by the coding agent you picked", tag: "Following", ok: loose("{harness, status, since, through, text, error, at}, or null") },
    post: { id: "digest_feed", summary: "Have a coding agent digest your feed since the last digest", tag: "Following",
      body: obj({ harness: { type: "string", enum: ["claude", "codex", "pi", "opencode"] }, model: str() }, ["harness"]), ok: loose("the digest, status running"), status: 202 },
  },
  "/users/{name}/pulse": { get: { id: "get_pulse", summary: "A person's or agent's pulse: lines they landed each hour over the last week", tag: "Account", open: true,
    description: "Lines in private repos count only on your own pulse. 404 when they turned their public pulse off.", ok: ref("Pulse") } },
  "/pulse": { get: { id: "list_pulses", summary: "Several pulses at once, for a crew list (off ones left out)", tag: "Account", open: true,
    query: { names: { ...str("up to 50 handles or agent-<harness> names, comma separated"), required: true } }, ok: obj({ pulses: arr(ref("Pulse")) }) } },
  "/jobs": { get: { id: "list_jobs", summary: "Your requests that waited in a rate limit's line this week", tag: "Account", ok: loose("{jobs: [{id, rule, state, place?, eta?, status?, result?}]}") } },
  "/jobs/{id}": { get: { id: "get_job", summary: "A queued request: its place in line, or its answer once it ran", tag: "Account", ok: loose("{id, rule, state, place?, eta?, status?, result?}") } },

  "/search": { get: { id: "search_code", summary: "Search committed code you're allowed to see", tag: "Search", open: true,
    query: { q: { ...str("words to look for"), required: true } },
    ok: arr(obj({ owner: str(), repo: str(), path: str(), snippet: str("matches marked «like this»") })) } },

  "/levels": { get: { id: "list_levels", summary: "Every level (an imported open-source repo) and whether it's ready", tag: "Levels", open: true, ok: arr(loose("{slug, title, repo, status, …}")) } },
  "/levels/{slug}/tree": { get: { id: "list_level_files", summary: "A level folder's files and folders", tag: "Levels", open: true,
    query: { path: str("folder, empty for the root") }, ok: ref("Tree") } },
  "/levels/{slug}/file": { get: { id: "read_level_file", summary: "A level file's text (read-only: fork the level to edit it)", tag: "Levels", open: true,
    query: { path: { ...str(), required: true } }, ok: obj({ text: str() }) } },
  "/levels/{slug}/fork": { post: { id: "fork_level", summary: "Fork a level: your own writable repo, with its history", tag: "Levels",
    body: obj({ name: str("your repo's name; the level's slug by default") }), ok: obj({ owner: str(), name: str() }), status: 201 } },

  "/repos": { post: { id: "create_repo", summary: "Make an empty repo", tag: "Repos",
    body: obj({ name: str("lowercase letters and digits, single dashes between"), visibility: { type: "string", enum: ["public", "private"] } }, ["name"]),
    ok: obj({ owner: str(), name: str(), visibility: str() }), status: 201 } },
  [repo]: {
    get: { id: "get_repo", summary: "A repo: visibility, crew, whether you can write, and a git clone command with an hour-long read token", tag: "Repos", open: true, ok: ref("Repo") },
    put: { id: "set_repo_visibility", summary: "Make a repo public or private (owner only)", tag: "Repos",
      body: obj({ visibility: { type: "string", enum: ["public", "private"] } }, ["visibility"]), ok: obj({ visibility: str() }) },
    delete: { id: "delete_repo", summary: "Delete a repo and everything of it here, for good (owner only)", tag: "Repos", risky: true,
      description: "Its files, branches, cuts, shares, logs and git. GitHub never hears, and a stack it deployed stays up.",
      query: { confirm: { ...str("the repo's name again"), required: true } }, ok: obj({ deleted: str() }) },
  },
  [`${repo}/tree`]: { get: { id: "list_files", summary: "A repo folder's files and folders", tag: "Files", open: true,
    query: { path: str("folder, empty for the root") }, ok: ref("Tree") } },
  [`${repo}/files`]: { post: { id: "add_file", summary: "Add a file (the crew)", tag: "Files",
    body: obj({ path: str(), content: str(), branch: str("add it on this open branch instead of main") }, ["path"]), ok: obj({ path: str() }), status: 201 } },
  [`${repo}/do/file`]: { get: { id: "read_file", summary: "A file's lines, each with its id, who last wrote it, and the rev it was written at", tag: "Files", open: true,
    description: "Line ids stay put while lines move, so edits address them. Private lines are blank unless you're crew.",
    query: { ...filePath, ...onBranch }, ok: ref("Doc") } },
  [`${repo}/do/at`]: { get: { id: "read_file_at", summary: "Time travel: the file as it was at a rev, with blame per line", tag: "Files", open: true,
    query: { ...filePath, ...onBranch, rev: { ...int("the edit to stop at"), required: true } }, ok: ref("Doc") } },
  [`${repo}/do/log`]: { get: { id: "file_log", summary: "Every edit to a file since a rev", tag: "Files", open: true,
    query: { ...filePath, ...onBranch, since: int("0 for all") }, ok: arr(ref("Applied")) } },
  [`${repo}/do/ops`]: { post: { id: "edit_lines", summary: "Edit a file's lines: insert, set and delete by line id, all or nothing (the crew)", tag: "Files",
    description: "Each set or delete names the line's rev as `base`; if it moved on, the batch is a 409 with its conflicts. `ifRev` pins the batch to the whole file's rev.",
    query: { ...filePath, ...onBranch }, body: obj({ ops: arr(ref("LineOp")), ifRev: int() }, ["ops"]),
    ok: obj({ rev: int(), applied: arr(ref("Applied")) }) } },
  [`${repo}/do/commits`]: { get: { id: "file_commits", summary: "A file's commits, newest first", tag: "Files", open: true, query: { ...filePath, ...onBranch }, ok: arr(ref("Commit")) } },
  [`${repo}/do/commit`]: { post: { id: "commit_file", summary: "Commit a file on main and push it to the repo's git (the crew)", tag: "Files", risky: true,
    description: "A real git commit; if the owner turned on deploy on commit, it ships too.",
    query: filePath, body: obj({ message: str() }), ok: { allOf: [ref("Commit"), obj({ git: loose("{commit, parent} or {error}") })] } } },
  [`${repo}/do/private`]: {
    get: { id: "private_lines", summary: "The ids of a file's private lines", tag: "Files", open: true, query: filePath, ok: arr(str()) },
    post: { id: "set_private_lines", summary: "Hide lines from everyone but the crew, git included, or show them again (the crew)", tag: "Files",
      query: filePath, body: obj({ lines: arr(str("line id")), private: bool() }, ["lines", "private"]), ok: arr(str()) },
  },
  [`${repo}/shares`]: { post: { id: "share_lines", summary: "A live link to some lines, even from a private repo", tag: "Sharing",
    body: obj({ path: str(), from: int("first line number, from 1"), to: int("last line number"), note: str() }, ["path", "from", "to"]),
    ok: obj({ id: str("open it at /#/s/{id}"), from: int(), to: int() }), status: 201 } },
  "/shares/{id}": {
    get: { id: "get_share", summary: "Shared lines as they are now", tag: "Sharing", open: true, ok: loose("{id, owner, repo, path, note, by, from, to, lines: [{id, n, text, by, rev, private?}], gone?}") },
    delete: { id: "delete_share", summary: "Revoke a share (whoever shared it, or the repo's owner)", tag: "Sharing", ok: ref("Ok") },
  },
  [`${repo}/stamps`]: {
    get: { id: "list_stamps", summary: "A file's stamps, line by line", tag: "Sharing", open: true, query: filePath,
      ok: arr(obj({ line: str("line id"), n: int("line number now"), stamps: loose("{stamp: [who stamped it]}") })) },
    post: { id: "stamp_lines", summary: "Stamp lines, a person's or an agent's: a reaction that follows each line by id", tag: "Sharing",
      body: obj({ path: str(), stamp: { type: "string", enum: ["+1", "heart", "binoculars", "shovel", "gem", "skull", "lgtm"] }, lines: arr(str("line id")), from: int("or the first line number"), to: int("the last line number") }, ["path", "stamp"]),
      ok: obj({ stamp: str(), lines: arr(str()) }), status: 201 },
    delete: { id: "unstamp_line", summary: "Take your stamp off a line", tag: "Sharing",
      query: { ...filePath, line: { ...str("line id"), required: true }, stamp: { ...str(), required: true } }, ok: ref("Ok") },
  },
  [`${repo}/cuts`]: { post: { id: "cut_lines", summary: "Cut some lines and what they use out of the repo, as a branch to run and merge back (the crew)", tag: "Cuts",
    body: obj({ pieces: arr(obj({ path: str(), from: int(), to: int() }, ["path", "from", "to"])), note: str() }, ["pieces"]),
    ok: obj({ id: str(), branch: str(), files: arr(obj({ path: str(), lines: int(), pulled: bool() })) }), status: 201 } },
  "/cuts/{id}": { get: { id: "get_cut", summary: "A cut: its files, each line with where it came from on main, and its last test run", tag: "Cuts", open: true,
    ok: loose("{id, owner, repo, branch, note, paths, files: [{path, lines: [{id, text, by, rev, n}]}], run, can_run}") } },
  "/cuts/{id}/run": { post: { id: "run_cut", summary: "Run bun test on a cut (the repo's owner)", tag: "Cuts", ok: loose("{code, out, report?}") } },
  [`${repo}/collaborators`]: { post: { id: "invite", summary: "Add someone, or an agent, who already has a handle straight to the crew (owner only)", tag: "Repos",
    body: obj({ name: str("their handle") }, ["name"]), ok: ref("Ok") } },
  [`${repo}/collaborators/{name}`]: { delete: { id: "remove_collaborator", summary: "Take someone out of the crew; the lines they wrote stay theirs (owner only)", tag: "Repos", ok: ref("Ok") } },
  [`${repo}/invites`]: {
    get: { id: "list_invites", summary: "A repo's pending invites (owner only)", tag: "Invites", ok: arr(ref("Invite")) },
    post: { id: "create_invite", summary: "Invite someone to the crew by handle, by email, or with a bare link to pass on (owner only)", tag: "Invites",
      description: "Give a handle or an email, or neither for a bare link. Only a bare link lets an agent in. The link works once, for 7 days unless days says otherwise; an email invite is mailed when the site sends mail.",
      body: obj({ handle: str(), email: str(), note: str("shown on the invite"), days: int("1 to 30") }), ok: ref("Invite"), status: 201 },
  },
  [`${repo}/invites/{token}`]: { delete: { id: "revoke_invite", summary: "Revoke a pending invite (owner only)", tag: "Invites", ok: ref("Ok") } },
  "/invites": { get: { id: "my_invites", summary: "Pending invites to your handle, with their links", tag: "Invites", ok: arr(ref("Invite")) } },
  "/invites/{token}": { get: { id: "get_invite", summary: "An invite: the repo, who invited and their note, and which doors it opens", tag: "Invites", open: true,
    ok: loose("{owner, repo, visibility, by, note, kind, for, emailed, expires_at, doors, you?, member?}") } },
  "/invites/claim": { post: { id: "claim_invite", summary: "Claim an invite link: join the crew as yourself, or as a new agent with its own handle and token", tag: "Invites",
    description: "Someone pasted you a codeSplitters invite link (…/invite/csi_…)? Pass it as invite. as: agent makes you a handle of your own (agent-<name>-xxxx) and a write API token, shown once, with the line that connects your harness's MCP client as that agent: use it, so your lines are blamed on you. as: person joins as whoever this token is.",
    body: obj({ invite: str("the invite link, or its csi_… token"), as: { type: "string", enum: ["agent", "person"] }, name: str("an agent's handle's middle part, like linter"), harness: { type: "string", enum: ["claude", "codex", "pi", "opencode"] } }, ["invite", "as"]),
    ok: loose("{owner, repo, url, joined, door, and for a new agent: token, expires_at, mcp: {claude, codex, pi, opencode}, next}"), status: 201 } },
  [`${repo}/branches`]: {
    get: { id: "list_branches", summary: "A repo's branches", tag: "Branches", open: true, ok: arr(ref("Branch")) },
    post: { id: "start_branch", summary: "Open a branch: edit its files with ?branch=, then merge it (the crew)", tag: "Branches",
      body: obj({ name: str() }, ["name"]), ok: ref("Branch"), status: 201 },
  },
  [`${repo}/branches/{branch}`]: { get: { id: "review_branch", summary: "A branch's review: each file's ops against main now, and its conflicts", tag: "Branches", open: true,
    ok: loose("the branch row, plus {deploys, files: [{path, merged, build, deleted?, ops, conflicts, lines?}]}") } },
  [`${repo}/branches/{branch}/files`]: { delete: { id: "delete_branch_file", summary: "Delete a file on a branch: merging the branch deletes it from main (the crew)", tag: "Branches",
    description: "Making the file again on the branch (add_file with branch) brings it back.",
    query: { path: { ...str(), required: true } }, ok: obj({ path: str(), branch: str(), deleted: bool() }) } },
  [`${repo}/checks`]: {
    get: { id: "checks", summary: "A ref's check runs, ours and GitHub Actions', and whether a merge may go", tag: "Checks", open: true,
      description: "Like `gh pr checks`: the newest run of each name on the ref's latest sha. gate.ok false means merging waits: on gate.waiting, or for gate.failed to be fixed. While GitHub is down (offline), required checks only GitHub runs are deferred once our own have passed.",
      query: { ref: str("main or a branch's name; main by default") },
      ok: obj({ ref: str(), sha: { type: ["string", "null"] }, where: { type: ["string", "null"] }, runs: arr(ref("CheckRun")),
        here: bool("whether our own checks run"), offline: bool("the mirror can't reach GitHub"),
        gate: obj({ required: arr(str("the ones this ref needs")), ok: bool(), passed: arr(str()), waiting: arr(str()), failed: arr(str()), deferred: arr(str("GitHub's, put off while it's down")),
          skipped: arr(str("required checks scoped to paths this branch doesn't touch")) }) }) },
    post: { id: "record_check", summary: "Record a check run, by hand or from a runner (the crew)", tag: "Checks",
      body: obj({ ref: str(), sha: str(), name: str(), runner: { type: "string", enum: ["desktop", "container", "github", "external"] }, status: ref("CheckStatus"), url: str() }, ["ref", "sha", "name"]),
      ok: ref("CheckRun"), status: 201 },
  },
  [`${repo}/checks/run`]: { post: { id: "run_checks", summary: "Queue our own checks on main or an open branch as it is now, whatever the setting (the crew)", tag: "Checks",
    body: obj({ ref: str("main by default") }), ok: loose("the ref's checks, as `checks` answers"), status: 202 } },
  [`${repo}/checks/github`]: { post: { id: "import_github_checks", summary: "Fetch GitHub's results for the shas sent up, now (the crew)", tag: "Checks",
    body: obj({ ref: str("just this ref's") }), ok: loose("{polled: [{sha, imported, done} or {error}]}") } },
  [`${repo}/checks/claim`]: { post: { id: "claim_check", summary: "A runner of your own takes the oldest queued check run (the crew)", tag: "Checks",
    description: "Marks it running for runner_label and answers {id, ref, sha, name, clone_url, command?, stale_after_s}, or 204 when nothing's queued. Report with update_check, passing runner_label: each call is a heartbeat, and a run quiet for stale_after_s goes back in the queue.",
    body: obj({ runner_label: str("what this runner calls itself"), names: arr(str("only these checks")) }, ["runner_label"]),
    ok: obj({ id: int(), ref: str(), sha: str(), name: str(), clone_url: { type: ["string", "null"] }, command: str("the check's command, when its setting has one"), stale_after_s: int() }) } },
  [`${repo}/checks/settings`]: {
    get: { id: "check_settings", summary: "Where a repo's checks run, and which ones a merge waits on", tag: "Checks", open: true, ok: ref("CheckSettings") },
    put: { id: "set_check_settings", summary: "Set where checks run, which are required, and whether ours go to GitHub (owner only)", tag: "Checks",
      body: obj({ where: { type: ["string", "null"], enum: ["here", "github", "both", null] }, required: arr(ref("RequiredCheck")), post_statuses: bool() }), ok: ref("CheckSettings") },
  },
  [`${repo}/checks/tokens`]: {
    get: { id: "list_ci_tokens", summary: "The repo's CI tokens, without their secrets (owner only)", tag: "Checks", ok: arr(ref("CiToken")) },
    post: { id: "create_ci_token", summary: "Make a CI token for external CI to report checks with (owner only)", tag: "Checks",
      description: "Set the CI's GitHub API base URL to /api/gh/v3 on this site and give it this token as its GitHub token: its commit statuses and check runs land in the repo's checks as external runs, labelled with the token's label. It reaches this repo's checks and nothing else. The secret is in this answer only. At most 20 a repo.",
      body: obj({ label: str("which CI it's for, like jenkins") }, ["label"]), ok: obj({ id: str(), label: str(), last4: str(), created_by: str(), created_at: int("ms"), token: str("the secret, shown this once") }), status: 201 },
  },
  [`${repo}/checks/tokens/{id}`]: { delete: { id: "revoke_ci_token", summary: "Revoke a CI token: the CI's next report is a 401 (owner only)", tag: "Checks", ok: ref("Ok") } },
  [`${repo}/checks/{id}`]: {
    get: { id: "get_check", summary: "One check run, with its log", tag: "Checks", open: true, ok: loose("a check run, plus {log, junit}") },
    put: { id: "update_check", summary: "Report on a check run: its status, its log (the crew, or a runner)", tag: "Checks",
      body: obj({ status: ref("CheckStatus"), log: str("the whole log"), append: str("more log"), junit: str("a JUnit XML report"), runner_label: str("the claimer: a 409 if the run is someone else's now") }), ok: loose("the run") },
  },
  [`${repo}/checks/{id}/cancel`]: { post: { id: "cancel_check", summary: "Stop one of our check runs that's queued or running (the crew)", tag: "Checks", ok: loose("the run") } },
  [`${repo}/branches/{branch}/merge`]: { post: { id: "merge_branch", summary: "Merge a branch into main (the crew)", tag: "Branches", risky: true,
    description: "Conflicts merge nothing (409); settle each conflicting line with `resolve`. A branch that changes build or deploy files needs `build_ok` when commits deploy.",
    body: obj({ resolve: loose("{path: {lineId: \"branch\" | \"main\"}}"), build_ok: bool() }),
    ok: obj({ status: str("merged or open"), merged: arr(obj({ path: str(), rev: int(), ops: int(), deleted: bool() })), conflicts: arr(loose("{path, conflicts}")) }) } },
  [`${repo}/limits`]: { get: { id: "repo_limits", summary: "What this repo and you may do, and how close you are", tag: "Repos", ok: loose("{git, fresh, files, dig, you: [{label, used, max, window_s, on}]}") } },
  [`${repo}/agents`]: {
    get: { id: "list_agent_runs", summary: "A repo's coding-agent runs, newest first (owner only)", tag: "Agents", query: { path: str() }, ok: arr(loose("a run: {id, harness, task, status, …}")) },
    post: { id: "start_agent", summary: "Give a coding agent a task on a file (owner only)", tag: "Agents",
      body: obj({ path: str(), harness: str("one GET /agents lists"), task: str(), model: str() }, ["path", "harness", "task"]), ok: loose("the run"), status: 202 },
  },
  [`${repo}/agents/stop`]: { post: { id: "stop_agents", summary: "Stop running coding agents: by run, file, harness or the lines they claimed (owner only)", tag: "Agents",
    description: "Every filter given must match; with none, every running agent on the repo stops. The CLI is killed (a hosted run's container destroyed within a few seconds), nothing more it does lands, and its claim on lines is lifted.",
    body: obj({ ids: arr(int()), path: str(), harness: str(), lines: arr(str("a line id")) }), ok: obj({ stopped: arr(int()) }) } },
  [`${repo}/agents/{id}/notes`]: { post: { id: "tell_agent", summary: "Tell a running coding agent something, for its next run (owner only)", tag: "Agents",
    description: "A running CLI can't take messages, so the note goes into the prompt of its next run: when this run ends, it goes round again with every note so far (up to 5 extra runs). 409 once the run has ended.",
    body: obj({ text: str() }, ["text"]), ok: loose("the run, with its notes") } },
  "/agents": { get: { id: "list_harnesses", summary: "Which coding-agent harnesses this site can run", tag: "Agents", open: true, ok: loose("{available, why, harnesses, all}") } },
  [`${repo}/deploy`]: {
    get: { id: "deploy_status", summary: "Deploy settings, the run going now, and the last 20 (owner only)", tag: "Deploys", ok: loose("{settings, run, deploys}") },
    post: { id: "deploy", summary: "Deploy the repo now (owner only)", tag: "Deploys", risky: true, ok: loose("{run}"), status: 202 },
  },

  "/playlists": { post: { id: "create_collection", summary: "Start a collection of lines you like", tag: "Collections",
    body: obj({ title: str() }, ["title"]), ok: ref("Playlist"), status: 201 } },
  "/playlists/{id}": { get: { id: "get_collection", summary: "A collection, each track with its lines as they are now", tag: "Collections", open: true, ok: loose("the playlist, plus {tracks: [{owner, repo, path, from_line, to_line, note, lines}]}") } },
  "/playlists/{id}/tracks": { post: { id: "collect_lines", summary: "Add some lines to your collection", tag: "Collections",
    body: obj({ owner: str(), repo: str(), path: str(), from: int(), to: int(), note: str() }, ["owner", "repo", "path", "from", "to"]), ok: ref("Ok"), status: 201 } },
};

const SCHEMAS: Record<string, Schema> = {
  Error: obj({ error: str() }, ["error"]),
  Ok: obj({ ok: bool() }),
  User: obj({ name: str(), bio: str(), theme_html: str(), city_public: int("1 while your code city is public, 0 once you switched it off"), pulse: int("1 when their pulse is public") }),
  Pulse: obj({ name: str(), hours: arr(int()), from: int("ms: the first hour's start; hours[] is 168 counts, oldest first"), total: int(), live_at: { type: ["integer", "null"], description: "ms: the last line they landed" } }),
  RepoSummary: obj({ owner: str(), name: str(), visibility: str(), level: str(), created_at: int("ms"), expires_at: { type: ["integer", "null"], description: "a visitor's dig goes then" } }),
  Repo: obj({ owner: str(), name: str(), visibility: str(), level: str(), branch: str(), upstream: str(), created_at: int(), expires_at: { type: ["integer", "null"] },
    collaborators: arr(str()), canWrite: bool(), clone: { type: ["string", "null"], description: "git clone command, read token good for an hour" }, crewClone: { type: ["string", "null"] }, home: str("local or cloud"), invites: { ...arr(ref("Invite")), description: "pending invites, for the owner only" } }),
  Tree: obj({ commit: { type: ["object", "null"], properties: { hash: str(), message: str() } }, entries: arr(obj({ name: str(), path: str(), type: str("file or dir (blob or tree in a level)") })),
    forking: bool("still being copied: try again shortly"), lost: bool("its git never landed") }),
  Line: obj({ id: str("stable while lines move, like L12"), text: str(), by: str("who last wrote it"), rev: int("the edit that wrote it"), private: bool() }, ["id", "text", "by", "rev"]),
  Doc: obj({ rev: int("edits so far"), nextId: int(), lines: arr(ref("Line")) }, ["rev", "lines"]),
  LineOp: { oneOf: [
    obj({ kind: { const: "insert" }, after: { type: ["string", "null"], description: "line id, null for the top" }, text: str() }, ["kind", "after", "text"]),
    obj({ kind: { const: "set" }, line: str("line id"), base: int("the line's rev you read"), text: str() }, ["kind", "line", "base", "text"]),
    obj({ kind: { const: "delete" }, line: str(), base: int() }, ["kind", "line", "base"]),
  ] },
  Applied: obj({ rev: int(), by: str(), at: int("ms"), op: ref("LineOp"), line: str() }),
  Commit: obj({ n: int(), sha: str(), parent: { type: ["string", "null"] }, rev: int(), by: str(), at: int(), message: str() }),
  Branch: obj({ name: str(), by: str(), status: str("open or merged"), created_at: int(), merged_by: { type: ["string", "null"] }, merged_at: { type: ["integer", "null"] } }),
  Playlist: obj({ id: int(), owner: str(), title: str() }),
  Follow: obj({ id: int("unfollow by this"), kind: { type: "string", enum: ["user", "agent", "repo", "lines"] }, name: str("user or agent: the handle"),
    owner: str(), repo: str(), path: str("lines: the file"), ids: arr(str("lines: every line id in the range when followed")),
    from_line: int("lines: where the range began when followed"), to_line: int(), created_at: int("ms") }, ["id", "kind", "created_at"]),
  Invite: obj({ token: str("csi_…"), link: str("…/invite/csi_…"), kind: str("handle, email or link"), target: { type: ["string", "null"] }, note: str(), by: str(), created_at: int(), expires_at: int(),
    owner: str(), repo: str(), mailed: bool("an email invite: whether it went out") }),
  Stamp: obj({ owner: str(), repo: str(), path: str(), line: str("line id"), stamp: str(), by: str("who stamped it"), author: str("who wrote the line, person or agent"), created_at: int("ms") }),
  CheckStatus: { type: "string", enum: ["queued", "running", "passed", "failed", "cancelled"] },
  CheckRun: obj({ id: int(), ref: str("main or a branch"), sha: str(), name: str(), runner: { type: "string", enum: ["desktop", "container", "github", "external"] }, status: ref("CheckStatus"),
    started_at: { type: ["integer", "null"] }, finished_at: { type: ["integer", "null"] }, url: { type: ["string", "null"], description: "GitHub's page, for an imported job" },
    runner_label: { type: ["string", "null"], description: "the runner that claimed it, or the CI token an external run came in on" }, created_at: int() }),
  CiToken: obj({ id: str(), label: str("which CI it's for"), last4: str("the secret's last four characters"), created_by: str(), created_at: int("ms"), last_used_at: { type: ["integer", "null"], description: "ms, to the minute" } }),
  RequiredCheck: { description: "a check's name (* for all), or one scoped to paths and with a command for our runners", oneOf: [str(), obj({ name: str(), paths: arr(str("a directory, file or glob")), command: str() }, ["name"])] },
  CheckSettings: obj({ where: { type: ["string", "null"], description: "here, github or both; null runs none (a GitHub mirror defaults to github)" }, required: arr(obj({ name: str(), paths: arr(str()), command: str() }, ["name"])), post_statuses: bool(), github: { type: ["string", "null"], description: "owner/name, when the repo mirrors GitHub" },
    offline: bool("the mirror can't reach GitHub right now"), down_since: { type: ["integer", "null"] }, here: bool("whether our own checks run: asked for, or in GitHub's place while it's down") }),
};

const params = (path: string, query: Op["query"] = {}) => [
  ...[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: "path", required: true, schema: str() })),
  ...Object.entries(query).map(([name, { required, ...schema }]) => ({ name, in: "query", ...(required && { required }), schema })),
];
const err = (description: string) => ({ description, content: { "application/json": { schema: ref("Error") } } });

/** The spec, with this origin as its server. */
export function openapi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, methods] of Object.entries(OPS)) {
    paths[path] = {};
    for (const [method, o] of Object.entries(methods)) {
      paths[path][method] = {
        operationId: o.id, summary: o.summary, tags: [o.tag], ...(o.description && { description: o.description }),
        parameters: params(path, o.query),
        ...(o.body && { requestBody: { required: true, content: { "application/json": { schema: o.body } } } }),
        // Public reads answer without a token too; a token still sees what its owner may.
        security: [...(o.open ? [{}] : []), { token: [] }, { oauth: [method === "get" ? "read" : "write"] }],
        "x-codesplitters-scope": method === "get" ? "read" : "write",
        ...(o.risky && { "x-codesplitters-risky": true }),
        responses: {
          [String(o.status ?? 200)]: { description: "OK", content: { "application/json": { schema: o.ok ?? ref("Ok") } } },
          400: err("bad input"), 401: err("no token, or it's expired or revoked"), 403: err("not yours to do, or the token is read-only"),
          404: err("not found, or private and not yours"), 409: err("conflicts, or it already exists"), 429: err("over a rate limit: retry after the retry-after header"),
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "codeSplitters",
      version: "1",
      description: "A code host where every line is its own record. Make a personal API token on your profile page and send it as `Authorization: Bearer cst_…`: "
        + "it acts as you, counts against your rate limits, and expires. read tokens make GET requests only. Tokens never reach admin routes, sign-in, or token management. "
        + "Or sign in with OAuth (authorization code with PKCE; public clients, so no secret): an app on your own computer may use any client_id with a http://127.0.0.1 or localhost redirect, anything else registers at /api/oauth/register first. "
        + "Operations marked `x-codesplitters-risky` can't be undone or ship code: ask a person before calling them.",
    },
    servers: [{ url: `${origin}/api` }],
    components: {
      schemas: SCHEMAS,
      securitySchemes: {
        token: { type: "http", scheme: "bearer", description: "a personal API token from your profile page (cst_…)" },
        oauth: {
          type: "oauth2", description: "sign in on codeSplitters; access tokens last an hour, refresh tokens rotate, and you can revoke the app from your profile page",
          flows: { authorizationCode: { authorizationUrl: `${origin}/api/oauth/authorize`, tokenUrl: `${origin}/api/oauth/token`, refreshUrl: `${origin}/api/oauth/token`, scopes: OAUTH_SCOPES } },
        },
      },
    },
    security: [{ token: [] }, { oauth: ["read"] }],
    paths,
  };
}

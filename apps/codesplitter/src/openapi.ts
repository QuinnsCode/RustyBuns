// Layout: `GET /api/openapi.json`, the API for outside agents
// GET /api/openapi.json  the API as OpenAPI 3.1, so an agent outside the browser
// (Claude Code, or a gateway like Executor that turns a spec into tools) can drive
// codeSplitter with a personal API token (tokens.ts). It covers every ⌘K palette
// command (client.html commands()) and the reads each view makes. Operations that
// change who can get in or see what (tokens, invites, the crew, visibility, private
// lines, shares), can't be undone, or ship code carry `x-codesplitter-risky: true`:
// a gateway's policy should ask a person before it calls them. That's advice: the
// server's own checks are what hold. An agent can sign in with OAuth
// instead of a copied token (the `oauth` scheme, oauth.ts).
//
// Written by hand, next to the routes: a route that changes shape changes here too
// (test/tokens.test.ts checks each operation answers). It imports nothing, so the docs
// site (scripts/site/codesplitter.ts) can load it from any version and render its pages.

/** What an OAuth app may ask for (oauth.ts). */
export const OAUTH_SCOPES = { read: "read what you can read", write: "read, and change what you can change" } as const;

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
  /** Changes who can get in or see what, can't be undone, or ships code. */
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
      body: obj({ bio: str(), theme_html: str("any HTML and CSS, rendered in a sandbox"), pulse: bool("false: only you see your pulse"), avatar: { description: "your avatar: {skin, hair, hairColor, hat, eyes, mouth, glasses, top, topColor, bottomColor, build}, colors #rrggbb, the rest one of src/avatar.ts PARTS; null takes it off" },
        git_truth: { type: "string", enum: ["ask", "codesplitter", "artifact", "github"], description: "whose side your mirrors take when they and upstream changed the same lines or upstream rewrote its history: ask (stop and wait, the default), codesplitter (the edits here), artifact (this copy's commits; uncommitted edits still ask) or github (upstream's)" } }), ok: ref("User") },
  },
  "/users/{name}": { get: { id: "get_user", summary: "A profile, a person's or an agent's: its repos you may see, its collections, its following and follower counts, and the stamps it gave and got", tag: "Account", open: true,
    description: "An agent's handle starts agent- (agent-claude). Its profile adds `agent`: the harness, who runs it, the repos it works in, its line edits, its pulse per day and its runs, all from repos you may read.",
    ok: obj({ user: ref("User"), repos: arr(ref("RepoSummary")), playlists: arr(ref("Playlist")),
      following: int("how many people, agents, repos and line ranges it follows that you may see"), followers: int("how many follow it"),
      stamps: obj({ given: arr(ref("Stamp")), got: arr(ref("Stamp")) }),
      agent: loose("an agent's only: {harness, run_by: [{name, runs}], repos, lines, pulse: [{day, runs, lines}], runs: [{id, owner, repo, path, status, started, applied, task?}], run_count}") }) } },
  "/users/{name}/city": { get: { id: "get_city", summary: "A person's code city: a district per public repo, a building per file (height from lines, glow from how lately lines landed, agent from how much agents wrote), and who's in town", tag: "Account", open: true,
    description: "Private repos are never in it. Each district carries its pulse: its week of commits and edits (bustle, 0-1, how busy its streets are) and its check runs (failing now, and chaos, 0-1, how wild its traffic is). 404 when its owner has switched the public city off, to anyone but them. The postcard is GET /api/users/{name}/city.png.",
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
      description: "On the hosted site this runs on the site's API keys, so only its admins may (403 otherwise).",
      body: obj({ harness: { type: "string", enum: ["claude", "codex", "pi", "opencode"] }, model: str() }, ["harness"]), ok: loose("the digest, status running"), status: 202 },
  },
  "/users/{name}/pulse": { get: { id: "get_pulse", summary: "A person's or agent's pulse: lines they landed each hour over the last week", tag: "Account", open: true,
    description: "Lines in private repos count only on your own pulse. 404 when they turned their public pulse off.", ok: ref("Pulse") } },
  "/pulse": { get: { id: "list_pulses", summary: "Several pulses at once, for a crew list (off ones left out)", tag: "Account", open: true,
    query: { names: { ...str("up to 50 handles or agent-<harness> names, comma separated"), required: true } }, ok: obj({ pulses: arr(ref("Pulse")) }) } },
  "/jobs": { get: { id: "list_jobs", summary: "Your requests that waited in a rate limit's line this week", tag: "Account", ok: loose("{jobs: [{id, rule, state, place?, eta?, status?, result?}]}") } },
  "/jobs/{id}": { get: { id: "get_job", summary: "A queued request: its place in line, or its answer once it ran", tag: "Account", ok: loose("{id, rule, state, place?, eta?, status?, result?}") } },

  "/search": { get: { id: "search_code", summary: "Search committed code you're allowed to see", tag: "Search", open: true,
    query: { q: { ...str("words to look for"), required: true }, repo: str("owner/name: search just this repo (else your repos first, then the 50 most recently committed)") },
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
    put: { id: "set_repo_visibility", summary: "Make a repo public or private (owner only)", tag: "Repos", risky: true,
      body: obj({ visibility: { type: "string", enum: ["public", "private"] } }, ["visibility"]), ok: obj({ visibility: str() }) },
    delete: { id: "delete_repo", summary: "Delete a repo and everything of it here, for good (owner only)", tag: "Repos", risky: true,
      description: "Its files, branches, cuts, shares, logs and git. GitHub never hears, and a stack it deployed stays up.",
      query: { confirm: { ...str("the repo's name again"), required: true } }, ok: obj({ deleted: str() }) },
  },
  [`${repo}/tree`]: { get: { id: "list_files", summary: "A repo folder's files and folders", tag: "Files", open: true,
    query: { path: str("folder, empty for the root") }, ok: ref("Tree") } },
  [`${repo}/share`]: { get: { id: "share_repo", summary: "A git clone command with a read token that lasts a day, to hand to someone", tag: "Repos", open: true,
    query: { branch: str("clone just this branch"), ttl: { type: "integer", description: "seconds the token lasts: a day by default, a week at most" } },
    ok: obj({ command: str(), ttl: int(), expiresAt: int(), branch: str() }) } },
  [`${repo}/graph`]: { get: { id: "commit_graph", summary: "The commit graph: main's commits newest first, with the branches merged into them", tag: "Repos", open: true,
    description: "Each merge is followed by the commits of the branch it took in (they carry `side`: the merge), walked back until they meet main. `up` is true for a commit in upstream's history, false for one made in this copy.",
    query: { limit: int("how many of main's commits, default 60, up to 200") },
    ok: obj({ branch: str(), upstream: { type: ["string", "null"], description: "the upstream commit this repo last took" }, more: bool("main goes back further"),
      commits: arr(obj({ hash: str(), parents: arr(str()), message: str("the first line"), author: str(), at: int("ms"), up: bool(), side: str("the merge this branch commit lands in") })) }) } },
  [`${repo}/gitpath`]: { get: { id: "gitpath_data", summary: "gitpath's data: a file's commits with line counts and parents, or the repo's busiest files", tag: "Repos", open: true,
    description: "With `path`: of main's last `limit` commits (and the side branches merged into them), the ones that changed that file, newest first. `added` and `removed` are its lines (0 for a file too big or not text), and `parents` are the nearest earlier commits that changed the file too, so a branch that merged shows as a fork and a join. The file is followed by its path: a rename starts a new history. Without `path`: the files changed most often in main's last `limit` commits (a commit that changes hundreds of files, and lockfiles, don't count).",
    query: { path: str("the file, for its history; leave out for the busiest files"), limit: int("how many of main's commits to read: default 100 with a path, 60 without, up to 200") },
    ok: obj({ repo: str("owner/name"), branch: str(), path: str(), more: bool("main goes back further than limit"),
      commits: arr(obj({ hash: str(), author: str(), date: str("ISO 8601"), subject: str(), added: int(), removed: int(), parents: arr(str()), refs: arr(str("branch names, main's tip commit only")) })),
      files: arr(obj({ path: str(), commits: int() })) }) } },
  [`${repo}/tags`]: {
    get: { id: "list_tags", summary: "A repo's tags, each with the commit it names", tag: "Repos", open: true,
      description: "Version tags first, the highest first, then the rest by name. An annotated tag names the commit it points at.",
      ok: obj({ tags: arr(obj({ name: str(), commit: str() })) }) },
    post: { id: "make_tag", risky: true, summary: "Tag a commit (owner only)", tag: "Repos",
      description: "A lightweight tag: main's tip, or `commit`. A name that's taken is a 409; delete it first to move it.",
      body: obj({ name: str("git's rule, as for a branch"), commit: str("a full commit hash; main's tip without it") }, ["name"]), ok: obj({ name: str(), commit: str() }), status: 201 },
  },
  [`${repo}/git-state`]: { get: { id: "get_git_state", summary: "Where the repo's git stands: mirror, push, pull, uncommitted files, clashes", tag: "Repos", open: true,
    description: "What the git bar on the repo page shows, in one answer: the mirror's state and how far ahead or behind it is, files committed here that git hasn't taken yet, files with edits no commit has taken, and any mirror or push clash.",
    ok: obj({ mirror: { description: "null when the repo isn't mirrored: {url, branch, state, pullOnly, primary, held, ahead, behind, syncedAt, downSince, error}" }, dug: { description: "for a repo dug from GitHub and not mirrored: {moved, behind, heardAt}; else null" },
      uncommitted: obj({ count: int(), files: arr(obj({ path: str(), since: int() })) }), waitingForGit: arr(str()), gitError: { type: ["string", "null"] },
      conflicts: obj({ mirror: { description: "{state, files} on a clash or rewrite; else null" }, push: arr(str()) }) }) } },
  [`${repo}/try`]: {
    get: { id: "get_try", summary: "The current or last Rusty Buns try-out (owner only)", tag: "Repos",
      description: "`can_run` says whether this server can run one (the desktop app can); `run` is the last run's steps (clone, install, init, infra, plan) and their output, or null. `run.infra` is the stack as a graph (`{app, stage, mode, targets, nodes, edges}`), each node with `protected: true` when `protect: true` makes destroy leave it; absent when the repo's Rusty Buns is too old for `rustybuns infra`.",
      ok: obj({ can_run: bool(), run: { description: "the run, or null" } }) },
    post: { id: "start_try", summary: "Try Rusty Buns on the repo or a branch: init, then an offline plan (owner only)", tag: "Repos",
      description: "Desktop only. Clones the repo's git remote, lays the branch's changed files over it, runs `rustybuns init`, `rustybuns infra --json` and `rustybuns plan --offline`. Nothing is deployed. A run already going is a 409.",
      body: obj({ branch: str("an open branch to try; main without it") }), ok: obj({ run: { description: "the run just started" } }), status: 202 },
  },
  [`${repo}/tags/{name}`]: { delete: { id: "delete_tag", risky: true, summary: "Delete a tag (owner only). A mirror's upstream keeps its own", tag: "Repos", ok: ref("Ok") } },
  ...Object.fromEntries((["revert", "pick"] as const).map((k) => [`${repo}/commits/{sha}/${k}`, { post: {
    id: k === "revert" ? "revert_commit" : "cherry_pick", summary: k === "revert" ? "Revert a commit: undo its changes (the crew)" : "Cherry-pick a commit onto main or an open branch (the crew)", tag: "Repos", risky: true,
    description: "Its changes against its first parent are merged into each file's lines as they are now and land as line edits, so the lines it doesn't touch keep their ids and blame. " +
      "On main the files are committed as one git commit; on a branch they wait for its merge. A file whose lines changed since, deleted or made since, or a binary one: 409 with `clashes`, and nothing lands.",
    body: obj({ branch: str("an open branch to land it on instead of main") }),
    ok: obj({ kind: str("revert or pick"), commit: str(), branch: str(), message: str("the commit message, as git writes it"), files: arr(obj({ path: str(), did: str("edit, make or delete") })), git: loose("main's git commit") }),
  } }])),
  [`${repo}/files`]: { post: { id: "add_file", summary: "Add a file (the crew)", tag: "Files",
    body: obj({ path: str(), content: str(), branch: str("add it on this open branch instead of main") }, ["path"]), ok: obj({ path: str() }), status: 201 } },
  [`${repo}/do/file`]: { get: { id: "read_file", summary: "A file's lines, each with its id, who last wrote it, and the rev it was written at", tag: "Files", open: true,
    description: "Line ids stay put while lines move, so edits address them. Private lines are blank unless you're crew.",
    query: { ...filePath, ...onBranch, from: int("window the lines: start at this 0-based line (adds `total` and `from` to the answer)"), limit: int("window the lines: at most this many, up to 5,000; leave both out for the whole file") }, ok: ref("Doc") } },
  [`${repo}/do/at`]: { get: { id: "read_file_at", summary: "Time travel: the file as it was at a rev, with blame per line", tag: "Files", open: true,
    query: { ...filePath, ...onBranch, rev: { ...int("the edit to stop at"), required: true } }, ok: ref("Doc") } },
  [`${repo}/do/log`]: { get: { id: "file_log", summary: "A file's edits since a rev, a page at a time", tag: "Files", open: true,
    description: "A page holds up to 1,000 edits; `next` is the rev to pass as `since` for the following page. History reaches back about 20,000 edits (a file whose log predates trimming, from its first snapshot); since a rev before that is a 410 naming the rev it starts at.",
    query: { ...filePath, ...onBranch, since: int("0 for all"), limit: int("at most this many ops, up to and by default 1,000") },
    ok: obj({ ops: arr(ref("Applied")), next: int("pass as since for the next page; null at the end") }) } },
  [`${repo}/do/ops`]: { post: { id: "edit_lines", summary: "Edit a file's lines: insert, set and delete by line id, all or nothing (the crew)", tag: "Files",
    description: "Each set or delete names the line's rev as `base`; if it moved on, the batch is a 409 with its conflicts, unless a set changed other words of the line than the edit since did: then it lands on top of that one. `ifRev` pins the batch to the whole file's rev. "
      + "An agent editing lines it claimed names the claim, which renews it. When someone else holds a line, the 409 also has `claims` (who, task, until) and `retryAfter` (seconds; null for a person's hold, which stands till lifted): "
      + "work elsewhere in the file first, then try those lines again no sooner than retryAfter, or ask a person to lift the claim. Don't poll. "
      + "The path's policy (the review's `live`) can refuse it too, with an `error`: on a `line` file an agent edits only lines it claimed (claim_lines, with wait to get in line), and a `locked` one (lockfiles) takes no live edits or claims: regenerate it or push it.",
    query: { ...filePath, ...onBranch }, body: obj({ ops: arr(ref("LineOp")), ifRev: int(), claim: str("your claim's id, when you're an agent editing lines you claimed") }, ["ops"]),
    ok: obj({ rev: int(), applied: arr(ref("Applied")) }) } },
  [`${repo}/do/claims`]: {
    get: { id: "list_claims", summary: "Who is working on which lines of a file right now", tag: "Files", open: true,
      description: "A claimed line takes edits from its holder only. `until` is when a claim lapses (null: a person's hold, which stands till lifted). A `soft` one is an intent: it keeps nobody off.",
      query: filePath, ok: arr(ref("Claim")) },
    post: { id: "claim_lines", summary: "Claim lines so only you edit them, or renew your claim (the crew)", tag: "Files",
      description: "All or nothing: a 409 names the claims in the way, with `retryAfter` in seconds. An agent's claim is a 2-minute lease: renew it by claiming again with its `id` "
        + "(lines optional), or by editing with `claim`. It can't stand more than 30 minutes in all unless a person sends `extend`, "
        + "and once it ends there (or you release it in its last 2 minutes), you can't claim those lines again for 2 minutes (a 409 with `retryAfter`): work elsewhere. A person's hold stands till lifted. "
        + "Claim before a rewrite, send `claim` with your edits, and release it when you're done. "
        + "`soft: true` only says what you intend (\"rewriting 40–80\"): it's shown and listed, but keeps nobody off, and may overlap others' claims. "
        + "`wait: true` gets in line when the lines are held (or others are already in line for them), first come first, and waits up to `timeout` seconds (20 at most): "
        + "201 with the claim if it's granted meanwhile, else 202 {queued, id, place}: ask again at once with that id and wait to keep your place (a place nobody asks for in a minute is dropped). "
        + "Granted between asks, the lines are yours for 15 seconds: claim again with the id to take them. You can't wait while you hold lines (here or in another file): let go first. release_claim with the id leaves the line. "
        + "Waiting is for when your task needs those lines; otherwise work elsewhere.",
      query: filePath, body: obj({ lines: arr(str("line id")), id: str("your claim's id: to renew it, or to name a new one"), task: str("what you're doing, shown to everyone"),
        ttl: int("ms till it lapses; an agent's defaults to 120000"), extend: bool("a person: give an agent's claim another 30 minutes past its cap"),
        soft: bool("an intent: shown, but it keeps nobody off"), wait: bool("held? get in line for the lines"), timeout: int("with wait: seconds to wait this time, 0 to 20 (default 20)") }), ok: ref("Claim") } },
  [`${repo}/do/release`]: { post: { id: "release_claim", summary: "Let go of a claim, so its lines are free again (the crew)", tag: "Files",
    description: "Release your own claim when you're done, or your place in line. Any of the crew may lift anyone's, which is how a person steers an agent off lines: ask a person before lifting someone else's.",
    query: filePath, body: obj({ id: str("the claim's id") }, ["id"]), ok: obj({ released: bool("false if it had already gone") }) } },
  [`${repo}/do/commits`]: { get: { id: "file_commits", summary: "A file's commits, newest first", tag: "Files", open: true, query: { ...filePath, ...onBranch }, ok: arr(ref("Commit")) } },
  [`${repo}/do/commit`]: { post: { id: "commit_file", summary: "Commit a file on main and push it to the repo's git (the crew)", tag: "Files", risky: true,
    description: "A real git commit; if the owner turned on deploy on commit, it ships too.",
    query: filePath, body: obj({ message: str() }), ok: { allOf: [ref("Commit"), obj({ git: loose("{commit, parent} or {error}") })] } } },
  [`${repo}/do/private`]: {
    get: { id: "private_lines", summary: "The ids of a file's private lines", tag: "Files", open: true, query: filePath, ok: arr(str()) },
    post: { id: "set_private_lines", summary: "Hide lines from everyone but the crew, git included (the crew), or show them again (the owner only)", tag: "Files", risky: true,
      query: filePath, body: obj({ lines: arr(str("line id")), private: bool() }, ["lines", "private"]), ok: arr(str()) },
  },
  [`${repo}/shares`]: { post: { id: "share_lines", risky: true, summary: "A live link to some lines, even from a private repo", tag: "Sharing",
    body: obj({ path: str(), from: int("first line number, from 1"), to: int("last line number"), note: str() }, ["path", "from", "to"]),
    ok: obj({ id: str("open it at /#/s/{id}"), from: int(), to: int() }), status: 201 } },
  "/shares/{id}": {
    get: { id: "get_share", summary: "Shared lines as they are now", tag: "Sharing", open: true, ok: loose("{id, owner, repo, path, note, by, from, to, lines: [{id, n, text, by, rev, private?}], gone?}") },
    delete: { id: "delete_share", summary: "Revoke a share (whoever shared it, or the repo's owner)", tag: "Sharing", risky: true, ok: ref("Ok") },
  },
  [`${repo}/beams`]: {
    get: { id: "list_beams", summary: "A repo's beams; for the crew, the git and codeSplitter branches there are to beam too", tag: "Sharing",
      ok: obj({ beams: arr(ref("BeamSummary")), branches: arr(obj({ name: str(), sha: str(), ahead: int("commits past main") })),
        codesplitter_branches: arr(obj({ name: str(), by: str(), parent: { type: ["string", "null"], description: "the branch it's stacked on" }, files: int("files it has of its own") })), hosted: bool("on the hosted site: only codeSplitter branches, onto main") }) },
    post: { id: "beam_branch", risky: true, summary: "Beam a branch, git or codeSplitter: its work squashed into one clean commit on main (or upstream's tip), its noise left out, as a link and a patch (the crew)", tag: "Sharing",
      description: "An agent hands its work over this way: `kind: \"codesplitter\"` beams a codeSplitter branch, its files as they are now on main's tip; one stacked on another is a commit per branch, the one under it first (`stack`). On the hosted site codeSplitter is the only kind (the default there), onto main only: git branches and upstream need the desktop app's git (501). Lockfiles from another package manager, lockfile churn with no package.json change, installed packages, build output, OS and editor leftovers and env files are left out, each with why; `keep` and `drop` override. Nothing is written to GitHub. 409 with `clash` when it doesn't sit cleanly on `onto`, or with `dropped` when nothing's left.",
      body: obj({ branch: str("a git branch in the repo's git, or a codeSplitter branch with `kind`"), kind: { type: "string", enum: ["git", "codesplitter"], description: "which kind of branch `branch` is; git when left out (codesplitter on the hosted site)" }, onto: { type: "string", enum: ["main", "upstream"] }, title: str(), message: str(), to: str("a handle whose inbox it goes in"),
        keep: arr(str("path")), drop: arr(str("path")) }, ["branch"]), ok: ref("Beam"), status: 201 },
  },
  "/beams/{id}": {
    get: { id: "get_beam", summary: "A beam: its message, what it changes, what was left out and why, and its diff", tag: "Sharing", open: true,
      ok: { allOf: [ref("Beam"), obj({ diff: str("git diff, cut at 512 KB"), diff_truncated: bool() })] } },
    delete: { id: "withdraw_beam", summary: "Withdraw a beam (whoever beamed it, or the repo's owner): its commit's ref goes", tag: "Sharing", risky: true, ok: ref("Ok") },
  },
  "/beams/{id}/patch": { get: { id: "beam_patch", summary: "A beam as `git format-patch` writes it, for `git am`", tag: "Sharing", open: true, ok: str("the patch, text/plain") } },
  "/me/beams": { get: { id: "my_beams", summary: "Beams sent to you, and the ones you sent", tag: "Sharing", ok: obj({ to_you: arr(ref("BeamSummary")), yours: arr(ref("BeamSummary")) }) } },
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
  "/cuts/{id}/run": { post: { id: "run_cut", risky: true, summary: "Run bun test on a cut (the repo's owner)", tag: "Cuts", ok: loose("{code, out, report?}") } },
  [`${repo}/audit`]: { get: { id: "repo_audit", summary: "A repo's security audit log, newest first: tokens, crew, invites, visibility, webhooks, deploy keys (owner only)", tag: "Repos", ok: arr(ref("AuditEntry")) } },
  [`${repo}/collaborators`]: { post: { id: "invite", summary: "Add someone, or an agent, who already has a handle straight to the crew (owner only)", tag: "Repos", risky: true,
    body: obj({ name: str("their handle") }, ["name"]), ok: ref("Ok") } },
  [`${repo}/collaborators/{name}`]: { delete: { id: "remove_collaborator", summary: "Take someone out of the crew; the lines they wrote stay theirs (owner only)", tag: "Repos", risky: true, ok: ref("Ok") } },
  [`${repo}/invites`]: {
    get: { id: "list_invites", summary: "A repo's pending invites (owner only)", tag: "Invites", ok: arr(ref("Invite")) },
    post: { id: "create_invite", summary: "Invite someone to the crew by handle, by email, or with a bare link to pass on (owner only)", tag: "Invites", risky: true,
      description: "Give a handle or an email, or neither for a bare link. Only a bare link lets an agent in. The link works once, for 7 days unless days says otherwise; an email invite is mailed when the site sends mail. The link is in this answer only: just its hash is kept.",
      body: obj({ handle: str(), email: str(), note: str("shown on the invite"), days: int("1 to 30") }), ok: ref("Invite"), status: 201 },
  },
  [`${repo}/invites/{id}`]: { delete: { id: "revoke_invite", summary: "Revoke a pending invite (owner only)", tag: "Invites", risky: true, ok: ref("Ok") } },
  "/invites": { get: { id: "my_invites", summary: "Pending invites to your handle: open or claim one by its id", tag: "Invites", ok: arr(ref("Invite")) } },
  "/invites/{token}": { get: { id: "get_invite", summary: "An invite: the repo, who invited and their note, and which doors it opens", tag: "Invites", open: true,
    ok: loose("{owner, repo, visibility, by, note, kind, for, emailed, expires_at, doors, you?, member?}") } },
  "/invites/claim": { post: { id: "claim_invite", risky: true, summary: "Claim an invite link: join the crew as yourself, or as a new agent with its own handle and token", tag: "Invites",
    description: "Someone pasted you a codeSplitter invite link (…/invite/csi_…)? Pass it as invite. as: agent makes you a handle of your own (agent-<name>-xxxx) and a write API token, shown once, with the line that connects your harness's MCP client as that agent: use it, so your lines are blamed on you. as: person joins as whoever this token is.",
    body: obj({ invite: str("the invite link, or its csi_… token"), as: { type: "string", enum: ["agent", "person"] }, name: str("an agent's handle's middle part, like linter"), harness: { type: "string", enum: ["claude", "codex", "pi", "opencode"] } }, ["invite", "as"]),
    ok: loose("{owner, repo, url, joined, door, and for a new agent: token, expires_at, mcp: {claude, codex, pi, opencode}, next}"), status: 201 } },
  [`${repo}/upstream`]: { get: { id: "upstream_status", summary: "Where a fork dug from GitHub stands with its upstream: the commit it's at, upstream's tip, and how many commits behind (asks GitHub when it last did over 10 minutes ago)", tag: "Repos", open: true,
    ok: loose("{listens: false} for a repo that isn't a dug GitHub fork; else {listens, upstream, repo, branch, folder, commit, tip, behind (null when GitHub wouldn't count), heardAt, error?}") } },
  [`${repo}/upstream/hear`]: { post: { id: "hear_upstream", summary: "Ask GitHub now whether a dug fork's upstream moved on (the owner)", tag: "Repos",
    ok: loose("the same as upstream_status") } },
  [`${repo}/upstream/take`]: { post: { id: "take_upstream", risky: true, summary: "Open what upstream changed since the fork's commit as a branch, to review and merge; the fork then stands at upstream's tip (the owner)", tag: "Branches",
    body: obj({ name: str("the branch to open; upstream-<sha> if left out") }),
    ok: loose("{name, from, commit, commits, files, deleted, skipped}: the branch, the upstream commits it spans, and its paths (binary ones are skipped)"), status: 201 } },
  [`${repo}/branches`]: {
    get: { id: "list_branches", summary: "A repo's branches", tag: "Branches", open: true, ok: arr(ref("Branch")) },
    post: { id: "start_branch", summary: "Open a branch, named as git allows (slashes, dots, capitals; no spaces): edit its files with ?branch=, then merge it (the crew)", tag: "Branches",
      description: "With `parent`, it's stacked on that open branch: each file it opens forks from the parent's copy where the parent has one, it can't merge until the parent has, and a beam of it is a commit per branch.",
      body: obj({ name: str(), parent: str("an open branch to stack it on") }, ["name"]), ok: ref("Branch"), status: 201 },
  },
  [`${repo}/branches/{branch}`]: { get: { id: "review_branch", summary: "A branch's review: each file's ops against main now, and its conflicts", tag: "Branches", open: true,
    description: "Each conflict is {line, base, main, branch, choices, suggestion?}: settle it in merge_branch's `resolve` by its `line` with one of its `choices` " +
      "(\"text\" meaning {\"text\": \"...\"}). `suggestion`, where there is one, keeps both sides' words: merge with {\"text\": suggestion} to take it. " +
      "suggest_resolution has a coding agent write one. `policy` is the file's rule from the repo's .gitattributes or the defaults: `live` free, line (claim the lines first) or locked (regenerated, don't edit), `merge` its merge rule, and `leftover` who settles a conflict: ai (a merge asks a checked agent on its own, its `answer` shown with the conflict to the crew), person, or ci (a lockfile made again); `check`, how a merge both sides changed is checked before it lands: lint, or tests (code's default: its tests run on the merged tree, where test_merges is on); `budget`, the tokens an agent run on it may read, and `over`, what happens past that: handoff (a fresh agent from a terse note), escalate (a person) or downshift (a cheaper model). " +
      "`checks`, for the crew, are prose the merge settled on its own that may now be untrue: a stretch both sides changed where git would have stopped, or a line one side wrote stating a number or `name` the other took out of that section; and in code lint can't read (C, Rust, Python, Go and the rest outside JS, TS and HTML), a stretch both sides changed where git would have stopped, which may no longer build. Each is shaped like a conflict, plus `facts`, the numbers and names the sides differ on (none for code). It never blocks the merge; to fix one, merge with {\"text\": ...} on its `line`, or have suggest_resolution check it.",
    ok: loose("the branch row, plus {deploys, files: [{path, merged, build, deleted?, binary?, blob?, policy?: {live, merge, leftover, check, budget, over}, ops, conflicts: [{line, base, main, branch, choices, suggestion?, doubled?, whole?, lint?, answer?}], checks?: [{line, base, main, branch, choices, check, facts}], hunks, lines?}]}; " +
      "hunks are what the branch itself changed since it forked: [{key, at, from, del: [{id, text}], add: [{id, text}], before}]") } },
  [`${repo}/branches/{branch}/hunks/reject`]: { post: { id: "reject_hunk", summary: "Reject one hunk of a branch: its copy of the file reads as it did where the branch forked, there only (the crew)", tag: "Branches",
    description: "Name the hunk by the `key` review_branch lists for it. The rest of the branch stays. A 404 means the hunk changed or went: review again.",
    body: obj({ path: str(), key: str("the hunk's key, as review_branch lists it") }, ["path", "key"]),
    ok: obj({ path: str(), key: str(), rev: int() }) } },
  [`${repo}/branches/{branch}/conflicts/agent`]: { post: { id: "suggest_resolution", summary: "Have a coding agent write the settled text for one conflict; nothing lands (the crew)", tag: "Branches",
    description: "A review's `checks` take it too: the agent fact-checks that settled stretch against both sides' commits. The agent sees the conflict as git's markers, the rest of the file as the merge leaves it, main's commit messages since the branch forked, and, on a branch an agent run made, that run's task, and writes the lines that replace it. Its answer is then checked: the merged file must parse, and, where the owner turned on the doctor's test_merges setting, the tests for that file must pass with it in a throwaway clone. ok false comes with the attempt and the failure, for a person to fix or drop. Merge with resolve {path: {line: {text}}} to take it. Waits for the agent and the tests.",
    body: obj({ path: str(), line: str("the conflict's line, as review_branch lists it"), harness: str("one GET /agents lists"), model: str() }, ["path", "line", "harness"]),
    ok: obj({ path: str(), line: str(), harness: str(), text: str("the settled lines"), ok: bool("it parses and the tests passed (or were skipped)"),
      tests: str("passed, failed, not run, or skipped: why"), failure: str("why the check failed: the parse problems or the test output's end") }) } },
  [`${repo}/branches/{branch}/files`]: { delete: { id: "delete_branch_file", risky: true, summary: "Delete a file on a branch: merging the branch deletes it from main (the crew)", tag: "Branches",
    description: "Making the file again on the branch (add_file with branch) brings it back.",
    query: { path: { ...str(), required: true } }, ok: obj({ path: str(), branch: str(), deleted: bool() }) } },
  [`${repo}/checks`]: {
    get: { id: "checks", summary: "A ref's check runs, ours and GitHub Actions', and whether a merge may go", tag: "Checks", open: true,
      description: "Like `gh pr checks`: the newest run of each name on the ref's latest sha. gate.ok false means merging waits: on gate.waiting, or for gate.failed to be fixed. While GitHub is down (offline), required checks only GitHub runs are deferred once our own have passed. A branch edited since its runs is stale: every required check waits again. " +
        "With self-healing on, a required check failing on a branch starts a fix task there (a coding agent on the failing log): `heal` lists them, and after `max` the branch waits for a person (gave_up).",
      query: { ref: str("main or a branch's name; main by default") },
      ok: obj({ ref: str(), sha: { type: ["string", "null"] }, where: { type: ["string", "null"] }, runs: arr(ref("CheckRun")),
        here: bool("whether our own checks run"), offline: bool("the mirror can't reach GitHub"),
        stale: bool("the branch changed since these runs saw it"), changed_at: { type: ["integer", "null"], description: "when the branch last changed (ms), null on main" },
        gate: obj({ required: arr(str("the ones this ref needs")), ok: bool(), passed: arr(str()), waiting: arr(str()), failed: arr(str()),
          hung: { type: "object", additionalProperties: str(), description: "a failed check that ran out of time: the test file it hung in, from the `::error title=hung::` line in its log (scripts/ci-test-count.ts prints one), or setup" }, deferred: arr(str("GitHub's, put off while it's down")),
          skipped: arr(str("required checks scoped to paths this branch doesn't touch")) }),
        heal: obj({ max: int(), running: bool(), gave_up: bool("its fix tasks are spent: a person's turn"), attempts: arr(loose("{id, path, harness, status, started, why, applied?, error?, also?: the branch's other files it could edit, edited?: those it did}")) }) }) },
    post: { id: "record_check", risky: true, summary: "Record a check run by hand (the crew queues one; only the owner may give it a status past queued)", tag: "Checks",
      body: obj({ ref: str(), sha: str(), name: str(), runner: { type: "string", enum: ["desktop", "container", "github", "external"] }, status: ref("CheckStatus"), url: str() }, ["ref", "sha", "name"]),
      ok: ref("CheckRun"), status: 201 },
  },
  [`${repo}/checks/run`]: { post: { id: "run_checks", summary: "Queue our own checks on main or an open branch as it is now, whatever the setting (the crew)", tag: "Checks",
    body: obj({ ref: str("main by default") }), ok: loose("the ref's checks, as `checks` answers"), status: 202 } },
  [`${repo}/checks/github`]: { post: { id: "import_github_checks", summary: "Fetch GitHub's results for the shas sent up, now (the crew)", tag: "Checks",
    body: obj({ ref: str("just this ref's") }), ok: loose("{polled: [{sha, imported, done} or {error}]}") } },
  [`${repo}/checks/claim`]: { post: { id: "claim_check", summary: "A runner of your own takes the oldest queued check run (the crew)", tag: "Checks",
    description: "Marks it running for runner_label and answers {id, ref, sha, name, clone_url, command?, stale_after_s}, or 204 when nothing's queued. A sha like `<branch>@<time>` is a branch not pushed as a git commit: check out main and write the branch's files over it (scripts/runner.ts does). A run nobody claims in 6 hours is cancelled. Report with update_check, passing runner_label: each call is a heartbeat, and a run quiet for stale_after_s goes back in the queue.",
    body: obj({ runner_label: str("what this runner calls itself"), names: arr(str("only these checks")) }, ["runner_label"]),
    ok: obj({ id: int(), ref: str(), sha: str(), name: str(), clone_url: { type: ["string", "null"] }, command: str("what to run: the required check's command, else the repo's codesplitter.ci or package.json script; none means the runner's default"), stale_after_s: int() }) } },
  [`${repo}/checks/settings`]: {
    get: { id: "check_settings", summary: "Where a repo's checks run, and which ones a merge waits on", tag: "Checks", open: true, ok: ref("CheckSettings") },
    put: { id: "set_check_settings", risky: true, summary: "Set where checks run, which are required, and whether ours go to GitHub (owner only)", tag: "Checks",
      body: obj({ where: { type: ["string", "null"], enum: ["here", "github", "both", null] }, required: arr(ref("RequiredCheck")), post_statuses: bool(), pinned: bool() }), ok: ref("CheckSettings") },
  },
  [`${repo}/protect`]: {
    get: { id: "get_protect_main", summary: "Whether main is protected from the crew and agents", tag: "Repos", open: true, ok: obj({ on: bool() }) },
    put: { id: "set_protect_main", risky: true, summary: "Protect main (owner only)", tag: "Repos",
      description: "On: the crew (people and agents) edit on branches only, an agent's batch waits for a person instead of a timer, and a branch's author can't merge it. The owner's own work on main is untouched.",
      body: obj({ on: bool() }, ["on"]), ok: obj({ on: bool() }) },
  },
  [`${repo}/checks/tokens`]: {
    get: { id: "list_ci_tokens", summary: "The repo's CI tokens, without their secrets (owner only)", tag: "Checks", ok: arr(ref("CiToken")) },
    post: { id: "create_ci_token", summary: "Make a CI token for external CI to report checks with (owner only)", tag: "Checks", risky: true,
      description: "Set the CI's GitHub API base URL to /api/gh/v3 on this site and give it this token as its GitHub token: its commit statuses and check runs land in the repo's checks as external runs, labelled with the token's label. It reaches this repo's checks and nothing else, until it expires. The secret is in this answer only. At most 20 a repo.",
      body: obj({ label: str("which CI it's for, like jenkins"), days: int("how long it lasts, 1 to 365; 90 if left out") }, ["label"]), ok: obj({ id: str(), label: str(), last4: str(), created_by: str(), created_at: int("ms"), expires_at: int("ms"), token: str("the secret, shown this once") }), status: 201 },
  },
  [`${repo}/checks/tokens/{id}`]: { delete: { id: "revoke_ci_token", summary: "Revoke a CI token: the CI's next report is a 401 (owner only)", tag: "Checks", risky: true, ok: ref("Ok") } },
  [`${repo}/checks/{id}`]: {
    get: { id: "get_check", summary: "One check run, with its log", tag: "Checks", open: true, ok: loose("a check run, plus {log, junit}") },
    put: { id: "update_check", risky: true, summary: "Report on a check run: its status, its log (the runner that claimed it, or the owner)", tag: "Checks",
      body: obj({ status: ref("CheckStatus"), log: str("the whole log"), append: str("more log"), junit: str("a JUnit XML report"), runner_label: str("the claimer: a 409 if the run is someone else's now") }), ok: loose("the run") },
  },
  [`${repo}/checks/{id}/cancel`]: { post: { id: "cancel_check", summary: "Stop one of our check runs that's queued or running (the crew)", tag: "Checks", ok: loose("the run") } },
  [`${repo}/branches/{branch}/merge`]: { post: { id: "merge_branch", summary: "Merge a branch into main (the crew)", tag: "Branches", risky: true,
    description: "Conflicts merge nothing (409, with each conflict's choices); settle each one in `resolve` by its line: \"main\", \"branch\", \"both\" (main's first), " +
      "\"both:branch-first\", or {\"text\": \"...\"} (one or more lines, in its place). Lockfiles, doubled config keys and code that won't build take only main or branch. " +
      "A branch that changes build or deploy files needs `build_ok` when commits deploy. With self-healing on, a guard tripping (git's markers, a file that won't parse or build) starts a fix task on the branch, its run id in `fix`. " +
      "Each conflicted file in the 409 says its policy's `leftover` and goes where it says: ci, a lockfile both changed is made again in a throwaway clone from main's and the merged manifests, put on the branch and taken whole (or `note` says why not); " +
      "ai, a checked agent (as suggest_resolution, on the cheapest model, where self-healing runs) answers up to three conflicts a merge on its own, each conflict's `answer` {harness, model?, text?, ok, tests, failure?, round?, note?} kept until the conflict changes: take it with {text} when ok, or fix it as a person. From the branch's third conflict round (a merge asking again about a conflict main moved under), the file's `over` says who answers, from a terse `note` of what the rounds before tried: handoff, the agent on its CLI's own model; downshift, the cheapest again; escalate, a person, as everyone after two of them, the file's `note` saying so; person, as before. " +
      "Each open branch that clashed with this one (get_merge_plan's `after`) then takes main in by itself, once, and `took` says how each went: `updated` (settled with no card, the checked agent's passing answers and a lockfile CI made again included; its files start from main's copy with its changes on top, and one that follows a branch upstream pushes there) or `cards` (left as it was, for a person). Its own checks, held while it waited, run then. " +
      "A file both sides changed that merges with nothing left, under a `check: tests` policy, runs the repo's tests on the merged tree in a throwaway clone first, where the owner turned on test_merges: when they fail, the 409 has a `lint:tests` conflict on each such file and the run's `failure`; settle it as \"branch\" to land it anyway. " +
      "Generated text (lines between `<!-- generated: <command> -->` and `<!-- /generated -->`) both sides touched keeps main's copy, never a conflict; once the merge lands, each command runs from its file's folder on the merged tree in a throwaway clone, where the owner turned on test_merges, on the desktop or (for the site's admins) in a Cloudflare container, and what it rewrote goes onto main. `regenerated` lists each run, with a `note` when it didn't.",
    body: obj({ resolve: loose("{path: {line: \"main\" | \"branch\" | \"both\" | \"both:branch-first\" | {text}}}"), build_ok: bool() }),
    ok: obj({ status: str("merged or open"), merged: arr(obj({ path: str(), rev: int(), ops: int(), deleted: bool() })), conflicts: arr(loose("{path, conflicts}")), regenerated: arr(loose("{paths, command, cwd?, note?}")),
      took: arr(obj({ branch: str(), status: str("updated, cards or failed"), files: arr(str()), pushed: bool("pushed upstream too"), error: str() })) }) } },
  [`${repo}/merges`]: { post: { id: "merge_clean_branches", summary: "Merge every open branch that merges clean, oldest first (the crew)", tag: "Branches", risky: true,
    description: "Each branch merges by line id against main as the one before it left it, so branches that change different lines (a README edit, a package.json bump) all land. " +
      "One with a conflict, failing or waiting required checks, or build files without `build_ok` stays open and is listed in `skipped` with why; merge it alone with merge_branch. " +
      "`branches` limits it to those names. A branch with nothing on it yet is skipped.",
    body: obj({ branches: arr(str()), build_ok: bool() }),
    ok: obj({ merged: arr(str("a branch name")), skipped: arr(obj({ branch: str(), error: str(), files: arr(str("the conflicting or build files")) })) }) } },
  [`${repo}/merge-plan`]: { get: { id: "get_merge_plan", summary: "The open branches in merge waves: each wave merges together, a branch waits for the ones before it that it clashes with", tag: "Branches",
    description: "Two branches clash when the second merges clean into main now but not once the first has landed, by codeSplitter's own merge (line ids, then the lint), so a pair it settles by itself holds nothing up. " +
      "`order` is the order merge_clean_branches takes them: oldest first, the ones whose required checks passed ahead of the ones they hold (`held`). A stacked branch waits for the one it's on. " +
      "Merge a wave and the next one's branches that name one of them in `after` take main in by themselves, once (merge_branch's `took`). Reading the plan keeps each branch's `after`: its own checks wait till those have merged, so they run once.",
    ok: obj({ engine: str("the merge engine that planned it: Mervin"), order: arr(str("a branch name")), held: arr(str("a branch its required checks hold")),
      waves: arr(arr(obj({ branch: str(), after: arr(obj({ branch: str("one it waits for"), files: arr(str("where they clash")), stacked: bool("it's built on that one") })) }))) }) } },
  [`${repo}/board`]: {
    get: { id: "get_board", summary: "Mervin's live board: every open PR, its CI, stack, clashes and owner, and what can merge now", tag: "Branches",
      description: "One row per open PR Mervin staged: its own CI, the PR it's stacked on, its files per tier (certain, agree, mervin, differ, card), the clashes that merge clean as text and break later, the Agent Office worker that owns it, and for a PR touching package.json, bun.lock or packages/ the apps and PRs it reaches. " +
        "`waves` and `mergeable` come straight off the rows; `hits` is each tier's exact-landing rate after real merges. With `pr`: that PR's answer, what blocks it (`blocking`), who should take it (`take`) and what it blocks.",
      query: { pr: int("one PR's answer instead of the whole board") },
      ok: obj({ main: { type: ["string", "null"], description: "the main commit the board was staged on" }, at: { type: ["integer", "null"], description: "ms of the last update" },
        prs: arr(loose("{pr, title?, head, ci, failing?, stackedOn?, tiers, files, clashes: [{kind, key, with, main?}], owner?, blast?: {apps, prs}, at}")),
        waves: arr(arr(int("a PR number"))), mergeable: arr(int("a PR nothing holds up")), hits: loose("{tier: percent that landed exactly, or null}") }) },
    post: { id: "update_board", summary: "Post the rows of the PRs whose stage moved (the crew)", tag: "Branches",
      description: "What scripts/mervin-live.ts sends: `prs` are upserted by PR number, `drop` removes merged or closed ones, `replace` removes every row not in `prs`, and `hits` replaces the tiers' track record.",
      body: obj({ main: str("the main commit the board was staged on"), prs: arr(loose("a row, as get_board returns it")), drop: arr(int()), replace: bool(), hits: loose("{tier: {exact, of}}") }, ["main", "prs"]),
      ok: obj({ ok: bool(), rows: int() }), status: 201 } },
  [`${repo}/dispatch-hint`]: { get: { id: "get_dispatch_hint", summary: "Before a task starts: its likely files, and the open branches already rewriting them", tag: "Branches",
    description: "`files` is `paths` plus the repo's files the task's text names, whole or by a tail only one path ends in (`main.ts`, `src/main.ts`). " +
      "`busy` lists the open branches that change any of them, the one sharing the most first. Their merges will likely meet the task's: hold it till they land, or open its branch on the first (start_branch with `parent`). start_agent's answer carries the same `busy`.",
    query: { task: str("the task's text, an issue body say"), paths: str("files it will touch, comma separated") },
    ok: obj({ files: arr(str()), busy: arr(obj({ branch: str(), files: arr(str("the task's files it changes")) })) }) } },
  [`${repo}/limits`]: { get: { id: "repo_limits", summary: "What this repo and you may do, and how close you are", tag: "Repos", ok: loose("{git, fresh, files, dig, you: [{label, used, max, window_s, on}]}") } },
  [`${repo}/agents`]: {
    get: { id: "list_agent_runs", summary: "A repo's coding-agent runs, newest first (owner only)", tag: "Agents", query: { path: str() }, ok: arr(loose("a run: {id, harness, task, status, …}")) },
    post: { id: "start_agent", risky: true, summary: "Give a coding agent a task on a file (owner only)", tag: "Agents",
      body: obj({ path: str(), harness: str("one GET /agents lists"), task: str(), model: str() }, ["path", "harness", "task"]), ok: loose("the run, with `busy` when open branches already rewrite its file or ones its task names (get_dispatch_hint)"), status: 202 },
  },
  [`${repo}/agents/stop`]: { post: { id: "stop_agents", summary: "Stop running coding agents: by run, file, harness or the lines they claimed (owner only)", tag: "Agents", risky: true,
    description: "Every filter given must match; with none, every running agent on the repo stops. The CLI is killed (a hosted run's container destroyed within a few seconds), nothing more it does lands, and its claim on lines is lifted.",
    body: obj({ ids: arr(int()), path: str(), harness: str(), lines: arr(str("a line id")) }), ok: obj({ stopped: arr(int()) }) } },
  [`${repo}/agents/{id}/notes`]: { post: { id: "tell_agent", summary: "Tell a running coding agent something, for its next run (owner only)", tag: "Agents",
    description: "A running CLI can't take messages, so the note goes into the prompt of its next run: when this run ends, it goes round again with every note so far (up to 5 extra runs). 409 once the run has ended.",
    body: obj({ text: str() }, ["text"]), ok: loose("the run, with its notes") } },
  [`${repo}/agents/waiting`]: { get: { id: "waiting_agent_batches", summary: "A file's agent batches waiting to land on main, with their hunks", tag: "Agents",
    description: "Anyone who can read the file sees them: each run's id, agent, `pending` {branch, until (null: held), why} and its branch's hunks, private lines blank outside the crew. `kept`, for the crew only, lists lines where a landing in the last day kept your version, with what the agent wanted.",
    query: { path: { ...str("the file"), required: true } }, ok: obj({ waiting: arr(loose("{id, agent, pending, hunks}")), kept: arr(loose("{line, yours, wanted, agent}")) }) } },
  [`${repo}/agents/engine`]: { get: { id: "rebuild_engine_lines", summary: "What rebuild tasks said a merge rule could have settled, newest first (owner only)", tag: "Agents",
    description: "A branch that really clashes with main once the one it waited for merged gets a rebuild task, which ends with a line per clash: whether a merge rule could have settled it with no agent, and how. " +
      "Each row is one run that said so, out of the runs the repo keeps: `after` is the branch that merged. The `yes` ones are what a new merge rule would take off agents.",
    ok: arr(obj({ run: int(), branch: str(), after: str("the branch whose merge it rebuilt on"), started: int(),
      engine: arr(obj({ path: str(), line: str("a line id"), yes: bool("a merge rule could have settled it"), how: str() })) })) } },
  [`${repo}/agents/{id}/accept`]: { post: { id: "accept_agent_batch", summary: "Land a finished run's waiting batch on main now (owner only)", tag: "Agents", risky: true,
    description: "A run's batch waits on its own branch (the run's `pending.branch`) for a few seconds before it merges into main by itself. Accept merges it now, build files and all. A line someone changed on main meanwhile keeps their version: the run's `kept` lists what the agent wanted there. 409 if the repo's required checks hold it back; it stays waiting, held.",
    ok: obj({ landed: bool(), kept: arr(loose("{line, yours, wanted}")) }) } },
  [`${repo}/agents/{id}/hold`]: { post: { id: "hold_agent_batch", summary: "Stop a waiting batch's clock: it lands only when accepted (crew)", tag: "Agents", ok: loose("the run") } },
  [`${repo}/agents/{id}/look`]: { post: { id: "look_at_agent_batch", summary: "Say someone is reading a waiting batch: it lands no sooner than a few seconds from now (crew)", tag: "Agents", ok: loose("the run") } },
  [`${repo}/agents/{id}/reject`]: { post: { id: "reject_agent_batch", summary: "Throw a waiting batch away: nothing of it lands, and its branch goes (owner only)", tag: "Agents", risky: true, ok: loose("the run") } },
  "/agents": { get: { id: "list_harnesses", summary: "Which coding-agent harnesses this site can run", tag: "Agents", open: true, ok: loose("{available, why, harnesses, all}") } },
  [`${repo}/deploy`]: {
    get: { id: "deploy_status", summary: "Deploy settings, the run going now, and the last 20 (owner only)", tag: "Deploys", ok: loose("{settings, run, deploys}") },
    post: { id: "deploy", summary: "Deploy the repo now (owner only)", tag: "Deploys", risky: true, body: obj({ approve: str("approve main up to this sha first"), allow_delete: bool("pass --allow-delete: a deploy that deletes or replaces a D1, R2, KV or queue, this once"), force: bool("pass --force: deploy from a HEAD behind origin/main, this once") }), ok: loose("{run}"), status: 202 },
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
  Beam: obj({ id: str(), owner: str(), repo: str(), branch: str(), kind: { type: "string", enum: ["git", "codesplitter"] }, by: str(), to: { type: ["string", "null"] }, title: str(), message: str(),
    onto: obj({ sha: str(), label: str('"main", or "upstream <repo>@<branch>"') }), sha: str("the clean commit, at refs/beams/{id}: the top one of a stacked branch's"), commits: int("commits in the stack it squashed; 0 for a codeSplitter branch"),
    stack: { ...arr(obj({ branch: str(), sha: str(), title: str() })), description: "its commits, the bottom one first: one per branch for a stacked codeSplitter branch, else just the one" },
    files: arr(obj({ path: str(), status: str("git's A, M or D") })), dropped: arr(obj({ path: str(), why: str() })),
    status: { type: "string", enum: ["open", "withdrawn"] }, created_at: int(), page: str("open it at /#/beam/{id}"), patch: str() }),
  BeamSummary: loose("A Beam with `files` and `dropped` as counts"),
  User: obj({ name: str(), bio: str(), avatar: str("their avatar as JSON text, '' until they make one"), theme_html: str(), city_public: int("1 while your code city is public, 0 once you switched it off"), pulse: int("1 when their pulse is public") }),
  Pulse: obj({ name: str(), hours: arr(int()), from: int("ms: the first hour's start; hours[] is 168 counts, oldest first"), total: int(), live_at: { type: ["integer", "null"], description: "ms: the last line they landed" } }),
  RepoSummary: obj({ owner: str(), name: str(), visibility: str(), level: str(), created_at: int("ms"), expires_at: { type: ["integer", "null"], description: "a visitor's dig goes then" } }),
  Repo: obj({ owner: str(), name: str(), visibility: str(), level: str(), branch: str(), upstream: str(), created_at: int(), expires_at: { type: ["integer", "null"] },
    collaborators: arr(str()), canWrite: bool(), clone: { type: ["string", "null"], description: "git clone command, read token good for an hour" }, crewClone: { type: ["string", "null"] }, push: str("desktop, owner only: git remote add line for the repo's bare git, write token good for a day"), home: str("local or cloud"), invites: { ...arr(ref("Invite")), description: "pending invites, for the owner only" } }),
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
  Claim: obj({ id: str(), who: str("who holds it"), bot: bool("an agent's: a lease that lapses"), lines: arr(str("line id")), task: str(), at: int("ms: when it was laid"),
    until: { type: ["integer", "null"], description: "ms: when it lapses; null stands till lifted" }, cap: int("ms: an agent's claim can't be renewed past this"), soft: bool("an intent: shown, but it keeps nobody off") }, ["id", "who", "bot", "lines", "at", "until"]),
  Commit: obj({ n: int(), sha: str(), parent: { type: ["string", "null"] }, rev: int(), by: str(), at: int(), message: str() }),
  Branch: obj({ name: str(), by: str(), status: str("open or merged"), parent: { type: ["string", "null"], description: "the branch it's stacked on" }, created_at: int(), merged_by: { type: ["string", "null"] }, merged_at: { type: ["integer", "null"] } }),
  Playlist: obj({ id: int(), owner: str(), title: str() }),
  Follow: obj({ id: int("unfollow by this"), kind: { type: "string", enum: ["user", "agent", "repo", "lines"] }, name: str("user or agent: the handle"),
    owner: str(), repo: str(), path: str("lines: the file"), ids: arr(str("lines: every line id in the range when followed")),
    from_line: int("lines: where the range began when followed"), to_line: int(), created_at: int("ms") }, ["id", "kind", "created_at"]),
  Invite: obj({ id: str("revoke it, or (invited by handle) open and claim it, by this"), last4: str("the token's last four characters"), token: str("csi_…, when it's made only"), link: str("…/invite/csi_…, when it's made only"), kind: str("handle, email or link"), target: { type: ["string", "null"] }, note: str(), by: str(), created_at: int(), expires_at: int(),
    owner: str(), repo: str(), mailed: bool("an email invite: whether it went out") }),
  AuditEntry: obj({ id: int(), at: int("ms"), actor: { type: ["string", "null"] }, via: str("cookie, token, oauth, job or invite"), action: str("like token.create or crew.remove"),
    owner: { type: ["string", "null"] }, repo: { type: ["string", "null"] }, target: { type: ["string", "null"], description: "what it was done to" }, detail: { type: ["string", "null"] }, country: { type: ["string", "null"] } }),
  Stamp: obj({ owner: str(), repo: str(), path: str(), line: str("line id"), stamp: str(), by: str("who stamped it"), author: str("who wrote the line, person or agent"), created_at: int("ms") }),
  CheckStatus: { type: "string", enum: ["queued", "running", "passed", "failed", "cancelled"] },
  CheckRun: obj({ id: int(), ref: str("main or a branch"), sha: str(), name: str(), runner: { type: "string", enum: ["desktop", "container", "github", "external"] }, status: ref("CheckStatus"),
    started_at: { type: ["integer", "null"] }, finished_at: { type: ["integer", "null"] }, url: { type: ["string", "null"], description: "GitHub's page, for an imported job" },
    runner_label: { type: ["string", "null"], description: "the runner that claimed it, or the CI token an external run came in on" }, created_at: int() }),
  CiToken: obj({ id: str(), label: str("which CI it's for"), last4: str("the secret's last four characters"), created_by: str(), created_at: int("ms"), expires_at: int("ms"), expired: bool(), last_used_at: { type: ["integer", "null"], description: "ms, to the minute" } }),
  RequiredCheck: { description: "a check's name (* for all), or one scoped to paths and with a command for our runners", oneOf: [str(), obj({ name: str(), paths: arr(str("a directory, file or glob")), command: str() }, ["name"])] },
  CheckSettings: obj({ where: { type: ["string", "null"], description: "here, github or both; null runs none (a GitHub mirror defaults to github)" }, required: arr(obj({ name: str(), paths: arr(str()), command: str() }, ["name"])), post_statuses: bool(), pinned: bool("only the required checks' commands run: codesplitter.ci and package.json's scripts at the ref are ignored"), github: { type: ["string", "null"], description: "owner/name, when the repo mirrors GitHub" },
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
        "x-codesplitter-scope": method === "get" ? "read" : "write",
        ...(o.risky && { "x-codesplitter-risky": true }),
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
      title: "codeSplitter",
      version: "1",
      description: "A code host where every line is its own record. Make a personal API token on your profile page and send it as `Authorization: Bearer cst_…`: "
        + "it acts as you, counts against your rate limits, and expires. read tokens make GET requests only. Tokens never reach admin routes, sign-in, or token management. "
        + "Or sign in with OAuth (authorization code with PKCE; public clients, so no secret): an app on your own computer may use any client_id with a http://127.0.0.1 or localhost redirect, anything else registers at /api/oauth/register first. "
        + "Operations marked `x-codesplitter-risky` change who can get in or see what, can't be undone, or ship code: ask a person before calling them.",
    },
    servers: [{ url: `${origin}/api` }],
    components: {
      schemas: SCHEMAS,
      securitySchemes: {
        token: { type: "http", scheme: "bearer", description: "a personal API token from your profile page (cst_…)" },
        oauth: {
          type: "oauth2", description: "sign in on codeSplitter; access tokens last an hour, refresh tokens rotate, and you can revoke the app from your profile page",
          flows: { authorizationCode: { authorizationUrl: `${origin}/api/oauth/authorize`, tokenUrl: `${origin}/api/oauth/token`, refreshUrl: `${origin}/api/oauth/token`, scopes: OAUTH_SCOPES } },
        },
      },
    },
    security: [{ token: [] }, { oauth: ["read"] }],
    paths,
  };
}

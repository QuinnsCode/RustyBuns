// The API reference: every read and action the site's own page uses, so anyone can
// build their own UI on it, or point an agent at it. The Worker serves it as JSON at
// GET /api, and /reference shows it. test/api.test.ts keeps it whole: every route
// comment in src/ and every call the command palette names must be in here.
//
// Paths: :o/:r is a repo's owner and name, :path a file's path in the repo (a query
// parameter, since paths have slashes). A [bracketed] part is optional.

export interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "WS";
  path: string;
  /** The JSON body it takes, as a sketch. */
  body?: string;
  /** Who may call it, when it isn't anyone who can read the repo. */
  who?: string;
  does: string;
}

export interface Group { name: string; about?: string; endpoints: Endpoint[] }

const OWNER = "the repo's owner", CREW = "the crew (owner and collaborators)", ADMINS = "admins", SIGNED_IN = "signed in";

export const GROUPS: Group[] = [
  {
    name: "This reference",
    endpoints: [
      { method: "GET", path: "/api", does: "this reference, as JSON" },
      { method: "GET", path: "/api/openapi.json", does: "the same API as an OpenAPI 3.1 spec, for agents and gateways outside the browser; calls that can't be undone or ship code carry x-codesplitters-risky: true" },
      { method: "POST", path: "/api/mcp", body: "a JSON-RPC request", does: "a remote MCP server (Streamable HTTP, no sessions) whose tools are the spec's operations, one per operationId; sign in with OAuth (a client added with no header opens a consent page) or send a personal API token; read scope lists only reads, and risky ones are marked destructive; /mcp shows how to connect" },
      { method: "GET", path: "/api/mcp/tools", does: "every MCP tool: name, description, inputs, scope and whether it's risky (no token needed)" },
    ],
  },
  {
    name: "Signing in",
    about: "Accounts (Better Auth) are on when the site has BETTER_AUTH_SECRET; otherwise a name in the cs_user cookie is all it takes (alias mode). GET /api/session says which. An agent can send a personal API token instead (Authorization: Bearer cst_…): read tokens only GET, it's never an admin, and it can't open sockets.",
    endpoints: [
      { method: "GET", path: "/api/session", does: "{mode: \"accounts\" | \"alias\" | \"token\", user, providers, admin?, pick?, token?}: who you are, and how to sign in" },
      { method: "POST", path: "/api/login", body: "{name}", does: "alias mode: sign in as name (sets the cs_user cookie)" },
      { method: "POST", path: "/api/logout", does: "alias mode: sign out" },
      { method: "POST", path: "/api/auth/sign-in/email", body: "{email, password}", does: "accounts: sign in; the rest of /api/auth/* is Better Auth's (sign-up/email, sign-in/social, sign-out, …)" },
      { method: "POST", path: "/api/auth/sign-out", does: "accounts: sign out" },
      { method: "GET", path: "/api/handle?name=", does: "accounts: is this handle free? {name, ok, why}" },
      { method: "POST", path: "/api/handle", body: "{name}", who: SIGNED_IN, does: "claim your handle: once, six or more characters, for good" },
      { method: "GET", path: "/api/me", who: SIGNED_IN, does: "your user row" },
      { method: "PUT", path: "/api/me", body: "{bio, theme_html}", who: SIGNED_IN, does: "your profile's text and HTML/CSS" },
      { method: "GET", path: "/api/me/export", who: SIGNED_IN, does: "everything here about you, as one JSON download (cookie only, never a token or agent)" },
      { method: "DELETE", path: "/api/me?confirm=:handle", who: SIGNED_IN, does: "delete your account, your repos and everything of them; your handle is retired (cookie only)" },
      { method: "GET", path: "/api/users/:name", does: "a profile: {user, repos you may see, playlists, following, followers}; following counts what you may see of it" },
      { method: "GET", path: "/api/tokens", who: SIGNED_IN, does: "your personal API tokens, without their secrets (cookie only, never a token)" },
      { method: "POST", path: "/api/tokens", body: "{label, scope: \"read\" | \"write\", days?}", who: SIGNED_IN, does: "a personal API token, 1 to 365 days (30 by default), sent as Authorization: Bearer cst_…; its secret is shown this once (cookie only)" },
      { method: "DELETE", path: "/api/tokens/:id", who: SIGNED_IN, does: "revoke one (cookie only)" },
      { method: "GET", path: "/.well-known/oauth-authorization-server", does: "OAuth sign-in for apps outside the browser (RFC 8414): authorization code with PKCE (S256), public clients, scopes read and write" },
      { method: "GET", path: "/.well-known/oauth-protected-resource/api/mcp", does: "where an MCP client signs in for /api/mcp (RFC 9728)" },
      { method: "GET", path: "/api/oauth/authorize", does: "the consent page: response_type=code, client_id, redirect_uri, code_challenge, code_challenge_method=S256, state?, scope?. An unregistered client_id may only redirect to http://127.0.0.1 or localhost" },
      { method: "POST", path: "/api/oauth/token", body: "grant_type=authorization_code&code&redirect_uri&client_id&code_verifier, or grant_type=refresh_token&refresh_token", does: "{access_token (cst_…, an hour), refresh_token (rotated on every use, 30 days from its last), scope}" },
      { method: "POST", path: "/api/oauth/register", body: "{redirect_uris, client_name?}", does: "register an app (RFC 7591): https or loopback redirects; it gets a client_id and no secret" },
      { method: "POST", path: "/api/oauth/revoke", body: "token", does: "end the grant behind a refresh token, or one access token (RFC 7009)" },
      { method: "GET", path: "/api/oauth/grants", who: SIGNED_IN, does: "the apps you've signed in (cookie only)" },
      { method: "DELETE", path: "/api/oauth/grants/:id", who: SIGNED_IN, does: "sign one out: its tokens stop at once (cookie only)" },
    ],
  },
  {
    name: "Repos",
    about: "A private repo you can't read answers 404, as if it weren't there.",
    endpoints: [
      { method: "POST", path: "/api/repos", body: "{name, visibility?: \"public\" | \"private\"}", who: SIGNED_IN, does: "a new, empty repo of yours" },
      { method: "GET", path: "/api/repos/:o/:r", does: "the repo: visibility, collaborators, canWrite, upstream, and a git clone line with an hour-long read token (crewClone too, for the crew)" },
      { method: "PUT", path: "/api/repos/:o/:r", body: "{visibility}", who: OWNER, does: "make it public or private" },
      { method: "DELETE", path: "/api/repos/:o/:r?confirm=:r", who: OWNER, does: "delete it here: rows, files, branches, git. GitHub never hears" },
      { method: "GET", path: "/api/repos/:o/:r/tree?path=dir", does: "one folder: {commit, entries: [{name, path, type: \"file\" | \"dir\"}]}, git's plus files written here but not committed yet; 202 {forking} while a dig is landing" },
      { method: "POST", path: "/api/repos/:o/:r/files", body: "{path, content?, branch?}", who: CREW, does: "a new file (on a branch, with branch)" },
      { method: "POST", path: "/api/repos/:o/:r/collaborators", body: "{name}", who: OWNER, does: "add someone to the crew (this is how agents get in)" },
      { method: "GET", path: "/api/repos/:o/:r/fit?dir=", does: "how easily Rusty Buns could ship it (or, with dir, one app in it): ready, likely, needs work or poor, with reasons" },
      { method: "GET", path: "/api/repos/:o/:r/limits", does: "git's size against its cap, files waiting for git, and where you stand on your rate limits" },
      { method: "GET", path: "/api/repos/:o/:r/mirror", does: "a mirror's standing with upstream: {state: ok | down | refused | clash | held | rewritten, url, branch, ahead, behind, downSince, syncedAt, nextAt, clash, error, private, pushCrew}" },
      { method: "POST", path: "/api/repos/:o/:r/mirror", body: "{resolve?: \"mine\" | \"upstream\" | \"rebase\", pushCrew?: boolean}", who: OWNER, does: "sync a mirror now; resolve settles a clash (its files taking your lines or upstream's) or rewritten upstream history (rebase replays your commits on upstream's, upstream drops them); pushCrew true sends the crew's copy, private lines' real text and all, upstream instead of holding it" },
      { method: "GET", path: "/api/repos/:o/:r/mirror/branches", does: "a mirror's upstream branches other than the default: [{ref, commit, branch, status}], branch being the one here that follows it, if any" },
      { method: "POST", path: "/api/repos/:o/:r/mirror/branches", body: "{ref, name?}", who: OWNER, does: "open upstream's branch ref here as a branch of what it changed since it left main; pushing it goes back to ref. Says which files it took, which it deleted (upstream did) and which it skipped (binary)" },
      { method: "POST", path: "/api/repos/:o/:r/mirror/branches/:b/pull", who: OWNER, does: "branch :b takes what its upstream branch got since it last did (every sync does this too). {ref, commit, files, deleted, skipped}" },
      { method: "POST", path: "/api/repos/:o/:r/mirror/branches/:b/push", who: OWNER, does: "push branch :b upstream as a real git branch: one commit on main's tip with its files (and without the ones it deleted), on top of what went up last time (taken in first), never forced. {ref, commit, pushed, took}" },
      { method: "GET", path: "/api/repos/:o/:r/fresh", does: "where a fresh start of git stands; takes a step while one is running" },
      { method: "POST", path: "/api/repos/:o/:r/fresh", who: OWNER, does: "start git fresh (a new Artifact holding only the current files), or retry one that failed" },
      { method: "DELETE", path: "/api/repos/:o/:r/fresh?artifact=", who: OWNER, does: "delete the old git a fresh start moved off" },
      { method: "GET", path: "/api/search?q=", does: "committed code you may see: [{owner, repo, path, snippet}], best 20" },
    ],
  },
  {
    name: "A file",
    about: "Each file is a Durable Object. Every call takes ?path= (the file) and, to work on a branch's copy, &branch=. A line is {id, text, by, rev}: by and rev are its blame. An op names lines by id: {kind: \"insert\", after: id | null, text} | {kind: \"set\", line, base, text} | {kind: \"delete\", line, base}, where base is the line's rev as you read it; a stale one is a 409 to retry. ifRev pins the whole batch to the file's rev.",
    endpoints: [
      { method: "GET", path: "/api/repos/:o/:r/do/file?path=", does: "the file now, with blame: {rev, lines: [{id, text, by, rev, private?}]}" },
      { method: "POST", path: "/api/repos/:o/:r/do/ops?path=", body: "{ops: Op[], ifRev?}", who: CREW, does: "edit, all or nothing: {rev, applied}, or 409 {rev, conflicts}" },
      { method: "GET", path: "/api/repos/:o/:r/do/log?path=&since=", does: "every op after rev since: [{rev, by, at, op, line}]" },
      { method: "GET", path: "/api/repos/:o/:r/do/at?path=&rev=", does: "time travel: the file as it was at rev, with blame" },
      { method: "POST", path: "/api/repos/:o/:r/do/commit?path=", body: "{message}", who: CREW, does: "commit the file on main: indexed for search and pushed to git ({…commit, git})" },
      { method: "GET", path: "/api/repos/:o/:r/do/commits?path=", does: "the file's commits, newest first" },
      { method: "GET", path: "/api/repos/:o/:r/do/private?path=", does: "the ids of its private lines" },
      { method: "POST", path: "/api/repos/:o/:r/do/private?path=", body: "{lines: [id], private: boolean}", who: CREW, does: "make lines private (crew only) or public again" },
      { method: "GET", path: "/api/repos/:o/:r/do/claims?path=", does: "who is working on which lines: [{id, who, bot, lines: [id], task?, at, until}]; until null stands until lifted" },
      { method: "POST", path: "/api/repos/:o/:r/do/claims?path=", body: "{lines: [id], id?, task?, ttl?} | {id, release: true}", who: CREW, does: "claim lines so only you edit them (an agent's lapses in 30 minutes, a person's hold stands), renew your claim by id, or lift any claim; 409 {error, claims} when they're held. An agent's ops name their claim: {ops, claim}" },
      { method: "WS", path: "/api/repos/:o/:r/do/ws?path=", does: "live: send {type: \"ops\", id, ops, ifRev?} and get {type: \"ack\", id, rev} or {type: \"nack\", id, rev?, conflicts?, error?, retryAfter?}; everyone gets {type: \"ops\", rev, applied}, {type: \"presence\", who}, {type: \"commit\", commit}, {type: \"private\", lines, private}, {type: \"claim\", claim} and {type: \"unclaim\", id}. A gap in revs means refetch the file" },
    ],
  },
  {
    name: "Branches",
    endpoints: [
      { method: "GET", path: "/api/repos/:o/:r/branches", does: "the repo's branches" },
      { method: "POST", path: "/api/repos/:o/:r/branches", body: "{name}", who: CREW, does: "open a branch; edit on it with ?branch=name" },
      { method: "GET", path: "/api/repos/:o/:r/branches/:b", does: "the review: each file's ops against main now, its conflicts, and any build-time changes; a file the branch deleted says deleted: true" },
      { method: "DELETE", path: "/api/repos/:o/:r/branches/:b/files?path=", who: CREW, does: "delete a file on the branch: merging deletes it from main (and its git). Text, binary or too big, all can go; making it again on the branch brings it back" },
      { method: "POST", path: "/api/repos/:o/:r/branches/:b/merge", body: "{resolve?: {path: {lineId: \"branch\" | \"main\"}}, build_ok?}", who: CREW, does: "merge into main by line; 409 with the conflicts merges nothing, and 409 when a required check failed or hasn't finished" },
    ],
  },
  {
    name: "Checks",
    about: "Check runs say whether a change is good, wherever it ran: ours (desktop or container) and GitHub Actions jobs for the shas a mirror sent up. A run is {id, ref, sha, name, runner, status: queued | running | passed | failed | cancelled, started_at, finished_at, url}. Each one that starts or finishes is a check_run webhook.",
    endpoints: [
      { method: "GET", path: "/api/repos/:o/:r/checks?ref=", does: "a ref's runs (main by default) on its latest sha, the newest of each name, and the merge gate: {required, ok, passed, waiting, failed, deferred, skipped}; skipped are required checks scoped to paths the branch doesn't touch; while GitHub is down (offline), GitHub-only required checks are deferred once ours pass" },
      { method: "POST", path: "/api/repos/:o/:r/checks", body: "{ref, sha, name, runner?, status?, url?}", who: CREW, does: "record a run, by hand or from a runner" },
      { method: "POST", path: "/api/repos/:o/:r/checks/run", body: "{ref?}", who: CREW, does: "queue our own checks on main or an open branch as it is now, whatever where says: running here is always on offer" },
      { method: "POST", path: "/api/repos/:o/:r/checks/github", body: "{ref?}", who: CREW, does: "fetch GitHub's check runs and commit statuses for the shas sent up, now rather than at the next poll" },
      { method: "POST", path: "/api/repos/:o/:r/checks/claim", body: "{runner_label, names?}", who: CREW, does: "a runner of your own takes the oldest queued run of ours (of names, if given) and it's running: {id, ref, sha, name, clone_url, command?, stale_after_s}, or 204 when there's none. Each PUT on it is a heartbeat; quiet for stale_after_s, it's queued again. scripts/runner.ts is the loop" },
      { method: "GET", path: "/api/repos/:o/:r/checks/settings", does: "{where: here | github | both | null, required, post_statuses, github, offline, down_since, here}: here says whether our own checks run, which they do in GitHub's place while it's down" },
      { method: "PUT", path: "/api/repos/:o/:r/checks/settings", body: "{where?, required?: [name or {name, paths?, command?}] or [\"*\"], post_statuses?}", who: OWNER, does: "where checks run, which ones a merge waits on (one with paths only on a branch touching them; one with a command is queued for runners), and whether ours go to GitHub as codesplitters/<name> statuses" },
      { method: "GET", path: "/api/repos/:o/:r/checks/:id", does: "one run, with its log and JUnit report" },
      { method: "PUT", path: "/api/repos/:o/:r/checks/:id", body: "{status?, log?, append?, junit?, runner_label?}", who: CREW, does: "a runner reports, which is also its heartbeat: move it on, replace or add to its log; a finished run stays finished, and one claimed by another label is a 409" },
      { method: "POST", path: "/api/repos/:o/:r/checks/:id/cancel", who: CREW, does: "stop one of ours that's queued or running; GitHub's are cancelled on GitHub" },
    ],
  },
  {
    name: "Shares, cuts and playlists",
    endpoints: [
      { method: "POST", path: "/api/repos/:o/:r/shares", body: "{path, from, to, note?}", who: SIGNED_IN, does: "a live link to some lines (from/to are line numbers now; the share follows them by id)" },
      { method: "GET", path: "/api/shares/:id", does: "the shared lines as they are now, for anyone with the link" },
      { method: "DELETE", path: "/api/shares/:id", who: "whoever shared it, or the repo's owner", does: "revoke it" },
      { method: "POST", path: "/api/repos/:o/:r/cuts", body: "{pieces: [{path, from, to}], note?}", who: CREW, does: "cut some lines out, with what they use, as a branch cut-<id>" },
      { method: "GET", path: "/api/cuts/:id", does: "its files, each line with where it came from on main, and the last run" },
      { method: "POST", path: "/api/cuts/:id/run", who: OWNER, does: "bun test on the cut alone" },
      { method: "GET", path: "/api/cuts/:id/card.png", does: "the social card: the code and its test result (?font=geist)" },
      { method: "GET", path: "/api/cuts/:id/share", does: "a page for link previews, sending people on to the cut" },
      { method: "POST", path: "/api/playlists", body: "{title}", who: SIGNED_IN, does: "a new playlist" },
      { method: "POST", path: "/api/playlists/:id/tracks", body: "{owner, repo, path, from, to, note?}", who: "the playlist's owner", does: "add some lines to it" },
      { method: "GET", path: "/api/playlists/:id", does: "each track with its lines as they are now" },
    ],
  },
  {
    name: "Following",
    about: "Follow people, agents, repos and line ranges. A followed range is kept by line id, like a share. A private repo, and lines in one, show only in its crew's list.",
    endpoints: [
      { method: "POST", path: "/api/follows", body: "{name, kind?} | {owner, repo} | {owner, repo, path, from, to}", who: SIGNED_IN, does: "follow a person or agent, a repo, or some lines (from/to are line numbers now); following again answers the follow you have" },
      { method: "DELETE", path: "/api/follows/:id", who: "the follower", does: "unfollow" },
      { method: "GET", path: "/api/me/following", who: SIGNED_IN, does: "[{id, kind: user | agent | repo | lines, name? | owner, repo, path?, ids?, from_line?, to_line?, created_at}], newest first" },
    ],
  },
  {
    name: "Levels and digs",
    endpoints: [
      { method: "GET", path: "/api/levels", does: "every level and whether it's dug up" },
      { method: "GET", path: "/api/levels/:slug/tree?path=dir", does: "one folder of a level" },
      { method: "GET", path: "/api/levels/:slug/file?path=", does: "one file of a level, read-only" },
      { method: "POST", path: "/api/levels/:slug/fork", body: "{name}", who: SIGNED_IN, does: "dig it up: your own writable fork" },
      { method: "POST", path: "/api/levels/:slug/import", who: ADMINS, does: "import the level (off a queue: 202 while it digs)" },
      { method: "GET", path: "/api/github/repos", does: "who GitHub thinks you are, your repos, newest push first, and every GitHub linked to your sign-in" },
      { method: "POST", path: "/api/github/active", body: "{id}", who: SIGNED_IN, does: "dig and list as this one of your linked GitHubs" },
      { method: "POST", path: "/api/github/agent", body: "{id|null}", who: SIGNED_IN, does: "your hosted agents work as this one of your linked GitHubs (GH_TOKEN in their container); null: none" },
      { method: "GET", path: "/api/github/search?q=", does: "public repos on GitHub, best match first" },
      { method: "POST", path: "/api/github/dig", body: "{repo, name?, visibility?}", who: SIGNED_IN, does: "fork a GitHub repo into one you own here" },
      { method: "POST", path: "/api/mirrors", body: "{url, name?, visibility?}", who: SIGNED_IN, does: "desktop only: clone any git remote (GitHub, GitLab, an ssh or https URL) as a mirror that keeps in step with it, pulling its commits and pushing yours back" },
      { method: "GET", path: "/api/jobs", who: SIGNED_IN, does: "your queued requests from the last week" },
      { method: "GET", path: "/api/jobs/:id", does: "a queued request: its place in line, or the answer it had once it ran" },
    ],
  },
  {
    name: "Agents, previews and deploys",
    endpoints: [
      { method: "GET", path: "/api/agents", does: "which coding-agent harnesses this machine can run" },
      { method: "GET", path: "/api/repos/:o/:r/agents?path=", who: OWNER, does: "the repo's agent runs, newest first, or one file's with path" },
      { method: "POST", path: "/api/repos/:o/:r/agents", body: "{path, harness, task, model?}", who: OWNER, does: "give a coding agent a task on a file; answers at once" },
      { method: "POST", path: "/api/repos/:o/:r/agents/stop", body: "{ids?, path?, harness?, lines?}", who: OWNER, does: "stop the running agents that match every filter (none: all of them): the CLI is killed or its container destroyed, nothing more lands, its claim is lifted; answers {stopped: [id]}" },
      { method: "POST", path: "/api/repos/:o/:r/agents/:id/notes", body: "{text}", who: OWNER, does: "tell a running agent something: a CLI can't take messages mid-run, so it goes into the prompt of its next run, and when this run ends it goes round again (up to 5 times); 409 once it has ended" },
      { method: "GET", path: "/api/repos/:o/:r/preview", who: OWNER, does: "the current or last preview deploy, and the last 20" },
      { method: "POST", path: "/api/repos/:o/:r/preview", who: OWNER, does: "start a preview deploy" },
      { method: "GET", path: "/api/repos/:o/:r/deploy", who: OWNER, does: "deploy settings, the run going now, the last 20 deploys" },
      { method: "PUT", path: "/api/repos/:o/:r/deploy", body: "{stage, dir, on_commit, production}", who: OWNER, does: "deploy settings" },
      { method: "POST", path: "/api/repos/:o/:r/deploy", who: OWNER, does: "ship it now" },
      { method: "GET", path: "/api/repos/:o/:r/deploy/key[/:provider]", who: OWNER, does: "{set, by, at, last4}: the stored deploy key (Cloudflare's without a provider)" },
      { method: "PUT", path: "/api/repos/:o/:r/deploy/key[/:provider]", body: "{token, account_id?}", who: OWNER, does: "store a deploy key" },
      { method: "DELETE", path: "/api/repos/:o/:r/deploy/key[/:provider]", who: OWNER, does: "forget it" },
      { method: "GET", path: "/api/repos/:o/:r/deps", who: OWNER, does: "the dependency doctor's settings and last report" },
      { method: "PUT", path: "/api/repos/:o/:r/deps", body: "{on, every_hours, max_level, min_age_days, ignore, run_tests, fix_with, fix_tries}", who: OWNER, does: "the doctor's settings" },
      { method: "POST", path: "/api/repos/:o/:r/deps/run", who: OWNER, does: "check now" },
      { method: "GET", path: "/api/repos/:o/:r/hooks", who: OWNER, does: "the webhooks, each with its last delivery" },
      { method: "POST", path: "/api/repos/:o/:r/hooks", body: "{url, events?, secret?}", who: OWNER, does: "add a webhook; its secret is shown this once" },
      { method: "DELETE", path: "/api/repos/:o/:r/hooks/:id", who: OWNER, does: "remove it" },
      { method: "GET", path: "/api/repos/:o/:r/hooks/:id/deliveries", who: OWNER, does: "its last 20 deliveries" },
      { method: "POST", path: "/api/repos/:o/:r/hooks/:id/deliveries/:d/redeliver", who: OWNER, does: "send one again" },
    ],
  },
  {
    name: "The game",
    about: "The same under /api/game/r/:o/:r for any repo you can read.",
    endpoints: [
      { method: "GET", path: "/api/game/l/:slug", does: "who's waiting in a level's room" },
      { method: "GET", path: "/api/game/l/:slug/walls?path=", does: "one room of the backrooms: a folder's files' lines" },
      { method: "WS", path: "/api/game/l/:slug/ws", does: "join the level's room" },
      { method: "WS", path: "/api/game/r/:o/:r/ws", does: "join a repo's room" },
    ],
  },
  {
    name: "Admin",
    endpoints: [
      { method: "GET", path: "/api/admin/limits", who: ADMINS, does: "every rate-limit rule with this window's traffic, the week's log, who's flagged" },
      { method: "PUT", path: "/api/admin/limits", body: "{rules: [{name, max, window_s, enabled, on_fail?}]}", who: ADMINS, does: "tune the rules" },
      { method: "POST", path: "/api/admin/limits/reset", body: "{who, rule?}", who: ADMINS, does: "clear a caller's counts" },
      { method: "GET", path: "/api/admin/handles", who: ADMINS, does: "handles granted to emails" },
      { method: "POST", path: "/api/admin/handles", body: "{handle, email}", who: ADMINS, does: "give a handle to whoever signs in with that email" },
      { method: "GET", path: "/api/admin/insights?days=7", who: ADMINS, does: "people vs agents vs bots by day, the site's health, recent people and how far each got, the last day's callers" },
      { method: "GET", path: "/api/admin/deploy-keys", who: ADMINS, does: "{rotating, keys}" },
      { method: "POST", path: "/api/admin/deploy-keys/reseal", who: ADMINS, does: "reseal stored deploy keys under the current key" },
    ],
  },
];

export const REFERENCE = {
  name: "codeSplitters API",
  about: "JSON over HTTP; send JSON bodies with content-type: application/json. Errors are {error} with a 4xx or 5xx. Over a rate limit is a 429 with retry-after, or a 202 {queued} for limits that queue (poll GET /api/jobs/:id). Every action in the site's command palette (⌘K) is one of these calls.",
  groups: GROUPS,
};

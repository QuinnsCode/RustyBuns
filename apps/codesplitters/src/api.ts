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
      { method: "POST", path: "/api/mcp", body: "a JSON-RPC request", does: "a remote MCP server (Streamable HTTP, no sessions) whose tools are the spec's operations, one per operationId; send a personal API token (a read token lists only reads), and risky ones are marked destructive; /mcp shows how to connect" },
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
      { method: "GET", path: "/api/users/:name", does: "a profile: {user, repos you may see, playlists}" },
      { method: "GET", path: "/api/tokens", who: SIGNED_IN, does: "your personal API tokens, without their secrets (cookie only, never a token)" },
      { method: "POST", path: "/api/tokens", body: "{label, scope: \"read\" | \"write\", days?}", who: SIGNED_IN, does: "a personal API token, 1 to 365 days (30 by default), sent as Authorization: Bearer cst_…; its secret is shown this once (cookie only)" },
      { method: "DELETE", path: "/api/tokens/:id", who: SIGNED_IN, does: "revoke one (cookie only)" },
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
      { method: "WS", path: "/api/repos/:o/:r/do/ws?path=", does: "live: send {type: \"ops\", id, ops, ifRev?} and get {type: \"ack\", id, rev} or {type: \"nack\", id, rev?, conflicts?, error?, retryAfter?}; everyone gets {type: \"ops\", rev, applied}, {type: \"presence\", who}, {type: \"commit\", commit} and {type: \"private\", lines, private}. A gap in revs means refetch the file" },
    ],
  },
  {
    name: "Branches",
    endpoints: [
      { method: "GET", path: "/api/repos/:o/:r/branches", does: "the repo's branches" },
      { method: "POST", path: "/api/repos/:o/:r/branches", body: "{name}", who: CREW, does: "open a branch; edit on it with ?branch=name" },
      { method: "GET", path: "/api/repos/:o/:r/branches/:b", does: "the review: each file's ops against main now, its conflicts, and any build-time changes" },
      { method: "POST", path: "/api/repos/:o/:r/branches/:b/merge", body: "{resolve?: {path: {lineId: \"branch\" | \"main\"}}, build_ok?}", who: CREW, does: "merge into main by line; 409 with the conflicts merges nothing" },
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
    name: "Levels and digs",
    endpoints: [
      { method: "GET", path: "/api/levels", does: "every level and whether it's dug up" },
      { method: "GET", path: "/api/levels/:slug/tree?path=dir", does: "one folder of a level" },
      { method: "GET", path: "/api/levels/:slug/file?path=", does: "one file of a level, read-only" },
      { method: "POST", path: "/api/levels/:slug/fork", body: "{name}", who: SIGNED_IN, does: "dig it up: your own writable fork" },
      { method: "POST", path: "/api/levels/:slug/import", who: ADMINS, does: "import the level (off a queue: 202 while it digs)" },
      { method: "GET", path: "/api/github/repos", does: "who GitHub thinks you are, your repos, newest push first, and every GitHub linked to your sign-in" },
      { method: "POST", path: "/api/github/active", body: "{id}", who: SIGNED_IN, does: "dig and list as this one of your linked GitHubs" },
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
      { method: "GET", path: "/api/repos/:o/:r/agents?path=", who: OWNER, does: "this file's agent runs, newest first" },
      { method: "POST", path: "/api/repos/:o/:r/agents", body: "{path, harness, task, model?}", who: OWNER, does: "give a coding agent a task on a file; answers at once" },
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

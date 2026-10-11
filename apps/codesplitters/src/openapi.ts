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
    put: { id: "update_me", summary: "Change your bio and page HTML", tag: "Account", body: obj({ bio: str(), theme_html: str("any HTML and CSS, rendered in a sandbox") }), ok: ref("User") },
  },
  "/users/{name}": { get: { id: "get_user", summary: "A profile: its repos you may see, and its collections", tag: "Account", open: true,
    ok: obj({ user: ref("User"), repos: arr(ref("RepoSummary")), playlists: arr(ref("Playlist")) }) } },
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
    get: { id: "get_share", summary: "Shared lines as they are now", tag: "Sharing", open: true, ok: loose("{id, owner, repo, path, note, by, from, to, lines: [{n, text, by, rev, private?}], gone?}") },
    delete: { id: "delete_share", summary: "Revoke a share (whoever shared it, or the repo's owner)", tag: "Sharing", ok: ref("Ok") },
  },
  [`${repo}/cuts`]: { post: { id: "cut_lines", summary: "Cut some lines and what they use out of the repo, as a branch to run and merge back (the crew)", tag: "Cuts",
    body: obj({ pieces: arr(obj({ path: str(), from: int(), to: int() }, ["path", "from", "to"])), note: str() }, ["pieces"]),
    ok: obj({ id: str(), branch: str(), files: arr(obj({ path: str(), lines: int(), pulled: bool() })) }), status: 201 } },
  "/cuts/{id}": { get: { id: "get_cut", summary: "A cut: its files, each line with where it came from on main, and its last test run", tag: "Cuts", open: true,
    ok: loose("{id, owner, repo, branch, note, paths, files: [{path, lines: [{id, text, by, rev, n}]}], run, can_run}") } },
  "/cuts/{id}/run": { post: { id: "run_cut", summary: "Run bun test on a cut (the repo's owner)", tag: "Cuts", ok: loose("{code, out, report?}") } },
  [`${repo}/collaborators`]: { post: { id: "invite", summary: "Add someone, or an agent, to the crew (owner only)", tag: "Repos",
    body: obj({ name: str("their handle") }, ["name"]), ok: ref("Ok") } },
  [`${repo}/branches`]: {
    get: { id: "list_branches", summary: "A repo's branches", tag: "Branches", open: true, ok: arr(ref("Branch")) },
    post: { id: "start_branch", summary: "Open a branch: edit its files with ?branch=, then merge it (the crew)", tag: "Branches",
      body: obj({ name: str() }, ["name"]), ok: ref("Branch"), status: 201 },
  },
  [`${repo}/branches/{branch}`]: { get: { id: "review_branch", summary: "A branch's review: each file's ops against main now, and its conflicts", tag: "Branches", open: true,
    ok: loose("the branch row, plus {deploys, files: [{path, merged, build, ops, conflicts, lines?}]}") } },
  [`${repo}/branches/{branch}/merge`]: { post: { id: "merge_branch", summary: "Merge a branch into main (the crew)", tag: "Branches", risky: true,
    description: "Conflicts merge nothing (409); settle each conflicting line with `resolve`. A branch that changes build or deploy files needs `build_ok` when commits deploy.",
    body: obj({ resolve: loose("{path: {lineId: \"branch\" | \"main\"}}"), build_ok: bool() }),
    ok: obj({ status: str("merged or open"), merged: arr(obj({ path: str(), rev: int(), ops: int() })), conflicts: arr(loose("{path, conflicts}")) }) } },
  [`${repo}/limits`]: { get: { id: "repo_limits", summary: "What this repo and you may do, and how close you are", tag: "Repos", ok: loose("{git, fresh, files, dig, you: [{label, used, max, window_s, on}]}") } },
  [`${repo}/agents`]: {
    get: { id: "list_agent_runs", summary: "A repo's coding-agent runs, newest first (owner only)", tag: "Agents", query: { path: str() }, ok: arr(loose("a run: {id, harness, task, status, …}")) },
    post: { id: "start_agent", summary: "Give a coding agent a task on a file (owner only)", tag: "Agents",
      body: obj({ path: str(), harness: str("one GET /agents lists"), task: str(), model: str() }, ["path", "harness", "task"]), ok: loose("the run"), status: 202 },
  },
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
  User: obj({ name: str(), bio: str(), theme_html: str() }),
  RepoSummary: obj({ owner: str(), name: str(), visibility: str(), level: str(), created_at: int("ms"), expires_at: { type: ["integer", "null"], description: "a visitor's dig goes then" } }),
  Repo: obj({ owner: str(), name: str(), visibility: str(), level: str(), branch: str(), upstream: str(), created_at: int(), expires_at: { type: ["integer", "null"] },
    collaborators: arr(str()), canWrite: bool(), clone: { type: ["string", "null"], description: "git clone command, read token good for an hour" }, crewClone: { type: ["string", "null"] }, home: str("local or cloud") }),
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

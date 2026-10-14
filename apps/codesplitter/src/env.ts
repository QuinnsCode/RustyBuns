// The Worker's bindings, and the slice of Cloudflare's Artifacts types we use
// (copied from @cloudflare/workers-types so the app needs no extra package).

export interface TreeEntry { name: string; mode: string; hash: string; type: "tree" | "blob" | "symlink" | "gitlink" | "exec" }
export interface CommitMeta { hash: string; treeHash: string; message: string; parents: string[]; author: { name: string; email: string }; authoredAt: number }

export interface ArtifactsRepo {
  info(): Promise<{ name: string; defaultBranch: string; remote: string; readOnly: boolean; source: string | null }>;
  createToken(scope?: "read" | "write", ttl?: number): Promise<{ plaintext: string }>;
  log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<CommitMeta[]>;
  readCommit(hash: string): Promise<CommitMeta | null>;
  readTree(hash: string): Promise<TreeEntry[] | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
  readBlob(hash: string): Promise<Blob | null>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<{ name: string; remote: string; defaultBranch: string }>;
}

export interface Artifacts {
  create(name: string, opts?: { readOnly?: boolean; description?: string; setDefaultBranch?: string }): Promise<{ name: string; remote: string; defaultBranch: string }>;
  get(name: string): Promise<ArtifactsRepo>;
  /** Desktop only: true when import() can read a private source with `source.token`. */
  readonly privateImports?: boolean;
  /** Deletes a repo for good. */
  delete?(name: string): Promise<boolean>;
  import(params: { source: { url: string; branch?: string; depth?: number; token?: string }; target: { name: string; opts?: { description?: string; readOnly?: boolean } } }): Promise<{ name: string; remote: string; defaultBranch: string }>;
}

/** The slice of a Vectorize index that search.ts uses. */
export interface VectorIndex {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, string | number | boolean> }[]): Promise<unknown>;
  query(values: number[], opts: { topK: number; filter?: Record<string, unknown>; returnMetadata?: "none" | "indexed" | "all" }): Promise<{ matches: { id: string; score: number; metadata?: Record<string, unknown> }[] }>;
  getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, unknown> }[]>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** The slice of an R2 bucket that chunks.ts uses. */
/** A LEVEL_DIGS message: a level's first step (`again`: replacing its Artifact), or one part of a big level's swarm (swarm.ts). */
export interface DigMessage { dig: string; user: string | null; again?: boolean; part?: { sha: string; n: number; files: [string, string, number][] } }

export interface R2Like {
  put(key: string, value: Blob | Uint8Array): Promise<unknown>;
  get(key: string, opts?: { range?: { offset: number; length: number } }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Env {
  DB: any;
  FILES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One game room per level or repo: its lobby and multiplayer relay. */
  GAMES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One settings object per person, near where they first connected (settings.ts). */
  SETTINGS: { idFromName(n: string): unknown; get(id: unknown, opts?: { locationHint?: string }): { fetch(r: Request): Promise<Response> } };
  /** One code search index per repo (search.ts). */
  SEARCH: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /**
   * One vector index across every repo's committed code, and Workers AI to embed for it
   * (search.ts). With both, search across repos asks the index which repos to search instead
   * of fanning out. Bound only with CODESPLITTER_VECTORS=1; the desktop has neither.
   */
  VECTORS?: VectorIndex;
  AI?: { run(model: string, inputs: { text: string[] }): Promise<{ data: number[][] }> };
  /** Containers that run hosted coding agents (Cloudflare only; the desktop runs the CLIs itself). */
  AGENT_SANDBOX?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One Durable Object per repo that runs hosted deploys, each in its own container (deploy-runner.ts). Bound only with CODESPLITTER_DEPLOYS=1. */
  DEPLOY_RUNNER?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One Durable Object per repo that runs its queued checks, each in its own container (ci-runner.ts). Bound only with CODESPLITTER_CHECKS=1. */
  CI_RUNNER?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** "off": the desktop doesn't run its own queued checks (ci-runner.ts). local() sets it, so tests claim runs themselves. */
  CHECKS_RUNNER?: string;
  /** Self-healing CI (heal.ts): "1" turns it on for the desktop (it's on with hosted agents), "off" turns it off anywhere. */
  HEAL?: string;
  /** 32 random bytes in base64: seals each repo's stored deploy key (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY?: string;
  /** The DEPLOY_SECRETS_KEY before a rotation: what's sealed under it still opens until an admin re-seals it (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY_OLD?: string;
  /** Shared with the watchdog Worker (watchdog/): lets it report a rollback. Unset, that route is off (watchdog.ts). */
  WATCHDOG_SECRET?: string;
  /** Logins for the agent CLIs in the sandbox (see sandbox.ts). */
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CODEX_API_KEY?: string;
  /** Cloudflare Artifacts (a bare-repo twin on the desktop). Optional: without it, nothing is pushed. */
  ARTIFACTS?: Artifacts;
  /**
   * Levels too big for an Artifacts repo even from the tarball, packed into chunks (chunks.ts).
   * Without it, such a level stays failed with Artifacts' reason.
   */
  LEVEL_CHUNKS?: R2Like;
  /** The landing page's counts, cached for a minute so reads skip D1 (stats.ts). */
  STATS?: { get(key: string, type: "json"): Promise<unknown>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };
  /** Handles allowed to import levels when accounts are on (comma separated). */
  ADMINS?: string;
  /** The owner's verified email; signing in with it claims the first ADMINS handle. */
  ADMIN_EMAIL?: string;
  /** Where privacy requests go, shown on the #/privacy page (privacy.ts). */
  PRIVACY_EMAIL?: string;
  /** A coming change to the privacy page, "YYYY-MM-DD what changes", shown as a banner (privacy.ts). */
  PRIVACY_NOTICE?: string;
  BETTER_AUTH_SECRET?: string;
  /**
   * Cloudflare Email Sending, and the address it sends from (its domain onboarded
   * to Email Sending). With both, email accounts get verification and password
   * reset mail; without them, there's none (see identity.ts).
   */
  EMAIL?: { send(m: { from: string | { email: string; name?: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  /**
   * Cloudflare Turnstile, the bot check on sign-up, password reset and joining a crew
   * (security.ts). On with both; the page gets the site key from GET /api/session.
   */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Tests only: stands in for fetch when Turnstile's answer is checked (see security.ts). */
  TURNSTILE_FETCH?: unknown;
  /** Workers Rate Limiting in front of the per-IP rules (security.ts); edge only. */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** A GitHub token for listing and digging up repos. Without it: the caller's GitHub sign-in, else `gh auth token`. */
  GITHUB_TOKEN?: string;
  /** How many visitors' GitHub digs may be live at once (default 20); past it the oldest goes. */
  DIG_CAP?: string;
  /** "off" stops the desktop asking the GitHub CLI for a token (the tests set it). */
  GH_CLI?: string;
  /** How long, in ms, an agent run's batch waits as a ghost diff on main before it lands (default 8000; 0 writes main directly). See agent-routes.ts. */
  AGENT_REVIEW_MS?: string;
  /** Tests only: stands in for running a coding agent's CLI (see agent-run.ts). */
  AGENT_EXEC?: unknown;
  /** Tests only: stand in for npm, osv.dev, the install-and-test run and the fixer (see deps.ts). */
  DEPS_REGISTRY?: unknown;
  DEPS_ADVISORIES?: unknown;
  DEPS_TESTER?: unknown;
  DEPS_FIXER?: unknown;
  DOCS_REGENERATOR?: unknown;
  /** Tests only: stands in for emailing or notifying the owner about a run (see deps.ts). */
  DEPS_NOTIFY?: unknown;
  /** "1" turns on the supply-chain watch's daily news search, which needs ANTHROPIC_API_KEY (watch.ts). */
  WATCH_NEWS?: string;
  /** Tests only: stands in for fetch to the status pages, osv.dev and the news search (see watch.ts). */
  WATCH_FETCH?: unknown;
  /** Where desktop deploys keep each repo's Alchemy state (deploy.ts); ~/.codesplitters/alchemy if unset. */
  DEPLOY_STATE_DIR?: string;
  /** Tests only: stands in for the commands and the fetch a preview deploy runs (see preview.ts). */
  PREVIEW_RUNNER?: unknown;
  /** Webhook tries, one message each (hooks.ts): a Cloudflare Queue whose consumer is this Worker's queue(). */
  HOOKS: { send(body: { id: string; n: number }, opts?: { delaySeconds?: number }): Promise<void>; sendBatch(messages: Iterable<{ body: { id: string; n: number }; delaySeconds?: number }>): Promise<void> };
  /** Level digs (levels.ts, swarm.ts): a dig's first step, then a big level's parts, side by side. Unset, an import runs in its request. */
  LEVEL_DIGS?: { send(body: DigMessage): Promise<void>; sendBatch(messages: Iterable<{ body: DigMessage; delaySeconds?: number }>): Promise<void> };
  /** Queued requests, one message each (limits.ts), delayed until the caller's window has room, and hosted agent runs (agent-routes.ts): the same Worker's queue() consumes it. */
  JOBS: { send(body: { job: number } | { agent: number; origin: string; land?: true } | { digest: string }, opts?: { delaySeconds?: number }): Promise<void> };
  /** Fix tasks (heal.ts), one message each, apart from JOBS so a rebuild doesn't wait behind feature runs (#1234). Unset, they ride JOBS. */
  FIXES?: { send(body: { agent: number; origin: string }): Promise<void> };
  /** Tests only: stands in for fetch when a webhook is delivered (see hooks.ts). */
  HOOK_FETCH?: unknown;
  /** Tests only: stands in for fetch when checks talk to GitHub's API (see checks.ts). */
  GITHUB_FETCH?: unknown;
  /** Tests only: stands in for running `bun test` on a cut (see cuts.ts). */
  CUT_TESTER?: unknown;
}

export const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });

/** A client's JSON body: the fields a route reads, each unknown until the route checks it. Bad JSON or a non-object just has none. */
export type Body<K extends string> = { [k in K]?: unknown };
export const readBody = async <K extends string>(req: Request): Promise<Body<K>> => (await req.json().catch(() => null)) ?? {};

// Single dashes only, so "owner--repo" names an artifact unambiguously.
export const NAME = /^(?=.{1,39}$)[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What's wrong with `name` as a branch name, or null: git's rule (`git check-ref-format
 * --branch`), so slashes, dots, underscores and capitals are fine, up to 255 bytes. "main"
 * is taken. The web page carries a copy of this (client.html), and a test keeps them alike.
 */
export function branchNameError(name: string): string | null {
  if (!name) return "a branch needs a name";
  if (name === "main") return "main is the branch everything merges into";
  if (new TextEncoder().encode(name).length > 255) return "a branch name is at most 255 bytes";
  const bad = name.match(/[\s~^:?*[\\\x00-\x1f\x7f]/)?.[0];
  if (bad) return /\s/.test(bad) ? "no spaces in a branch name: use - instead" : `a branch name can't have ${/[\x00-\x1f\x7f]/.test(bad) ? "a control character" : `"${bad}"`} in it`;
  if (name === "@") return `a branch can't be just "@"`;
  if (name.includes("@{")) return `a branch name can't have "@{" in it`;
  if (name.includes("..")) return `a branch name can't have ".." in it`;
  if (name.startsWith("-")) return `a branch name can't start with "-"`;
  if (name.startsWith("/") || name.endsWith("/")) return `a branch name can't start or end with "/"`;
  if (name.includes("//")) return `a branch name can't have "//" in it`;
  if (name.endsWith(".")) return `a branch name can't end with "."`;
  if (name.split("/").some((s) => s.startsWith("."))) return `no part of a branch name can start with "."`;
  if (name.split("/").some((s) => s.endsWith(".lock"))) return `no part of a branch name can end with ".lock"`;
  return null;
}

/** An ArtifactsError's code, if that's what this is. */
export const code = (e: unknown) => (e as { code?: string })?.code ?? String((e as Error)?.message ?? e).split(":")[0];

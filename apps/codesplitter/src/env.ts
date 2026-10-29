// The Worker's bindings, and the slice of Cloudflare's Artifacts types we use
// (copied from @cloudflare/workers-types so the app needs no extra package).
import { Bad, type Guard } from "@rustybuns/util/guard";

export interface TreeEntry { name: string; mode: string; hash: string; type: "tree" | "blob" | "symlink" | "gitlink" | "exec" }
export interface CommitMeta { hash: string; treeHash: string; message: string; parents: string[]; author: { name: string; email: string }; authoredAt: number }

export interface ArtifactsRepo {
  info(): Promise<{ name: string; defaultBranch: string; remote: string; readOnly: boolean; source: string | null }>;
  createToken(scope?: "read" | "write", ttl?: number): Promise<{ plaintext: string }>;
  /** Takes a token's plaintext or id away; false when it was not one of this repo's. */
  revokeToken(tokenOrId: string): Promise<boolean>;
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
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

/** A row as D1 hands it over: name the columns you selected with `first<Row>()` / `all<Row>()`. */
export type Row = Record<string, unknown>;
export interface D1Result<T = Row> { results: T[]; success: boolean; meta: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number; duration?: number } }
export interface D1Statement {
  bind(...params: unknown[]): D1Statement;
  first<T = Row>(): Promise<T | null>;
  first<T = unknown>(column: string): Promise<T | null>;
  all<T = Row>(): Promise<D1Result<T>>;
  run<T = Row>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(opts?: { columnNames?: boolean }): Promise<T[]>;
}
/** The D1 binding (Cloudflare's in production, shell-bun's SQLite in tests and on the desktop): the part of its API this app calls. */
export interface D1 {
  prepare(sql: string): D1Statement;
  batch<T = Row>(stmts: D1Statement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

/** The part of a dynamic Worker's code (worker_loader) this app writes, and of the loader it calls (codemode.ts). */
export interface WorkerLoaderLike {
  get(id: string, code: () => { compatibilityDate?: string; mainModule: string; modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: unknown }):
    { getEntrypoint(): { fetch(input: string, init?: RequestInit): Promise<Response> } };
}

export interface Env {
  DB: D1;
  /** Dynamic Workers that run an agent's program over the MCP tools (codemode.ts). Without it the MCP server lists every tool. */
  LOADER?: WorkerLoaderLike;
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
  /** What the check image has (rustybuns.config.ts): JSON like {"docker":false,"rust":false}. */
  CI_IMAGE_CAPS?: string;
  CI_RUNNER?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** "off": the desktop doesn't run its own queued checks (ci-runner.ts). local() sets it, so tests claim runs themselves. */
  CHECKS_RUNNER?: string;
  /** Self-healing CI (heal.ts): "1" turns it on for the desktop (it's on with hosted agents), "off" turns it off anywhere. */
  HEAL?: string;
  /** 32 random bytes in base64: seals each repo's stored deploy key (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY?: string;
  /** The DEPLOY_SECRETS_KEY before a rotation: what's sealed under it still opens until an admin re-seals it (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY_OLD?: string;
  /** "0" stops opening keys and state sealed as "codesplitters …" (deploy-keys.ts, #840). Unset: they still open. */
  DEPLOY_LEGACY_AAD?: string;
  /** Shared with the watchdog Worker (watchdog/): lets it report a rollback. Unset, that route is off (watchdog.ts). */
  WATCHDOG_SECRET?: string;
  /** Bearer for POST /api/admin/drain, which the deploy calls to warn busy rooms (drain.ts). Optional: the route is off without it. */
  DRAIN_SECRET?: string;
  /** Logins for the agent CLIs in the sandbox (see sandbox.ts). */
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CODEX_API_KEY?: string;
  /** Cloudflare Artifacts (a bare-repo twin on the desktop). Optional: without it, nothing is pushed. */
  ARTIFACTS?: Artifacts;
  /**
   * A second namespace made in the EU jurisdiction (REST only, fixed at creation: #2301). A repo made with `region: "eu"`
   * keeps its git here and says so in `repos.namespace` (archive.ts `artifactsFor`). Unbound, "eu" is refused.
   */
  ARTIFACTS_EU?: Artifacts;
  /** The namespace the repos are moving to (artifact-move.ts, #823). Bound only while the move runs. */
  ARTIFACTS_NEXT?: Artifacts;
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
  /** Where profile pages are served from, a host of their own such as https://pages.example.com (page.ts). Unset: from this site, sandboxed. */
  PAGES_ORIGIN?: string;
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
  /** "on" runs the mergiraf on PATH on a file Mervin left cards in (mergiraf.ts); hosted, it runs in the agent container. Tests pass an Exec. */
  MERGIRAF?: unknown;
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
  /** The built pages (dist/client), for the routes that serve one page under a second name (worker.ts). Unset in tests. */
  ASSETS?: { fetch(req: Request): Promise<Response> };
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

// A JSON reply and a client's unchecked body, shared with every app (`@rustybuns/util/http`); routes import them from here.
import { json, readBody, type Body } from "@rustybuns/util/http";
export { json, readBody, type Body };

/** A body through a guard (`@rustybuns/util/guard`): the value typed, or a 400 saying what's wrong, in `why`'s words when given. */
export const need = <T>(v: unknown, g: Guard<T>, why?: string): T | Response => {
  try { return g(v); } catch (e) { if (e instanceof Bad) return json({ error: why ?? e.message }, 400); throw e; }
};

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

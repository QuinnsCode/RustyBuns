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

export interface Env {
  DB: any;
  FILES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One game room per level or repo: its lobby and multiplayer relay. */
  GAMES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** Containers that run hosted coding agents (Cloudflare only; the desktop runs the CLIs itself). */
  AGENT_SANDBOX?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** One Durable Object per repo that runs hosted deploys, each in its own container (deploy-runner.ts). Bound only with CODESPLITTERS_DEPLOYS=1. */
  DEPLOY_RUNNER?: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** 32 random bytes in base64: seals each repo's stored deploy key (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY?: string;
  /** The DEPLOY_SECRETS_KEY before a rotation: what's sealed under it still opens until an admin re-seals it (deploy-keys.ts). */
  DEPLOY_SECRETS_KEY_OLD?: string;
  /** Logins for the agent CLIs in the sandbox (see sandbox.ts). */
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
  CODEX_API_KEY?: string;
  /** Cloudflare Artifacts (a bare-repo twin on the desktop). Optional: without it, nothing is pushed. */
  ARTIFACTS?: Artifacts;
  /** Handles allowed to import levels when accounts are on (comma separated). */
  ADMINS?: string;
  /** The owner's verified email; signing in with it claims the first ADMINS handle. */
  ADMIN_EMAIL?: string;
  BETTER_AUTH_SECRET?: string;
  /**
   * Cloudflare Email Sending, and the address it sends from (its domain onboarded
   * to Email Sending). With both, email accounts get verification and password
   * reset mail; without them, there's none (see identity.ts).
   */
  EMAIL?: { send(m: { from: string | { email: string; name?: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  EMAIL_FROM?: string;
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
  /** Tests only: stands in for running a coding agent's CLI (see agent-run.ts). */
  AGENT_EXEC?: unknown;
  /** Tests only: stand in for npm, the install-and-test run and the fixer (see deps.ts). */
  DEPS_REGISTRY?: unknown;
  DEPS_TESTER?: unknown;
  DEPS_FIXER?: unknown;
  /** Where desktop deploys keep each repo's Alchemy state (deploy.ts); ~/.codesplitters/alchemy if unset. */
  DEPLOY_STATE_DIR?: string;
  /** Tests only: stands in for the commands and the fetch a preview deploy runs (see preview.ts). */
  PREVIEW_RUNNER?: unknown;
  /** Webhook tries, one message each (hooks.ts): a Cloudflare Queue whose consumer is this Worker's queue(). */
  HOOKS: { send(body: { id: string; n: number }, opts?: { delaySeconds?: number }): Promise<void>; sendBatch(messages: Iterable<{ body: { id: string; n: number }; delaySeconds?: number }>): Promise<void> };
  /** Queued requests, one message each (limits.ts), delayed until the caller's window has room: the same Worker's queue() consumes it. */
  JOBS: { send(body: { job: number }, opts?: { delaySeconds?: number }): Promise<void> };
  /** Tests only: stands in for fetch when a webhook is delivered (see hooks.ts). */
  HOOK_FETCH?: unknown;
  /** Tests only: stands in for running `bun test` on a cut (see cuts.ts). */
  CUT_TESTER?: unknown;
}

export const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });

// Single dashes only, so "owner--repo" names an artifact unambiguously.
export const NAME = /^(?=.{1,39}$)[a-z0-9]+(-[a-z0-9]+)*$/;

/** An ArtifactsError's code, if that's what this is. */
export const code = (e: unknown) => (e as { code?: string })?.code ?? String((e as Error)?.message ?? e).split(":")[0];

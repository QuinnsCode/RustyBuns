// Cloudflare Artifacts (git repos for agents) over bare repos in a directory.
// Same binding shape as @cloudflare/workers-types: create/get/import/list/
// delete on the namespace; info, tokens, log, readCommit, readTree, readBlob,
// readFile and fork on a repo. Same write path too: a real git push over smart
// HTTP to the repo's `remote`, served by `git http-backend` behind the repo's
// tokens. So `git clone <remote>` works against a laptop.
//
// Needs `git` on the PATH. Tokens live in memory: they are short-lived on
// Cloudflare too, and a restart just means minting new ones. Repo metadata
// (id, source, readOnly) lives in each bare repo's git config under `rb.*`.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HASH = /^[0-9a-f]{40}$/;

export type ArtifactsErrorCode =
  | "ALREADY_EXISTS" | "NOT_FOUND" | "CREATE_IN_PROGRESS" | "IMPORT_IN_PROGRESS" | "FORK_IN_PROGRESS"
  | "INVALID_INPUT" | "INVALID_REPO_NAME" | "INVALID_TTL" | "INVALID_URL" | "REMOTE_AUTH_REQUIRED"
  | "UPSTREAM_UNAVAILABLE" | "MEMORY_LIMIT" | "INTERNAL_ERROR";

export class ArtifactsError extends Error {
  override readonly name = "ArtifactsError";
  readonly numericCode = 0;
  constructor(readonly code: ArtifactsErrorCode, message: string) { super(`${code}: ${message}`); }
}

interface Token { id: string; repo: string; scope: "read" | "write"; createdAt: number; expiresAt: number; revoked: boolean }

/** Run git and return stdout; throws with stderr. Sync: only for quick local reads and writes. */
function git(args: string[], cwd?: string, input?: Uint8Array) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdin: input, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args[0]}: ${r.stderr.toString().trim()}`);
  return r.stdout;
}
/** Async git, for anything that touches the network or copies a whole repo. */
async function gitAsync(args: string[], cwd?: string, env: Record<string, string> = {}) {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code !== 0) throw new Error(err.trim());
  return code;
}

export class LocalArtifacts {
  /** Where `remote` URLs point. The host sets it once it is listening. */
  remoteBase = "http://127.0.0.1";
  private tokens = new Map<string, Token>();
  /** Repos still importing or forking: get() refuses them, like Cloudflare. */
  private busy = new Map<string, "IMPORT_IN_PROGRESS" | "FORK_IN_PROGRESS">();
  /** Unlike Cloudflare's, import() here takes a token for a private source. */
  readonly privateImports = true;

  constructor(readonly dir: string, readonly namespace: string) { mkdirSync(dir, { recursive: true }); }

  path(name: string) {
    if (!NAME.test(name)) throw new ArtifactsError("INVALID_REPO_NAME", JSON.stringify(name));
    return join(this.dir, name + ".git");
  }
  remote(name: string) { return `${this.remoteBase}/__rb/git/${this.namespace}/${name}.git`; }

  mint(repo: string, scope: "read" | "write" = "write", ttl = 86400) {
    if (ttl < 60 || ttl > 31536000) throw new ArtifactsError("INVALID_TTL", String(ttl));
    const id = crypto.randomUUID().replace(/-/g, "");
    const now = Date.now(), expiresAt = now + ttl * 1000;
    this.tokens.set(id, { id, repo, scope, createdAt: now, expiresAt, revoked: false });
    return { id, plaintext: `art_v1_${id}?expires=${Math.floor(expiresAt / 1000)}`, scope, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Is `secret` (the part before "?expires=") good for this repo and access? */
  check(repo: string, secret: string, write: boolean) {
    const t = this.tokens.get(secret.replace(/^art_v1_/, ""));
    if (!t || t.revoked || t.repo !== repo || t.expiresAt <= Date.now()) return false;
    if (!write) return true;
    return t.scope === "write" && !this.meta(repo).readOnly;
  }

  meta(name: string) {
    const p = this.path(name);
    const get = (k: string) => { try { return git(["config", "--get", `rb.${k}`], p).toString().trim(); } catch { return ""; } };
    return { id: get("id"), source: get("source") || null, readOnly: get("readonly") === "true", description: get("description") || null };
  }
  stamp(p: string, opts: { description?: string; readOnly?: boolean; source?: string }) {
    git(["config", "rb.id", crypto.randomUUID()], p);
    if (opts.description) git(["config", "rb.description", opts.description], p);
    if (opts.readOnly) git(["config", "rb.readonly", "true"], p);
    if (opts.source) git(["config", "rb.source", opts.source], p);
  }
  /** create()-shaped result with a fresh token. */
  result(name: string, readOnly?: boolean) {
    const p = this.path(name), m = this.meta(name);
    const defaultBranch = git(["symbolic-ref", "--short", "HEAD"], p).toString().trim();
    return { id: m.id, name, description: m.description, defaultBranch, remote: this.remote(name), token: this.mint(name, readOnly ? "read" : "write").plaintext };
  }

  async create(name: string, opts: { readOnly?: boolean; description?: string; setDefaultBranch?: string } = {}) {
    const p = this.path(name);
    if (existsSync(p)) throw new ArtifactsError("ALREADY_EXISTS", name);
    git(["init", "--bare", "--quiet", "-b", opts.setDefaultBranch ?? "main", p]);
    this.stamp(p, opts);
    return this.result(name, opts.readOnly);
  }

  /**
   * Import from an external remote. Returns at once with the repo marked
   * importing (get() throws IMPORT_IN_PROGRESS until the clone lands), the way
   * Cloudflare does it. `done` is for tests and hosts that want to wait.
   * `source.token` (local only) reads a private source: it goes to git through
   * the environment for this clone, so it is never in argv or the repo's config.
   */
  async import(params: { source: { url: string; branch?: string; depth?: number; token?: string }; target: { name: string; opts?: { description?: string; readOnly?: boolean } } }) {
    const { source, target } = params;
    if (!/^https:\/\//.test(source.url)) throw new ArtifactsError("INVALID_INPUT", "source.url must be https");
    const name = target.name, p = this.path(name);
    if (existsSync(p) || this.busy.has(name)) throw new ArtifactsError("ALREADY_EXISTS", name);
    this.busy.set(name, "IMPORT_IN_PROGRESS");
    const gh = /^https:\/\/github\.com\/([^/]+\/[^/.]+)/.exec(source.url);
    const args = ["clone", "--bare", "--quiet", "--single-branch", ...(source.branch ? ["--branch", source.branch] : []), ...(source.depth ? ["--depth", String(source.depth)] : []), source.url, p];
    const auth: Record<string, string> = source.token ? {
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa(`x-access-token:${source.token}`)}`,
    } : {};
    this.importing = gitAsync(args, undefined, auth)
      .then(() => this.stamp(p, { ...target.opts, source: gh ? `github:${gh[1]}` : source.url }))
      .catch((e) => { rmSync(p, { recursive: true, force: true }); this.failed.set(name, String(e.message ?? e)); })
      .finally(() => this.busy.delete(name));
    return { id: "", name, description: target.opts?.description ?? null, defaultBranch: source.branch ?? "main", remote: this.remote(name), token: "" };
  }
  /** The last import's promise (tests wait on it) and any failures, by repo name. */
  importing: Promise<unknown> = Promise.resolve();
  failed = new Map<string, string>();

  async get(name: string) {
    const b = this.busy.get(name);
    if (b) throw new ArtifactsError(b, name);
    if (!existsSync(this.path(name))) throw new ArtifactsError("NOT_FOUND", name);
    return new LocalArtifactsRepo(this, name, this.path(name));
  }

  async list(opts: { limit?: number; cursor?: string } = {}) {
    const names = readdirSync(this.dir).filter((f) => f.endsWith(".git")).map((f) => f.slice(0, -4)).sort();
    const start = opts.cursor ? names.indexOf(opts.cursor) + 1 : 0;
    const page = names.slice(start, start + Math.min(opts.limit ?? 50, 200));
    const repos = page.map((n) => { const { remote: _, ...info } = new LocalArtifactsRepo(this, n, this.path(n)).infoSync(); return info; });
    return { repos, total: names.length, cursor: start + page.length < names.length ? page.at(-1) : undefined };
  }

  async delete(name: string) {
    const p = this.path(name);
    if (!existsSync(p)) return false;
    rmSync(p, { recursive: true, force: true });
    for (const [k, t] of this.tokens) if (t.repo === name) this.tokens.delete(k);
    return true;
  }

  /** Mark a fork in progress while its copy runs. */
  async forking<T>(name: string, run: () => Promise<T>) {
    this.busy.set(name, "FORK_IN_PROGRESS");
    try { return await run(); } finally { this.busy.delete(name); }
  }
}

const TYPE: Record<string, "tree" | "blob" | "symlink" | "gitlink" | "exec"> = { "40000": "tree", "100644": "blob", "100755": "exec", "120000": "symlink", "160000": "gitlink" };
// %B is the raw message; fields are NUL-separated and commits end with a record separator.
const FMT = "%H%x00%T%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B%x1e";
const commits = (out: string) => out.split("\x1e").map((s) => s.replace(/^\n/, "")).filter(Boolean).map((rec) => {
  const [hash, treeHash, parents, an, ae, at, cn, ce, ct, message] = rec.split("\0");
  return {
    hash: hash!, treeHash: treeHash!, parents: parents ? parents.split(" ") : [],
    author: { name: an!, email: ae! }, committer: { name: cn!, email: ce! },
    authoredAt: Number(at), committedAt: Number(ct), message: message!.replace(/\n$/, ""),
  };
});

export class LocalArtifactsRepo {
  constructor(private ns: LocalArtifacts, readonly name: string, private p: string) {}
  [Symbol.dispose]() {}

  infoSync() {
    const m = this.ns.meta(this.name), st = statSync(this.p);
    let lastPushAt: string | null = null;
    try { lastPushAt = new Date(Number(git(["log", "-1", "--format=%ct", "--all"], this.p).toString().trim()) * 1000).toISOString(); } catch {}
    return {
      id: m.id, name: this.name, description: m.description,
      defaultBranch: git(["symbolic-ref", "--short", "HEAD"], this.p).toString().trim(),
      createdAt: st.birthtime.toISOString(), updatedAt: st.mtime.toISOString(), lastPushAt,
      source: m.source, readOnly: m.readOnly, remote: this.ns.remote(this.name),
    };
  }
  async info() { return this.infoSync(); }

  async createToken(scope: "read" | "write" = "write", ttl = 86400) { return this.ns.mint(this.name, scope, ttl); }

  async log(opts: { ref?: string; limit?: number; offset?: number } = {}) {
    // --end-of-options: a ref like `--output=x` is a ref, not an option.
    try {
      return commits(git(["log", "--first-parent", `--skip=${opts.offset ?? 0}`, `-n${Math.min(opts.limit ?? 50, 1000)}`, `--format=${FMT}`, "--end-of-options", opts.ref ?? "HEAD", "--"], this.p).toString());
    } catch { return []; } // unresolvable ref: an empty list, like Cloudflare
  }

  private kind(hash: string) {
    if (!HASH.test(hash)) throw new ArtifactsError("INVALID_INPUT", `bad object id ${hash}`);
    try { return git(["cat-file", "-t", hash], this.p).toString().trim(); } catch { return null; }
  }
  async readCommit(hash: string) {
    if (this.kind(hash) !== "commit") return null;
    return commits(git(["show", "-s", `--format=${FMT}`, hash], this.p).toString())[0] ?? null;
  }
  async readTree(hash: string) {
    if (this.kind(hash) !== "tree") return null;
    return git(["ls-tree", "-z", hash], this.p).toString().split("\0").filter(Boolean).map((l) => {
      const [meta, name] = l.split("\t") as [string, string];
      const [mode0, , oid] = meta.split(" ") as [string, string, string];
      const mode = mode0.replace(/^0+/, "");
      return { name, mode, hash: oid, type: TYPE[mode] ?? "blob" };
    });
  }
  async readBlob(hash: string) {
    if (this.kind(hash) !== "blob") return null;
    return new Blob([new Uint8Array(git(["cat-file", "blob", hash], this.p))]);
  }
  async readFile(args: { ref: string; path: string }) {
    if (!args.ref || !args.path) throw new ArtifactsError("INVALID_INPUT", "ref and path are required");
    // Files only: `git show` would happily print a folder's listing.
    const spec = `${args.ref}:${args.path}`;
    try {
      if (git(["cat-file", "-t", "--end-of-options", spec], this.p).toString().trim() !== "blob") return null;
      return new Blob([new Uint8Array(git(["cat-file", "blob", "--end-of-options", spec], this.p))], { type: "text/plain; charset=utf-8" });
    } catch { return null; }
  }

  async fork(name: string, opts: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean } = {}) {
    const target = this.ns.path(name);
    if (existsSync(target)) throw new ArtifactsError("ALREADY_EXISTS", name);
    const branch = git(["symbolic-ref", "--short", "HEAD"], this.p).toString().trim();
    await this.ns.forking(name, () => gitAsync(["clone", "--bare", "--quiet", ...(opts.defaultBranchOnly === false ? [] : ["--single-branch", "--branch", branch]), this.p, target]));
    // A clone doesn't carry config: the fork gets its own id, and is writable unless asked.
    this.ns.stamp(target, { description: opts.description, readOnly: opts.readOnly, source: `artifacts:${this.ns.namespace}/${this.name}` });
    return this.ns.result(name, opts.readOnly);
  }
}

/**
 * Serve `/__rb/git/<namespace>/<repo>.git/...` for these namespaces with
 * `git http-backend`, authorized by the repo's own tokens (Bearer, or Basic
 * with the token as the password) instead of the host's cookie.
 */
export async function gitHttp(req: Request, namespaces: LocalArtifacts[]): Promise<Response> {
  const url = new URL(req.url);
  const m = /^\/__rb\/git\/([^/]+)\/([^/]+)\.git(\/.*)$/.exec(url.pathname);
  const ns = m && namespaces.find((n) => n.namespace === m[1]);
  if (!m || !ns || !NAME.test(m[2]!)) return new Response("not found", { status: 404 });
  const [, , repo, rest] = m as unknown as [string, string, string, string];
  const write = rest === "/git-receive-pack" || url.searchParams.get("service") === "git-receive-pack";

  const h = req.headers.get("authorization") ?? "";
  const secret = h.startsWith("Bearer ") ? h.slice(7)
    : h.startsWith("Basic ") ? atob(h.slice(6)).split(":").slice(1).join(":") : "";
  if (!ns.check(repo, secret.split("?")[0]!, write))
    return new Response("unauthorized", { status: 401, headers: { "www-authenticate": 'Basic realm="artifacts"' } });

  const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : undefined;
  const proc = Bun.spawn(["git", "http-backend"], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: ns.dir, GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/${repo}.git${rest}`, REQUEST_METHOD: req.method, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers.get("content-type") ?? "", CONTENT_LENGTH: String(body?.length ?? 0),
      // http-backend only takes pushes from an authenticated user; we just checked the token.
      REMOTE_USER: "artifacts", REMOTE_ADDR: "127.0.0.1",
    },
    stdin: body ?? "ignore", stdout: "pipe", stderr: "pipe",
  });
  const out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;
  // CGI: headers, a blank line, then the body.
  let split = -1;
  for (let i = 0; i + 3 < out.length; i++) if (out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 && out[i + 3] === 10) { split = i; break; }
  if (split < 0) return new Response("git http-backend failed: " + (await new Response(proc.stderr).text()), { status: 500 });
  const headers = new Headers();
  let status = 200;
  for (const line of new TextDecoder().decode(out.subarray(0, split)).split("\r\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k.toLowerCase() === "status") status = parseInt(v, 10);
    else headers.set(k, v);
  }
  return new Response(out.subarray(split + 4), { status, headers });
}

// Cloudflare Artifacts (git repos for agents) over bare repos in a directory.
// Same binding shape: create/get/list/delete on the namespace, and a repo
// handle with tokens, log and readFile. Same write path too: a real git push
// over smart HTTP to the repo's `remote`, served by `git http-backend` behind
// the repo's tokens. So `git clone <remote>` works against a laptop.
//
// Needs `git` on the PATH. Tokens live in memory: they are short-lived on
// Cloudflare too, and a restart just means minting new ones.

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface Token { id: string; repo: string; scope: "read" | "write"; expiresAt: number }

function git(args: string[], cwd?: string, input?: Uint8Array) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdin: input, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args[0]}: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

export class LocalArtifacts {
  /** Where `remote` URLs point. The host sets it once it is listening. */
  remoteBase = "http://127.0.0.1";
  private tokens = new Map<string, Token>();

  constructor(readonly dir: string, readonly namespace: string) { mkdirSync(dir, { recursive: true }); }

  private path(name: string) {
    if (!NAME.test(name)) throw new Error(`INVALID_INPUT: bad repo name ${JSON.stringify(name)}`);
    return join(this.dir, name + ".git");
  }
  remote(name: string) { return `${this.remoteBase}/__rb/git/${this.namespace}/${name}.git`; }

  mint(repo: string, scope: "read" | "write" = "write", ttl = 3600) {
    const id = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = Date.now() + ttl * 1000;
    this.tokens.set(id, { id, repo, scope, expiresAt });
    return { id, plaintext: `art_v1_${id}?expires=${Math.floor(expiresAt / 1000)}`, scope, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Is `secret` (the part before "?expires=") good for this repo and access? */
  check(repo: string, secret: string, write: boolean) {
    const t = this.tokens.get(secret.replace(/^art_v1_/, ""));
    return !!t && t.repo === repo && t.expiresAt > Date.now() && (!write || t.scope === "write");
  }

  async create(name: string, opts: { readOnly?: boolean; description?: string; setDefaultBranch?: string } = {}) {
    const p = this.path(name);
    if (existsSync(p)) throw new Error(`ALREADY_EXISTS: repo ${name}`);
    const branch = opts.setDefaultBranch ?? "main";
    git(["init", "--bare", "--quiet", "-b", branch, p]);
    if (opts.description) await Bun.write(join(p, "description"), opts.description + "\n");
    return { name, remote: this.remote(name), defaultBranch: branch, token: this.mint(name, opts.readOnly ? "read" : "write").plaintext };
  }

  async get(name: string) {
    if (!existsSync(this.path(name))) throw new Error(`NOT_FOUND: repo ${name}`);
    return new LocalArtifactsRepo(this, name, this.path(name));
  }

  async list(opts: { limit?: number } = {}) {
    const repos = readdirSync(this.dir).filter((f) => f.endsWith(".git")).sort().slice(0, opts.limit ?? 1000)
      .map((f) => ({ name: f.slice(0, -4), status: "ready" as const, remote: this.remote(f.slice(0, -4)) }));
    return { repos, cursor: undefined };
  }

  async delete(name: string) {
    const p = this.path(name);
    if (!existsSync(p)) return false;
    rmSync(p, { recursive: true, force: true });
    for (const [k, t] of this.tokens) if (t.repo === name) this.tokens.delete(k);
    return true;
  }

  async import(): Promise<never> { throw new Error("UNSUPPORTED: import has no local twin yet; clone it and push instead"); }
}

export class LocalArtifactsRepo {
  constructor(private ns: LocalArtifacts, readonly name: string, private p: string) {}
  async info() {
    const head = git(["symbolic-ref", "--short", "HEAD"], this.p).toString().trim();
    return { name: this.name, remote: this.ns.remote(this.name), defaultBranch: head };
  }
  async createToken(scope: "read" | "write" = "write", ttl = 3600) { return this.ns.mint(this.name, scope, ttl); }
  async log(opts: { ref?: string; limit?: number; offset?: number } = {}) {
    let out: string;
    try {
      out = git(["log", `--skip=${opts.offset ?? 0}`, `-n${Math.min(opts.limit ?? 50, 1000)}`, "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s", opts.ref ?? "HEAD", "--"], this.p).toString();
    } catch { return []; } // unresolvable ref: an empty list, like Cloudflare
    return out.split("\n").filter(Boolean).map((l) => {
      const [id, parents, author, email, at, message] = l.split("\0");
      return { id: id!, parents: parents ? parents.split(" ") : [], author: { name: author!, email: email! }, timestamp: Number(at) * 1000, message: message! };
    });
  }
  async readFile(args: { ref: string; path: string }) {
    if (!args.ref || !args.path) throw new Error("INVALID_INPUT: ref and path are required");
    try { return new Blob([new Uint8Array(git(["show", `${args.ref}:${args.path}`], this.p))]); } catch { return null; }
  }
  async fork(name: string) {
    const r = await this.ns.create(name);
    git(["fetch", "--quiet", this.p, "+refs/*:refs/*"], join(this.ns.dir, name + ".git"));
    return r;
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

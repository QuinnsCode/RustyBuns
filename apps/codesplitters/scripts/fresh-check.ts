// Fresh start (src/fresh.ts) against real Cloudflare Artifacts (#314). The app
// runs in-process as in the tests, but its ARTIFACTS is Cloudflare's REST API on
// a throwaway namespace, so every read, push and ref delete goes to Cloudflare.
// Each step's Artifacts calls and D1 queries are counted against what one
// Worker invocation may make. Deletes every repo it made when it's done.
//
//   CLOUDFLARE_API_TOKEN=$(wrangler auth token) CLOUDFLARE_ACCOUNT_ID=… \
//     bun scripts/fresh-check.ts [small] [big <https git url>] [full]
//
//   small  a repo made through the app, moved over in one-object steps: HEAD
//          stays on main, the tree's modes rebuild
//   big    a public repo's tip (pushed: imports stop at 40 MB), moved over at the real step size
//   full   fills a repo past 1 GB to read what Cloudflare says when it's full

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local, type Call } from "../src/local.ts";
import { STEP } from "../src/fresh.ts";
import { push } from "../src/git.ts";
import type { Artifacts, ArtifactsRepo, TreeEntry } from "../src/env.ts";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
let apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !apiToken) throw new Error("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (wrangler auth token)");
const NS = "codesplitters-check";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${account}/artifacts/namespaces/${NS}`;

// Every Artifacts call, REST or git, counted.
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign((input: any, init?: any) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u.includes("/artifacts/") || u.includes(".artifacts.cloudflare.net")) calls++;
  return realFetch(input, init);
}, realFetch);

/** Wrangler's OAuth token lasts about an hour; a big run outlives it. */
async function authed(url: string, init: RequestInit = {}) {
  const go = () => fetch(url, { ...init, headers: { authorization: `Bearer ${apiToken}`, ...init.headers } });
  const res = await go();
  if (res.status !== 401) return res;
  apiToken = Bun.spawnSync(["npx", "wrangler", "auth", "token"], { stderr: "ignore" }).stdout.toString().trim().split("\n").at(-1);
  return go();
}

async function api(path: string, init: RequestInit = {}, ok404 = false): Promise<any> {
  for (let tries = 0; ; tries++) {
    const res = await authed(BASE + path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
    if (ok404 && res.status === 404) return null;
    if (res.status === 409 && tries < 60) { await Bun.sleep(5000); continue; }   // still importing
    const body = await res.json() as any;
    if (!body.success) throw new Error(`artifacts ${init.method ?? "GET"} ${path}: ${res.status} ${JSON.stringify(body.errors)}`);
    return body.result;
  }
}

const made = new Set<string>();
const remoteOf = (r: any) => ({ name: r.name, remote: r.remote, defaultBranch: r.default_branch });

/** The slice of the binding codeSplitters uses, over the REST API. */
class CloudRepo implements ArtifactsRepo {
  constructor(readonly name: string) {}
  async info() {
    const r = await api(`/repos/${this.name}`);
    return { name: r.name, defaultBranch: r.default_branch, remote: r.remote, readOnly: r.read_only, source: r.source };
  }
  async createToken(scope: "read" | "write" = "write", ttl = 3600) {
    return { plaintext: (await api("/tokens", { method: "POST", body: JSON.stringify({ repo: this.name, scope, ttl: Math.max(ttl, 60) }) })).plaintext };
  }
  async log(o: { ref?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    return (await api(`/repos/${this.name}/log?${q}`, {}, true)) ?? [];
  }
  readCommit(hash: string) { return api(`/repos/${this.name}/commit/${hash}`, {}, true); }
  readTree(hash: string) { return api(`/repos/${this.name}/tree/${hash}`, {}, true) as Promise<TreeEntry[] | null>; }
  async readBlob(hash: string) { return this.raw(`/repos/${this.name}/blob/${hash}`); }
  async readFile(a: { ref: string; path: string }) { return this.raw(`/repos/${this.name}/file?ref=${encodeURIComponent(a.ref)}&path=${encodeURIComponent(a.path)}`); }
  async fork(): Promise<never> { throw new Error("not needed here"); }
  private async raw(path: string) {
    const res = await authed(BASE + path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`artifacts GET ${path}: ${res.status} ${await res.text()}`);
    return res.blob();
  }
}

const cloud: Artifacts = {
  async create(name, o = {}) {
    made.add(name);
    return remoteOf(await api("/repos", { method: "POST", body: JSON.stringify({ name, description: o.description, default_branch: o.setDefaultBranch, read_only: o.readOnly }) }));
  },
  async get(name) { return new CloudRepo(name); },
  async delete(name) { made.delete(name); return !!(await api(`/repos/${name}`, { method: "DELETE" }, true)); },
  async import({ source, target }) {
    made.add(target.name);
    const r = remoteOf(await api(`/repos/${target.name}/import`, { method: "POST", body: JSON.stringify({ url: source.url, branch: source.branch, depth: source.depth }) }));
    // The import runs on after the call returns; it's done once the log answers.
    for (let i = 0; i < 120 && !(await new CloudRepo(target.name).log({ limit: 1 }).catch(() => [])).length; i++) await Bun.sleep(5000);
    return r;
  },
};

/** Boot the app on Cloudflare's Artifacts, with D1 queries counted. */
async function boot() {
  const call = await local({ ARTIFACTS: cloud });
  const db = call.env.DB, prepare = db.prepare.bind(db), batch = db.batch.bind(db);
  // Each statement counts, a batch's too (Cloudflare doesn't say whether a batch is one).
  const counter = { queries: 0 };
  let inBatch = false;
  const counted = (o: any) => {
    for (const m of ["first", "all", "run", "raw"]) { const f = o[m]?.bind(o); if (f) o[m] = (...a: any[]) => (inBatch || counter.queries++, f(...a)); }
    return o;
  };
  db.prepare = (sql: string) => {
    const s = counted(prepare(sql)), bind = s.bind.bind(s);
    s.bind = (...a: any[]) => counted(bind(...a));
    return s;
  };
  db.batch = async (stmts: unknown[]) => {
    counter.queries += stmts.length;
    inBatch = true;
    try { return await batch(stmts); } finally { inBatch = false; }
  };
  return { call, db: counter };
}

const post = (call: Call, user: string, path: string, body: unknown = {}) => call(user, path, { method: "POST", body: JSON.stringify(body) });
const get = async (call: Call, user: string, path: string) => (await call(user, path)).json() as Promise<any>;
const sh = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
function check(ok: boolean, what: string) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

/** Drive a fresh start step by step, as the page's polls would; each step's cost. */
async function run(call: Call, db: { queries: number }, owner: string, repo: string) {
  const steps: { state: string; calls: number; queries: number; ms: number; done: number; total: number }[] = [];
  const t0 = Date.now();
  let f = await (async () => {
    const c = calls, q = db.queries, t = Date.now();
    const res = await post(call, owner, `/api/repos/${owner}/${repo}/fresh`);
    const body = await res.json() as any;
    if (res.status !== 202) throw new Error(`fresh start: ${res.status} ${JSON.stringify(body)}`);
    steps.push({ state: body.state, calls: calls - c, queries: db.queries - q, ms: Date.now() - t, done: body.done, total: body.total });
    return body;
  })();
  while (f.state === "walking" || f.state === "copying") {
    const c = calls, q = db.queries, t = Date.now();
    f = await get(call, owner, `/api/repos/${owner}/${repo}/fresh`);
    steps.push({ state: f.state, calls: calls - c, queries: db.queries - q, ms: Date.now() - t, done: f.done, total: f.total });
    if (steps.length % 10 === 0) console.log(`  … step ${steps.length}: ${f.state} ${f.done}/${f.total}`);
  }
  const max = (k: "calls" | "queries" | "ms") => Math.max(...steps.map((s) => s[k]));
  console.log(`  ${steps.length} steps in ${((Date.now() - t0) / 1000).toFixed(0)}s; the most in one step: ${max("calls")} Artifacts calls, ${max("queries")} D1 queries, ${(max("ms") / 1000).toFixed(1)}s`);
  return { f, steps, max };
}

/** The new git: one root commit of the old tip's tree, no staging ref, and a stock clone that fscks. */
async function verifyMoved(call: Call, owner: string, repo: string, tree: string) {
  const { git } = await get(call, owner, `/api/repos/${owner}/${repo}/limits`);
  const fresh = new CloudRepo(git.artifact);
  const log = await fresh.log({ ref: "main" });
  check(log.length >= 1 && log.at(-1)!.parents.length === 0 && log.at(-1)!.treeHash === tree, `new Artifact ${git.artifact}: a root commit with the old tree ${tree.slice(0, 7)}`);
  const a = await fresh.info(), tok = (await fresh.createToken("read", 600)).plaintext.split("?")[0];
  const dir = mkdtempSync(join(tmpdir(), "cs-fresh-check-"));
  try {
    const auth = ["-c", `http.extraHeader=Authorization: Bearer ${tok}`];
    const refs = sh(["git", ...auth, "ls-remote", "--symref", a.remote], dir);
    check(refs.code === 0 && refs.out.startsWith("ref: refs/heads/main\tHEAD") && refs.out.trim().split("\n").length === 3, `HEAD is main, and main is the only branch: ${refs.out.trim().replace(/\n/g, " | ")}`);
    const clone = sh(["git", ...auth, "clone", "-q", a.remote, "r"], dir);
    check(clone.code === 0 && !clone.err.trim(), `a stock git clone checks out main ${clone.err.trim()}`);
    const fsck = sh(["git", "fsck", "--full", "--strict"], join(dir, "r"));
    check(fsck.code === 0, `git fsck --full --strict ${fsck.err.trim().slice(0, 200)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return git;
}

async function small() {
  console.log("small: a repo made through the app, one object a step");
  const { call, db } = await boot();
  const owner = `chk${Date.now().toString(36)}`;
  try {
    await post(call, owner, "/api/login", { name: owner });
    await post(call, owner, "/api/repos", { name: "dig" });
    for (const [path, content] of [["src/a.ts", "export const a = 1"], ["src/deep/b.ts", "export const b = 2"], ["README", "found it"]]) {
      await post(call, owner, `/api/repos/${owner}/dig/files`, { path, content });
      const r = await (await post(call, owner, `/api/repos/${owner}/dig/do/commit?path=${encodeURIComponent(path)}`, { message: `add ${path}` })).json() as any;
      if (r.git?.error) throw new Error(`commit ${path}: ${r.git.error}`);
    }
    const old = new CloudRepo(`${owner}--dig`);
    const [tip] = await old.log({ ref: "main", limit: 1 });
    const modes = (await old.readTree(tip!.treeHash))!.map((e) => `${e.mode} ${e.type} ${e.name}`);
    console.log(`  readTree on Cloudflare: ${modes.join(" · ")}`);
    check(modes.some((m) => m.startsWith("40000 tree")), `a tree's mode comes back as "40000"`);

    const was = { ...STEP };
    Object.assign(STEP, { reads: 1, bytes: 1 });
    let res;
    try { res = await run(call, db, owner, "dig"); } finally { Object.assign(STEP, was); }
    check(res.f.state === "done" && !res.f.error, `fresh start done: ${res.f.done}/${res.f.total} objects ${res.f.error ?? ""}`);
    await verifyMoved(call, owner, "dig", tip!.treeHash);
  } finally { call.close(); }
}

async function big(url: string) {
  console.log(`big: ${url}'s tip, ${STEP.reads} reads and ${STEP.bytes / 1024 ** 2} MB a step`);
  const { call, db } = await boot();
  const owner = `chk${Date.now().toString(36)}`, name = `${owner}--big`;
  const dir = mkdtempSync(join(tmpdir(), "cs-fresh-big-"));
  try {
    await post(call, owner, "/api/login", { name: owner });
    await post(call, owner, "/api/repos", { name: "big" });
    // Cloudflare's import stops at 40 MB, so the tip goes up with stock git: a shallow
    // clone, its tree as one commit, pushed to the repo's empty Artifact.
    let t = Date.now();
    for (const cmd of [["git", "clone", "-q", "--depth", "1", url, "src"], ["git", "-C", "src", "checkout", "-q", "--orphan", "tip"], ["git", "-C", "src", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qm", "tip"]]) {
      const r = sh(cmd, dir);
      if (r.code) throw new Error(`${cmd.join(" ")}: ${r.err}`);
    }
    const tree = sh(["git", "-C", "src", "rev-parse", "HEAD^{tree}"], dir).out.trim();
    const repo = new CloudRepo(name), a = await repo.info(), tok = (await repo.createToken("write", 3600)).plaintext.split("?")[0];
    const p = sh(["git", "-C", "src", "-c", `http.extraHeader=Authorization: Bearer ${tok}`, "-c", "http.postBuffer=500000000", "push", "-q", a.remote, "tip:main"], dir);
    if (p.code) throw new Error(`push: ${p.err}`);
    const counts = sh(["git", "-C", "src", "count-objects", "-vH"], dir).out.match(/size-pack: (.*)/)?.[1];
    console.log(`  pushed ${sh(["git", "-C", "src", "ls-files"], dir).out.split("\n").length - 1} files (${counts} packed) in ${((Date.now() - t) / 1000).toFixed(0)}s`);
    const res = await run(call, db, owner, "big");
    check(res.f.state === "done" && !res.f.error, `fresh start done: ${res.f.done}/${res.f.total} objects, ${(res.f.bytes / 1024 ** 2).toFixed(1)} MB ${res.f.error ?? ""}`);
    // One Worker invocation: 10,000 subrequests (paid default) and 1,000 D1 queries.
    check(res.max("calls") < 10_000, `every step's Artifacts calls fit a Worker's subrequests (most ${res.max("calls")})`);
    check(res.max("queries") < 1_000, `every step's D1 queries fit a Worker invocation's 1,000 (most ${res.max("queries")})`);
    await verifyMoved(call, owner, "big", tree);
  } finally { call.close(); rmSync(dir, { recursive: true, force: true }); }
}

async function full() {
  console.log("full: a repo filled past 1 GB, and what a push to it says");
  const name = `chk${Date.now().toString(36)}--full`;
  const art = await cloud.create(name, { setDefaultBranch: "main" });
  const repo = new CloudRepo(name), tok = (await repo.createToken("write", 7200)).plaintext;
  const auth = ["-c", `http.extraHeader=Authorization: Bearer ${tok.split("?")[0]}`, "-c", "http.postBuffer=100000000"];
  const dir = mkdtempSync(join(tmpdir(), "cs-fresh-full-"));
  try {
    sh(["git", "init", "-q", "-b", "main"], dir);
    // 30 MB of random bytes a commit (under the 32 MB file cap, and it won't compress).
    let failed = "";
    for (let i = 0; i < 40 && !failed; i++) {
      writeFileSync(join(dir, `f${i}.bin`), randomBytes(30 * 1024 ** 2));
      sh(["git", "add", "-A"], dir);
      sh(["git", "-c", "user.name=c", "-c", "user.email=c@c", "commit", "-qm", `fill ${i}`], dir);
      const p = sh(["git", ...auth, "push", "-q", art.remote, "main"], dir);
      if (p.code) failed = p.err.trim();
      else if (i % 5 === 4) console.log(`  … ${(i + 1) * 30} MB pushed`);
    }
    console.log(`  stock git's push into a full repo: ${failed || "(never failed)"}`);
    // And what the app's own push sees, which is what fresh.ts's FULL has to match.
    let appErr = "";
    try { await push(art.remote, tok, { changes: { "README": "one more\n" }, message: "one more", author: "c", branch: "main", base: repo }); }
    catch (e) { appErr = (e as Error).message; }
    console.log(`  the app's push into a full repo: ${appErr || "(it landed)"}`);
    const FULL = /storage|quota|too large|exceed|size limit|limit exceeded|no space/i;
    check(!!appErr && FULL.test(appErr), "fresh.ts reads the app's push error as a full repo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function randomBytes(n: number) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

const args = process.argv.slice(2);
try {
  if (!args.length || args.includes("small")) await small();
  if (args.includes("big")) await big(args[args.indexOf("big") + 1] ?? "https://github.com/alchemy-run/alchemy");
  if (args.includes("full")) await full();
} finally {
  for (const name of made) await cloud.delete!(name).catch((e) => console.log(`  couldn't delete ${name}: ${e.message}`));
  console.log(`deleted ${NS} repos this made; ${calls} Artifacts calls in all`);
}

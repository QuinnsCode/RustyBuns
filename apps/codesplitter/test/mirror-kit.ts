// What the mirror tests share: an upstream as a bare repo on disk, a signed-in desktop, and the
// moves both sides make. Split across three files so bun test --parallel can run them side by side;
// each file gets its own copy of this module, so its own temp root and `up`.
import { afterAll, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";

// Upstream: a bare repo on disk, so "GitHub goes down" is a rename. Commits go up as this identity.
export const root = mkdtempSync(join(tmpdir(), "codesplitter-mirror-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
/** The upstream the current test works against; mirrored() points it at a fresh one. */
export let up = join(root, "up.git");
export const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

export const sh = async (cmd: string, cwd = root) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new Error(`${cmd}: ${err}`);
  return out.trim();
};
export const post = (call: Call, path: string, body: unknown = {}) => call("ana", path, { method: "POST", body: JSON.stringify(body) });
export const get = async (call: Call, path: string) => (await call("ana", path)).json() as Promise<any>;
export const sync = async (call: Call, body: unknown = {}) => (await post(call, "/api/repos/ana/up/mirror", body)).json() as Promise<any>;
export const file = async (call: Call, path: string) => get(call, `/api/repos/ana/up/do/file?path=${encodeURIComponent(path)}`);
/** Set line `n` (from 1) of a file here, then commit it. */
export async function editHere(call: Call, path: string, n: number, text: string, commit = true) {
  const line = (await file(call, path)).lines[n - 1];
  const r = await post(call, `/api/repos/ana/up/do/ops?path=${encodeURIComponent(path)}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text }] });
  expect(r.status).toBe(200);
  if (commit) expect((await post(call, `/api/repos/ana/up/do/commit?path=${encodeURIComponent(path)}`, { message: `edit ${path}` })).status).toBe(200);
}
/** Upstream starts over: one new commit of `files`, force-pushed over its history. */
export async function upstreamRewrite(files: Record<string, string>, message: string, work?: string) {
  if (!work) { work = mkdtempSync(join(root, "work-")); await sh(`git init -q -b main .`, work); }
  await sh(`git config user.name Bo && git config user.email bo@example.com`, work);
  for (const [p, c] of Object.entries(files)) { await sh(`mkdir -p "$(dirname ${p})"`, work); writeFileSync(join(work, p), c); }
  await sh(`git add -A && git commit -qm "${message}" && git push -qf ${up} main`, work);
}
/** A fresh upstream with a couple of files, and a signed-in desktop with a mirror of it. */
export async function mirrored(name: string) {
  up = join(root, `${name}.git`);
  const seed = mkdtempSync(join(root, "seed-"));
  await sh(`git init -q --bare ${up} && git clone -q ${up} . 2>/dev/null; mkdir src && printf 'hello\\nworld\\n' > README && printf 'export const a = 1\\n' > src/a.ts && git add -A && git commit -qm init && git push -q origin main`, seed);
  const call = await boot();
  opened.push(call);
  await post(call, "/api/login", { name: "ana" });
  expect((await post(call, "/api/mirrors", { url: `file://${up}`, name: "up" })).status).toBe(201);
  return call;
}
/** Somebody else pushes to upstream. */
export async function upstreamCommit(files: Record<string, string>, message: string) {
  const work = mkdtempSync(join(root, "work-"));
  await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com`, work);
  for (const [p, c] of Object.entries(files)) { await sh(`mkdir -p "$(dirname ${p})"`, work); writeFileSync(join(work, p), c); }
  await sh(`git add -A && git commit -qm "${message}" && git push -q origin main`, work);
}
export const upLog = (fmt: string) => sh(`git --git-dir ${up} log -1 --format=${fmt} main`);
export const commit = (call: Call, path: string) => post(call, `/api/repos/ana/up/do/commit?path=${encodeURIComponent(path)}`, { message: `commit ${path}` });
/** The files a push clashed with, once one has: it lands as it arrives, a moment after the push. */
export async function pushClash(call: Call) {
  for (let i = 0; i < 100; i++) {
    const r = await get(call, "/api/repos/ana/up");
    if (r.pushClash) return r.pushClash;
    await Bun.sleep(20);
  }
}
export const upShow = (path: string) => sh(`git --git-dir ${up} show main:${path}`);
/** A fork dug up on the desktop (#875): a mirror's shallow clone, as git sees it, with no mirror_url and a dig's time limit. */
export async function dug(name: string) {
  const call = await mirrored(name) as Awaited<ReturnType<typeof boot>> & { env: any };
  await call.env.DB.prepare("UPDATE repos SET mirror_url = NULL, expires_at = ? WHERE owner = 'ana' AND name = 'up'").bind(Date.now() + 3600_000).run();
  return call;
}
/** Both sides' tips, and what this copy keeps aside: nothing in here may move when a turn stops. */
export const sides = async (call: Awaited<ReturnType<typeof boot>>) => {
  const here = call.artifacts.path("ana--up");
  return {
    upstream: await sh(`git --git-dir ${up} rev-parse main`), here: await sh(`git --git-dir ${here} rev-parse main`),
    kept: await sh(`git --git-dir ${here} for-each-ref refs/kept`),
  };
};
export const turn = (call: Call, body: unknown) => post(call, "/api/repos/ana/up/mirror/turn", body);


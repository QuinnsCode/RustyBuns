#!/usr/bin/env bun
// Dry run of the demo video (docs/demo-video.md) without a camera: walks each beat through the app's own
// API and fails on the first thing a viewer would have seen break. Runs on the local twins by default
// (free); `--url https://...` runs the same beats against a deployed app instead, on a throwaway repo.
//
//   bun run demo-check [--url https://codesplitter.example --cookie "..."] [--user demo]
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local, remote, type Call } from "../src/local.ts";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const URL_ = arg("url"), USER = arg("user") ?? "demo", RUN = Date.now().toString(36);
const REPO = `demo-${RUN}`, base = `/api/repos/${USER}/${REPO}`, at = `${base}/do`, F = "src/server.ts";
const app = URL_ ? null : await local({ GH_CLI: "off" });
const call: Call = app ?? remote(URL_!, arg("cookie"));
const j = (user: string, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  call(user || null, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async (res: Response) => res.json() as Promise<any>;

let failed = 0;
async function beat(name: string, fn: () => Promise<void>) {
  const t = performance.now();
  try { await fn(); console.log(`ok    ${name} (${Math.round(performance.now() - t)} ms)`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}
const must = (cond: unknown, what: string) => { if (!cond) throw new Error(what); };
/** The response, or a failure naming what came back: a number is the one status wanted, a function says which are fine. */
const status = async (res: Promise<Response>, want: number | ((s: number) => boolean), what: string) => {
  const r = await res, ok = typeof want === "number" ? r.status === want : want(r.status);
  if (!ok) throw new Error(`${what}: got ${r.status} ${await r.text()}`);
  return r;
};
const fine = (s: number) => s >= 200 && s < 300;

const SOURCE = "const a = 1;\nconst b = 2;\nconst c = 3;\nfunction run() {\n  return a + b + c;\n}";
const AGENTS = ["agent-claude", "agent-codex"];
type Line = { id: string; text: string; rev: number; by: string };
const lines = async (branch = "") => ((await json(await j(USER, `${at}/file?path=${F}${branch && `&branch=${branch}`}`))).lines as Line[]);

await beat("the page loads", async () => {
  // Locally the page is the built client the shell serves; against a deployment it is whatever `/` answers.
  const html = URL_ ? await (await status(j("", "/"), 200, "GET /")).text() : await Bun.file(join(import.meta.dir, "../dist/client/index.html")).text().catch(() => "");
  must(html.includes("<html") || html.includes("<!doctype") || html.includes("<!DOCTYPE"), URL_ ? "GET / is not a page" : "no built page: run `bun run build` first");
  must((await j("", "/api/openapi.json")).ok, "the API spec doesn't load");
});

await beat("setup: a fresh repo with both agents on the crew", async () => {
  await status(j(USER, "/api/login", { name: USER }), fine, "login");
  await status(j(USER, "/api/repos", { name: REPO, visibility: "public" }), fine, "create repo");
  await status(j(USER, `${base}/files`, { path: F, content: SOURCE }), fine, "add file");
  for (const a of AGENTS) await status(j(USER, `${base}/collaborators`, { name: a }), fine, `invite ${a}`);
});

await beat("the line: stable ids, author per line, time travel", async () => {
  const before = await lines(), ids = before.map((l) => l.id);
  must(before.length === 6 && before.every((l) => l.id && l.by), "every line has an id and an author");
  const log = await json(await j(USER, `${at}/log?path=${F}&since=0`));
  const first = (log.ops as { rev: number }[]).at(-1)!.rev;
  await status(j(AGENTS[0]!, `${at}/ops?path=${F}`, { ops: [{ kind: "insert", after: before[0]!.id, text: "// agent was here" }] }), 200, "insert");
  const now = await lines();
  must(ids.every((id) => now.some((l) => l.id === id)), "ids survived an insert");
  must(now.find((l) => l.text === "// agent was here")?.by === AGENTS[0], "the new line is blamed on the agent");
  const then = await json(await j(USER, `${at}/at?path=${F}&rev=${first}`));
  must(then.lines.length === before.length, `time travel to rev ${first} shows ${then.lines.length} lines, wanted ${before.length}`);
});

await beat("two agents, one file: claims queue the second, a stale edit is refused not clobbered", async () => {
  const ls = await lines(), mine = [ls[2]!, ls[3]!];
  const claim = await json(await status(j(AGENTS[0]!, `${at}/claims?path=${F}`, { id: "run-a", task: "rewrite b and c", lines: mine.map((l) => l.id) }), fine, "claim"));
  const held = await json(await j(USER, `${at}/claims?path=${F}`));
  must(JSON.stringify(held).includes(AGENTS[0]!), "the claim shows who holds the lines");
  const clash = await status(j(AGENTS[1]!, `${at}/ops?path=${F}`, { ops: [{ kind: "set", line: mine[0]!.id, base: mine[0]!.rev, text: "stolen" }] }), 409, "second agent on a held line");
  must((await json(clash)).claims?.length, "the 409 names who holds the lines");
  await status(j(AGENTS[0]!, `${at}/ops?path=${F}`, { claim: claim.id, ops: [{ kind: "set", line: mine[0]!.id, base: mine[0]!.rev, text: "const b = 20;" }] }), 200, "holder edits");
  await status(j(AGENTS[0]!, `${at}/release?path=${F}`, { id: claim.id }), 200, "release");
  await status(j(AGENTS[1]!, `${at}/ops?path=${F}`, { ops: [{ kind: "set", line: mine[0]!.id, base: mine[0]!.rev, text: "const b = 99;" }] }), 409, "stale edit after release");
  const fresh = (await lines()).find((l) => l.id === mine[0]!.id)!;
  must(fresh.text === "const b = 20;", "the holder's edit was clobbered");
  await status(j(AGENTS[1]!, `${at}/ops?path=${F}`, { ops: [{ kind: "set", line: fresh.id, base: fresh.rev, text: "const b = 21;" }] }), 200, "retry with the fresh rev");
});

await beat("merge and review: clashing branches get a plan, a conflict card, and a settled merge", async () => {
  const target = (await lines()).find((l) => l.text.startsWith("const c"))!;
  for (const b of ["b1", "b2"]) await status(j(USER, `${base}/branches`, { name: b }), fine, `branch ${b}`);
  const edit = (b: string, text: string) => j(USER, `${at}/ops?path=${F}&branch=${b}`, { ops: [{ kind: "set", line: target.id, base: target.rev, text }] });
  await status(edit("b1", "const c = 30;"), 200, "b1 edit");
  await status(edit("b2", "const c = 31;"), 200, "b2 edit");
  const plan = await json(await status(j(USER, `${base}/merge-plan`), 200, "merge plan"));
  must(plan.waves.length === 2, `the clash should split into two waves, got ${plan.waves.length}`);
  await status(j(USER, `${base}/branches/b1/merge`, {}), 200, "merge b1");
  const card = await status(j(USER, `${base}/branches/b2/merge`, {}), 409, "merge b2 on b1's line");
  must(JSON.stringify(await json(card)).includes("const c = 31;"), "the conflict card doesn't show the branch's side");
  const merged = await j(USER, `${base}/branches/b2/merge`, { resolve: { [F]: { [target.id]: "branch" } } });
  if (!merged.ok) throw new Error(`settling the conflict gave ${merged.status}: ${await merged.text()}`);
});

await beat("it is real git: clone it with stock git and find the commit", async () => {
  await status(j(USER, `${at}/commit?path=${F}`, { message: "demo" }), fine, "commit to git");
  const { clone } = await json(await j(USER, base));
  must(clone, "the repo page has no clone command");
  const dir = mkdtempSync(join(tmpdir(), "cs-demo-"));
  const sh = async (cmd: string, cwd = dir) => {
    const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
    if ((await p.exited) !== 0) throw new Error(`${cmd.slice(0, 40)} failed: ${await new Response(p.stderr).text()}`);
  };
  try {
    await sh(clone);
    const work = join(dir, REPO);
    must(readFileSync(join(work, F), "utf8").includes("agent was here"), "the clone doesn't hold the agents' edits");
    // Writes reach git as the app's own push, so a stock git sees the commit the app made.
    await sh("git log --oneline | grep -q demo", work);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

app?.close();
console.log(failed ? `\n${failed} beat(s) would have shown a viewer something broken.` : "\nEvery beat held.");
process.exit(failed ? 1 : 0);

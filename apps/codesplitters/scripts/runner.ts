// A runner of your own for codeSplitters checks (#534). It pulls work rather than being pushed
// to, so it runs anywhere that can reach the site: behind a firewall, on a laptop, on a build box
// with no inbound port. The loop: claim the oldest queued run, clone, run, report, again.
//
//   CODESPLITTERS_URL=https://codesplitter.notryanquinn.workers.dev \
//   CODESPLITTERS_TOKEN=cst_… \
//   bun scripts/runner.ts owner/repo [--label my-mac] [--names test,lint] [--command "bun test"] [--once]
//
// Leave CODESPLITTERS_URL out to use the desktop app running on this machine (~/.codesplitters/desktop.json).
// The desktop runs its own queue already (src/ci-runner.ts); this is for running them on another machine.
//
// The token is a write token from your profile page, of someone in the repo's crew. The command
// is the check's own (a required check's `command` in the settings), else --command, else
// `bun test`, run with sh in a fresh clone checked out at the run's sha (or, for a branch edited
// here and not pushed, main with the branch's files laid over it as they are now). Its output streams to
// the run's log every couple of seconds, and each of those PUTs is the heartbeat: go quiet for
// 10 minutes and the run goes back in the queue. Exit 0 passes it; anything else fails it. A
// junit.xml left in the clone goes up as the report. To wrap Jenkins, Docker or anything else,
// make --command the thing that starts it, or copy this loop: it's the whole protocol.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals: [slug] } = parseArgs({ allowPositionals: true, options: {
  label: { type: "string", default: `${process.env.USER ?? "runner"}@${hostname()}` },
  names: { type: "string" }, command: { type: "string" }, once: { type: "boolean" }, idle: { type: "string", default: "10" },
} });
// No CODESPLITTERS_URL: the desktop app, if it's running, from the 0600 file it keeps while it does.
function desktop(): string | undefined {
  try {
    const d = JSON.parse(readFileSync(join(homedir(), ".codesplitters/desktop.json"), "utf8")) as { url: string; token: string; pid: number };
    process.kill(d.pid, 0); // throws when the app is gone and left the file behind
    return `${d.url}/?token=${encodeURIComponent(d.token)}`;
  } catch { return undefined; }
}
const site = process.env.CODESPLITTERS_URL ?? desktop(), token = process.env.CODESPLITTERS_TOKEN;
if (!slug?.includes("/") || !site || !token) throw new Error("usage: CODESPLITTERS_URL=… CODESPLITTERS_TOKEN=cst_… bun scripts/runner.ts owner/repo [--label] [--names a,b] [--command] [--once]");
// The desktop app sits behind its launch token too: a URL like http://127.0.0.1:5199/?token=<it>
// (what RB_NO_BROWSER=1 prints, or desktop() finds) sends it as the cookie the desktop expects.
const u = new URL(site), launch = u.searchParams.get("token");
const base = u.origin + u.pathname.replace(/\/$/, "");
const api = (path: string, body: unknown, method = "POST") => fetch(`${base}/api/repos/${slug}/checks${path}`, {
  method, body: JSON.stringify(body),
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(launch && { cookie: `rb_token_${u.port}=${launch}` }) },
});

// The command is repo code, maybe an agent's: it doesn't get our write token, or the URL (it can carry the desktop launch token).
const { CODESPLITTERS_TOKEN: _token, CODESPLITTERS_URL: _url, ...commandEnv } = process.env;

/** A branch's own files, written over the clone (and the ones it deleted, removed). Says what it did, for the log. */
async function overlay(dir: string, ref: string) {
  const get = (path: string) => fetch(`${base}/api/repos/${slug}${path}`, { headers: { authorization: `Bearer ${token}`, ...(launch && { cookie: `rb_token_${u.port}=${launch}` }) } });
  const res = await get(`/branches/${encodeURIComponent(ref)}`);
  if (!res.ok) throw new Error(`reading branch ${ref}: ${res.status}`);
  const { files } = (await res.json()) as { files: { path: string; merged: boolean; deleted?: boolean }[] };
  const mine = files.filter((f) => !f.merged);
  for (const f of mine) {
    const at = join(dir, f.path);
    if (!at.startsWith(dir + "/")) throw new Error(`${f.path} is outside the repo`);
    if (f.deleted) { await rm(at, { force: true }); continue; }
    const doc = await get(`/do/file?path=${encodeURIComponent(f.path)}&branch=${encodeURIComponent(ref)}`);
    if (!doc.ok) throw new Error(`reading ${f.path} on ${ref}: ${doc.status}`);
    await Bun.write(at, ((await doc.json()) as { lines: { text: string }[] }).lines.map((l) => l.text).join("\n") + "\n");
  }
  return `main, with ${mine.length} file${mine.length === 1 ? "" : "s"} from branch ${ref} as they are now\n`;
}

/** One run, start to finish. */
async function work(job: { id: number; ref: string; sha: string; name: string; clone_url: string | null; command?: string }) {
  const report = (b: object) => api(`/${job.id}`, { runner_label: o.label, ...b }, "PUT");
  const dir = await mkdtemp(join(tmpdir(), "cs-runner-"));
  let out = "";
  const flush = async () => { const append = out; out = ""; if ((await report({ append })).status === 409) throw new Error("lost the claim"); };
  try {
    if (!job.clone_url) throw new Error("the repo has no git to clone yet");
    const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: dir, stderr: "pipe" });
    const cloned = git("clone", "--quiet", job.clone_url, ".");
    if (cloned.exitCode) throw new Error(`git clone failed: ${cloned.stderr}`);
    // A branch that hasn't gone up as a git commit (`<branch>@<time>`): main, with the branch's files laid over it as they are now.
    if (/^[0-9a-f]{40}$/.test(job.sha)) { if (git("checkout", "--quiet", job.sha).exitCode) throw new Error(`${job.sha} isn't a commit in the repo's git`); }
    else if (/@\d+$/.test(job.sha)) out = await overlay(dir, job.ref);
    else throw new Error(`${job.sha} isn't a commit in the repo's git`);
    const command = job.command ?? o.command ?? "bun test";
    out += `$ ${command}\n`;
    const p = Bun.spawn(["sh", "-c", command], { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...commandEnv, CI: "1" } });
    const pump = async (s: ReadableStream<Uint8Array>) => { for await (const t of s.pipeThrough(new TextDecoderStream())) out += t; };
    const tick = setInterval(() => flush().catch(() => p.kill()), 2000);
    const [code] = await Promise.all([p.exited, pump(p.stdout), pump(p.stderr)]).finally(() => clearInterval(tick));
    const junit = await Bun.file(join(dir, "junit.xml")).text().catch(() => undefined);
    await report({ append: out + `\nexit ${code}\n`, status: code === 0 ? "passed" : "failed", ...(junit && { junit }) });
  } catch (e) {
    await report({ append: `${out}\n${(e as Error).message}\n`, status: "failed" }).catch(() => null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

while (true) {
  const res = await api("/claim", { runner_label: o.label, ...(o.names && { names: o.names.split(",") }) });
  if (res.status === 200) {
    const job = await res.json();
    console.log(`${o.label}: ${job.name} on ${job.ref} at ${job.sha.slice(0, 7)} (run ${job.id})`);
    await work(job);
    continue;
  }
  if (res.status !== 204) console.error(`claim: ${res.status} ${await res.text()}`);
  if (o.once) break;   // --once drains what's queued, then stops
  await Bun.sleep(Number(o.idle) * 1000);
}

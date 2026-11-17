// One window for the open MANUAL RUN issues: each card starts its app in the jump state the issue needs,
// and Yes (comment and close) or No (comment, stays open) answers it with the owner's own gh.
//
//   bun run manual                 open http://localhost:4790 (a free port if that one is taken) and go down the queue (y / n on the keyboard)
//   bun run manual --dry           print the gh writes instead of running them
//   --port N, --issues file.json (instead of asking gh), --tags file.json (instead of ~/.rustybuns/manual-tags.json), --no-apps (start nothing)
//
// The issues are read from gh once and kept; the page's refresh button reads them again. (Asking gh on every
// 1.5 s status poll ran into GitHub's rate limit, and an empty reply crashed the queue.)
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { arr, bool, int, obj, oneOf, str } from "../packages/util/src/guard.ts";
import { APPS, Issues, Tags, answer, cleanTags, queue, type AppId, type Issue } from "./manual-runs-lib.ts";
import { portArg } from "../packages/util/src/ports.ts";
import { json } from "../packages/util/src/http.ts";

const args = process.argv.slice(2);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes("--dry"), noApps = args.includes("--no-apps");
const askedPort = value("--port"), port = portArg(askedPort, "manual");
const root = join(import.meta.dir, "..");
const logs = join(tmpdir(), "rustybuns-manual-runs");
mkdirSync(logs, { recursive: true });

async function readIssues(): Promise<Issue[]> {
  const file = value("--issues");
  if (file) return Issues(JSON.parse(await Bun.file(file).text()));
  const p = Bun.spawn(["gh", "issue", "list", "--label", "manual run", "--state", "open", "--limit", "500", "--json", "number,title,body,url,labels"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0 || !out.trim()) throw new Error(`gh issue list failed: ${err.trim() || `exit ${code}, no output`}`);
  return Issues(JSON.parse(out));
}
/** The open issues, read once; `fresh` reads them again. A failed read isn't kept, so the next ask tries again. */
let cached: Promise<Issue[]> | null = null;
function openIssues(fresh = false) {
  if (fresh || !cached) {
    const read = readIssues();
    cached = read;
    read.catch(() => { if (cached === read) cached = null; });
  }
  return cached;
}
openIssues().catch(() => {});

const tagsFile = value("--tags") ?? join(homedir(), ".rustybuns", "manual-tags.json");
async function readTags(): Promise<Tags> {
  if (!existsSync(tagsFile)) return {};
  try { return Tags(JSON.parse(await Bun.file(tagsFile).text())); }
  catch (e) { console.log(`${tagsFile} is unreadable (${e instanceof Error ? e.message : e}); starting with no tags.`); return {}; }
}
async function setTags(number: number, tags: string[]) {
  const all = await readTags(), clean = cleanTags(tags);
  if (clean.length) all[number] = clean; else delete all[number];
  mkdirSync(dirname(tagsFile), { recursive: true });
  await Bun.write(tagsFile, JSON.stringify(all, null, 2) + "\n");
  return clean;
}

type Status = "off" | "starting" | "up" | "exited";
const procs = new Map<AppId, { p: Subprocess; up: boolean; url: string }>();
const status = (id: AppId): Status => {
  const run = procs.get(id);
  return !run ? "off" : run.p.exitCode !== null || run.p.signalCode !== null ? "exited" : run.up ? "up" : "starting";
};

/** A port nothing is listening on (workers' own dev servers sit on the usual ones). */
const freePort = () => { const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); const p = s.port; s.stop(true); return p; };

function start(id: AppId) {
  if (noApps || ["starting", "up"].includes(status(id))) return;
  const app = APPS[id], port = freePort(), log = openSync(join(logs, `${id}.log`), "w");
  const run = { p: Bun.spawn(app.cmd(port), { cwd: join(root, app.dir), stdout: log, stderr: log, stdin: "ignore", detached: true }), up: false, url: `http://127.0.0.1:${port}` };
  procs.set(id, run);
  (async () => {
    while (run.p.exitCode === null && !run.up) {
      run.up = await fetch(run.url).then((r) => r.status < 500, () => false);
      if (!run.up) await Bun.sleep(500);
    }
  })();
}

// Each app runs in its own process group (detached), so a script's shell and what it started (wrangler, esbuild) stop with it.
const stopAll = () => { for (const { p } of procs.values()) try { process.kill(-p.pid, "SIGTERM"); } catch {} };
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, () => { stopAll(); process.exit(0); });

const Answer = obj({ number: int(1, 1e7), yes: bool(), note: str(5000, { min: 0, dflt: "" }) });
const Start = obj({ app: oneOf(Object.keys(APPS) as AppId[]) });
const SetTags = obj({ number: int(1, 1e7), tags: arr(str(100), 30) });
const appsNow = () => Object.fromEntries(Object.entries(APPS).map(([id, a]) => [id, { name: a.name, url: procs.get(id as AppId)?.url ?? "", status: status(id as AppId), log: join(logs, `${id}.log`) }]));
const answered = new Map<number, boolean>();

const listen = (port: number) => Bun.serve({
  port,
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === "/") return new Response(Bun.file(join(import.meta.dir, "manual-runs.html")));
    if (pathname === "/api/queue") {
      try {
        const q = queue(await openIssues(searchParams.has("refresh")), await readTags());
        return json({ ...q, apps: appsNow(), answered: Object.fromEntries(answered), dry });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }
    if (pathname === "/api/apps") return json({ apps: appsNow() });
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    const body: unknown = await req.json().catch(() => null);
    try {
      if (pathname === "/api/start") { start(Start(body).app); return json({ ok: true }); }
      if (pathname === "/api/tags") { const t = SetTags(body); return json({ ok: true, tags: await setTags(t.number, t.tags) }); }
      if (pathname === "/api/answer") {
        const a = Answer(body), cmds = answer(a.number, a.yes, a.note);
        for (const cmd of cmds) {
          if (dry) { console.log(cmd.join(" ")); continue; }
          const r = Bun.spawnSync(cmd, { cwd: root });
          if (r.exitCode !== 0) return json({ error: r.stderr.toString() || `${cmd.join(" ")} failed` }, 502);
        }
        answered.set(a.number, a.yes);
        return json({ ok: true, commands: cmds });
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    return json({ error: "not found" }, 404);
  },
});
/** PORTS.manual unless something else (a worker's preview server) already sits there: then any free port, said out loud. */
const server = (() => {
  try { return listen(port); }
  catch (e) {
    if (askedPort || !(e instanceof Error) || !("code" in e) || e.code !== "EADDRINUSE") throw e;
    console.log(`Port ${port} is taken (\`lsof -nP -iTCP:${port} -sTCP:LISTEN\` says by what); using a free one.`);
    return listen(0);
  }
})();

console.log(`Manual runs: http://localhost:${server.port}${dry ? " (dry: gh writes are printed, not run)" : ""}\nApp logs in ${logs}. Ctrl+C stops it and every app it started.`);
if (!args.includes("--no-open") && !value("--issues")) Bun.spawn(["open", `http://localhost:${server.port}`]);

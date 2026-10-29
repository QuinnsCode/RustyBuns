// One window for the open MANUAL RUN issues: each card starts its app in the jump state the issue needs,
// and Yes (comment and close) or No (comment, stays open) answers it with the owner's own gh.
//
//   bun run manual                 open http://localhost:4790 and go down the queue (y / n on the keyboard)
//   bun run manual --dry           print the gh writes instead of running them
//   --port N, --issues file.json (instead of asking gh), --no-apps (start nothing)
import { mkdirSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { bool, int, obj, oneOf, str } from "../packages/util/src/guard.ts";
import { APPS, Issues, answer, queue, type AppId } from "./manual-runs-lib.ts";

const args = process.argv.slice(2);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes("--dry"), noApps = args.includes("--no-apps");
const port = Number(value("--port") ?? 4790);
const root = join(import.meta.dir, "..");
const logs = join(tmpdir(), "rustybuns-manual-runs");
mkdirSync(logs, { recursive: true });

async function openIssues() {
  const file = value("--issues");
  const text = file
    ? await Bun.file(file).text()
    : Bun.spawnSync(["gh", "issue", "list", "--label", "manual run", "--state", "open", "--limit", "200", "--json", "number,title,body,url"], { cwd: root }).stdout.toString();
  return queue(Issues(JSON.parse(text)));
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
const answered = new Map<number, boolean>();
const json = (v: unknown, status = 200) => Response.json(v, { status });

const server = Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/") return new Response(Bun.file(join(import.meta.dir, "manual-runs.html")));
    if (pathname === "/api/queue") {
      const q = await openIssues();
      const apps = Object.fromEntries(Object.entries(APPS).map(([id, a]) => [id, { name: a.name, url: procs.get(id as AppId)?.url ?? "", status: status(id as AppId), log: join(logs, `${id}.log`) }]));
      return json({ ...q, apps, answered: Object.fromEntries(answered), dry });
    }
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    const body: unknown = await req.json().catch(() => null);
    try {
      if (pathname === "/api/start") { start(Start(body).app); return json({ ok: true }); }
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

console.log(`Manual runs: http://localhost:${server.port}${dry ? " (dry: gh writes are printed, not run)" : ""}\nApp logs in ${logs}. Ctrl+C stops it and every app it started.`);
if (!args.includes("--no-open") && !value("--issues")) Bun.spawn(["open", `http://localhost:${server.port}`]);

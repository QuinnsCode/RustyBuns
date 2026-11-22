import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type Gh } from "./pushes.ts";

setDefaultTimeout(30_000);

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
type Run = { status: string; conclusion: string | null; name: string };
const pass = (name: string): Run => ({ status: "completed", conclusion: "success", name });
// Repos as gh would answer: one passing with 150 commits in the last hour (two pages), one with a
// workflow still running, one where one of two workflows failed, one archived. Anything else is a
// repo gh can't find.
const repos: Record<string, { archived?: boolean; runs: Run[]; commits: string[] }> = {
  "me/live": { runs: [pass("typecheck"), pass("apps")], commits: Array.from({ length: 150 }, () => hoursAgo(0.2)) },
  "me/testing": { runs: [pass("typecheck"), { status: "in_progress", conclusion: null, name: "apps" }], commits: [] },
  "me/broken": { runs: [pass("typecheck"), { status: "completed", conclusion: "failure", name: "apps" }], commits: [hoursAgo(30)] },
  "me/gone": { archived: true, runs: [pass("ci")], commits: [] },
};
const commit = (at: string, i: number) => ({ sha: `abc${i}def0123`, commit: { message: `change ${i}\n\nbody`, committer: { date: at } } });
const gh: Gh = async (args) => {
  const path = args.at(-1) ?? "";
  // one stamp for all: a clock tick between them would reorder the newest-first catalog
  const pushedAt = hoursAgo(1);
  if (args[0] === "repo") return JSON.stringify(Object.keys(repos).map((n) => ({ nameWithOwner: n, pushedAt })));
  if (path === "user/orgs") return "[]";
  const m = path.match(/^repos\/([^/]+\/[^/?]+)(?:\/(commits\/main|commits|actions\/runs))?/);
  const r = m && repos[m[1] ?? ""];
  if (!m || !r) return null;
  if (m[2] === "commits/main") return JSON.stringify(commit(r.commits[0] ?? hoursAgo(300), 0));
  if (m[2] === "commits") {
    const all = r.commits.map(commit);
    return JSON.stringify([all.slice(0, 100), all.slice(100)].filter((p) => p.length));
  }
  if (m[2] === "actions/runs") return JSON.stringify({ workflow_runs: r.runs.map((run) => ({ ...run, html_url: `https://x/${run.name}` })) });
  return JSON.stringify({ full_name: m[1], default_branch: "main", pushed_at: r.commits[0] ?? hoursAgo(300), html_url: `https://github.com/${m[1]}`, homepage: null, archived: !!r.archived, disabled: false });
};

const dir = mkdtempSync(join(tmpdir(), "pushes-"));
const file = join(dir, "pushes.json");
const server = serve({ port: 0, file, gh, ping: async () => true });
const base = `http://localhost:${server.port}`;
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

type Data = { scanning: boolean; repos: string[]; scan: { rows: { repo: string; light: string; why: string; run: string | null; today: number; week: number; days: number[]; last: { subject: string } | null }[] } | null };
async function data(): Promise<Data> {
  for (;;) {
    const d: Data = await (await fetch(`${base}/api/data`)).json();
    if (!d.scanning && d.scan) return d;
    await Bun.sleep(50);
  }
}
const change = (body: unknown) => fetch(`${base}/api/repos`, { method: "POST", body: JSON.stringify(body) });

test("the owner picks the repos they care about and sees a light and counts for each", async () => {
  expect((await data()).repos).toEqual(["QuinnsCode/RustyBuns"]);
  const offered = await (await fetch(`${base}/api/catalog`)).json();
  expect(offered.repos).toEqual(Object.keys(repos));

  expect((await change({ remove: "quinnscode/rustybuns" })).status).toBe(200);
  for (const add of [...Object.keys(repos), "me/missing", "me/live"]) expect((await change({ add })).status).toBe(200);
  expect((await change({ add: "not a repo" })).status).toBe(400);

  const d = await data();
  expect(d.repos).toEqual([...Object.keys(repos), "me/missing"]);
  const row = (n: string) => d.scan?.rows.find((r) => r.repo === n);
  expect(row("me/live")).toMatchObject({ light: "green", today: 150, week: 150, last: { subject: "change 0" } });
  expect(row("me/live")?.days[6]).toBe(150);
  expect(row("me/testing")).toMatchObject({ light: "yellow", why: "apps running" });
  expect(row("me/broken")).toMatchObject({ light: "red", why: "apps failed", run: "https://x/apps", today: 0 });
  expect(row("me/gone")?.light).toBe("red");
  expect(row("me/missing")?.light).toBe("red");
  // The picks outlive the server.
  expect(JSON.parse(readFileSync(file, "utf8")).repos).toEqual(d.repos);
});

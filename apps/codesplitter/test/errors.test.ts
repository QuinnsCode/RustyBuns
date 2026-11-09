import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { codesplitter, failure, type Failure } from "../client.ts";
import { local as boot } from "../src/local.ts";
import type { OpWithErrors } from "../src/openapi.ts";

// Named errors (#3804): branches.ts's failure paths, walked through the running app with the typed client. Each one
// fails with the tag the scenario expects, and the client only names a tag the operation declares (an undeclared one
// comes back Unexpected), so a route answering a tag its openapi.ts entry doesn't list fails here.
setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-errors-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const ORIGIN = "http://cs.test";

/** The tag a call failed with, or "ok". */
async function tagOf<Id extends string>(e: Effect.Effect<unknown, Failure<Id>>): Promise<string> {
  const exit = await Effect.runPromiseExit(e);
  if (Exit.isSuccess(exit)) return "ok";
  const err = exit.cause.reasons.find((r) => r._tag === "Fail");
  return err && "error" in err ? (err.error as { _tag: string })._tag : "defect";
}

test("each branch route's failure comes back as the tag it declares", async () => {
  const call = await boot();
  opened.push(call);
  const as = (user: string) => codesplitter({ url: ORIGIN, retries: 0, send: async (r) => call(user, r.url.slice(ORIGIN.length), { method: r.method, headers: r.headers, ...(r.body && { body: await r.text() }) }) });
  const post = (u: string, url: string, body: unknown, method = "POST") => call(u, url, { method, body: JSON.stringify(body) });
  for (const u of ["ana", "bo", "cy"]) await post(u, "/api/login", { name: u });
  expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
  expect((await post("ana", "/api/repos/ana/lab/files", { path: "a.ts", content: "export const a = 1;" })).status).toBe(201);
  await post("ana", "/api/repos/ana/lab/collaborators", { name: "bo" });
  const ana = as("ana"), bo = as("bo"), cy = as("cy"), at = { owner: "ana", repo: "lab" };
  const setLine = async (branch: string | null, t: string) => {
    const d = await (await call("ana", `/api/repos/ana/lab/do/file?path=a.ts${branch ? `&branch=${branch}` : ""}`)).json() as { lines: { id: string; rev: number }[] };
    const l = d.lines[0]!;
    expect((await post("ana", `/api/repos/ana/lab/do/ops?path=a.ts${branch ? `&branch=${branch}` : ""}`, { ops: [{ kind: "set", line: l.id, text: t, base: l.rev }] })).status).toBe(200);
  };

  // A branch whose line main changes too (a conflict), one stacked on it, and bo's own under protected main.
  expect(await tagOf(ana.call("start_branch", { ...at, body: { name: "fix" } }))).toBe("ok");
  await setLine("fix", "export const a = 2;");
  await setLine(null, "export const a = 3;");
  expect(await tagOf(ana.call("start_branch", { ...at, body: { name: "on-fix", parent: "fix" } }))).toBe("ok");
  expect((await post("ana", "/api/repos/ana/lab/files", { path: "b.ts", content: "b", branch: "on-fix" })).status).toBe(201);
  expect(await tagOf(bo.call("start_branch", { ...at, body: { name: "bo-work" } }))).toBe("ok");
  expect((await post("bo", "/api/repos/ana/lab/files", { path: "c.ts", content: "c", branch: "bo-work" })).status).toBe(201);
  await post("ana", "/api/repos/ana/lab/protect", { on: true }, "PUT");

  const cases: [string, Effect.Effect<unknown, Failure<OpWithErrors>>, string][] = [
    ["not on the crew", cy.call("start_branch", { ...at, body: { name: "x" } }), "NoWriteAccess"],
    ["a name git won't take", ana.call("start_branch", { ...at, body: { name: "a b" } }), "BadBranchName"],
    ["a parent that isn't open", ana.call("start_branch", { ...at, body: { name: "y", parent: "nope" } }), "NoSuchBranch"],
    ["a name that's taken", ana.call("start_branch", { ...at, body: { name: "fix" } }), "BranchExists"],
    ["reviewing no branch", ana.call("review_branch", { ...at, branch: "nope" }), "NoSuchBranch"],
    ["deleting a file it never had", ana.call("delete_branch_file", { ...at, branch: "fix", path: "zz.ts" }), "NoSuchFile"],
    ["rejecting a hunk that went", ana.call("reject_hunk", { ...at, branch: "fix", body: { path: "a.ts", key: "gone" } }), "NoSuchChange"],
    ["a resolve that doesn't parse", ana.call("merge_branch", { ...at, branch: "fix", body: { resolve: 5 } }), "BadInput"],
    ["main changed its line too", ana.call("merge_branch", { ...at, branch: "fix", body: {} }), "Conflicts"],
    ["landing it, one conflict left", ana.call("land", { ...at, branch: "fix", body: {} }), "Conflicts"],
    ["the branch under it is open", ana.call("merge_branch", { ...at, branch: "on-fix", body: {} }), "Stacked"],
    ["its author, main protected", bo.call("merge_branch", { ...at, branch: "bo-work", body: {} }), "BranchProtected"],
    ["a hook that isn't one", ana.call("say_hook", { ...at, branch: "fix", hook: "nope", body: { say: "yay", hash: "x" } }), "NoSuchHook"],
    ["branches not a list", ana.call("merge_clean_branches", { ...at, body: { branches: "fix" } }), "BadInput"],
    ["Mervin's learning, not the owner", bo.call("set_mervin_learning", { ...at, body: { learning: true } }), "OwnerOnly"],
    ["learning not a boolean", ana.call("set_mervin_learning", { ...at, body: { learning: "yes" } }), "BadInput"],
  ];
  const got = [];
  for (const [why, e, want] of cases) got.push([why, await tagOf(e), want]);
  expect(got.filter(([, tag, want]) => tag !== want)).toEqual([]);

  // Merged, it's closed to another merge.
  expect(await tagOf(ana.call("merge_branch", { ...at, branch: "fix", body: { resolve: { "a.ts": { [(await (await call("ana", "/api/repos/ana/lab/do/file?path=a.ts")).json() as { lines: { id: string }[] }).lines[0]!.id]: "branch" } } } }))).toBe("ok");
  expect(await tagOf(ana.call("merge_branch", { ...at, branch: "fix", body: {} }))).toBe("BranchClosed");
  // merge_clean_branches says why each one stayed, by name too.
  const swept = await Effect.runPromise(ana.call("merge_clean_branches", { ...at, body: { branches: ["gone"] } }));
  expect(swept).toMatchObject({ skipped: [{ branch: "gone", tag: "NoSuchBranch" }] });
});

test("each worker.ts route's failure comes back as the tag it declares", async () => {
  const call = await boot();
  opened.push(call);
  const as = (user: string) => codesplitter({ url: ORIGIN, retries: 0, send: async (r) => call(user, r.url.slice(ORIGIN.length), { method: r.method, headers: r.headers, ...(r.body && { body: await r.text() }) }) });
  const post = (u: string, url: string, body: unknown, method = "POST") => call(u, url, { method, body: JSON.stringify(body) });
  for (const u of ["ana", "bo", "cy"]) await post(u, "/api/login", { name: u });
  expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
  expect((await post("ana", "/api/repos", { name: "hid", visibility: "private" })).status).toBe(201);
  expect((await post("ana", "/api/repos/ana/lab/files", { path: "a.ts", content: "export const a = 1;" })).status).toBe(201);
  await post("ana", "/api/repos/ana/lab/collaborators", { name: "bo" });
  await post("ana", "/api/repos/ana/lab/protect", { on: true }, "PUT");
  const ana = as("ana"), bo = as("bo"), cy = as("cy"), at = { owner: "ana", repo: "lab" };

  const cases: [string, Effect.Effect<unknown, Failure<OpWithErrors>>, string][] = [
    ["a profile nobody has", ana.call("get_user", { name: "nobody" }), "NoSuchUser"],
    ["a repo name that won't do", ana.call("create_repo", { body: { name: "a b" } }), "BadInput"],
    ["a private repo you can't see", cy.call("get_repo", { owner: "ana", repo: "hid" }), "NoSuchRepo"],
    ["visibility, not the owner", bo.call("set_repo_visibility", { ...at, body: { visibility: "private" } }), "OwnerOnly"],
    ["deleting, confirmed with the wrong name", ana.call("delete_repo", { ...at, confirm: "lb" }), "BadInput"],
    ["inviting a handle nobody has", ana.call("invite", { ...at, body: { name: "nobody" } }), "NoSuchUser"],
    ["removing someone not in the crew", ana.call("remove_collaborator", { ...at, name: "cy" }), "NotInCrew"],
    ["adding a file off the crew", cy.call("add_file", { ...at, body: { path: "b.ts", content: "b" } }), "NoWriteAccess"],
    ["adding a file that's there", ana.call("add_file", { ...at, body: { path: "a.ts", content: "a" } }), "FileExists"],
    ["adding onto a branch that isn't open", ana.call("add_file", { ...at, body: { path: "b.ts", content: "b", branch: "nope" } }), "NoSuchBranch"],
    ["reading a file that isn't there", ana.call("read_file", { ...at, path: "zz.ts" }), "NoSuchFile"],
    ["the crew, editing protected main", bo.call("edit_lines", { ...at, path: "a.ts", body: { ops: [] } }), "MainProtected"],
    ["searching a repo you can't see", cy.call("search_code", { q: "a", repo: "ana/hid" }), "NoSuchRepo"],
    ["a collection with no title", ana.call("create_collection", { body: { title: " " } }), "BadInput"],
    ["a collection nobody made", ana.call("get_collection", { id: 999 }), "NoSuchCollection"],
    ["adding to someone else's collection", ana.call("collect_lines", { id: 999, body: { owner: "ana", repo: "lab", path: "a.ts", from: 1, to: 1 } }), "NotYourCollection"],
  ];
  const got = [];
  for (const [why, e, want] of cases) got.push([why, await tagOf(e), want]);
  expect(got.filter(([, tag, want]) => tag !== want)).toEqual([]);
});

test("a reply the route didn't declare, a rate limit and a 5xx come back as the common failures", async () => {
  const tags = (id: string, status: number, reply: unknown, retry?: string): [string, number | undefined] => { const f = failure(id, status, reply, retry); return [f._tag, "retryAfter" in f ? f.retryAfter : undefined]; };
  expect([
    tags("merge_branch", 409, { error: "conflicts", tag: "Conflicts" }),
    tags("merge_branch", 409, { error: "?", tag: "HookOff" }),
    tags("read_file", 404, { error: "no such file" }),
    tags("merge_branch", 429, { error: "slow down" }, "7"),
    tags("merge_branch", 503, null),
    tags("merge_branch", 401, { error: "bad token" }),
  ]).toEqual([["Conflicts", undefined], ["Unexpected", undefined], ["Unexpected", undefined], ["RateLimited", 7], ["Transient", undefined], ["Unauthorized", undefined]]);

  // Transient is the only one retried: a 503 twice, then the answer.
  let n = 0;
  const flaky = codesplitter({ url: ORIGIN, send: async () => ++n < 3 ? new Response("{}", { status: 503 }) : Response.json([]) });
  expect(await Effect.runPromise(flaky.call("list_branches", { owner: "ana", repo: "lab" }))).toEqual([]);
  expect(n).toBe(3);
  let m = 0;
  const held = codesplitter({ url: ORIGIN, send: async () => { m++; return Response.json({ error: "checks", tag: "ChecksHold" }, { status: 409 }); } });
  expect(await tagOf(held.call("merge_branch", { owner: "ana", repo: "lab", branch: "fix", body: {} }))).toBe("ChecksHold");
  expect(m).toBe(1);
});

test("each agent route's failure comes back as the tag it declares", async () => {
  const call = await boot();
  opened.push(call);
  // A fake CLI that upper-cases the file; its batch waits a minute on main, so it can be read, held and accepted.
  call.env.AGENT_EXEC = async (_cmd: unknown, cwd: string) => { const f = join(cwd, "a.ts"); writeFileSync(f, (await Bun.file(f).text()).toUpperCase()); return { code: 0, out: "done" }; };
  call.env.AGENT_REVIEW_MS = "60000";
  const as = (user: string) => codesplitter({ url: ORIGIN, retries: 0, send: async (r) => call(user, r.url.slice(ORIGIN.length), { method: r.method, headers: r.headers, ...(r.body && { body: await r.text() }) }) });
  const post = (u: string, url: string, body: unknown) => call(u, url, { method: "POST", body: JSON.stringify(body) });
  for (const u of ["ana", "bo", "cy"]) await post(u, "/api/login", { name: u });
  expect((await post("ana", "/api/repos", { name: "lab" })).status).toBe(201);
  expect((await post("ana", "/api/repos", { name: "hid", visibility: "private" })).status).toBe(201);
  expect((await post("ana", "/api/repos/ana/lab/files", { path: "a.ts", content: "export const a = 1;" })).status).toBe(201);
  expect((await post("ana", "/api/repos/ana/lab/files", { path: ".gitattributes", content: "gen.ts codesplitter-live=locked\n" })).status).toBe(201);
  await post("ana", "/api/repos/ana/lab/collaborators", { name: "bo" });
  const ana = as("ana"), bo = as("bo"), cy = as("cy"), at = { owner: "ana", repo: "lab" };
  const task = { path: "a.ts", harness: "claude", task: "shout" };

  const cases: [string, Effect.Effect<unknown, Failure<OpWithErrors>>, string][] = [
    ["runs of a repo you can't see", cy.call("list_agent_runs", { owner: "ana", repo: "hid" }), "NoSuchRepo"],
    ["runs, off the crew", cy.call("list_agent_runs", at), "NoWriteAccess"],
    ["the crew starting one", bo.call("start_agent", { ...at, body: task }), "OwnerOnly"],
    ["a harness there isn't", ana.call("start_agent", { ...at, body: { ...task, harness: "nope" } }), "BadInput"],
    ["a locked file", ana.call("start_agent", { ...at, body: { ...task, path: "gen.ts" } }), "PathLocked"],
    ["stopping by ids that aren't", ana.call("stop_agents", { ...at, body: { ids: "x" } }), "BadInput"],
    ["telling a run there isn't", ana.call("tell_agent", { ...at, id: 999, body: { text: "hi" } }), "NoSuchRun"],
    ["a thread, off the crew", cy.call("open_agent_thread", { ...at, body: { path: "a.ts", task: "t" } }), "NoWriteAccess"],
    ["a thread with no task", bo.call("open_agent_thread", { ...at, body: { path: "a.ts", task: "" } }), "BadInput"],
    ["reading a thread there isn't", bo.call("read_agent_thread", { ...at, id: 999 }), "NoSuchRun"],
    ["the engine lines, not the owner", bo.call("rebuild_engine_lines", at), "OwnerOnly"],
    ["the crew rejecting a batch", bo.call("reject_agent_batch", { ...at, id: 999 }), "OwnerOnly"],
    ["holding a run there isn't", bo.call("hold_agent_batch", { ...at, id: 999 }), "NoSuchRun"],
  ];
  const got = [];
  for (const [why, e, want] of cases) got.push([why, await tagOf(e), want]);
  expect(got.filter(([, tag, want]) => tag !== want)).toEqual([]);

  // A run that finished, its batch waiting on main.
  const { id } = await (await post("ana", "/api/repos/ana/lab/agents", task)).json() as { id: number };
  const run = async () => ((await (await call("ana", "/api/repos/ana/lab/agents")).json()) as { id: number; status: string; pending?: { hash: string } }[]).find((r) => r.id === id);
  for (const end = performance.now() + 15_000; performance.now() < end && !(await run())?.pending;) await Bun.sleep(20);
  const after = [
    ["telling a run that ended", await tagOf(bo.call("tell_agent", { ...at, id, body: { text: "more" } })), "RunEnded"],
    ["speaking as an agent that isn't yours", await tagOf(bo.call("say_in_agent_thread", { ...at, id, body: { text: "hi", as: "agent" } })), "NotTheAgent"],
    ["accepting a batch you didn't read", await tagOf(ana.call("accept_agent_batch", { ...at, id, body: { hash: "old" } })), "BranchMoved"],
    ["accepting it, read", await tagOf(ana.call("accept_agent_batch", { ...at, id, body: { hash: (await run())!.pending!.hash } })), "ok"],
    ["holding one that landed", await tagOf(bo.call("hold_agent_batch", { ...at, id })), "NothingWaiting"],
  ];
  expect(after.filter(([, tag, want]) => tag !== want)).toEqual([]);
});

test("each mirror route's failure comes back named, and with no git in its words", async () => {
  // Upstream: a bare git with main and one other branch. Mirrors take any git URL on the desktop (file:// here).
  const up = join(root, "up.git"), seed = mkdtempSync(join(root, "seed-"));
  const sh = (cmd: string) => Bun.$`sh -c ${cmd}`.cwd(seed).quiet();
  await sh(`git init -q --bare ${up} && git clone -q ${up} . 2>/dev/null; echo a > a.ts && git add -A && git commit -qm init && git push -q origin HEAD:main`);
  await sh(`git checkout -qb feat && echo b > b.ts && git add -A && git commit -qm feat && git push -q origin feat`);
  const call = await boot();
  opened.push(call);
  const send = (u: string, url: string, body?: unknown) => call(u, url, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  for (const u of ["ana", "bo"]) await send(u, "/api/login", { name: u });
  expect((await send("ana", "/api/mirrors", { url: `file://${up}` })).status).toBe(201);
  expect((await send("ana", "/api/repos", { name: "lab" })).status).toBe(201);
  expect((await send("ana", "/api/repos/ana/up/mirror/branches", { ref: "feat" })).status).toBe(201);
  expect((await send("ana", "/api/repos/ana/up/branches", { name: "loc" })).status).toBe(201);
  /** A reply's tag, or its status when it has none. */
  const named = async (r: Response) => { const b = await r.json() as { tag?: string }; return b.tag ?? r.status; };

  const cases: [string, () => Promise<Response>, string | number][] = [
    ["syncing, not the owner", () => send("bo", "/api/repos/ana/up/mirror", {}), "OwnerOnly"],
    ["a name you have a repo by", () => send("ana", "/api/mirrors", { url: `file://${up}` }), "RepoExists"],
    ["something that isn't a remote", () => send("ana", "/api/mirrors", { url: "not a remote" }), "BadInput"],
    ["a repo that isn't a mirror", () => send("ana", "/api/repos/ana/lab/mirror", {}), "NotAMirror"],
    ["opening upstream's main as a branch", () => send("ana", "/api/repos/ana/up/mirror/branches", { ref: "main" }), "BadBranchName"],
    ["a branch upstream doesn't have", () => send("ana", "/api/repos/ana/up/mirror/branches", { ref: "nope" }), "NoUpstreamBranch"],
    ["opening it twice", () => send("ana", "/api/repos/ana/up/mirror/branches", { ref: "feat" }), "BranchExists"],
    ["pushing no branch", () => send("ana", "/api/repos/ana/up/mirror/branches/nope/push", {}), "NoSuchBranch"],
    ["pulling one that never went up", () => send("ana", "/api/repos/ana/up/mirror/branches/loc/pull", {}), "NotUpstream"],
    ["pushing a tag there isn't", () => send("ana", "/api/repos/ana/up/mirror/tags/v9/push", {}), "NoSuchTag"],
    ["turning a mirror into one", () => send("ana", "/api/repos/ana/up/mirror/turn"), "AlreadyMirror"],
    ["turning a repo that's no fork", () => send("ana", "/api/repos/ana/lab/mirror/turn"), "NotAFork"],
  ];
  const got = [];
  for (const [why, r, want] of cases) got.push([why, await named(await r()), want]);
  expect(got.filter(([, tag, want]) => tag !== want)).toEqual([]);

  // Upstream not there: a 502 a client retries, said without git's own words.
  const gone = await send("ana", "/api/mirrors", { url: `file://${join(root, "nothing-here.git")}`, name: "gone" });
  expect(gone.status).toBe(502);
  expect((await gone.json() as { error: string }).error).not.toMatch(/fatal|does not appear|repository/i);
});

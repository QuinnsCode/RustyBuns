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

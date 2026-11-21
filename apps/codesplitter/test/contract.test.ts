import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { codesplitter } from "../client.ts";
import { review } from "../src/deploy-review.ts";
import { local as boot } from "../src/local.ts";
import { openapi } from "../src/openapi.ts";
import type { Runner } from "../src/preview.ts";
import { isRecord } from "@rustybuns/util/guard";

// Contract tests (#5333): the running app held to src/openapi.ts. The journey calls operations by id through the
// typed client, and every body sent and every reply that comes back is checked against that operation's schema in
// the spec, so a route that renames a field, changes its type or its status fails here without a test of its own.
// The sweep then sends an empty body to every operation whose spec names a required field: each must refuse it.
// Checked: types, required fields, enums and the success status. A reply field an object's spec doesn't name is a fault
// too (`unnamed`), unless the spec leaves that object open (`loose`, or additionalProperties).
setDefaultTimeout(60_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-contract-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const ORIGIN = "http://cs.test";
const spec = openapi(ORIGIN);
type Schema = Record<string, unknown>;

/** Why `v` isn't `schema` (the part of JSON Schema openapi.ts writes), one line per fault, each led by where it is. */
function faults(schema: unknown, v: unknown, at = "body"): string[] {
  if (!isRecord(schema)) return [];
  if (typeof schema.$ref === "string") return faults((spec.components.schemas as Record<string, Schema>)[schema.$ref.split("/").pop()!], v, at);
  if (Array.isArray(schema.oneOf)) return schema.oneOf.some((s) => !faults(s, v, at).length) ? [] : [`${at}: none of its ${schema.oneOf.length} shapes`];
  if ("const" in schema) return v === schema.const ? [] : [`${at}: not ${JSON.stringify(schema.const)}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(v)) return [`${at}: ${JSON.stringify(v)} is not one of ${schema.enum.join(", ")}`];
  if (schema.type === undefined) return [];
  const is = v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.includes(is) && !(is === "integer" && types.includes("number"))) return [`${at}: ${is}, not ${types.join(" or ")}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => faults(schema.items, x, `${at}[${i}]`));
  if (!isRecord(v)) return [];
  const props = isRecord(schema.properties) ? schema.properties : {};
  const missing = (Array.isArray(schema.required) ? schema.required : []).filter((k) => v[k] === undefined).map((k) => `${at}.${k}: missing`);
  const unnamed = schema.properties && schema.additionalProperties === undefined ? Object.keys(v).filter((k) => !(k in props)).map((k) => `${at}.${k}: unnamed`) : [];
  return [...missing, ...unnamed, ...Object.keys(props).filter((k) => v[k] !== undefined).flatMap((k) => faults(props[k], v[k], `${at}.${k}`))];
}

/** One operation as the spec has it: where it is, the body it takes, and the status and shape of its answer. */
interface Operation { id: string; method: string; path: string; body?: unknown; status: number; ok: unknown }
const content = (o: unknown): unknown => isRecord(o) && isRecord(o.content) && isRecord(o.content["application/json"]) ? o.content["application/json"].schema : undefined;
const OPERATIONS: Operation[] = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).flatMap(([method, o]) => {
  if (!isRecord(o) || typeof o.operationId !== "string" || !isRecord(o.responses)) return [];
  const status = Number(Object.keys(o.responses).find((s) => s.startsWith("2")));
  return [{ id: o.operationId, method: method.toUpperCase(), path, body: content(o.requestBody), status, ok: content(o.responses[String(status)]) }];
}));

async function app(extra: Record<string, unknown> = {}) {
  const call = await boot(extra);
  opened.push(call);
  const post = (u: string, url: string, body: unknown) => call(u, url, { method: "POST", body: JSON.stringify(body) });
  for (const u of ["ana", "bo"]) expect((await post(u, "/api/login", { name: u })).status).toBeLessThan(300);
  return call;
}

/** A signed-in app and `ask`: operation `id` as `user` through the typed client, its body and answer checked against the
 * spec, each fault in `drift` and each operation called in `seen`. */
async function asker(extra: Record<string, unknown> = {}) {
  const call = await app(extra);
  const drift: string[] = [], seen = new Set<string>();
  const ask = async (user: string, id: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const op = OPERATIONS.find((o) => o.id === id);
    if (!op) throw new Error(`the spec has no operation ${id}`);
    if (op.body) drift.push(...faults(op.body, args.body ?? {}, `${id} request`));
    let status = 0;
    const client = codesplitter({ url: ORIGIN, retries: 0, send: async (r) => {
      const res = await call(user, r.url.slice(ORIGIN.length), { method: r.method, headers: r.headers, ...(r.body && { body: await r.text() }) });
      status = res.status;
      return res;
    } });
    const body = await Effect.runPromise(client.call(id, args));
    if (status !== op.status) drift.push(`${id}: answered ${status}, the spec says ${op.status}`);
    drift.push(...faults(op.ok, body, id));
    seen.add(id);
    return body;
  };
  return { call, ask, drift, seen };
}
const field = (v: unknown, k: string): unknown => isRecord(v) ? v[k] : undefined;
const sh = async (cmd: string, cwd = root) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code) throw new Error(`${cmd}: ${err}`);
};

test("a day's work through the API: every body sent and every answer is the shape the spec says", async () => {
  const { ask, drift, seen } = await asker();
  const at = { owner: "ana", repo: "lab" };

  await ask("ana", "create_repo", { body: { name: "lab", visibility: "public" } });
  await ask("ana", "get_repo", at);
  await ask("ana", "add_file", { ...at, body: { path: "src/a.ts", content: "export const a = 1;\nexport const b = 2;" } });
  await ask("bo", "list_files", { ...at, path: "src" });
  const doc = await ask("ana", "read_file", { ...at, path: "src/a.ts" });
  const lines = field(doc, "lines"), first = Array.isArray(lines) ? lines[0] : undefined;
  await ask("ana", "edit_lines", { ...at, path: "src/a.ts", body: { ops: [{ kind: "set", line: field(first, "id"), base: field(first, "rev"), text: "export const a = 3;" }, { kind: "insert", after: field(first, "id"), text: "// three now" }] } });
  await ask("bo", "file_log", { ...at, path: "src/a.ts", since: 0 });

  await ask("ana", "start_branch", { ...at, body: { name: "tidy" } });
  await ask("ana", "add_file", { ...at, body: { path: "notes.md", content: "tidy up", branch: "tidy" } });
  await ask("bo", "list_branches", at);
  await ask("ana", "merge_branch", { ...at, branch: "tidy", body: {} });

  await ask("ana", "get_me");
  await ask("bo", "get_user", { name: "ana" });
  const follow = await ask("bo", "follow", { body: { name: "ana" } });
  await ask("bo", "list_following");
  await ask("bo", "unfollow", { id: field(follow, "id") });

  await ask("ana", "save_program", { name: "count", body: { code: "return 1;", description: "one" } });
  await ask("ana", "list_programs");
  await ask("ana", "get_program", { name: "count" });
  await ask("ana", "delete_program", { name: "count" });

  expect(drift).toEqual([]);
  expect(seen.size).toBe(19);
});

test("a mirror's day, its checks and its deploy settings: every answer is the shape the spec says", async () => {
  const { ask, drift, seen } = await asker();
  // Upstream: a bare repo on disk with a main and Bo's branch.
  const up = join(root, "up.git"), work = mkdtempSync(join(root, "work-"));
  await sh(`git init -q --bare ${up}`);
  await sh(`git clone -q ${up} . 2>/dev/null; printf 'hello\\n' > README && git add -A && git commit -qm init && git push -q origin HEAD:main`, work);
  await sh(`git checkout -qb shiny && printf 'new\\n' > NEW && git add -A && git commit -qm shiny && git push -q origin shiny`, work);
  const at = { owner: "ana", repo: "up" };

  await ask("ana", "create_mirror", { body: { url: `file://${up}`, name: "up", visibility: "public" } });
  await ask("bo", "mirror_status", at);
  await ask("ana", "sync_mirror", { ...at, body: {} });
  await ask("bo", "list_upstream_branches", at);
  await ask("ana", "open_upstream_branch", { ...at, body: { ref: "shiny" } });
  await ask("ana", "pull_upstream_branch", { ...at, branch: "shiny" });
  await ask("ana", "add_file", { ...at, body: { path: "MORE", content: "more", branch: "shiny" } });
  await ask("ana", "push_branch_upstream", { ...at, branch: "shiny" });
  await ask("ana", "make_tag", { ...at, body: { name: "v1" } });
  await ask("ana", "push_tag_upstream", { ...at, name: "v1" });
  await sh(`git tag v0 shiny~1 && git push -q origin v0`, work);
  await ask("bo", "list_upstream_tags", at);
  await ask("ana", "fetch_upstream_tags", { ...at, body: {} });

  // Checks: Ana's CI reports by hand, a runner of Bo's takes one, Ester hears what a red one was.
  const sha = "a".repeat(40);
  await ask("ana", "set_check_settings", { ...at, body: { required: ["test", { name: "lint", paths: ["src"] }] } });
  await ask("bo", "check_settings", at);
  const token = await ask("ana", "create_ci_token", { ...at, body: { label: "jenkins" } });
  await ask("ana", "list_ci_tokens", at);
  await ask("ana", "revoke_ci_token", { ...at, id: field(token, "id") });
  await ask("ana", "record_check", { ...at, body: { ref: "main", sha, name: "lint", runner: "external", status: "failed" } });
  await ask("ana", "record_check", { ...at, body: { ref: "main", sha, name: "test" } });
  await ask("ana", "record_check", { ...at, body: { ref: "main", sha, name: "e2e" } });
  await ask("ana", "invite", { ...at, body: { name: "bo" } });
  const run = await ask("bo", "claim_check", { ...at, body: { runner_label: "bo-box", names: ["test"] } });
  await ask("bo", "update_check", { ...at, id: field(run, "id"), body: { status: "passed", append: "3 pass\n", runner_label: "bo-box" } });
  await ask("bo", "get_check", { ...at, id: field(run, "id") });
  const e2e = await ask("ana", "claim_check", { ...at, body: { runner_label: "ana-box" } });
  await ask("ana", "cancel_check", { ...at, id: field(e2e, "id") });
  await ask("bo", "checks", { ...at, ref: "main" });
  await ask("bo", "answer_ester", { ...at, body: { name: "lint", kind: "flaky", ref: "main", note: "the network" } });
  await ask("bo", "ester_memory", at);

  // Deploys: the settings and what they show, nothing run (a deploy here would run rustybuns on this machine).
  await ask("ana", "set_deploy_settings", { ...at, body: { stage: "live", dir: "", on_commit: false } });
  await ask("ana", "deploy_status", at);
  await ask("ana", "deploy_plan_status", at);

  expect(drift).toEqual([]);
  expect(seen.size).toBe(29);
});

test("the routes that start work, on a stand-in machine: a deploy, its plan and teardown, checks queued, a dug fork turned into a mirror", async () => {
  // The machine a deploy runs on: every command answers 0, git names the commit it was asked to ship, and rustybuns its URL.
  const ran: string[] = [];
  const runner: Runner = {
    exec: async (cmd, _cwd, out) => {
      const line = cmd.join(" ");
      ran.push(line);
      if (line.includes("rev-parse")) out(`${(await review(call.env, "ana", "lab")).tip}\n`);
      if (line.includes("bun -e")) out(`RB ${JSON.stringify({ adopt: false, edge: true, box: false })}\n`);
      if (line.includes("rustybuns deploy")) out('url: "https://lab.ana.workers.dev"\n');
      return 0;
    },
    fetch: async () => ({ status: 200 }),
  };
  const { call, ask, drift, seen } = await asker({ GH_CLI: "off", PREVIEW_RUNNER: runner });
  const at = { owner: "ana", repo: "lab" };
  /** Ask `id` until `done` says its answer is the finished one. */
  const until = async (id: string, done: (v: unknown) => boolean) => {
    for (const end = performance.now() + 15_000; performance.now() < end; await Bun.sleep(20)) {
      const v = await ask("ana", id, at);
      if (done(v)) return v;
    }
    throw new Error(`${id} never finished`);
  };
  const settled = (n: number) => (v: unknown) => { const h = field(v, "history"); return Array.isArray(h) && h.length >= n && h.every((d) => field(d, "status") !== "running"); };

  await ask("ana", "create_repo", { body: { name: "lab", visibility: "public" } });
  await ask("ana", "add_file", { ...at, body: { path: "package.json", content: "{}" } });
  await ask("ana", "commit_file", { ...at, path: "package.json", body: { message: "package.json" } });
  await ask("ana", "set_deploy_settings", { ...at, body: { stage: "prod" } });
  await ask("ana", "deploy", { ...at, body: {} });
  await until("deploy_status", settled(1));
  await ask("ana", "deploy_plan", at);
  await until("deploy_plan_status", (v) => field(field(v, "run"), "done") === true);
  await ask("ana", "deploy_destroy", { ...at, body: { stage: "prod" } });
  await until("deploy_status", settled(2));
  expect(ran.filter((l) => /rustybuns (deploy|plan|destroy)/.test(l)).map((l) => l.match(/rustybuns (\w+)/)![1])).toEqual(["deploy", "plan", "destroy"]);

  await ask("ana", "run_checks", { ...at, body: { on: "desktop" } });
  await ask("ana", "import_github_checks", { ...at, body: {} });

  // A dug fork: a mirror that forgot it was one, as a dig on the desktop is.
  const up = join(root, "dig.git"), work = mkdtempSync(join(root, "work-"));
  await sh(`git init -q --bare ${up}`);
  await sh(`git clone -q ${up} . 2>/dev/null; printf 'hello\\n' > README && git add -A && git commit -qm init && git push -q origin HEAD:main`, work);
  await ask("ana", "create_mirror", { body: { url: `file://${up}`, name: "dig", visibility: "public" } });
  await call.env.DB.prepare("UPDATE repos SET mirror_url = NULL, expires_at = ? WHERE owner = 'ana' AND name = 'dig'").bind(Date.now() + 3600_000).run();
  const dig = { owner: "ana", repo: "dig" };
  expect(field(await ask("ana", "get_repo", dig), "mirrorable")).toBe(true);
  const preview = await ask("ana", "mirror_turn_preview", dig);
  await ask("ana", "turn_into_mirror", { ...dig, body: { ahead: field(preview, "ahead") } });

  expect(drift).toEqual([]);
  expect(seen.size).toBe(15);
});

test("every operation whose spec names a required field refuses a body without one", async () => {
  const call = await app();
  const post = (url: string, body: unknown) => call("ana", url, { method: "POST", body: JSON.stringify(body) });
  expect((await post("/api/repos", { name: "lab" })).status).toBe(201);
  expect((await post("/api/repos/ana/lab/files", { path: "a.ts", content: "a" })).status).toBe(201);
  expect((await post("/api/repos/ana/lab/branches", { name: "open" })).status).toBe(201);
  const fill: Record<string, string> = { owner: "ana", repo: "lab", branch: "open", name: "ana" };
  const strict = OPERATIONS.filter((o) => isRecord(o.body) && Array.isArray(o.body.required) && o.body.required.length);
  expect(strict.length).toBeGreaterThan(20);

  const wrong: string[] = [];
  for (const o of strict) {
    const url = `/api${o.path.replace(/\{(\w+)\}/g, (_, k: string) => fill[k] ?? "1")}`;
    const res = await Promise.race([call("ana", url, { method: o.method, headers: { "content-type": "application/json" }, body: "{}" }).catch((e: unknown) => String(e)), Bun.sleep(10_000).then(() => null)]);
    if (!res) { wrong.push(`${o.id}: no answer in 10 s`); continue; }
    if (typeof res === "string") { wrong.push(`${o.id}: threw ${res.slice(0, 120)}`); continue; }
    const body: unknown = await res.json().catch(() => null);
    if (res.status < 400 || res.status > 499) wrong.push(`${o.id}: answered ${res.status}`);
    else if (!isRecord(body) || typeof body.error !== "string") wrong.push(`${o.id}: its ${res.status} has no error sentence`);
  }
  expect(wrong).toEqual([]);
});

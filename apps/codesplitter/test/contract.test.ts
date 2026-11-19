import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { codesplitter } from "../client.ts";
import { local as boot } from "../src/local.ts";
import { openapi } from "../src/openapi.ts";
import { isRecord } from "@rustybuns/util/guard";

// Contract tests (#5333): the running app held to src/openapi.ts. The journey calls operations by id through the
// typed client, and every body sent and every reply that comes back is checked against that operation's schema in
// the spec, so a route that renames a field, changes its type or its status fails here without a test of its own.
// The sweep then sends an empty body to every operation whose spec names a required field: each must refuse it.
// Checked: types, required fields, enums and the success status. A field the spec doesn't mention is let through.
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
  return [...missing, ...Object.keys(props).filter((k) => v[k] !== undefined).flatMap((k) => faults(props[k], v[k], `${at}.${k}`))];
}

/** One operation as the spec has it: where it is, the body it takes, and the status and shape of its answer. */
interface Operation { id: string; method: string; path: string; body?: unknown; status: number; ok: unknown }
const content = (o: unknown): unknown => isRecord(o) && isRecord(o.content) && isRecord(o.content["application/json"]) ? o.content["application/json"].schema : undefined;
const OPERATIONS: Operation[] = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).flatMap(([method, o]) => {
  if (!isRecord(o) || typeof o.operationId !== "string" || !isRecord(o.responses)) return [];
  const status = Number(Object.keys(o.responses).find((s) => s.startsWith("2")));
  return [{ id: o.operationId, method: method.toUpperCase(), path, body: content(o.requestBody), status, ok: content(o.responses[String(status)]) }];
}));

async function app() {
  const call = await boot();
  opened.push(call);
  const post = (u: string, url: string, body: unknown) => call(u, url, { method: "POST", body: JSON.stringify(body) });
  for (const u of ["ana", "bo"]) expect((await post(u, "/api/login", { name: u })).status).toBeLessThan(300);
  return call;
}

test("a day's work through the API: every body sent and every answer is the shape the spec says", async () => {
  const call = await app();
  const drift: string[] = [], seen = new Set<string>();
  /** Operation `id` as `user`, checked both ways against the spec; answers what came back. */
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
  const at = { owner: "ana", repo: "lab" };

  await ask("ana", "create_repo", { body: { name: "lab", visibility: "public" } });
  await ask("ana", "get_repo", at);
  await ask("ana", "add_file", { ...at, body: { path: "src/a.ts", content: "export const a = 1;\nexport const b = 2;" } });
  await ask("bo", "list_files", { ...at, path: "src" });
  const doc = await ask("ana", "read_file", { ...at, path: "src/a.ts" });
  const first = isRecord(doc) && Array.isArray(doc.lines) && isRecord(doc.lines[0]) ? doc.lines[0] : {};
  await ask("ana", "edit_lines", { ...at, path: "src/a.ts", body: { ops: [{ kind: "set", line: first.id, base: first.rev, text: "export const a = 3;" }, { kind: "insert", after: first.id, text: "// three now" }] } });
  await ask("bo", "file_log", { ...at, path: "src/a.ts", since: 0 });

  await ask("ana", "start_branch", { ...at, body: { name: "tidy" } });
  await ask("ana", "add_file", { ...at, body: { path: "notes.md", content: "tidy up", branch: "tidy" } });
  await ask("bo", "list_branches", at);
  await ask("ana", "merge_branch", { ...at, branch: "tidy", body: {} });

  await ask("ana", "get_me");
  await ask("bo", "get_user", { name: "ana" });
  const follow = await ask("bo", "follow", { body: { name: "ana" } });
  await ask("bo", "list_following");
  await ask("bo", "unfollow", { id: isRecord(follow) ? follow.id : "" });

  await ask("ana", "save_program", { name: "count", body: { code: "return 1;", description: "one" } });
  await ask("ana", "list_programs");
  await ask("ana", "get_program", { name: "count" });
  await ask("ana", "delete_program", { name: "count" });

  expect(drift).toEqual([]);
  expect(seen.size).toBe(20);
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

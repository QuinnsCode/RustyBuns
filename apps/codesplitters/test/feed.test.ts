import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";

// End to end (in-process D1 and file DOs): fine alone, slow on a busy machine.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** ryan's public repo lab (a.ts) and private repo vault (s.ts, carol is crew); ana and carol signed in. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const post = (user: string | null, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  for (const u of ["ryan", "ana", "carol", "bob"]) await post(u, "/api/login", { name: u });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await post("ryan", "/api/repos", { name: "vault", visibility: "private" });
  await post("ryan", "/api/repos/ryan/vault/collaborators", { name: "carol" });
  await post("ryan", "/api/repos/ryan/lab/collaborators", { name: "bob" });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await post("ryan", "/api/repos/ryan/vault/files", { path: "s.ts", content: "secret" });
  const follow = (who: string, kind: string, f: Record<string, unknown>) => call.env.DB.prepare(
    "INSERT INTO follows (follower, kind, target, owner, repo, path, ids, from_line, to_line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(who, kind, f.target, f.owner ?? null, f.repo ?? null, f.path ?? null, f.ids ? JSON.stringify(f.ids) : null, f.from ?? null, f.to ?? null, Date.now()).run();
  const lines = async (repo: string, path: string) => (await (await call("ryan", `/api/repos/ryan/${repo}/do/file?path=${path}`)).json()).lines as { id: string; text: string }[];
  const add = (user: string, repo: string, path: string, text: string) => post(user, `/api/repos/ryan/${repo}/do/ops?path=${path}`, { ops: [{ kind: "insert", after: null, text }] });
  const feed = async (user: string) => (await (await call(user, `/api/me/feed?since=0`)).json()) as any;
  // The DO writes events after the edit answers.
  const settled = async (n: number) => { for (const end = performance.now() + 5000; performance.now() < end;) { if (((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM line_events").first()) as any).n >= n) return; await Bun.sleep(10); } };
  return { call, post, follow, lines, add, feed, settled };
}

test("a burst of edits is one event, blamed and counted, never the text", async () => {
  const { call, add, settled } = await app();
  await add("ryan", "lab", "a.ts", "three");
  await add("ryan", "lab", "a.ts", "four");
  await settled(2);
  const rows = (await call.env.DB.prepare("SELECT * FROM line_events WHERE repo = 'lab' ORDER BY id").all()).results as any[];
  // The file's first two lines and the two inserts fold into one.
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ owner: "ryan", repo: "lab", path: "a.ts", who: "ryan", run: null, inserts: 4, lines: 4 });
  expect(JSON.stringify(rows[0])).not.toContain("three");
});

test("the feed groups who you follow, says who came after, and keeps private repos to their crew", async () => {
  const { follow, add, feed, settled } = await app();
  await add("ryan", "vault", "s.ts", "more");
  await add("bob", "lab", "a.ts", "bob was here");
  await settled(3);
  await follow("ana", "user", { target: "ryan", name: "ryan" });
  await follow("carol", "user", { target: "ryan" });

  const a = await feed("ana");
  expect(a.groups.map((g: any) => g.key)).toEqual(["ryan"]);
  expect(a.groups[0].files.map((f: any) => f.path)).toEqual(["a.ts"]);
  expect(a.groups[0].summary).toBe("@ryan landed 2 lines in lab/a.ts, @bob touched it after");
  expect(a.groups[0].events[0]).not.toHaveProperty("ids");

  // carol is vault's crew, so ryan's vault edits reach her.
  const c = await feed("carol");
  expect(c.groups[0].files.map((f: any) => `${f.repo}/${f.path}`).sort()).toEqual(["lab/a.ts", "vault/s.ts"]);

  // Nobody sees their own edits, and following nothing is an empty feed.
  expect((await feed("ryan")).groups).toEqual([]);
  expect(await feed("bob")).toMatchObject({ follows: 0, groups: [] });
});

test("repo and line follows, and signed out", async () => {
  const { call, follow, lines, add, feed, settled } = await app();
  await settled(2);
  const [first] = await lines("lab", "a.ts");
  await follow("ana", "lines", { target: "x", owner: "ryan", repo: "lab", path: "a.ts", ids: [first!.id], from: 1, to: 1 });
  expect((await feed("ana")).groups.map((g: any) => g.who)).toEqual(["ryan"]);
  await follow("carol", "repo", { target: "ryan/lab", owner: "ryan", repo: "lab" });
  await add("bob", "lab", "a.ts", "hi");
  await settled(3);
  expect((await feed("carol")).groups.map((g: any) => g.who)).toEqual(["bob", "ryan"]);
  // bob's insert isn't on the followed line.
  expect((await feed("ana")).groups.map((g: any) => g.who)).toEqual(["ryan"]);
  expect((await call(null, "/api/me/feed")).status).toBe(401);
});

test("your agent digests the feed, seeing only what you may read", async () => {
  const { call, post, follow, add, settled } = await app();
  await add("ryan", "vault", "s.ts", "more");
  await settled(2);
  await follow("ana", "user", { target: "ryan", name: "ryan" });
  let seen = "";
  call.env.AGENT_EXEC = (async (cmd, cwd) => {
    seen = readFileSync(join(cwd, "FEED.md"), "utf8");
    writeFileSync(join(cwd, "FEED.md"), `ryan has been busy in lab (${cmd.bin}).\n`);
    return { code: 0, out: "" };
  }) as Exec;
  expect((await post("ana", "/api/me/feed/digest", { harness: "nope" })).status).toBe(400);
  const res = await post("ana", "/api/me/feed/digest", { harness: "claude" });
  expect(res.status).toBe(202);
  expect(await res.json()).toMatchObject({ harness: "claude", status: "running" });
  let d: any;
  for (const end = performance.now() + 5000; performance.now() < end && d?.status !== "done";) { d = await (await call("ana", "/api/me/feed/digest")).json(); await Bun.sleep(10); }
  expect(d).toMatchObject({ status: "done", text: "ryan has been busy in lab (claude)." });
  expect(seen).toContain("@ryan landed 2 lines in lab/a.ts");
  expect(seen).not.toContain("vault");
  expect((await (await call("ana", "/api/me/feed")).json()).digest.text).toBe(d.text);

  // Nothing new since: no agent needed.
  call.env.AGENT_EXEC = (async () => { throw new Error("should not run"); }) as Exec;
  await post("ana", "/api/me/feed/digest", { harness: "claude" });
  for (const end = performance.now() + 5000; performance.now() < end && d?.status !== "done";) { d = await (await call("ana", "/api/me/feed/digest")).json(); await Bun.sleep(10); }
  d = await (await call("ana", "/api/me/feed/digest")).json();
  expect(d.text).toBe("Nothing new from who and what you follow.");
});

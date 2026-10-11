import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { listFollows } from "../src/follows.ts";
import { local as boot } from "../src/local.ts";

// End to end (in-process D1 and file DOs), like privacy.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** ryan with a public repo `pub` and a private `lab`; mia and an agent who's been on lab's crew. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = async (user: string, url: string, body?: unknown, method = "POST") => {
    const res = await call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "pub" });
  await send("ryan", "/api/repos/ryan/pub/files", { path: "a.ts", content: "one\ntwo\nthree\nfour" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "b.ts", content: "secret\nplans" });
  await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "agent-claude" });
  return { call, send };
}

describe("follows", () => {
  test("a person, an agent, a repo and some lines, listed newest first, each once", async () => {
    const { send } = await app();
    expect((await send("mia", "/api/follows", { name: "@ryan" })).body).toMatchObject({ kind: "user", name: "ryan" });
    expect((await send("mia", "/api/follows", { name: "agent-claude" })).body).toMatchObject({ kind: "agent", name: "agent-claude" });
    expect((await send("mia", "/api/follows", { owner: "ryan", repo: "pub" })).status).toBe(201);
    const lines = await send("mia", "/api/follows", { owner: "ryan", repo: "pub", path: "a.ts", from: 2, to: 3 });
    expect(lines.status).toBe(201);
    expect(lines.body).toMatchObject({ kind: "lines", owner: "ryan", repo: "pub", path: "a.ts", from_line: 2, to_line: 3 });
    expect(lines.body.ids).toHaveLength(2);
    // Again: the follow you have.
    const again = await send("mia", "/api/follows", { owner: "ryan", repo: "pub", path: "a.ts", from: 2, to: 3 });
    expect(again).toEqual({ status: 200, body: lines.body });

    const list = (await send("mia", "/api/me/following", undefined, "GET")).body as any[];
    expect(list.map((f) => f.kind).sort()).toEqual(["agent", "lines", "repo", "user"]);
    const ryan = (await send("mia", "/api/users/ryan", undefined, "GET")).body;
    expect([ryan.following, ryan.followers]).toEqual([0, 1]);
    expect((await send("ryan", "/api/users/mia", undefined, "GET")).body.following).toBe(4);
  });

  test("no following yourself, nobody who isn't, or a file that isn't", async () => {
    const { send } = await app();
    expect((await send("ryan", "/api/follows", { name: "ryan" })).status).toBe(400);
    expect((await send("ryan", "/api/follows", { name: "nobody" })).status).toBe(404);
    expect((await send("ryan", "/api/follows", { owner: "ryan", repo: "pub", path: "nope.ts", from: 1, to: 1 })).status).toBe(404);
    expect((await send("ryan", "/api/follows", {})).status).toBe(400);
  });

  test("a private repo only its crew can follow, and only its crew sees in a list", async () => {
    const { call, send } = await app();
    expect((await send("mia", "/api/follows", { owner: "ryan", repo: "lab" })).status).toBe(404);
    expect((await send("ryan", "/api/follows", { owner: "ryan", repo: "lab", path: "b.ts", from: 1, to: 2 })).status).toBe(201);
    await call.env.DB.prepare("INSERT INTO collaborators (owner, repo, name) VALUES ('ryan', 'lab', 'mia')").run();
    expect((await send("mia", "/api/follows", { owner: "ryan", repo: "lab" })).status).toBe(201);
    expect((await send("mia", "/api/follows", { owner: "ryan", repo: "pub" })).status).toBe(201);
    // Signed out, or not crew: mia follows one repo.
    expect((await call(null, "/api/users/mia").then((r) => r.json()) as any).following).toBe(1);
    // Off the crew, it's gone from her own list too; back on, it's back.
    await call.env.DB.prepare("DELETE FROM collaborators WHERE name = 'mia'").run();
    expect((await listFollows(call.env.DB, "mia")).map((f) => f.kind === "repo" && f.repo)).toEqual(["pub"]);
    // And a public repo going private takes it out of everyone's but the crew's.
    await send("ryan", "/api/repos/ryan/pub", { visibility: "private" }, "PUT");
    expect(await listFollows(call.env.DB, "mia")).toEqual([]);
    expect((await listFollows(call.env.DB, "ryan")).map((f) => f.kind)).toEqual(["lines"]);
  });

  test("a followed range keeps up with its lines by id", async () => {
    const { call, send } = await app();
    const f = (await send("mia", "/api/follows", { owner: "ryan", repo: "pub", path: "a.ts", from: 3, to: 4 })).body;
    const doc = (await (await call("ryan", "/api/repos/ryan/pub/do/file?path=a.ts")).json()) as { lines: { id: string }[] };
    await send("ryan", "/api/repos/ryan/pub/do/ops?path=a.ts", { ops: [{ kind: "insert", after: null, text: "zero" }] });
    // Following lines 4–5 now is the same follow: same first and last line.
    const now = await send("mia", "/api/follows", { owner: "ryan", repo: "pub", path: "a.ts", from: 4, to: 5 });
    expect(now).toEqual({ status: 200, body: f });
    expect(f.ids).toEqual(doc.lines.slice(2, 4).map((l) => l.id));
  });

  test("unfollow is the follower's alone", async () => {
    const { send } = await app();
    const f = (await send("mia", "/api/follows", { name: "ryan" })).body;
    expect((await send("ryan", `/api/follows/${f.id}`, undefined, "DELETE")).status).toBe(404);
    expect((await send("mia", `/api/follows/${f.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await send("mia", "/api/me/following", undefined, "GET")).body).toEqual([]);
    expect((await send("mia", "/api/follows", { name: "ryan" })).status).toBe(201);
  });

  test("signed out, nothing to follow or list", async () => {
    const { call } = await app();
    expect((await call(null, "/api/me/following")).status).toBe(401);
    expect((await call(null, "/api/follows", { method: "POST", body: JSON.stringify({ name: "ryan" }) })).status).toBe(401);
  });

  test("deleting a repo drops its follows; deleting an account drops theirs and of them", async () => {
    const { call, send } = await app();
    await send("mia", "/api/follows", { owner: "ryan", repo: "pub" });
    await send("mia", "/api/follows", { name: "ryan" });
    await send("ryan", "/api/follows", { name: "mia" });
    await send("ryan", "/api/repos/ryan/pub?confirm=pub", undefined, "DELETE");
    expect((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE repo = 'pub'").first()).n).toBe(0);
    expect((await send("mia", "/api/me/export", undefined, "GET")).body.following.map((f: any) => f.name)).toEqual(["ryan"]);
    await send("mia", "/api/me?confirm=mia", undefined, "DELETE");
    expect((await call.env.DB.prepare("SELECT COUNT(*) AS n FROM follows").first()).n).toBe(0);
  });

  test("agents follow too, with MCP's follow, unfollow and list_following", async () => {
    const { call, send } = await app();
    const token = (await send("mia", "/api/tokens", { label: "mcp", scope: "write" })).body.token;
    const tool = async (name: string, args: unknown) => (await (await call(null, "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json() as any).result;
    const made = await tool("follow", { body: { owner: "ryan", repo: "pub", path: "a.ts", from: 1, to: 2 } });
    expect(made.isError).toBe(false);
    const f = JSON.parse(made.content[0].text);
    expect(JSON.parse((await tool("list_following", {})).content[0].text)).toEqual([f]);
    expect((await tool("unfollow", { id: String(f.id) })).isError).toBe(false);
    expect(JSON.parse((await tool("list_following", {})).content[0].text)).toEqual([]);
  });
});

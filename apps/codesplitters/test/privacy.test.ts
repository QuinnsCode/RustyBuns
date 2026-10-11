import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// End to end (real git, in-process D1), like tokens.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** ryan with a private repo, a collection and a token, and a collaborator on mia's repo. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("ryan", "/api/playlists", { title: "favourite regexes" });
  await send("mia", "/api/repos", { name: "pit" });
  await call.env.DB.prepare("INSERT INTO collaborators (owner, repo, name) VALUES ('mia', 'pit', 'ryan')").run();
  await call.env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ryan', 'lab', 'a.ts', 'claude', 'secret plans', 'agent-claude', 'done', 0)").run();
  const token = (await (await send("ryan", "/api/tokens", { label: "script", scope: "write" })).json()) as { token: string };
  const bearer = (url: string, method = "GET") => call(null, url, { method, headers: { authorization: `Bearer ${token.token}` } });
  return { call, send, token: token.token, bearer };
}

describe("your data", () => {
  test("the export has what we hold about you, and no secrets", async () => {
    const { call, token } = await app();
    const res = await call("ryan", "/api/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("codesplitters-ryan.json");
    const out = (await res.json()) as any;
    expect(out.handle).toBe("ryan");
    expect(out.repos.map((r: any) => r.name)).toEqual(["lab"]);
    expect(out.collaborating_on).toEqual([{ owner: "mia", repo: "pit" }]);
    expect(out.collections[0].title).toBe("favourite regexes");
    expect(out.api_tokens).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain(token);
    expect(JSON.stringify(out)).not.toContain("hash");
  });

  test("a token can't export or delete; only the person can", async () => {
    const { bearer } = await app();
    expect((await bearer("/api/me/export")).status).toBe(403);
    expect((await bearer("/api/me?confirm=ryan", "DELETE")).status).toBe(403);
  });

  test("deleting asks for the handle, then buries the account and retires the handle", async () => {
    const { call } = await app();
    expect((await call("ryan", "/api/me", { method: "DELETE" })).status).toBe(400);
    const res = await call("ryan", "/api/me?confirm=ryan", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("cs_user=;");
    expect((await call(null, "/api/users/ryan")).status).toBe(404);
    expect((await call("mia", "/api/repos/ryan/lab")).status).toBe(404);
    const db = call.env.DB;
    for (const [table, where] of [["repos", "owner"], ["collaborators", "name"], ["playlists", "owner"], ["api_tokens", "name"], ["agent_runs", "owner"]])
      expect(await db.prepare(`SELECT 1 FROM ${table} WHERE ${where} = 'ryan'`).first()).toBeNull();
    expect(await db.prepare("SELECT email FROM handle_grants WHERE handle = 'ryan'").first()).toEqual({ email: "retired:ryan" });
    // mia's repo is hers, untouched.
    expect((await call("mia", "/api/repos/mia/pit")).status).toBe(200);
  });
});

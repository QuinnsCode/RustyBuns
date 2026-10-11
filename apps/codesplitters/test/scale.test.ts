import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { CARDS, stateOf } from "../src/scale.ts";

// End to end (in-process D1), like insights.test.ts.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

test("a reading's state: under half is fine, past 80% is critical, none is unmeasured", () => {
  expect(stateOf({ value: 4, limit: 10, unit: "x", note: "" })).toBe("ok");
  expect(stateOf({ value: 5, limit: 10, unit: "x", note: "" })).toBe("warn");
  expect(stateOf({ value: 8, limit: 10, unit: "x", note: "" })).toBe("bad");
  expect(stateOf({ value: null, limit: 10, unit: "x", note: "" })).toBe("unmeasured");
  expect(stateOf(undefined)).toBe("unmeasured");
});

test("admins get every card with live readings; nobody else does", async () => {
  const call = await boot({ GH_CLI: "off", ADMINS: "boss" });
  opened.push(call);
  for (const u of ["boss", "ryan"]) await call(u, "/api/login", { method: "POST", body: JSON.stringify({ name: u }) });
  expect((await call("ryan", "/api/admin/scale")).status).toBe(403);
  expect((await call(null, "/api/admin/scale")).status).toBe(403);

  const db = call.env.DB;
  await db.prepare("INSERT INTO repo_search (owner, repo, files, text_bytes, size_bytes, big_path, big_bytes, big_lines, updated_at) VALUES ('ryan', 'lab', 1, 2000, 8192, 'big.ts', 2000, 1001, 0)").run();
  await db.prepare("INSERT INTO limit_hits (rule, who, win, count) VALUES ('edit', 'ryan', ?, 120)").bind(Date.now() - 60_000).run();
  await db.prepare(`INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ryan', 'lab', 'big.ts', 'claude', 't', 'agent-claude', 'running', ?)`).bind(Date.now()).run();
  await db.prepare(`INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started) VALUES ('ryan', 'lab', 'big.ts', 'claude', 't', 'agent-claude', 'running', ?)`).bind(Date.now()).run();

  const r = await call("boss", "/api/admin/scale");
  expect(r.status).toBe(200);
  const d: any = await r.json();
  expect(d.cards.map((c: any) => c.id)).toEqual(CARDS.map((c) => c.id));
  const card = (id: string) => d.cards.find((c: any) => c.id === id);
  // 120 edits by one typist in a minute: tallied at most once a second, so 60 writes.
  expect(card("d1-writes").reading.value).toBe(1);
  expect(card("big-file").reading.note).toContain("ryan/lab/big.ts");
  expect(card("big-file").reading.note).toContain("1,001 lines");
  expect(card("search").reading).toMatchObject({ value: 8192, limit: 10 * 1024 ** 3 });
  expect(card("search").reading.note).toContain("ryan/lab");
  expect(card("d1-size").reading.value).toBeGreaterThan(0);
  // Two runs on a cap of two: critical, and the page leads with it.
  expect(card("agents")).toMatchObject({ state: "bad", reading: { value: 2, limit: 2 } });
  expect(card("hot-file").state).toBe("unmeasured");
  expect(d.worst).toBe("bad");
});

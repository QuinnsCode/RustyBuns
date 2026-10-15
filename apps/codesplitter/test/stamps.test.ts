import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// End to end (in-process D1 and file DOs), like privacy.test.ts.

/** ana's public repo with a file whose second line agent-claude wrote, and bo signed in. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  const send = (user: string | null, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const u of ["ana", "bo"]) await send(u, "/api/login", { name: u });
  await send("ana", "/api/repos", { name: "pub" });
  await send("ana", "/api/repos/ana/pub/files", { path: "a.ts", content: "one\ntwo\nthree" });
  await send("ana", "/api/repos/ana/pub/collaborators", { name: "agent-claude" });
  const lines = async (who = "ana") => ((await (await call(who, "/api/repos/ana/pub/do/file?path=a.ts")).json()) as { lines: { id: string; text: string; rev: number }[] }).lines;
  const two = (await lines())[1]!;
  await send("agent-claude", "/api/repos/ana/pub/do/ops?path=a.ts", { ops: [{ kind: "set", line: two.id, base: two.rev, text: "TWO" }] });
  const stamps = async (who: string | null) => (await (await call(who, "/api/repos/ana/pub/stamps?path=a.ts")).json()) as { line: string; n: number; stamps: Record<string, string[]> }[];
  return { call, send, lines, stamps };
}

describe("stamps", () => {
  test("a stamp goes on a line, an agent's too, and follows it by id through edits", async () => {
    const { send, lines, stamps } = await app();
    const [one, two] = await lines();
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "shovel", from: 2 })).status).toBe(201);
    expect((await send("ana", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "shovel", lines: [two!.id] })).status).toBe(201);
    // Stamping twice is still one stamp.
    await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "shovel", lines: [two!.id] });
    await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", lines: [one!.id] });
    expect(await stamps(null)).toEqual([{ line: one!.id, n: 1, stamps: { "+1": ["bo"] } }, { line: two!.id, n: 2, stamps: { shovel: ["bo", "ana"] } }]);

    // A line put in above moves it down; the stamp goes with it, and goes when the line does.
    await send("ana", "/api/repos/ana/pub/do/ops?path=a.ts", { ops: [{ kind: "insert", after: null, text: "zero" }, { kind: "delete", line: one!.id, base: one!.rev }] });
    expect(await stamps(null)).toEqual([{ line: two!.id, n: 2, stamps: { shovel: ["bo", "ana"] } }]);

    // Taking yours off leaves everyone else's.
    expect((await send("bo", `/api/repos/ana/pub/stamps?path=a.ts&line=${two!.id}&stamp=shovel`, undefined, "DELETE")).status).toBe(200);
    expect((await stamps(null))[0]!.stamps).toEqual({ shovel: ["ana"] });
  });

  test("a page with the file open hears that its stamps changed, and nothing of which lines", async () => {
    const { call, send, lines } = await app();
    const [one] = await lines();
    const ws = ((await call("bo", "/api/repos/ana/pub/do/ws?path=a.ts", { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
    ws.toBrowser = (d: string) => got.push(JSON.parse(d));
    const pings = async (n: number) => {
      for (const end = performance.now() + 5_000; performance.now() < end;) { if (got.filter((m) => m.type === "stamps").length >= n) break; await Bun.sleep(5); }
      return got.filter((m) => m.type === "stamps");
    };
    await send("ana", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "gem", lines: [one!.id] });
    expect(await pings(1)).toEqual([{ type: "stamps" }]);
    await send("ana", `/api/repos/ana/pub/stamps?path=a.ts&line=${one!.id}&stamp=gem`, undefined, "DELETE");
    expect(await pings(2)).toHaveLength(2);
  });

  test("signed out, a stamp that isn't one, or a line that isn't there, is refused", async () => {
    const { send } = await app();
    expect((await send(null, "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", from: 1 })).status).toBe(401);
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "poop", from: 1 })).status).toBe(400);
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", lines: ["nope"] })).status).toBe(400);
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", from: 1, to: 200 })).status).toBe(201);
  });

  test("a private line is the crew's to stamp and see stamped; a private repo's, nobody else's", async () => {
    const { call, send, lines, stamps } = await app();
    const [one] = await lines();
    await send("ana", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "binoculars", lines: [one!.id] });
    await send("ana", "/api/repos/ana/pub/do/private?path=a.ts", { lines: [one!.id], private: true });
    expect((await stamps("ana")).map((s) => s.n)).toEqual([1]);
    expect(await stamps("bo")).toEqual([]);
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", lines: [one!.id] })).status).toBe(400);

    await call("ana", "/api/repos/ana/pub", { method: "PUT", body: JSON.stringify({ visibility: "private" }) });
    expect((await call("bo", "/api/repos/ana/pub/stamps?path=a.ts")).status).toBe(404);
    expect((await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "+1", from: 2 })).status).toBe(404);
  });
});

describe("agent profiles", () => {
  test("say who runs it, on what, where, its pulse and its runs; a run's task stays its owner's", async () => {
    const { call, send, lines } = await app();
    await send("bo", "/api/repos", { name: "hidden", visibility: "private" });
    await send("bo", "/api/repos/bo/hidden/collaborators", { name: "agent-claude" });
    const run = (owner: string, repo: string, task: string, applied: number, started: number) =>
      call.env.DB.prepare("INSERT INTO agent_runs (owner, repo, path, harness, task, agent, status, started, result) VALUES (?, ?, 'a.ts', 'claude', ?, 'agent-claude', 'done', ?, ?)")
        .bind(owner, repo, task, started, JSON.stringify({ applied })).run();
    const now = Date.now();
    await run("ana", "pub", "shout", 3, now - 1000);
    await run("ana", "pub", "whisper", 2, now - 2 * 86_400_000);
    await run("bo", "hidden", "secret plans", 9, now);
    const [, two] = await lines();
    await send("bo", "/api/repos/ana/pub/stamps", { path: "a.ts", stamp: "gem", lines: [two!.id] });

    const look = async (who: string | null) => (await (await call(who, "/api/users/agent-claude")).json()) as any;
    const ana = await look("ana");
    expect(ana.agent).toMatchObject({ harness: "claude", run_by: [{ name: "ana", runs: 2 }], lines: 5, run_count: 2 });
    expect(ana.agent.repos.map((r: any) => `${r.owner}/${r.name}`)).toEqual(["ana/pub"]);
    expect(ana.agent.runs.map((r: any) => r.task)).toEqual(["shout", "whisper"]);
    expect(ana.agent.pulse).toHaveLength(30);
    expect(ana.agent.pulse.slice(-3).map((d: any) => d.lines)).toEqual([2, 0, 3]);
    // Stamps on its lines show on its profile, as on a person's.
    expect(ana.stamps.got).toMatchObject([{ by: "bo", author: "agent-claude", stamp: "gem" }]);
    expect((await (await call(null, "/api/users/bo")).json() as any).stamps.given).toMatchObject([{ author: "agent-claude", stamp: "gem" }]);

    // bo sees their own private repo's run, and its task; not ana's tasks.
    const bo = await look("bo");
    expect(bo.agent.run_count).toBe(3);
    expect(bo.agent.runs.map((r: any) => r.task ?? null)).toEqual(["secret plans", null, null]);
    expect(bo.agent.run_by.map((o: any) => o.name).sort()).toEqual(["ana", "bo"]);

    // Signed out, nothing of the private repo; and a person's profile has no agent part.
    const anon = await look(null);
    expect([anon.agent.run_count, anon.agent.repos.length]).toEqual([2, 1]);
    expect((await (await call(null, "/api/users/ana")).json() as any).agent).toBeUndefined();
  });
});

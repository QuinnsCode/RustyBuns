import { afterAll, describe, expect, test } from "bun:test";
import { text, type Doc } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const file = "/api/repos/ryan/r1/do", q = "?path=a.js";
const post = (call: Call, user: string, route: string, body: unknown) => call(user, `${file}/${route}${q}`, { method: "POST", body: JSON.stringify(body) });
const doc = async (call: Call) => await (await call("ryan", `${file}/file${q}`)).json() as Doc;
const claims = async (call: Call) => await (await call("ryan", `${file}/claims${q}`)).json() as { id: string; lines: string[] }[];
const set = (line: string, text: string, base = 1) => ({ kind: "set", line, base, text });

async function setup(start: string) {
  const call = await boot();
  opened.push(call);
  await call("ryan", "/api/login", { method: "POST", body: JSON.stringify({ name: "ryan" }) });
  await call("ryan", "/api/repos", { method: "POST", body: JSON.stringify({ name: "r1", visibility: "public" }) });
  await call("ryan", "/api/repos/ryan/r1/collaborators", { method: "POST", body: JSON.stringify({ name: "agent-x" }) });
  await call("ryan", "/api/repos/ryan/r1/collaborators", { method: "POST", body: JSON.stringify({ name: "agent-y" }) });
  await call("ryan", "/api/repos/ryan/r1/files", { method: "POST", body: JSON.stringify({ path: "a.js", content: start }) });
  return call;
}

describe("edit: claim, apply, release in one call", () => {
  test("an edit lands and leaves no claim behind", async () => {
    const call = await setup("a\nb\nc");
    const res = await post(call, "agent-x", "edit", { ops: [set("L1", "A"), { kind: "insert", after: "L3", text: "d" }], task: "tidy" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rev: expect.any(Number), applied: expect.any(Array), claim: expect.any(String) });
    expect(text(await doc(call))).toBe("A\nb\nc\nd");
    expect(await claims(call)).toEqual([]);
  });

  test("held lines put the edit in line: a short wait answers 202 with the place, and asking again with the id lands after release", async () => {
    const call = await setup("a\nb\nc");
    await post(call, "ryan", "claims", { id: "run-x", lines: ["L1"] });
    const first = await post(call, "agent-y", "edit", { ops: [set("L1", "mine")], id: "run-y", timeout: 0 });
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ queued: true, id: "run-y", place: 1 });
    const again = post(call, "agent-y", "edit", { ops: [set("L1", "mine")], id: "run-y", timeout: 5 });
    await Bun.sleep(20);
    await post(call, "ryan", "release", { id: "run-x" });
    const done = await again;
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ claim: "run-y" });
    expect(text(await doc(call))).toBe("mine\nb\nc");
    expect(await claims(call)).toEqual([]);
  });

  test("a stale set is rebased word by word through edit", async () => {
    const call = await setup("const total = add(a, b)\nnext");
    await post(call, "ryan", "ops", { ops: [set("L1", "const sum = add(a, b)")] });
    const res = await post(call, "agent-x", "edit", { ops: [set("L1", "const total = add(a, c)")] });
    expect(res.status).toBe(200);
    expect(text(await doc(call))).toBe("const sum = add(a, c)\nnext");
  });

  test.each([
    ["overlapping words", { ops: [set("L1", "foo(3)")] }, 409],
    ["a pinned rev that moved", { ops: [set("L2", "x", 1)], ifRev: 0 }, 409],
    ["an op that is no op", { ops: [{ kind: "nonsense", line: "L1" }] }, 400],
  ])("a failed edit (%s) answers the ops' error and still lets go of its claim", async (_name, body, status) => {
    const call = await setup("foo(1)\nnext");
    await post(call, "ryan", "ops", { ops: [set("L1", "foo(2)")] });
    const res = await post(call, "agent-x", "edit", body);
    expect(res.status).toBe(status);
    expect(await claims(call)).toEqual([]);
    expect(text(await doc(call))).toBe("foo(2)\nnext");
  });

  test("bad bodies are 400, and someone off the crew is refused", async () => {
    const call = await setup("a");
    for (const body of [{}, { ops: [] }, { ops: [set("L1", "x")], timeout: 99 }, { ops: [set("L1", "x")], id: 5 }])
      expect((await post(call, "agent-x", "edit", body)).status).toBe(400);
    expect([401, 403]).toContain((await post(call, "stranger", "edit", { ops: [set("L1", "x")] })).status);
    expect(text(await doc(call))).toBe("a");
  });
});

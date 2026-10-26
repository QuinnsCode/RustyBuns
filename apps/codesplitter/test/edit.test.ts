import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { text, type Doc } from "../src/lines.ts";
import type { Call } from "../src/local.ts";
import type { Exec } from "../src/agent-run.ts";
import { resolveFile } from "../src/conflict-agent.ts";
import { local } from "./app-kit.ts";

const file = "/api/repos/ryan/r1/do", q = "?path=a.js";
const post = (call: Call, user: string, route: string, body: unknown) => call(user, `${file}/${route}${q}`, { method: "POST", body: JSON.stringify(body) });
const doc = async (call: Call) => await (await call("ryan", `${file}/file${q}`)).json() as Doc;
const claims = async (call: Call) => await (await call("ryan", `${file}/claims${q}`)).json() as { id: string; lines: string[] }[];
const set = (line: string, text: string, base = 1) => ({ kind: "set", line, base, text });

async function setup(start: string, env: Record<string, unknown> = {}) {
  const call = await local({ GH_CLI: "off", ...env });
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

describe("land: merge, or the one conflict left and why", () => {
  const branch = "?path=a.js&branch=feat", R = "/api/repos/ryan/r1";
  const on = (call: Call, user: string, route: string, body: unknown) => call(user, `${file}/${route}${branch}`, { method: "POST", body: JSON.stringify(body) });
  const land = (call: Call, user: string, body: unknown = {}) => call(user, `${R}/branches/feat/land`, { method: "POST", body: JSON.stringify(body) });

  test("two agents edit one line of a branch: one waits in line, both land word by word, and land hands back main's clash with both sides' reasons", async () => {
    const call = await setup("const total = add(a, b);\nnext");
    await call("ryan", `${R}/branches`, { method: "POST", body: JSON.stringify({ name: "feat" }) });
    // agent-x is mid-rewrite of L1; agent-y's edit of the same line gets in line behind it.
    await on(call, "agent-x", "claims", { id: "run-x", lines: ["L1"], task: "rename total" });
    const waiting = on(call, "agent-y", "edit", { ops: [set("L1", "const total = add(a, c);")], task: "pass c", timeout: 5 });
    await Bun.sleep(20);
    expect((await on(call, "agent-x", "ops", { ops: [set("L1", "const sum = add(a, b);")], claim: "run-x" })).status).toBe(200);
    await on(call, "agent-x", "release", { id: "run-x" });
    // y's edit was read at rev 1: it lands on top of x's, the words each changed kept.
    expect((await waiting).status).toBe(200);
    // Meanwhile main changed the same words y did, and said why.
    await post(call, "ryan", "ops", { ops: [set("L1", "const total = add(a, d);")] });
    await post(call, "ryan", "commit", { message: "add d, not b" });

    const clash = await land(call, "agent-y");
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ status: "open", left: 0, conflict: {
      path: "a.js", line: "L1", main: "const total = add(a, d);", branch: "const sum = add(a, c);", leftover: "person", choices: expect.arrayContaining(["text"]),
      why: { main: ["add d, not b"], branch: { by: "ryan" } },
    } });
    // The agent settles it and lands again.
    const landed = await land(call, "agent-y", { resolve: { "a.js": { L1: { text: "const sum = add(a, c, d);" } } } });
    expect(landed.status).toBe(200);
    expect(await landed.json()).toMatchObject({ status: "merged" });
    expect(text(await doc(call))).toBe("const sum = add(a, c, d);\nnext");
    expect(await claims(call)).toEqual([]);
  });

  test.each([
    ["passed its check lands on its own", "x(2);\nx(3);", 200],
    ["failed its check never lands", null, 409],
  ])("an AI leftover's kept answer that %s", async (_name, answer, status) => {
    const call = await setup("const a = 1;\nx(1);", { HEAL: "1" });
    call.env.AGENT_EXEC = (async (_cmd, cwd) => { if (answer) writeFileSync(join(cwd, resolveFile("a.js")), answer + "\n"); return { code: 0, out: "" }; }) as Exec;
    await call("ryan", `${R}/files`, { method: "POST", body: JSON.stringify({ path: ".gitattributes", content: "*.js codesplitter-leftover=ai" }) });
    await call("ryan", `${R}/branches`, { method: "POST", body: JSON.stringify({ name: "feat" }) });
    await on(call, "agent-x", "edit", { ops: [set("L2", "x(3);", 2)] });
    await post(call, "ryan", "ops", { ops: [set("L2", "x(2);", 2)] });
    const res = await land(call, "agent-x");
    expect(res.status).toBe(status);
    if (answer) expect(text(await doc(call))).toBe(`const a = 1;\n${answer}`);
    else expect(await res.json()).toMatchObject({ conflict: { line: "L2", leftover: "ai", answer: { ok: false } } });
  });
});

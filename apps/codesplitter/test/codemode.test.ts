import { describe, expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// Code mode (src/codemode.ts), measured against the plain tool list it replaces. "Tokens" are a quarter of a character,
// near enough to compare two ways of doing the same job; what matters is the ratio, which the tests hold.
const tokens = (x: unknown) => Math.ceil((typeof x === "string" ? x : JSON.stringify(x)).length / 4);

const LINES = 300;
const body = Array.from({ length: LINES }, (_, i) => (i % 15 === 0 ? `// TODO: tidy part ${i}` : `export const part${i} = ${i};`)).join("\n");
const TODOS = Math.ceil(LINES / 15);

/** ryan's private repo with two files of the same 300 lines (20 TODOs), a write token, and an MCP client over `url`. */
async function app(extra: Record<string, unknown> = { LOADER: true }) {
  const call = await boot({ GH_CLI: "off", ...extra });
  const send = (url: string, b: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(b) });
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "private" });
  for (const path of ["before.ts", "after.ts"]) await send("/api/repos/ryan/lab/files", { path, content: body });
  const token = async (scope: string) => ((await (await send("/api/tokens", { label: "mcp", scope })).json()) as { token: string }).token;
  const read = await token("read"), write = await token("write");
  let n = 0;
  const rpc = async (auth: string, method: string, params?: unknown, url = "/api/mcp") =>
    (await (await call(null, url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }), headers: { authorization: `Bearer ${auth}` } })).json()) as any;
  const tool = async (auth: string, name: string, args: unknown) => (await rpc(auth, "tools/call", { name, arguments: args })).result;
  const lines = async (path: string) => (JSON.parse((await tool(write, "read_file", { owner: "ryan", repo: "lab", path })).content[0].text).lines as { text: string }[]).map((l) => l.text);
  return { read, write, rpc, tool, lines };
}

const where = { owner: "ryan", repo: "lab" };

/** The job: every TODO line in a file becomes DONE. */
const PROGRAM = (path: string) => [
  `const owner = "ryan", repo = "lab", path = ${JSON.stringify(path)};`,
  "const f = await tools.read_file({ owner, repo, path });",
  "const todo = f.lines.filter((l) => l.text.includes('TODO'));",
  "const c = await tools.claim_lines({ owner, repo, path, body: { lines: todo.map((l) => l.id), task: 'clearing TODOs' } });",
  "try { await tools.edit_lines({ owner, repo, path, body: { claim: c.id, ops: todo.map((l) => ({ kind: 'set', line: l.id, base: l.rev, text: l.text.replace('TODO', 'DONE') })) } }); }",
  "finally { await tools.release_claim({ owner, repo, path, body: { id: c.id } }); }",
  "return { edited: todo.length };",
].join("\n");

describe("code mode", () => {
  test("before and after: what listing the tools costs an agent before it does anything", async () => {
    const { write, rpc } = await app();
    const before = (await rpc(write, "tools/list", {}, "/api/mcp?mode=tools")).result.tools as any[];
    const after = (await rpc(write, "tools/list")).result.tools as any[];
    expect(after.map((t) => t.name)).toEqual(["search_tools", "describe_tools", "execute", "call_tool"]);
    expect(before.length).toBeGreaterThan(100);
    console.log(`tools/list: ${before.length} tools ${tokens(before)} tokens, code mode ${after.length} tools ${tokens(after)} tokens`);
    expect(tokens(after) * 20).toBeLessThan(tokens(before));
  });

  test("before and after: one job, tool by tool and as one program, ends with the same file", async () => {
    const { write, rpc, tool, lines } = await app();
    // Before: the agent lists every tool, then calls them one at a time; whatever it sends and whatever comes back is in its context.
    let listed = tokens((await rpc(write, "tools/list", {}, "/api/mcp?mode=tools")).result.tools), spent = 0;
    const step = async (name: string, args: unknown) => {
      const r = await tool(write, name, args);
      spent += tokens({ name, args }) + tokens(r.content[0].text);
      expect(r.isError).toBe(false);
      return JSON.parse(r.content[0].text);
    };
    const path = "before.ts";
    const doc = await step("read_file", { ...where, path });
    const todo = doc.lines.filter((l: any) => l.text.includes("TODO"));
    const claim = await step("claim_lines", { ...where, path, body: { lines: todo.map((l: any) => l.id), task: "clearing TODOs" } });
    await step("edit_lines", { ...where, path, body: { claim: claim.id, ops: todo.map((l: any) => ({ kind: "set", line: l.id, base: l.rev, text: l.text.replace("TODO", "DONE") })) } });
    await step("release_claim", { ...where, path, body: { id: claim.id } });
    const toolByTool = listed + spent;

    // After: it lists the four, writes one program, and reads what it returns.
    listed = tokens((await rpc(write, "tools/list")).result.tools);
    const code = PROGRAM("after.ts");
    const r = await tool(write, "execute", { code });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content[0].text)).toEqual({ result: { edited: TODOS } });
    const asProgram = listed + tokens({ name: "execute", args: { code } }) + tokens(r.content[0].text);

    console.log(`clear ${TODOS} TODOs in a ${LINES}-line file: tool by tool ${toolByTool} tokens, one program ${asProgram} tokens`);
    expect(await lines("after.ts")).toEqual(await lines("before.ts"));
    expect((await lines("after.ts")).filter((l) => l.includes("TODO"))).toEqual([]);
    expect(asProgram * 10).toBeLessThan(toolByTool);
  });

  test("an agent finds a tool by what it does, and asks for just the schemas it needs", async () => {
    const { write, tool } = await app();
    const found = (await tool(write, "search_tools", { query: "claim lines" })).content[0].text as string;
    expect(found.split("\n")[0]).toStartWith("claim_lines({ owner, repo, path, body?: {");
    expect(found).toContain("release_claim");
    const risky = (await tool(write, "search_tools", { query: "merge branch" })).content[0].text as string;
    expect(risky).toMatch(/merge_branch\(.*\[risky: call_tool\]/);
    const every = (await tool(write, "search_tools", { query: "" })).content[0].text as string;
    expect(every).toContain("Files: ");
    expect(every).toContain("read_file");
    const [one] = JSON.parse((await tool(write, "describe_tools", { names: ["read_file", "nope"] })).content[0].text);
    expect(one).toMatchObject({ name: "read_file", inputSchema: { required: ["owner", "repo", "path"] } });
    expect(JSON.parse((await tool(write, "describe_tools", { names: ["nope"] })).content[0].text)[0].error).toContain("no such tool");
  });

  test("a program runs as its token: a read token's can read, not write, and a risky tool is not callable from one", async () => {
    const { read, write, tool } = await app();
    const run = async (auth: string, code: string) => { const r = await tool(auth, "execute", { code }); return { ...r, out: JSON.parse(r.content[0].text) }; };
    expect((await run(read, `const f = await tools.read_file({ ...${JSON.stringify(where)}, path: "before.ts" }); return f.lines.length;`)).out).toEqual({ result: LINES });
    const w = await run(read, `return await tools.edit_lines({ ...${JSON.stringify(where)}, path: "before.ts", body: { ops: [] } });`);
    expect(w.isError).toBe(true);
    expect(w.out.error).toContain("no tool edit_lines");
    const d = await run(write, `return await tools.delete_repo(${JSON.stringify(where)});`);
    expect(d.isError).toBe(true);
    expect(d.out.error).toContain("403");
    expect(d.out.error).toContain("call_tool");
  });

  test("risky tools go through call_tool, which asks the person first, and only those", async () => {
    const { write, rpc, tool } = await app();
    const meta = (await rpc(write, "tools/list")).result.tools.find((t: any) => t.name === "call_tool");
    expect(meta.annotations.destructiveHint).toBe(true);
    expect((await tool(write, "call_tool", { name: "read_file", arguments: where })).content[0].text).toContain("isn't risky");
    // A risky tool called by name, bypassing the hint the client would see, is refused.
    expect((await rpc(write, "tools/call", { name: "delete_repo", arguments: where })).error.message).toContain("call_tool");
    // Through call_tool it is the HTTP call, as the token's owner.
    const gone = await tool(write, "call_tool", { name: "delete_repo", arguments: { ...where, body: { confirm: "ryan/lab" } } });
    expect(gone.content[0].text).not.toContain("call_tool");
  });

  test("a program's mistakes come back as answers: its log, the error, a stale 409, no network, a cap on calls", async () => {
    const { write, tool } = await app();
    const run = async (code: string) => { const r = await tool(write, "execute", { code }); return { isError: r.isError as boolean, out: JSON.parse(r.content[0].text) }; };
    const thrown = await run(`console.log("reading", 1); throw new Error("boom");`);
    expect(thrown).toEqual({ isError: true, out: { error: "boom", log: ["reading 1"] } });
    const stale = await run(`
      const f = await tools.read_file({ ...${JSON.stringify(where)}, path: "before.ts", from: 0, limit: 1 });
      const op = { kind: "set", line: f.lines[0].id, base: f.lines[0].rev };
      await tools.edit_lines({ ...${JSON.stringify(where)}, path: "before.ts", body: { ops: [{ ...op, text: "one" }] } });
      try { await tools.edit_lines({ ...${JSON.stringify(where)}, path: "before.ts", body: { ops: [{ ...op, text: "two" }] } }); return "landed"; }
      catch (e) { return [e.status, e.message.slice(0, 3)]; }`);
    expect(stale.out.result).toEqual([409, "409"]);
    expect((await run(`return await tools.nope({});`)).out.error).toContain("no tool nope");
    expect((await run(`return await tools["nope"]({});`)).out.error).toContain("404");
    expect((await run(`await fetch("http://example.com/"); return 1;`)).out.error).toMatch(/network|outbound/i);
    const many = await run(`let n = 0; try { for (;;) { await tools.whoami({}); n++; } } catch (e) { return [n, e.status]; }`);
    expect(many.out.result).toEqual([100, 429]);
    expect((await tool(write, "execute", { code: "  " })).isError).toBe(true);
  });

  test("preflight: a wrong tool name or argument fails with what is wrong, before any request", async () => {
    const { write, tool } = await app();
    const run = async (code: string) => { const r = await tool(write, "execute", { code }); return JSON.parse(r.content[0].text); };
    // An unknown tool is found by reading the program: nothing ran, so the first line never logged.
    expect(await run(`console.log("ran"); return await tools.read_fle({});`)).toEqual({ error: "no tool read_fle for this token: search_tools lists them" });
    const bad = await run(`try { await tools.claim_lines({ ...${JSON.stringify(where)}, path: "before.ts", body: { lines: "a" }, extra: 1 }); } catch (e) { return [e.status, e.message]; }`);
    expect(bad.result[0]).toBe(400);
    expect(bad.result[1]).toContain("body.lines should be array");
    expect(bad.result[1]).toContain("extra is not an argument");
    const missing = await run(`try { await tools.read_file({ owner: "ryan" }); } catch (e) { return e.message; }`);
    expect(missing.result).toContain("repo is required");
    // The lenient cases still pass: a numeric string for a number, as toRequest always allowed.
    expect((await run(`return (await tools.read_file({ ...${JSON.stringify(where)}, path: "before.ts", from: "0", limit: "1" })).lines.length;`)).result).toBe(1);
  });

  test("what comes back is cut at a size, so a program that returns a file doesn't undo the point", async () => {
    const { write, tool } = await app();
    const r = await tool(write, "execute", { code: `const f = await tools.read_file({ ...${JSON.stringify(where)}, path: "before.ts" }); return f;` });
    expect(r.content[0].text.length).toBeLessThan(20_300);
    expect(r.content[0].text).toContain("return less");
  });

  test("without a loader, or with ?mode=tools, the server lists every tool, as it always did", async () => {
    const plain = await app({});
    const all = (await plain.rpc(plain.write, "tools/list")).result.tools as any[];
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((t) => t.name === "execute")).toBe(false);
    expect((await plain.rpc(plain.write, "tools/call", { name: "execute", arguments: { code: "return 1" } })).error.message).toContain("no tool execute");
    const coded = await app();
    const full = (await coded.rpc(coded.write, "tools/list", {}, "/api/mcp?mode=tools")).result.tools as any[];
    expect(full.map((t) => t.name)).toContain("edit_lines");
    const init = (await coded.rpc(coded.write, "initialize", { protocolVersion: "2025-06-18" })).result.instructions as string;
    expect(init).toContain("execute");
    expect((await plain.rpc(plain.write, "initialize", { protocolVersion: "2025-06-18" })).result.instructions).not.toContain("execute");
  });
});

describe("saved programs", () => {
  test("an agent saves a program, reruns it by name with new input, and sees only its own", async () => {
    const { write, read, tool } = await app();
    const code = [
      "const f = await tools.read_file({ owner: input.owner, repo: input.repo, path: input.path });",
      "return { todos: f.lines.filter((l) => l.text.includes('TODO')).length };",
    ].join("\n");
    const saved = await tool(write, "execute", { code: `return await tools.save_program({ name: 'count-todos', body: { code: ${JSON.stringify(code)}, description: 'TODOs in a file' } });` });
    expect(saved.isError).toBe(false);

    const run = await tool(read, "execute", { program: "count-todos", input: { ...where, path: "before.ts" } });
    expect(run.isError).toBe(false);
    expect(JSON.parse(run.content[0].text)).toEqual({ result: { todos: TODOS } });

    const list = await tool(write, "execute", { code: "return await tools.list_programs({});" });
    expect(JSON.parse(list.content[0].text).result).toEqual([expect.objectContaining({ name: "count-todos", description: "TODOs in a file" })]);

    const missing = await tool(write, "execute", { program: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("no saved program nope");

    const gone = await tool(write, "execute", { code: "await tools.delete_program({ name: 'count-todos' }); return (await tools.list_programs({})).length;" });
    expect(JSON.parse(gone.content[0].text)).toEqual({ result: 0 });
  });
});

describe("saved programs: who can reach them", () => {
  test("a read token can't save, another person's programs are invisible, and the cap holds", async () => {
    const { write, read, rpc, tool } = await app();
    const names = async (auth: string) => ((await rpc(auth, "tools/list", undefined, "/api/mcp?mode=tools")).result.tools as { name: string }[]).map((t) => t.name);
    expect(await names(read)).not.toContain("save_program");
    expect(await names(write)).toContain("save_program");

    const save = (name: string) => tool(write, "save_program", { name, body: { code: "return 1" } });
    expect((await save("mine")).isError).toBe(false);
    for (let i = 1; i < 50; i++) expect((await save(`p${i}`)).isError).toBe(false);
    const over = await save("one-too-many");
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toContain("at most 50");
    // Replacing one at the cap is still fine.
    expect((await save("mine")).isError).toBe(false);
  });

});

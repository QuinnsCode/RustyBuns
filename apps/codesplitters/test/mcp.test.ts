import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { tools } from "../src/mcp.ts";
import { openapi } from "../src/openapi.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

/** The app with ryan signed in, a private repo with a file, a read and a write token, and an MCP client for each. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "private" });
  await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  const token = async (scope: string) => ((await (await send("/api/tokens", { label: "mcp", scope })).json()) as { token: string }).token;
  const read = await token("read"), write = await token("write");
  let n = 0;
  const raw = (auth: string | null, body: unknown) =>
    call(null, "/api/mcp", { method: "POST", body: JSON.stringify(body), headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  const rpc = async (auth: string, method: string, params?: unknown) => ((await (await raw(auth, { jsonrpc: "2.0", id: ++n, method, params })).json()) as any);
  const tool = async (auth: string, name: string, args: unknown) => (await rpc(auth, "tools/call", { name, arguments: args })).result;
  return { read, write, raw, rpc, tool };
}

describe("POST /api/mcp", () => {
  test("has a tool for every OpenAPI operation, each schema standing alone", () => {
    const ops = Object.values(openapi("").paths).flatMap((m) => Object.values(m).map((o: any) => o.operationId));
    const ts = tools();
    expect(ts.map((t) => t.name).sort()).toEqual(ops.sort());
    expect(JSON.stringify(ts.map((t) => t.inputSchema))).not.toContain("$ref");
    expect(ts.find((t) => t.name === "delete_repo")!.annotations.destructiveHint).toBe(true);
    expect(ts.find((t) => t.name === "read_file")!.inputSchema.required).toEqual(["owner", "repo", "path"]);
  });

  test("needs a good token", async () => {
    const { raw } = await app();
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
    const none = await raw(null, init);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await raw("cst_nonsense", init)).status).toBe(401);
  });

  test("initializes, and lists only reads to a read token", async () => {
    const { read, write, raw, rpc } = await app();
    const init = await rpc(read, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "codesplitters" } });
    expect((await raw(read, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const r = (await rpc(read, "tools/list")).result.tools as any[], w = (await rpc(write, "tools/list")).result.tools as any[];
    expect(r.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(r.map((t) => t.name)).toContain("read_file");
    expect(w.map((t) => t.name)).toContain("edit_lines");
    expect(w.length).toBeGreaterThan(r.length);
    expect((await rpc(read, "tools/call", { name: "edit_lines", arguments: {} })).error.message).toContain("write token");
    expect((await rpc(read, "nope")).error.code).toBe(-32601);
  });

  test("a tool call is the HTTP call, as the token's owner", async () => {
    const { read, write, tool } = await app();
    const file = await tool(read, "read_file", { owner: "ryan", repo: "lab", path: "a.ts" });
    expect(file.isError).toBe(false);
    const doc = JSON.parse(file.content[0].text);
    expect(doc.lines.map((l: any) => l.text)).toEqual(["one", "two"]);
    const l = doc.lines[1];
    const edit = await tool(write, "edit_lines", { owner: "ryan", repo: "lab", path: "a.ts", body: { ops: [{ kind: "set", line: l.id, base: l.rev, text: "TWO" }] } });
    expect(edit.isError).toBe(false);
    const after = JSON.parse((await tool(read, "read_file", { owner: "ryan", repo: "lab", path: "a.ts" })).content[0].text);
    expect(after.lines[1]).toMatchObject({ text: "TWO", by: "ryan" });
    // The app's own answer comes through: a stale base is a 409, a missing path an error.
    const stale = await tool(write, "edit_lines", { owner: "ryan", repo: "lab", path: "a.ts", body: { ops: [{ kind: "set", line: l.id, base: l.rev, text: "x" }] } });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.content[0].text).toStartWith("409");
    expect((await tool(read, "read_file", { owner: "ryan", repo: "lab" })).isError).toBe(true);
  });
});

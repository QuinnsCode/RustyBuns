// The relay between an agent in a terminal and the page in a browser, with a fake page on the other end of the
// socket: what an agent's HTTP and MCP calls get back, and what happens when no page is open.
import { describe, expect, test } from "bun:test";
import { fromPage, linksFor, Relay } from "../src/relay.ts";

const links = linksFor("http://localhost:4799", "testroom0001");

/** A relay whose page answers each call as `answer` says (null: the page is closed). */
function room(answer: ((name: string, args: unknown) => { ok: boolean; result?: unknown; error?: string }) | null, waitMs = 1000) {
  const relay: Relay = new Relay(() => answer && ((frame) => {
    const m = JSON.parse(frame);
    const r = answer(m.name, m.args);
    queueMicrotask(() => relay.heard({ t: "reply", id: m.id, ok: r.ok, result: r.result ?? null, error: r.error }));
  }), waitMs);
  const post = (path: string, body: unknown) => relay.http(new Request(`${links.api}${path}`, { method: "POST", body: JSON.stringify(body) }), path, links);
  const rpc = async (method: string, params?: unknown) => (await (await post("/mcp", { jsonrpc: "2.0", id: 7, method, params })).json());
  return { relay, post, rpc };
}

const page = (name: string, args: unknown) =>
  name === "page_write_file" ? { ok: true, result: { ok: true, files: [{ path: (args as { path: string }).path, bytes: 2 }] } } : { ok: false, error: "too many files" };

describe("an agent over HTTP", () => {
  test("lists the tools, calls one on the page and reads its answer", async () => {
    const { relay, post } = room(page);
    const list = await (await relay.http(new Request(`${links.api}/tools`), "/tools", links)).json();
    expect(list.tools.map((t: { name: string }) => t.name)).toContain("page_write_file");
    const r = await post("/tools/page_write_file", { path: "world.js", text: "//" });
    expect([r.status, await r.json()]).toEqual([200, { ok: true, files: [{ path: "world.js", bytes: 2 }] }]);
  });

  test.each([
    ["a refusal from the page", "/tools/page_reset", {}, page, 422, "too many files"],
    ["a tool that doesn't exist", "/tools/page_paint", {}, page, 404, 'no tool "page_paint"'],
    ["no page open", "/tools/page_read", {}, null, 409, `open ${links.page}`],
  ] as const)("says what went wrong: %s", async (_, path, body, answer, status, says) => {
    const r = await room(answer).post(path, body);
    expect(r.status).toBe(status);
    expect((await r.json()).error).toContain(says);
  });

  test("a page that never answers times out instead of hanging the agent", async () => {
    const r = await new Relay(() => () => {}, 20).call("page_read", {}, links);
    expect(r).toMatchObject({ ok: false, status: 504 });
  });
});

describe("an agent over MCP", () => {
  test("initializes, lists the tools and calls one", async () => {
    const { rpc, post } = room(page);
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "agent-page" } });
    expect((await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc("tools/list")).result.tools).toHaveLength(7);
    const ok = await rpc("tools/call", { name: "page_write_file", arguments: { path: "world.js", text: "//" } });
    expect(ok.result.isError).toBe(false);
    expect(JSON.parse(ok.result.content[0].text)).toEqual({ ok: true, files: [{ path: "world.js", bytes: 2 }] });
    const bad = await rpc("tools/call", { name: "page_reset", arguments: {} });
    expect(bad.result.isError).toBe(true);
    expect((await rpc("resources/list")).error.code).toBe(-32601);
  });
});

// Only a page this server served may hold a room: another site that learned the link can't take the agent's calls.
test.each([
  ["this site's page", "http://localhost:4799", true],
  ["another site", "https://evil.example", false],
  ["no Origin at all", null, false],
])("the page socket from %s", (_, origin, ok) => {
  const headers = new Headers(origin ? { origin } : {});
  expect(fromPage(new Request("http://localhost:4799/api/r/testroom0001/socket", { headers }))).toBe(ok);
});

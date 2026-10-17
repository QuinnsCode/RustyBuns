import { expect, test } from "bun:test";
import { openapi } from "../src/openapi.ts";
import { local, person, post } from "./app-kit.ts";

const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

test("tools/list has every operation of the spec; tools/call runs one as the API key", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ada", email: "ada@example.com" });
  const key = await (await post(app, cookie, `/api/orgs/${org}/keys`, { name: "claude" })).json();
  expect(key.secret).toMatch(/^qk_[A-Za-z0-9_-]{32}$/);
  expect(key.prefix).toBe(key.secret.slice(0, 8));
  const bearer = { authorization: `Bearer ${key.secret}` };

  const info = await (await app("", "/api/mcp")).json();
  expect(info.claude).toContain("/api/mcp");
  const ops = Object.values(openapi("").paths).reduce((n, m) => n + Object.keys(m).length, 0);
  expect(info.tools).toBe(ops);
  expect(info.note).toContain(`${ops} tools, one per operation`);

  const list = await (await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("tools/list") })).json();
  const ids = Object.values(openapi("").paths).flatMap((m) => Object.values(m).map((op) => (op as { operationId: string }).operationId)).sort();
  expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(ids);
  const del = list.result.tools.find((t: { name: string }) => t.name === "delete_contact");
  expect(del.annotations.destructiveHint).toBe(true);
  expect(list.result.tools.find((t: { name: string }) => t.name === "list_contacts").annotations.readOnlyHint).toBe(true);

  const init = await (await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("initialize", { protocolVersion: "2025-03-26" }) })).json();
  expect(init.result.protocolVersion).toBe("2025-03-26");

  const call = await (await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("tools/call", { name: "list_contacts", arguments: { org, q: "ad" } }) })).json();
  expect(call.result.isError).toBe(false);
  const page = JSON.parse(call.result.content[0].text);
  expect(page.items).toHaveLength(1);
  expect(page.items[0].email).toBe("ada@example.com");

  // The key is the person inside this org only; a key can't make keys.
  const me = await (await app("", "/api/me", { headers: bearer })).json();
  expect(me.user.via).toBe("key");
  const bob = await person(app, "bob@qcrm.test");
  expect((await app("", `/api/orgs/${bob.org}/contacts`, { headers: bearer })).status).toBe(404);
  expect((await post(app, "", `/api/orgs/${org}/keys`, { name: "x" }).then((r) => r.status))).toBe(401);
  const viaKey = await app("", `/api/orgs/${org}/keys`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "x" }) });
  expect(viaKey.status).toBe(403);

  const missing = await (await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("tools/call", { name: "get_contact", arguments: { org } }) })).json();
  expect(missing.result.isError).toBe(true);
  expect((await app("", "/api/mcp", { method: "POST", headers: bearer, body: rpc("tools/call", { name: "nope" }) })).status).toBe(200);
});

test("a bad key is 401, no key is 401, a revoked key is 401", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  expect((await app("", "/api/mcp", { method: "POST", headers: { authorization: "Bearer qk_nope" }, body: rpc("tools/list") })).status).toBe(401);
  expect((await app("", "/api/mcp", { method: "POST", body: rpc("tools/list") })).status).toBe(401);
  const key = await (await post(app, cookie, `/api/orgs/${org}/keys`, { name: "k" })).json();
  expect((await app(cookie, `/api/orgs/${org}/keys/${key.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app("", "/api/mcp", { method: "POST", headers: { authorization: `Bearer ${key.secret}` }, body: rpc("tools/list") })).status).toBe(401);
  // The session cookie works on the MCP server too.
  const viaCookie = await (await app(cookie, "/api/mcp", { method: "POST", body: rpc("tools/call", { name: "get_me" }) })).json();
  expect(JSON.parse(viaCookie.result.content[0].text).orgs[0].id).toBe(org);
});

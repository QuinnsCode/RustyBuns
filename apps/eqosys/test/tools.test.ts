// The tools, called the ways an agent does: from a signed-in page (cookie), from a script with an app's token, in one batch that keeps
// only the fields asked for; the admin's tool refused to everyone else; and the page's WebMCP script registering what the server lists.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { WEBMCP_SCRIPT } from "../src/app/WebMcp.ts";
import { APPS } from "../src/apps.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string, email = `${name.toLowerCase()}@example.com`) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return { cookie: up.cookie, token: who.token };
}
const ada = await signUp("Ada"), boss = await signUp("Boss", "boss@example.com");
const page = (u: { cookie: string }) => ({ cookie: u.cookie }), app = (u: { token: string }) => ({ token: u.token });
/** As the page (the session cookie) or, with `{ token }`, as an app's script. */
const run = async (name: string, args: unknown, who: { cookie?: string; token?: string } = {}) => {
  const { res } = await call(`/api/tools/${name}`, { json: args, ...(who.cookie ? { cookie: who.cookie } : {}), ...(who.token ? { bearer: who.token } : {}) });
  return { status: res.status, body: await res.json() as { result?: any; error?: string } };
};

test("a signed-in page and an app's token both call a tool; no sign-in is refused with the way in", async () => {
  expect((await run("eq_whoami", {})).status).toBe(401);
  const seen = await run("eq_whoami", {}, page(ada)), script = await run("eq_whoami", {}, app(ada));
  expect(seen.body.result).toMatchObject({ name: "Ada", email: "ada@example.com", admin: false, via: "page" });
  expect(script.body.result).toMatchObject({ name: "Ada", via: "token for park-hide-seek" });
  expect(script.body.result.email).toBeUndefined();

  const apps = (await run("eq_apps", { genre: "Sports & Skate" }, page(ada))).body.result.apps;
  expect(apps.map((a: { id: string }) => a.id)).toEqual(APPS.filter((a) => a.genre === "Sports & Skate").map((a) => a.id));
  expect((await run("eq_apps", { q: "park" }, page(ada))).body.result.apps.find((a: { id: string }) => a.id === "park-hide-seek").mine).toEqual(["play"]);
  expect((await run("eq_apps", { genre: "Nonsense" }, page(ada))).status).toBe(400);
  expect((await run("eq_achievements", { app: "no-such-app" }, page(ada))).body.error).toContain("no app");
});

test("eq_batch answers several lookups in one call, keeps only the picked fields, and a bad call doesn't stop the rest", async () => {
  const { status, body } = await run("eq_batch", { calls: [
    { tool: "eq_apps", args: { q: "park-hide" }, pick: ["apps.id", "apps.mine"] },
    { tool: "eq_achievements" },
    { tool: "eq_nope" },
    { tool: "eq_batch", args: {} },
    { tool: "eq_members" },
  ] }, page(ada));
  expect(status).toBe(200);
  const [apps, ach, nope, nested, members] = body.result;
  expect(apps).toEqual({ tool: "eq_apps", ok: true, result: { apps: [{ id: "park-hide-seek", mine: ["play"] }] } });
  expect(ach.result.games.find((g: { app: string }) => g.app === "alien-disc-golf")).toEqual({ app: "alien-disc-golf", unlocked: 0, total: 8 });
  for (const bad of [nope, nested]) expect(bad.ok).toBe(false);
  expect(members).toMatchObject({ ok: false, error: expect.stringContaining("super admin") });
  expect((await run("eq_batch", { calls: [] }, page(ada))).status).toBe(400);
});

test("the admin's tool is the admin's alone", async () => {
  expect((await run("eq_members", {}, page(ada))).status).toBe(403);
  expect((await run("eq_members", {}, app(boss))).status).toBe(403);
  const all = (await run("eq_members", { q: "ada" }, page(boss))).body.result;
  expect(all.members.map((m: { name: string }) => m.name)).toEqual(["Ada"]);
});

test("another site can't call a tool with the person's cookie, and the guide and list are open", async () => {
  expect((await call("/api/tools/eq_whoami", { json: {}, cookie: ada.cookie, origin: "https://evil.example" })).res.status).toBe(403);
  const list = await (await call("/api/tools")).res.json() as { tools: { name: string }[] };
  expect(list.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["eq_apps", "eq_batch", "eq_members"]));
  expect(await (await call("/agents")).res.text()).toContain("eq_batch");
});

test("the page's script registers every listed tool with WebMCP and a call goes to the server with the page's session", async () => {
  const registered: { name: string; execute(a: unknown): Promise<unknown> }[] = [], asked: string[] = [];
  const win: Record<string, any> = {};
  const fetchFake = async (url: string, init?: { body?: string }) => {
    asked.push(`${init?.body ? "POST" : "GET"} ${url}`);
    const r = init?.body ? await call(url, { json: JSON.parse(init.body), cookie: ada.cookie }) : await call(url);
    return { ok: r.res.ok, status: r.res.status, json: () => r.res.json() };
  };
  new Function("document", "navigator", "window", "fetch", "location", "setTimeout", WEBMCP_SCRIPT)(
    { modelContext: { registerTool: (t: never) => registered.push(t) } }, {}, win, fetchFake, { assign: () => {} }, () => {});
  await new Promise((r) => setTimeout(r, 200));
  expect(registered.map((t) => t.name)).toEqual(expect.arrayContaining(["eq_open_app", "eq_apps", "eq_batch"]));
  expect(win.__commands.list().map((c: { name: string }) => c.name)).toEqual(registered.map((t) => t.name));
  expect(await registered.find((t) => t.name === "eq_whoami")!.execute({})).toMatchObject({ name: "Ada" });
  expect(asked).toContain("POST /api/tools/eq_whoami");
  await expect(win.__commands.run("eq_apps", { genre: "Nonsense" })).rejects.toThrow();
});

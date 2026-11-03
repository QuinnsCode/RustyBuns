// The tools, called the ways an agent does: from a signed-in page (cookie), from a script with an app's token, in one batch that keeps
// only the fields asked for; the admin's tool refused to everyone else; and the page's WebMCP script registering what the server lists.
import { expect, setDefaultTimeout, test } from "bun:test";
import { workerLoader } from "@rustybuns/shell-bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newKey } from "@rustybuns/util/token";
import { listCommands, runCommand } from "@rustybuns/util/commands";
import { startCommands } from "../src/app/commands.client.ts";
import { APPS } from "../src/apps.ts";
import { ACHIEVEMENTS } from "../src/achievements.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), LOADER: workerLoader(mkdtempSync(join(tmpdir(), "eq-loader-"))) as never });

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
  expect(ach.result.games.find((g: { app: string }) => g.app === "alien-disc-golf")).toEqual({ app: "alien-disc-golf", unlocked: 0, total: ACHIEVEMENTS["alien-disc-golf"]!.length });
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

test("the page's commands are every listed tool, and a call goes to the server with the page's session", async () => {
  const asked: string[] = [];
  const fetchFake = async (url: string, init?: { body?: string }) => {
    asked.push(`${init?.body ? "POST" : "GET"} ${url}`);
    const r = init?.body ? await call(url, { json: JSON.parse(init.body), cookie: ada.cookie }) : await call(url);
    return { ok: r.res.ok, status: r.res.status, json: () => r.res.json() };
  };
  await startCommands(fetchFake);
  expect(listCommands().map((c) => c.name)).toEqual(expect.arrayContaining(["eq_open_app", "eq_apps", "eq_batch"]));
  expect(await runCommand("eq_whoami")).toMatchObject({ name: "Ada" });
  expect(asked).toContain("POST /api/tools/eq_whoami");
  await expect(runCommand("eq_apps", { genre: "Nonsense" })).rejects.toThrow();
});

test("eq_execute runs a program over the tools as the caller, answers only what it returns, and costs less than a call per fact", async () => {
  // The job: for each app, how many achievements this person has unlocked, keeping only the games with any. A program loops; one call each would not.
  const code = "const { apps } = await tools.eq_apps({}); const out = {}; for (const a of apps.filter((x) => x.genre === input.genre)) { const r = await tools.eq_achievements({ app: a.id }); out[a.id] = r.total; } console.log('done'); return out;";
  const { status, body } = await run("eq_execute", { code, input: { genre: "Sports & Skate" } }, page(ada));
  expect(status).toBe(200);
  const want = APPS.filter((a) => a.genre === "Sports & Skate");
  const r = body.result as { ok: boolean; calls: number; result: Record<string, number>; log: string[] };
  expect(r).toMatchObject({ ok: true, calls: 1 + want.filter((a) => a.id in r.result).length, log: ["done"] });
  expect(Object.keys(r.result).sort()).toEqual(want.map((a) => a.id).filter((id) => id in r.result).sort());

  // What it cost against asking one tool at a time (characters / 4, the same yardstick codeSplitter's measurement uses).
  const tokens = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4);
  let byHand = tokens({ tool: "eq_apps" }) + tokens((await run("eq_apps", {}, page(ada))).body.result);
  for (const id of Object.keys(r.result)) byHand += tokens({ tool: "eq_achievements", args: { app: id } }) + tokens((await run("eq_achievements", { app: id }, page(ada))).body.result);
  const viaProgram = tokens({ code, input: { genre: "x" } }) + tokens(body.result);
  console.log(`eq_execute: ~${viaProgram} tokens in and out, against ~${byHand} calling each tool by hand`);
  expect(viaProgram).toBeLessThan(byHand);
});

test("a program can't reach what its caller can't, a typo or a bad call fails with words, and it can't run itself", async () => {
  const exec = async (code: string, who = page(ada)) => (await run("eq_execute", { code }, who)).body.result as { ok: boolean; error?: string; result?: unknown };
  expect(await exec("return await tools.eq_members({})")).toMatchObject({ ok: false, error: expect.stringContaining("403") });
  expect((await exec("return (await tools.eq_members({})).total", page(boss))).result).toBe(2);
  expect(await exec("return await tools.eq_nope({})")).toMatchObject({ ok: false, error: expect.stringContaining("no tool eq_nope") });
  expect(await exec("return await tools.eq_execute({ code: 'return 1' })")).toMatchObject({ ok: false });
  expect(await exec("return await tools.eq_apps({ genre: 'Nonsense' })")).toMatchObject({ ok: false, error: expect.stringContaining("400") });
  expect(await exec("try { await tools.eq_apps({ genre: 'Nonsense' }); } catch (e) { return 'caught ' + String(e.message).slice(0, 3); }")).toMatchObject({ ok: true, result: "caught 400" });
  expect(await exec("throw new Error('boom')")).toMatchObject({ ok: false, error: "boom" });
  expect((await run("eq_execute", {}, page(ada))).status).toBe(400);
});

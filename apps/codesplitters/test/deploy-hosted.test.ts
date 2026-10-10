import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { seal, unseal } from "../src/deploy-keys.ts";
import { DeployRunner } from "../src/deploy-runner.ts";
import { AgentSandbox, type ContainerApi } from "../src/sandbox.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the deploy image
import { exec } from "../deploy-sandbox/server.mjs";

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

// After a deploy the runner GETs the URL it printed until it answers. Here that's the fake
// lab.ryan.workers.dev, so answer it locally: a real request waits on the network, and one that
// fails retries every 2s, past the 5s test timeout.
const checked: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u instanceof Request ? u.url : u);
    if (!url.startsWith("https://lab.ryan.workers.dev")) return realFetch(u, init);
    checked.push(url);
    return new Response("ok");
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TOKEN = "cf-scoped-token-0123456789abcdWXYZ";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const SECRETS = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7)));
const origin = "http://codesplitters.local";

/** A deploy container: its server answers each command like deploy.test.ts's fake machine, echoing the token once to check it's hidden. */
function fakeContainers(cfg = { adopt: false, edge: true, box: false }) {
  const seen = { env: [] as Record<string, string>[], ran: [] as string[], destroyed: 0 };
  const make = (): ContainerApi => {
    let running = false;
    return {
      get running() { return running; },
      start(o) { running = true; seen.env.push(o?.env ?? {}); },
      async destroy() { running = false; seen.destroyed++; },
      getTcpPort: () => ({
        async fetch(_u, init) {
          const { cmd } = JSON.parse(String(init!.body)) as { cmd: string[] };
          const line = cmd.join(" ");
          seen.ran.push(line);
          let out = "";
          if (line.includes("rev-parse")) out = SHA + "\n";
          if (line.includes("bun -e")) out = `RB ${JSON.stringify(cfg)}\n`;
          if (line.includes("rustybuns deploy")) out = `using token ${seen.env.at(-1)?.CLOUDFLARE_API_TOKEN}\nurl: "https://lab.ryan.workers.dev"\n`;
          return Response.json({ code: 0, out });
        },
      }),
    };
  };
  return { seen, make };
}

/** A DeployRunner per repo with in-memory storage; its alarm fires on the next tick. */
function runnerNamespace(env: any, make: () => ContainerApi) {
  const objects = new Map<string, DeployRunner>();
  return {
    idFromName: (n: string) => n,
    get(id: string) {
      if (!objects.has(id)) {
        const data = new Map<string, unknown>();
        const ctx = {
          container: make(),
          storage: {
            get: async (k: string) => structuredClone(data.get(k)) as any,
            put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); },
            setAlarm: async () => { setTimeout(() => void obj.alarm(), 0); },
          },
        };
        const obj = new DeployRunner(ctx, env);
        objects.set(id, obj);
      }
      return objects.get(id)!;
    },
  };
}

async function hosted(extra: Record<string, string> = {}, cfg?: { adopt: boolean; edge: boolean; box: boolean }) {
  const booted = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ADMINS: "ryan-quinn", DEPLOY_SECRETS_KEY: SECRETS, ...extra });
  opened.push(booted);
  const c = fakeContainers(cfg);
  booted.env.DEPLOY_RUNNER = runnerNamespace(booted.env, c.make);
  const cookies: Record<string, string> = {};
  for (const name of ["Ryan Quinn", "Pat Person", "Sam Sample"]) {
    const res = await booted(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: `${name.replace(" ", ".")}@example.com`.toLowerCase(), password: "correct horse battery", name }) });
    const handle = name.toLowerCase().replace(" ", "-");
    cookies[handle] = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((x) => x.split(";")[0]).join("; ");
    // Signed up, then picks the handle the app sees.
    await booted(null, "/api/handle", { method: "POST", headers: { cookie: cookies[handle]! }, body: JSON.stringify({ name: handle }) });
  }
  const call: Call = (user, url, init = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", cookies[user]!);
    return booted(null, url, { ...init, headers });
  };
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  for (const who of ["ryan-quinn", "sam-sample"]) {
    await send(who, "/api/repos", { name: "lab", visibility: "public" });
    await send(who, `/api/repos/${who}/lab/files`, { path: "package.json", content: "{}" });
    await send(who, `/api/repos/${who}/lab/do/commit?path=package.json`, { message: "package.json" });
  }
  await send("ryan-quinn", "/api/repos/ryan-quinn/lab/collaborators", { name: "pat-person" });
  return { call, send, env: booted.env, ...c };
}

const K = "/api/repos/ryan-quinn/lab/deploy/key", D = "/api/repos/ryan-quinn/lab/deploy";
const settle = async (call: Call, n = 1) => {
  let d: any;
  for (let i = 0; i < 300; i++) {
    d = await (await call("ryan-quinn", D)).json();
    if (d.history.length >= n && d.history.every((h: any) => h.status !== "running")) break;
    await Bun.sleep(10);
  }
  return d;
};

describe("sealing", () => {
  test("a sealed key opens only for its own repo, and each seal is different", async () => {
    const env: any = { DEPLOY_SECRETS_KEY: SECRETS };
    const k = { token: TOKEN, account_id: ACCOUNT };
    const a = await seal(env, "ryan", "lab", k);
    expect(a).not.toContain(TOKEN);
    expect(await seal(env, "ryan", "lab", k)).not.toBe(a);
    expect(await unseal(env, "ryan", "lab", a)).toEqual(k);
    expect(unseal(env, "ryan", "other", a)).rejects.toThrow();
    expect(seal({ DEPLOY_SECRETS_KEY: "short" } as any, "ryan", "lab", k)).rejects.toThrow("32 bytes");
  });
});

describe("the deploy key", () => {
  test("only the owner sets, replaces and removes it, and it never comes back", async () => {
    const { call, send, env } = await hosted();
    expect((await send("pat-person", K, { token: TOKEN, account_id: ACCOUNT }, "PUT")).status).toBe(403);
    expect((await call("pat-person", K)).status).toBe(403);
    expect((await send("ryan-quinn", K, { token: "x", account_id: ACCOUNT }, "PUT")).status).toBe(400);
    expect((await send("ryan-quinn", K, { token: TOKEN, account_id: "nope" }, "PUT")).status).toBe(400);

    const put = await (await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT")).text();
    expect(put).not.toContain(TOKEN);
    const got = await (await call("ryan-quinn", K)).text();
    expect(got).not.toContain(TOKEN);
    expect(JSON.parse(got)).toMatchObject({ set: true, by: "ryan-quinn", last4: "WXYZ", hosted: true });
    const row = await env.DB.prepare("SELECT * FROM deploy_keys").first();
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(await (await call("ryan-quinn", D)).json())).not.toContain(TOKEN);

    await send("ryan-quinn", K, { token: TOKEN.replace("WXYZ", "ABCD"), account_id: ACCOUNT }, "PUT");
    expect(await (await call("ryan-quinn", K)).json()).toMatchObject({ last4: "ABCD" });
    expect(await (await call("ryan-quinn", K, { method: "DELETE" })).json()).toEqual({ set: false });
  });

  test("an owner who isn't in ADMINS can't store one or deploy from the site", async () => {
    const { call, send } = await hosted();
    const res = await send("sam-sample", "/api/repos/sam-sample/lab/deploy/key", { token: TOKEN, account_id: ACCOUNT }, "PUT");
    expect(res.status).toBe(403);
    expect((await res.json() as any).error).toContain("ADMINS");
    expect((await send("sam-sample", "/api/repos/sam-sample/lab/deploy", {})).status).toBe(403);
    expect(await (await call("sam-sample", "/api/repos/sam-sample/lab/deploy")).json()).toMatchObject({ can_run: false, hosted: true });
  });

  test("with accounts off, a key can't be stored: anyone could claim the owner's handle", async () => {
    const call = await boot({ GH_CLI: "off", ADMINS: "ryan", DEPLOY_SECRETS_KEY: SECRETS });
    opened.push(call);
    call.env.DEPLOY_RUNNER = runnerNamespace(call.env, fakeContainers().make);
    const send = (url: string, body: unknown, method = "POST") => call("ryan", url, { method, body: JSON.stringify(body) });
    await send("/api/login", { name: "ryan" });
    await send("/api/repos", { name: "lab", visibility: "public" });
    const res = await send("/api/repos/ryan/lab/deploy/key", { token: TOKEN, account_id: ACCOUNT }, "PUT");
    expect(res.status).toBe(403);
    expect((await res.json() as any).error).toContain("BETTER_AUTH_SECRET");
  });
});

describe("a hosted deploy", () => {
  test("needs a key; then runs in its own container with the key in its env, hidden from the log", async () => {
    const { call, send, seen } = await hosted();
    expect(((await (await send("ryan-quinn", D, {})).json()) as any).error).toContain("deploy key");
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    expect((await send("pat-person", D, {})).status).toBe(403);

    expect((await send("ryan-quinn", D, {})).status).toBe(202);
    const d = await settle(call);
    expect(seen.env).toEqual([{ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: "1" }]);
    expect(seen.destroyed).toBe(1);
    expect(seen.ran.find((l) => l.includes("rustybuns deploy"))).toContain("--stage prod");
    expect(d.run.steps.map((s: any) => s.status)).toEqual(["done", "done", "done", "done"]);
    expect(checked).toContain("https://lab.ryan.workers.dev");
    expect(d.history[0]).toMatchObject({ by: "ryan-quinn", trigger: "button", status: "done", runner: "hosted", key_last4: "WXYZ", commit_hash: SHA, url: "https://lab.ryan.workers.dev" });
    expect(JSON.stringify(d)).not.toContain(TOKEN);
    expect(d.history[0].out).toContain("<deploy key>");
  });

  test("the owner's own commit ships when they turned it on; crew commits never do", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, { on_commit: true }, "PUT");
    await send("pat-person", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "crew" });
    await Bun.sleep(30);
    expect(seen.env).toEqual([]);
    await send("ryan-quinn", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "mine" });
    const d = await settle(call);
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ by: "ryan-quinn", trigger: "commit", runner: "hosted", status: "done" });
  });

  test("a removed key fails the run instead of deploying", async () => {
    const { call, send, seen, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    // Removed between the press and the run.
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab");
    const alarm = stub.alarm.bind(stub);
    stub.alarm = async () => { await env.DB.prepare("DELETE FROM deploy_keys").run(); return alarm(); };
    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("deploy key was removed") });
    expect(seen.env).toEqual([]);
  });
});

test("an agent container never gets the deploy secrets", async () => {
  let started: Record<string, string> | undefined;
  const c: ContainerApi = { running: false, start(o) { started = o?.env; }, async destroy() {}, getTcpPort: () => ({ fetch: async () => Response.json({ code: 0, out: "", text: "" }) }) };
  const env: any = { DEPLOY_SECRETS_KEY: SECRETS, ANTHROPIC_API_KEY: "sk-a" };
  await new AgentSandbox({ container: c }, env).fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd: { bin: "claude", args: [] }, path: "a.js", text: "" }) }));
  expect(started).toEqual({ ANTHROPIC_API_KEY: "sk-a" });
});

describe("the deploy container's server", () => {
  test("runs a command in a directory under its work root, and refuses one outside it", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitters-deploy-"));
    try {
      expect(await exec({ cmd: ["sh", "-c", "pwd && echo hi"], cwd: "run/repo" }, root)).toEqual({ code: 0, out: `${realpathSync(root)}/run/repo\nhi\n` });
      expect((await exec({ cmd: ["true"], cwd: "../etc" }, root)).code).toBe(2);
      expect((await exec({ cmd: ["no-such-command-here"], cwd: "run" }, root)).code).toBe(127);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

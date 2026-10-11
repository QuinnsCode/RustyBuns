import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { seal, sealState, unseal, unsealState } from "../src/deploy-keys.ts";
import { DeployRunner, hider, readExec } from "../src/deploy-runner.ts";
import { AgentSandbox, type ContainerApi } from "../src/sandbox.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the deploy image
import { exec, state } from "../deploy-sandbox/server.mjs";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

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
  const seen = { env: [] as Record<string, string>[], ran: [] as string[], limits: [] as number[], destroyed: 0, stacks: [] as string[],
    /** Set, the deploy streams its output in two pieces with this between them, as a real one does. */
    gate: null as Promise<void> | null };
  const make = (): ContainerApi => {
    let running = false;
    // Its disk: .alchemy/state, gone when it's destroyed.
    let files: Record<string, string> = {};
    return {
      get running() { return running; },
      start(o) { running = true; seen.env.push(o?.env ?? {}); },
      async destroy() { running = false; seen.destroyed++; files = {}; },
      getTcpPort: () => ({
        async fetch(u, init) {
          if (String(u).endsWith("/state")) {
            const b = JSON.parse(String(init!.body)) as { files?: Record<string, string> };
            if (b.files) { files = { ...b.files }; return Response.json({ files: Object.keys(files).length }); }
            return Response.json({ files });
          }
          const { cmd, limit_ms } = JSON.parse(String(init!.body)) as { cmd: string[]; limit_ms: number };
          const line = cmd.join(" ");
          seen.ran.push(line);
          seen.limits.push(limit_ms);
          let out = "";
          if (line.includes("rev-parse")) out = SHA + "\n";
          if (line.includes("bun -e")) out = `RB ${JSON.stringify(cfg)}\n`;
          if (line.includes("rustybuns deploy")) {
            // Like Alchemy: with no state, a new stack under a new name; with it, the same one.
            files["lab/prod/Worker.json"] ??= JSON.stringify({ name: `lab-${seen.stacks.length}`, secret: "app-secret-value" });
            seen.stacks.push(JSON.parse(files["lab/prod/Worker.json"]!).name);
            const env = seen.env.at(-1) ?? {};
            out = `using token ${env.CLOUDFLARE_API_TOKEN}\n${env.RAILWAY_API_TOKEN ? `railway ${env.RAILWAY_API_TOKEN}\n` : ""}${env.HCLOUD_TOKEN ? `hetzner ${env.HCLOUD_TOKEN}\n` : ""}url: "https://lab.ryan.workers.dev"\n`;
            const gate = seen.gate;
            if (gate) {
              // Streamed like the real server: the token split across two pieces, the URL after the gate.
              const tok = String(env.CLOUDFLARE_API_TOKEN), e = new TextEncoder();
              return new Response(new ReadableStream({
                async start(c) {
                  c.enqueue(e.encode(JSON.stringify({ out: `building\nusing token ${tok.slice(0, 10)}` }) + "\n"));
                  c.enqueue(e.encode(JSON.stringify({ out: `${tok.slice(10)}\n` }) + "\n"));
                  await gate;
                  c.enqueue(e.encode(JSON.stringify({ out: `url: "https://lab.ryan.workers.dev"\n` }) + "\n" + JSON.stringify({ code: 0 })));
                  c.close();
                },
              }));
            }
          }
          return Response.json({ code: 0, out });
        },
      }),
    };
  };
  return { seen, make };
}

/** A DeployRunner per repo with in-memory storage; its alarm fires on the next tick. */
function runnerNamespace(env: any, make: () => ContainerApi, budgetMs?: number) {
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
            list: async (o: { prefix: string }) => new Map([...data].filter(([k]) => k.startsWith(o.prefix))) as any,
            setAlarm: async () => { setTimeout(() => void obj.alarm(), 0); },
          },
        };
        const obj = new DeployRunner(ctx, env, budgetMs);
        objects.set(id, obj);
      }
      return objects.get(id)!;
    },
  };
}

async function hosted(extra: Record<string, string> = {}, cfg?: { adopt: boolean; edge: boolean; box: boolean }, budgetMs?: number) {
  const booted = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ADMINS: "ryan-quinn", DEPLOY_SECRETS_KEY: SECRETS, ...extra });
  opened.push(booted);
  const c = fakeContainers(cfg);
  booted.env.DEPLOY_RUNNER = runnerNamespace(booted.env, c.make, budgetMs);
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
// A run leaves "running" in the history only once finish() logs it, after the container is destroyed,
// so a settled run has been torn down. Giving up says so, rather than failing a later expect on a half-done run (#287).
const settle = async (call: Call, n = 1) => {
  let d: any;
  for (const end = performance.now() + 15_000; performance.now() < end;) {
    d = await (await call("ryan-quinn", D)).json();
    if (d.history.length >= n && d.history.every((h: any) => h.status !== "running")) return d;
    await Bun.sleep(10);
  }
  throw new Error(`deploys still running after 15s: ${JSON.stringify(d.history.map((h: any) => h.status))}`);
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
    expect(d.history[0]).toMatchObject({ by: "ryan-quinn", trigger: "button", status: "done", runner: "hosted", key_last4: "…WXYZ", commit_hash: SHA, url: "https://lab.ryan.workers.dev" });
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

  test("each command gets what's left of the run's time; a run out of time fails and still cleans up", async () => {
    const ok = await hosted();
    await ok.send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await ok.send("ryan-quinn", D, {});
    await settle(ok.call);
    expect(ok.seen.limits.every((l) => l > 12 * 60_000 && l <= 13 * 60_000)).toBe(true);

    const { call, send, seen } = await hosted({}, undefined, 0);
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "failed" });
    expect(d.history[0].out).toContain("out of time");
    expect(seen.ran).toEqual([]);
    expect(seen.destroyed).toBe(1);
  });

  test("the next deploy updates the same stack: its Alchemy state is kept, sealed, between containers", async () => {
    const { call, send, seen, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, {});
    await settle(call, 1);
    await send("ryan-quinn", D, {});
    await settle(call, 2);
    expect(seen.destroyed).toBe(2);
    expect(seen.stacks).toEqual(["lab-0", "lab-0"]);
    const kept = await (env.DEPLOY_RUNNER.get("ryan-quinn/lab") as any).ctx.storage.get("state");
    expect(kept).not.toContain("app-secret-value");
    expect(atob(kept)).not.toContain("app-secret-value");
    // Sealed to this repo: it doesn't open as another's.
    expect(await unsealState(env, "ryan-quinn", "lab", kept)).toMatchObject({ "lab/prod/Worker.json": expect.stringContaining("lab-0") });
    await expect(unsealState(env, "sam-sample", "lab", kept)).rejects.toThrow();
  });

  test("an alarm retried after a cut-off run fails it instead of deploying again", async () => {
    const { call, send, seen, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab");
    const alarm = stub.alarm.bind(stub);
    // As if an earlier attempt of this alarm started the run and was killed.
    stub.alarm = async () => { (await stub.load()).started = Date.now() - 15 * 60_000; return alarm(); };
    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("cut off") });
    expect(seen.env).toEqual([]);
    expect(seen.destroyed).toBe(1);
  });
});

describe("more providers", () => {
  const RAIL = "railway-team-token-0123456789-RAIL", HET = "hetzner0123456789hetzner0123456789HETZ";
  test("Railway and Hetzner keys go into the container's env for a box target, hidden from the log like Cloudflare's", async () => {
    const { call, send, seen } = await hosted({}, { adopt: false, edge: true, box: true });
    expect((await send("ryan-quinn", `${K}/fly`, { token: RAIL }, "PUT")).status).toBe(404);
    expect((await send("pat-person", `${K}/railway`, { token: RAIL }, "PUT")).status).toBe(403);
    expect((await send("ryan-quinn", `${K}/railway`, { token: "short" }, "PUT")).status).toBe(400);
    // Its own key alone is enough to deploy: a box-only stack needs no Cloudflare key.
    expect(await (await send("ryan-quinn", `${K}/railway`, { token: RAIL }, "PUT")).json()).toMatchObject({ set: true, last4: "RAIL" });
    expect(await (await call("ryan-quinn", D)).json()).toMatchObject({ can_run: true, keys: { cloudflare: { set: false }, railway: { set: true, last4: "RAIL" }, hetzner: { set: false } } });
    await send("ryan-quinn", `${K}/hetzner`, { token: HET }, "PUT");
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");

    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(seen.env).toEqual([{ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, RAILWAY_API_TOKEN: RAIL, HCLOUD_TOKEN: HET, CI: "1" }]);
    expect(d.history[0]).toMatchObject({ status: "done", key_last4: "…WXYZ, railway …RAIL, hetzner …HETZ" });
    const all = JSON.stringify(d);
    for (const t of [TOKEN, RAIL, HET]) expect(all).not.toContain(t);
    expect(d.history[0].out).toContain("railway <deploy key>");

    // Removing one leaves the others.
    expect(await (await call("ryan-quinn", `${K}/railway`, { method: "DELETE" })).json()).toEqual({ set: false });
    expect(await (await call("ryan-quinn", K)).json()).toMatchObject({ set: true });
  });

  test("a key sealed for one provider doesn't open as another's", async () => {
    const env: any = { DEPLOY_SECRETS_KEY: SECRETS };
    const a = await seal(env, "ryan", "lab", { token: RAIL }, "railway");
    expect(await unseal(env, "ryan", "lab", a, "railway")).toEqual({ token: RAIL });
    await expect(unseal(env, "ryan", "lab", a, "hetzner")).rejects.toThrow();
    await expect(unseal(env, "ryan", "lab", a)).rejects.toThrow();
  });
});

describe("live output", () => {
  test("a step's output shows while it runs, with a key split across two pieces still hidden", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    let open!: () => void;
    seen.gate = new Promise((r) => { open = r; });
    await send("ryan-quinn", D, {});
    let mid: any;
    for (const end = performance.now() + 10_000; performance.now() < end; await Bun.sleep(10)) {
      mid = await (await call("ryan-quinn", D)).json();
      if (mid.run?.steps.find((x: any) => x.key === "deploy")?.out.includes("using token")) break;
    }
    const step = mid.run.steps.find((x: any) => x.key === "deploy");
    expect(step).toMatchObject({ status: "running" });
    expect(step.out).toContain("building\nusing token <deploy key>\n");
    expect(step.out).not.toContain("workers.dev");
    expect(JSON.stringify(mid)).not.toContain(TOKEN.slice(0, 10));
    open();
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "done", url: "https://lab.ryan.workers.dev" });
  });

  test("readExec reads the stream's lines, and fails a command whose answer ends early", async () => {
    const stream = (...parts: string[]) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }));
    const got: string[] = [];
    expect(await readExec(stream('{"out":"a', '"}\n{"out":"b\\n"}\n', '{"code":3}'), (s) => got.push(s))).toBe(3);
    expect(got).toEqual(["a", "b\n"]);
    const cut: string[] = [];
    expect(await readExec(stream('{"out":"half"}\n'), (s) => cut.push(s))).toBe(1);
    expect(cut.join("")).toContain("ended before the command did");
    // The old one-shot answer reads the same.
    expect(await readExec(Response.json({ code: 0, out: "x" }), () => {})).toBe(0);
  });

  test("the hider holds a line's tail until the line ends, and a long line's all but a key's length", () => {
    const out: string[] = [];
    const h = hider(["SECRETSECRET"], (s) => out.push(s));
    h.push("one\ntwo SECR"); h.push("ETSECRET three\nfour");
    expect(out).toEqual(["one\n", "two <deploy key> three\n"]);
    h.push("x".repeat(100));
    expect(out.at(-1)).toBe("four" + "x".repeat(100 - 12));
    h.flush();
    expect(out.join("")).toBe("one\ntwo <deploy key> three\nfour" + "x".repeat(100));
  });
});

describe("rotating DEPLOY_SECRETS_KEY", () => {
  const NEW = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 11 + 1)));
  test("what the old key sealed opens while it's DEPLOY_SECRETS_KEY_OLD, and an admin's re-seal moves keys and state onto the new one", async () => {
    const { call, send, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", `${K}/hetzner`, { token: "h".repeat(40) }, "PUT");
    await send("ryan-quinn", D, {});
    await settle(call);
    const runner = env.DEPLOY_RUNNER.get("ryan-quinn/lab") as any;
    // A monorepo folder's state too.
    await runner.ctx.storage.put("state~apps~web", await sealState(env, "ryan-quinn", "lab", { "web/prod/Worker.json": "{}" }));
    const before = (await env.DB.prepare("SELECT sealed FROM deploy_keys ORDER BY provider").all()).results.map((r: any) => r.sealed);

    // Rotated: the new key, and the old one beside it.
    Object.assign(env, { DEPLOY_SECRETS_KEY: NEW, DEPLOY_SECRETS_KEY_OLD: SECRETS });
    expect((await (await call("pat-person", "/api/admin/deploy-keys/reseal", { method: "POST" })).status)).toBe(403);
    expect(await (await call("ryan-quinn", "/api/admin/deploy-keys")).json()).toEqual({ hosted: true, rotating: true, keys: 2 });
    // Still deploys before the re-seal.
    await send("ryan-quinn", D, {});
    expect((await settle(call, 2)).history[0]).toMatchObject({ status: "done" });

    const r = await (await call("ryan-quinn", "/api/admin/deploy-keys/reseal", { method: "POST" })).json();
    // The deploy since kept the root's state under the new key already.
    expect(r).toEqual({ keys: 2, states: 1, failed: [] });
    const after = (await env.DB.prepare("SELECT sealed FROM deploy_keys ORDER BY provider").all()).results.map((x: any) => x.sealed);
    expect(after.every((x: string, i: number) => x !== before[i])).toBe(true);
    expect(await (await call("ryan-quinn", "/api/admin/deploy-keys/reseal", { method: "POST" })).json()).toEqual({ keys: 0, states: 0, failed: [] });

    // The old key gone, everything opens under the new one.
    delete env.DEPLOY_SECRETS_KEY_OLD;
    expect(await unseal(env, "ryan-quinn", "lab", after[0])).toEqual({ token: TOKEN, account_id: ACCOUNT });
    expect(await unsealState(env, "ryan-quinn", "lab", await runner.ctx.storage.get("state~apps~web"))).toEqual({ "web/prod/Worker.json": "{}" });
    expect(await unsealState(env, "ryan-quinn", "lab", await runner.ctx.storage.get("state"))).toMatchObject({ "lab/prod/Worker.json": expect.any(String) });
    await send("ryan-quinn", D, {});
    expect((await settle(call, 3)).history[0]).toMatchObject({ status: "done" });
  });

  test("something sealed under neither key is reported, not dropped", async () => {
    const { call, send, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    Object.assign(env, { DEPLOY_SECRETS_KEY: NEW, DEPLOY_SECRETS_KEY_OLD: NEW });
    const r = await (await call("ryan-quinn", "/api/admin/deploy-keys/reseal", { method: "POST" })).json();
    expect(r).toMatchObject({ keys: 0, failed: ["ryan-quinn/lab cloudflare key"] });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM deploy_keys").first()).toEqual({ n: 1 });
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

  test("hands each piece of output on as it comes", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitters-deploy-"));
    try {
      const pieces: [string, number][] = [];
      const t = Date.now();
      const r = await exec({ cmd: ["sh", "-c", "echo one; sleep 0.3; echo two"], cwd: "run" }, root, undefined, (s: string) => pieces.push([s, Date.now() - t]));
      expect(r).toEqual({ code: 0, out: "one\ntwo\n" });
      expect(pieces.map(([s]) => s).join("")).toBe("one\ntwo\n");
      // "one" arrived before the command finished.
      expect(pieces[0]![0]).toBe("one\n");
      expect(pieces[0]![1]).toBeLessThan(r.code === 0 ? pieces.at(-1)![1] - 200 : 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("carries the Alchemy state in and out, through rustybuns' shared-state symlink, and only under it", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitters-deploy-"));
    try {
      expect(await state({ cwd: "run/repo", files: { "app/prod/Worker.json": "{}" } }, root)).toEqual({ files: 1 });
      // rustybuns deploy moves it into the git dir and links it back.
      renameSync(join(root, "run/repo/.alchemy/state"), join(root, "shared"));
      symlinkSync(join(root, "shared"), join(root, "run/repo/.alchemy/state"), "dir");
      writeFileSync(join(root, "shared/app/prod/DB.json"), "[]");
      expect(await state({ cwd: "run/repo" }, root)).toEqual({ files: { "app/prod/Worker.json": "{}", "app/prod/DB.json": "[]" } });
      expect(await state({ cwd: "elsewhere" }, root)).toEqual({ files: {} });
      await expect(state({ cwd: "run/repo", files: { "../../../../x": "" } }, root)).rejects.toThrow("bad state file");
      await expect(state({ cwd: "../.." }, root)).rejects.toThrow("bad directory");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a command over its time limit is killed, and answers even if what it started holds the output open", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitters-deploy-"));
    try {
      // The child holds the output pipe open, as alchemy does under rustybuns deploy.
      const t = Date.now();
      const r = await exec({ cmd: ["sh", "-c", "sleep 30 & echo $! > child.pid; wait"], cwd: "run" }, root, 300);
      expect(Date.now() - t).toBeLessThan(3000);
      expect(r.code).toBe(124);
      expect(r.out).toContain("killed after 300 ms");
      process.kill(Number(readFileSync(join(root, "run", "child.pid"), "utf8")), "SIGKILL");
      // The run's time left, when it's shorter, is the limit.
      expect((await exec({ cmd: ["sleep", "5"], cwd: "run", limit_ms: 200 }, root)).out).toContain("killed after 200 ms");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

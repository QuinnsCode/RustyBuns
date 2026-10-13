import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { seal, sealState, unseal, unsealState } from "../src/deploy-keys.ts";
import { DeployRunner, hider, readExec } from "../src/deploy-runner.ts";
import { review, textDiff } from "../src/deploy-review.ts";
import { AgentSandbox, type ContainerApi } from "../src/sandbox.ts";
import { CiRunner } from "../src/ci-runner.ts";
import { gated, gateExports } from "./fake-gate.ts";
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
const origin = "http://codesplitter.local";

/** A deploy container: its server answers each command like deploy.test.ts's fake machine, echoing the token once to check it's hidden. */
function fakeContainers(cfg = { adopt: false, edge: true, box: false }) {
  const seen = { env: [] as Record<string, string>[], lists: [] as string[][], internet: [] as (boolean | undefined)[], ran: [] as string[], limits: [] as number[], destroyed: 0, stacks: [] as string[],
    /** What POST /files laid over a clone: the dependency doctor's files (#900). */
    laid: [] as { cwd: string; files: Record<string, string> }[],
    /** Set, the deploy streams its output in two pieces with this between them, as a real one does. */
    gate: null as Promise<void> | null,
    /** The commit the clone lands on: the remote's tip, once hosted() knows the app. */
    head: async () => SHA,
    /** Set, a command it matches exits 1. */
    fails: null as ((line: string) => boolean) | null };
  const make = (): ContainerApi => {
    let running = false;
    // Its disk: .alchemy/state, gone when it's destroyed.
    let files: Record<string, string> = {};
    return gated<ContainerApi>({
      get running() { return running; },
      start(o) { running = true; seen.env.push(o?.env ?? {}); seen.internet.push(o?.enableInternet); },
      async destroy() { running = false; seen.destroyed++; files = {}; },
      getTcpPort: () => ({
        async fetch(u, init) {
          if (String(u).endsWith("/files")) {
            const b = JSON.parse(String(init!.body)) as { cwd: string; files: Record<string, string> };
            seen.laid.push(b);
            return Response.json({ files: Object.keys(b.files).length });
          }
          if (String(u).endsWith("/state")) {
            const b = JSON.parse(String(init!.body)) as { files?: Record<string, string> };
            if (b.files) { files = { ...b.files }; return Response.json({ files: Object.keys(files).length }); }
            return Response.json({ files });
          }
          const { cmd, limit_ms } = JSON.parse(String(init!.body)) as { cmd: string[]; limit_ms: number };
          const line = cmd.join(" ");
          seen.ran.push(line);
          seen.limits.push(limit_ms);
          if (seen.fails?.(line)) return Response.json({ code: 1, out: "it failed\n" });
          let out = "";
          if (line.includes("rev-parse")) out = (await seen.head()) + "\n";
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
    }, seen.lists).container;
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
          exports: gateExports,
          storage: {
            get: async (k: string) => structuredClone(data.get(k)) as any,
            put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); },
            list: async (o: { prefix: string }) => new Map([...data].filter(([k]) => k.startsWith(o.prefix))) as any,
            delete: async (k: string) => data.delete(k),
            // A later one is the test's to fire, with alarm().
            setAlarm: async (at: number) => { if (at <= Date.now() + 1000) setTimeout(() => void obj.alarm(), 0); },
          },
        };
        const obj = new DeployRunner(ctx, env, budgetMs);
        objects.set(id, obj);
      }
      return objects.get(id)!;
    },
  };
}

async function hosted(extra: Record<string, string> = {}, cfg?: { adopt: boolean; edge: boolean; box: boolean }, budgetMs?: number, pkg = "{}") {
  const booted = await boot({ GH_CLI: "off", BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin, ADMINS: "ryan-quinn", DEPLOY_SECRETS_KEY: SECRETS, ...extra });
  opened.push(booted);
  const c = fakeContainers(cfg);
  c.seen.head = async () => (await review(booted.env, "ryan-quinn", "lab")).tip ?? SHA;
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
    await send(who, `/api/repos/${who}/lab/files`, { path: "package.json", content: pkg });
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
    // The internet off, and through the gate only the clone, the registries and Cloudflare's API (#681).
    expect(seen.internet).toEqual([false]);
    expect(seen.lists).toHaveLength(1);
    expect(seen.lists[0]).toEqual(expect.arrayContaining(["registry.npmjs.org", "api.cloudflare.com"]));
    expect(seen.lists[0]!.some((h) => /railway|hetzner/.test(h))).toBe(false);
    expect(seen.destroyed).toBe(1);
    expect(seen.ran.find((l) => l.includes("rustybuns deploy"))).toContain("--stage prod");
    expect(d.run.steps.map((s: any) => s.status)).toEqual(["done", "done", "done", "done"]);
    expect(checked).toContain("https://lab.ryan.workers.dev");
    expect(d.history[0]).toMatchObject({ by: "ryan-quinn", trigger: "button", status: "done", runner: "hosted", key_last4: "…WXYZ", commit_hash: await seen.head(), url: "https://lab.ryan.workers.dev" });
    expect(JSON.stringify(d)).not.toContain(TOKEN);
    expect(d.history[0].out).toContain("<deploy key>");
  });

  test("the owner's own commit ships when they turned it on; crew commits never do", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, { on_commit: true }, "PUT");
    await send("ryan-quinn", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "mine" });
    const d = await settle(call);
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ by: "ryan-quinn", trigger: "commit", runner: "hosted", status: "done" });
    await send("pat-person", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "crew" });
    await Bun.sleep(30);
    expect(seen.env).toHaveLength(1);
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
    // Hetzner's deploy SSHes to its server, so other ports stay open; HTTP and HTTPS still go through the gate.
    expect(seen.internet).toEqual([true]);
    expect(seen.lists[0]).toEqual(expect.arrayContaining(["api.cloudflare.com", "backboard.railway.com", "api.hetzner.cloud"]));
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
    // The deploy since sealed the keys it read, and the root's state it kept, under the new key already.
    expect(r).toEqual({ keys: 0, states: 1, failed: [] });
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

// Sealed as the site was named before the rename (#805): bound to "codesplitters …".
async function oldSeal(secret: string, what: string, value: unknown) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`codesplitters ${what}`) }, key, new TextEncoder().encode(JSON.stringify(value))));
  return btoa(String.fromCharCode(...iv, ...ct));
}

test("what was sealed before the rename still opens, and is sealed again as codesplitter when a deploy or a re-seal reads it", async () => {
  const { call, send, env } = await hosted();
  await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
  const old = await oldSeal(SECRETS, "deploy key ryan-quinn/lab", { token: TOKEN, account_id: ACCOUNT });
  await env.DB.prepare("UPDATE deploy_keys SET sealed = ?").bind(old).run();
  expect(await unseal(env, "ryan-quinn", "lab", old)).toEqual({ token: TOKEN, account_id: ACCOUNT });

  // A deploy opens it, and leaves it sealed under the new name.
  await send("ryan-quinn", D, {});
  expect((await settle(call)).history[0]).toMatchObject({ status: "done" });
  const now = (await env.DB.prepare("SELECT sealed FROM deploy_keys").first()) as { sealed: string };
  expect(now.sealed).not.toBe(old);
  expect(await unseal(env, "ryan-quinn", "lab", now.sealed)).toEqual({ token: TOKEN, account_id: ACCOUNT });

  // A state kept from before is moved by the admin's re-seal, with no key being rotated.
  const runner = env.DEPLOY_RUNNER.get("ryan-quinn/lab") as any;
  await runner.ctx.storage.put("state~apps~web", await oldSeal(SECRETS, "alchemy state ryan-quinn/lab", { "web/prod/Worker.json": "{}" }));
  expect(await (await call("ryan-quinn", "/api/admin/deploy-keys/reseal", { method: "POST" })).json()).toEqual({ keys: 0, states: 1, failed: [] });
  expect(await (await call("ryan-quinn", "/api/admin/deploy-keys/reseal", { method: "POST" })).json()).toEqual({ keys: 0, states: 0, failed: [] });
  expect(await unsealState(env, "ryan-quinn", "lab", await runner.ctx.storage.get("state~apps~web"))).toEqual({ "web/prod/Worker.json": "{}" });
});

test("an agent container never gets the deploy secrets", async () => {
  let started: Record<string, string> | undefined;
  const c: ContainerApi = { running: false, start(o) { started = o?.env; }, async destroy() {}, getTcpPort: () => ({ fetch: async () => Response.json({ code: 0, out: "", text: "" }) }) };
  const env: any = { DEPLOY_SECRETS_KEY: SECRETS, ANTHROPIC_API_KEY: "sk-a" };
  await new AgentSandbox(gated(c), env).fetch(new Request("http://sandbox/run", { method: "POST", body: JSON.stringify({ cmd: { bin: "claude", args: [] }, path: "a.js", text: "" }) }));
  expect(started).toEqual({ ANTHROPIC_API_KEY: "sk-a" });
});

describe("the deploy container's server", () => {
  test("runs a command in a directory under its work root, and refuses one outside it", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitter-deploy-"));
    try {
      expect(await exec({ cmd: ["sh", "-c", "pwd && echo hi"], cwd: "run/repo" }, root)).toEqual({ code: 0, out: `${realpathSync(root)}/run/repo\nhi\n` });
      expect((await exec({ cmd: ["true"], cwd: "../etc" }, root)).code).toBe(2);
      expect((await exec({ cmd: ["no-such-command-here"], cwd: "run" }, root)).code).toBe(127);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("hands each piece of output on as it comes", async () => {
    const root = mkdtempSync(join(tmpdir(), "codesplitter-deploy-"));
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
    const root = mkdtempSync(join(tmpdir(), "codesplitter-deploy-"));
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
    const root = mkdtempSync(join(tmpdir(), "codesplitter-deploy-"));
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

describe("code that isn't the owner's waits for them (#646)", () => {
  type Send = (u: string, url: string, b: unknown) => Promise<Response>;
  const edit = (send: Send, who: string, text: string, path = "rustybuns.config.ts") => send(who, "/api/repos/ryan-quinn/lab/files", { path, content: text });
  const commit = (send: Send, who: string, path = "rustybuns.config.ts") => send(who, `/api/repos/ryan-quinn/lab/do/commit?path=${path}`, { message: `${who}'s ${path}` });

  test("a crew commit holds the deploy, keys sealed, until the owner approves the diff at that tip", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, { on_commit: true }, "PUT");
    await edit(send, "pat-person", "export default { exfiltrate: true }");
    await commit(send, "pat-person");
    // Not even the owner's next commit ships it: the crew's is still under it.
    await send("ryan-quinn", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "mine" });
    await Bun.sleep(30);
    expect(seen.env).toEqual([]);

    const pressed = await send("ryan-quinn", D, {});
    expect(pressed.status).toBe(409);
    const waiting = (await pressed.json()) as any;
    expect(waiting.error).toContain("waiting for you");
    expect(waiting.review.commits.map((c: any) => c.message)).toEqual(["pat-person's rustybuns.config.ts"]);
    expect(waiting.review.cleared).toBe(false);
    const d0 = (await (await call("ryan-quinn", D)).json()) as any;
    expect(d0.review).toMatchObject({ cleared: false, tip: waiting.review.tip });

    // The diff since the last approval (none yet: from the start), the crew's line in it.
    const r = (await (await call("ryan-quinn", `${D}/review`)).json()) as any;
    expect(r.diff.files.find((f: any) => f.path === "rustybuns.config.ts")).toMatchObject({ note: "new file", lines: expect.arrayContaining(["+ export default { exfiltrate: true }"]) });
    expect((await call("pat-person", `${D}/review`)).status).toBe(403);
    expect(seen.env).toEqual([]);

    // Approving a tip that isn't main's any more doesn't approve anything.
    expect((await send("ryan-quinn", D, { approve: "f".repeat(40) })).status).toBe(409);
    expect((await send("ryan-quinn", D, { approve: waiting.review.tip })).status).toBe(202);
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "done", commit_hash: waiting.review.tip });
    expect(seen.env).toHaveLength(1);

    // Cleared from there: the owner's own commit ships with no question.
    await edit(send, "ryan-quinn", "export const mine = 1", "src/app.ts");
    await commit(send, "ryan-quinn", "src/app.ts");
    expect((await settle(call, 2)).history[0]).toMatchObject({ trigger: "commit", status: "done" });
  });

  test("the owner's commit of a file someone else edited since its last commit waits too", async () => {
    const { send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await edit(send, "pat-person", "export default { theirs: true }");
    await commit(send, "ryan-quinn");
    const res = await send("ryan-quinn", D, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).review.commits).toHaveLength(1);
    expect(seen.env).toEqual([]);
  });

  test("the runner checks again before it unseals the keys, and won't deploy a clone of another commit", async () => {
    const { call, send, seen, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    // A crew commit lands between the press and the run.
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab");
    const alarm = stub.alarm.bind(stub);
    stub.alarm = async () => { await edit(send, "pat-person", "x"); await commit(send, "pat-person"); stub.alarm = alarm; return alarm(); };
    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("waiting for you") });
    expect(seen.env).toEqual([]);

    // Approved, but main moves before the clone: the clone isn't what was checked, so nothing runs.
    const tip = ((await (await call("ryan-quinn", D)).json()) as any).review.tip;
    seen.head = async () => "e".repeat(40);
    await send("ryan-quinn", D, { approve: tip });
    const d2 = await settle(call, 2);
    expect(d2.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("main moved") });
    expect(seen.ran.some((l) => l.includes("bun install"))).toBe(false);
  });
});

describe("the dependency doctor's preview on the site (#900)", () => {
  /** The owner's package.json with one dependency a major behind, the doctor's previews on, and a fake npm. */
  async function doctor() {
    const h = await hosted({}, undefined, undefined, `{\n  "dependencies": {\n    "kleur": "^3.0.0"\n  }\n}`);
    h.env.DEPS_REGISTRY = async (name: string) => name === "kleur"
      ? { versions: ["3.0.0", "4.1.5"], time: { "3.0.0": new Date(Date.now() - 900 * 86_400_000).toISOString(), "4.1.5": new Date(Date.now() - 30 * 86_400_000).toISOString() } } : null;
    h.env.DEPS_ADVISORIES = async () => new Map();
    await h.send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await h.send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps", { max_level: "major", preview: true }, "PUT");
    return h;
  }
  const P = "/api/repos/ryan-quinn/lab/preview";

  test("it runs in the deploy container in an alarm of its own; the branch waits, and the next run picks up the result", async () => {
    const { call, send, seen } = await doctor();
    expect(await (await call("ryan-quinn", "/api/repos/ryan-quinn/lab/deps")).json()).toMatchObject({ can_preview: true });
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(first.branch).toBeUndefined();
    expect(first.waiting).toMatchObject({ stage: expect.stringMatching(/^preview-/), names: ["kleur"] });
    expect(first.note).toContain("the branch waits for it");
    const { id } = first.waiting, stage = `preview-${id}`;

    let h: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (h = await (await call("ryan-quinn", P)).json()).history[0]?.status === "running";) await Bun.sleep(10);
    expect(h.history[0]).toMatchObject({ id: id, by: "agent-deps", trigger: "preview", runner: "hosted", status: "done", key_last4: "…WXYZ" });
    // The doctor's package.json went over the clone through the container's /files, then up and down on its own stage.
    expect(seen.laid).toHaveLength(1);
    expect(seen.laid[0]!.cwd).toBe(`/work/${id}/repo`);
    expect(seen.laid[0]!.files["package.json"]).toContain(`"kleur": "^4.1.5"`);
    expect(seen.ran.filter((l) => /rustybuns (deploy|destroy)/.test(l))).toEqual([`bun x rustybuns deploy --yes --stage ${stage}`, `bun x rustybuns destroy --yes --stage ${stage}`]);
    expect(seen.destroyed).toBe(1);
    // A preview keeps no Alchemy state, and the deploy panel still shows no deploy.
    expect((await (await call("ryan-quinn", D)).json() as any).run).toBeNull();

    // The next run asks with the same files and gets the result: no second container, and the branch goes up.
    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.waiting).toBeUndefined();
    expect(second.previews).toEqual([{ id: id, stage: stage, ok: true, names: ["kleur"], url: "https://lab.ryan.workers.dev" }]);
    expect(second.branch).toMatch(/^deps-/);
    expect(seen.env).toHaveLength(1);
  });

  test("with the site's container minutes spent, it doesn't start, and nothing unchecked goes on a branch", async () => {
    const { send, seen, env } = await doctor();
    await env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('containers', 0, 86400, 1, 'reject')").run();
    const r = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(r.note).toContain("a preview deploy couldn't go (The site's container minutes");
    expect(r.branch).toBeUndefined();
    expect(seen.env).toEqual([]);
  });

  /** A CiRunner whose container answers each command with `code`, recording what it ran and what went over the clone. */
  function ciRunner(env: any, code = 0) {
    const seen = { ran: [] as string[], laid: [] as Record<string, string>[], env: [] as (Record<string, string> | undefined)[], internet: [] as (boolean | undefined)[], alarms: [] as Promise<void>[] };
    const data = new Map<string, unknown>();
    const obj: CiRunner = new CiRunner({
      container: gated<ContainerApi>({
        running: false,
        start(o) { seen.env.push(o?.env); seen.internet.push(o?.enableInternet); },
        async destroy() {},
        getTcpPort: () => ({
          async fetch(u, init) {
            const b = JSON.parse(String(init!.body));
            if (String(u).endsWith("/files")) { seen.laid.push(b.files); return Response.json({ files: Object.keys(b.files).length }); }
            seen.ran.push(b.cmd.join(" "));
            return Response.json({ code: b.cmd[0] === "sh" ? code : 0, out: b.cmd[0] === "sh" ? "1 fail\n" : "" });
          },
        }),
      }, []).container,
      exports: gateExports,
      storage: {
        get: async (k: string) => structuredClone(data.get(k)) as any,
        put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); },
        setAlarm: async () => { seen.alarms.push(Bun.sleep(0).then(() => obj.alarm())); },
      },
    }, env);
    env.CI_RUNNER = { idFromName: (n: string) => n, get: () => obj };
    return { seen, settled: async () => { for (let n = 0; n < seen.alarms.length; n++) await seen.alarms[n]; } };
  }
  const settlePreview = async (call: Call) => {
    let h: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (h = await (await call("ryan-quinn", P)).json()).history[0]?.status === "running";) await Bun.sleep(10);
    return h;
  };

  test("with no tester, the repo's checks run on the same files alongside, in a container with no secrets; the branch waits for both (#1294)", async () => {
    const { call, send, env } = await doctor();
    const ci = ciRunner(env);
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(first.branch).toBeUndefined();
    expect(first.waiting).toMatchObject({ stage: expect.stringMatching(/^preview-/), checks: expect.any(String), names: ["kleur"] });
    expect(first.note).toContain("the repo's checks are running in its check container: the branch waits for them");
    await Promise.all([ci.settled(), settlePreview(call)]);
    expect(ci.seen.laid).toHaveLength(1);
    expect(ci.seen.laid[0]!["package.json"]).toContain(`"kleur": "^4.1.5"`);
    expect(ci.seen.ran[0]).toStartWith("git clone --quiet http");
    expect(ci.seen.ran.at(-1)).toBe("sh -c bun test");
    expect(ci.seen.env).toEqual([{ CI: "1" }]);
    expect(ci.seen.internet).toEqual([false]);

    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.waiting).toBeUndefined();
    expect(second.checks).toEqual([{ id: first.waiting.checks, ok: true, names: ["kleur"] }]);
    expect(second.previews).toMatchObject([{ ok: true, names: ["kleur"] }]);
    expect(second.branch).toMatch(/^deps-/);
    // Asked again with the same files, the kept result: no second container.
    expect(ci.seen.env).toHaveLength(1);
  });

  test("what fails the repo's checks doesn't deploy, and goes on no branch (#1294)", async () => {
    const { call, send, env, seen } = await doctor();
    const ci = ciRunner(env, 1);
    await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json();
    await Promise.all([ci.settled(), settlePreview(call)]);
    const deployed = seen.env.length;
    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.checks).toMatchObject([{ ok: false, failed: "test", names: ["kleur"] }]);
    expect(second.updates).toMatchObject([{ name: "kleur", status: "broke", out: expect.stringContaining("the repo's checks: test failed") }]);
    expect(second.branch).toBeUndefined();
    expect(second.waiting).toBeUndefined();
    expect(seen.env).toHaveLength(deployed);
  });

  test("a failed destroy keeps the stage's state sealed; a later alarm destroys it in a fresh container, then drops it (#1299)", async () => {
    const { call, send, seen, env } = await doctor();
    let destroys = 0;
    seen.fails = (l) => l.includes("rustybuns destroy") && destroys++ === 0;
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    const { id } = first.waiting, stage = `preview-${id}`;
    expect((await settlePreview(call)).history[0]).toMatchObject({ id, status: "failed", note: expect.stringContaining("state is kept, sealed") });
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab") as any;
    const stuck = await stub.ctx.storage.get(`stuck:${stage}`);
    expect(stuck).toMatchObject({ stage, tries: 0, files: { "package.json": expect.stringContaining(`"kleur": "^4.1.5"`) } });
    expect(await unsealState(env, "ryan-quinn", "lab", stuck.sealed)).toMatchObject({ "lab/prod/Worker.json": expect.stringContaining("lab-0") });
    expect(seen.destroyed).toBe(1);

    // The later alarm: a fresh container, the commit the preview ran with its files, its state back, destroyed.
    seen.ran.length = 0;
    await stub.alarm();
    expect(seen.ran[1]).toContain(`fetch --quiet --depth 1`);
    expect(seen.ran[1]).toEndWith(stuck.commit);
    expect(seen.ran.at(-1)).toBe(`bun x rustybuns destroy --yes --stage ${stage}`);
    expect(seen.laid.at(-1)!.files).toEqual(stuck.files);
    expect(seen.env).toHaveLength(2);
    expect(seen.destroyed).toBe(2);
    expect(await stub.ctx.storage.list({ prefix: "stuck:" })).toEqual(new Map());
    expect((await settlePreview(call)).history[0].note).toContain("a later try took stage");
    // Nothing left to destroy: the next alarm starts no container.
    await stub.alarm();
    expect(seen.env).toHaveLength(2);
  });
});

test("the review's diff: what goes, what comes, two lines of context, where each hunk starts", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n") + "\n";
  const b = ["1", "2", "3", "four", "5", "6", "7", "8", "9", "10"].join("\n") + "\n";
  expect(textDiff(a, b)).toEqual(["@@ 2", "  2", "  3", "- 4", "+ four", "  5", "  6", "@@ 8", "  8", "  9", "+ 10"]);
  expect(textDiff("", "x\n")).toEqual(["@@ 1", "+ x"]);
  expect(textDiff("same\n", "same\n")).toEqual([]);
});

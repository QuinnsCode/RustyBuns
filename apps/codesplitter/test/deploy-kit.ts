// What the hosted-deploy tests share: a fake container runner, a hosted app with a repo to deploy and
// the fetch stub. Split across two files so bun test --parallel can run them side by side; each
// file gets its own copy of this module.
import { afterAll, beforeAll, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { DeployRunner } from "../src/deploy-runner.ts";
import { review } from "../src/deploy-review.ts";
import { type ContainerApi } from "../src/sandbox.ts";
import { gated, gateExports } from "./fake-gate.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the deploy image
import { state } from "../deploy-sandbox/server.mjs";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

export const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
// After a deploy the runner GETs the URL it printed until it answers. Here that's the fake
// lab.ryan.workers.dev, so answer it locally: a real request waits on the network, and one that
// fails retries every 2s, past the 5s test timeout.
export const checked: string[] = [];
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

export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const TOKEN = "cf-scoped-token-0123456789abcdWXYZ";
export const ACCOUNT = "0123456789abcdef0123456789abcdef";
export const SECRETS = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7)));
export const origin = "http://codesplitter.local";

/** A deploy container: its server answers each command like deploy.test.ts's fake machine, echoing the token once to check it's hidden. */
export function fakeContainers(cfg = { adopt: false, edge: true, box: false }) {
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
          if (line.includes("rustybuns infra")) out = `INFRA ${JSON.stringify({ app: "lab", stage: "prod", mode: "edge", targets: ["edge"], nodes: [{ id: "w", kind: "worker", name: "lab" }], edges: [] })}\n`;
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
export function runnerNamespace(env: any, make: () => ContainerApi, budgetMs?: number) {
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

export async function hosted(extra: Record<string, string> = {}, cfg?: { adopt: boolean; edge: boolean; box: boolean }, budgetMs?: number, pkg = "{}") {
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

export const K = "/api/repos/ryan-quinn/lab/deploy/key", D = "/api/repos/ryan-quinn/lab/deploy";
// A run leaves "running" in the history only once finish() logs it, after the container is destroyed,
// so a settled run has been torn down. Giving up says so, rather than failing a later expect on a half-done run (#287).
export const settle = async (call: Call, n = 1) => {
  let d: any;
  for (const end = performance.now() + 15_000; performance.now() < end;) {
    d = await (await call("ryan-quinn", D)).json();
    if (d.history.length >= n && d.history.every((h: any) => h.status !== "running")) return d;
    await Bun.sleep(10);
  }
  throw new Error(`deploys still running after 15s: ${JSON.stringify(d.history.map((h: any) => h.status))}`);
};

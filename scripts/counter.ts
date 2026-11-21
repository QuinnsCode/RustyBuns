// The sample-app contract every apps/<framework>-example meets (FRAMEWORKS.md, "The sample app contract"),
// checked over plain HTTP so one journey covers them all:
//
//   1. no token: 403                          2. `/` shows `count: 0` on a fresh data dir
//   3. the page's <form method="post"> increments it through the framework's own server mechanism
//      (an action, an endpoint, a server function); posted twice, `/` shows `count: 2`
//   4. the host quits and starts again on the same data dir: still `count: 2` (KV is the local twin, on disk)
//   5. the edge column: the stack `plan` would run declares the Worker and the COUNTER namespace (no account,
//      no second build: `rustybuns generate`, read the way `plan --offline` reads it)
//
// Each example's test is one line: `test("...", () => counterJourney(import.meta.dir + "/.."))`.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plannedResources } from "../packages/cli/src/offline-plan.ts";

const cli = join(import.meta.dir, "../packages/cli/src/index.ts");
const token = "counter-journey-token";

export type Host = { proc: ReturnType<typeof Bun.spawn>; url: string; cookie: string };

const DEV_HOST = ["bun", ".rustybuns/dev/desktop.js"];

/**
 * The token the host serves behind. The dev host takes the journey's RB_TOKEN; a compiled binary mints its own and
 * leaves it in <data>/desktop.json (`~/.<app>/`), the way local tools find it.
 */
async function tokenOf(home: string, url: string, dev: boolean): Promise<string> {
  if (dev) return token;
  for (let i = 0; i < 50; i++) {
    for (const d of readdirSync(home)) {
      const file = join(home, d, "desktop.json");
      const got: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      // After a restart the last run's file is still there until this one writes its own: match the URL.
      if (got && typeof got === "object" && "token" in got && typeof got.token === "string" && "url" in got && got.url === url) return got.token;
    }
    await Bun.sleep(100);
  }
  throw new Error(`the binary wrote no desktop.json for ${url} under ${home}`);
}

/** The app's desktop host on a fresh port with its token: the dev host, or `cmd` (a built binary). */
export async function start(app: string, home: string, cmd = DEV_HOST): Promise<Host> {
  // A binary ignores RB_TOKEN for its gate, so it isn't handed one its own server-side fetches would carry.
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home, RB_NO_BROWSER: "1", RB_TOKEN: token };
  if (cmd !== DEV_HOST) delete env.RB_TOKEN;
  const proc = Bun.spawn(cmd, { cwd: app, env, stdout: "pipe", stderr: "pipe" });
  let seen = "";
  const timer = Bun.sleep(30_000).then(() => { throw new Error(`host not serving after 30s:\n${seen}`); });
  const serving = (async () => {
    for await (const chunk of proc.stdout) {
      seen += new TextDecoder().decode(chunk);
      const url = seen.match(/serving (http:\/\/[\d.]+:\d+)/)?.[1];
      if (url) return { proc, url, cookie: `rb_token_${new URL(url).port}=${await tokenOf(home, url, cmd === DEV_HOST)}` };
    }
    throw new Error(`host exited before serving:\n${seen}\n${await new Response(proc.stderr).text()}`);
  })();
  return Promise.race([serving, timer]);
}

export const stop = async (h: Host) => { h.proc.kill(); await h.proc.exited; };

/** The N in `<h1 id="count">count: N</h1>`, whatever the framework put around it. */
export function countIn(html: string): number {
  const m = html.replace(/<!--[\s\S]*?-->/g, "").match(/id="count"[^>]*>\s*count:\s*(\d+)/);
  if (!m) throw new Error(`no <h1 id="count">count: N</h1> in the page:\n${html.slice(0, 2000)}`);
  return Number(m[1]);
}

/** The increment form's action and its hidden fields, as a browser would submit it. */
export function formIn(html: string): { action: string; body: URLSearchParams } {
  const form = html.match(/<form\b[^>]*method=["']?post["']?[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) throw new Error(`no <form method="post"> in the page:\n${html.slice(0, 2000)}`);
  const action = form[0].match(/\baction=["']([^"']*)["']/)?.[1] ?? "/";
  const body = new URLSearchParams();
  for (const input of form[1]!.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/\bname=["']([^"']*)["']/)?.[1];
    const value = input[0].match(/\bvalue=["']([^"']*)["']/)?.[1] ?? "";
    if (name) body.set(name, value);
  }
  return { action, body };
}

/** `host` is the command that serves the app (a built binary); by default the dev host, built here first. */
export async function counterJourney(app: string, opts: { build?: boolean; spa?: string; host?: string[]; edge?: false } = {}): Promise<void> {
  if (opts.build !== false && !opts.host) {
    const build = Bun.spawn(["bun", cli, "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (await build.exited) throw new Error(`build desktop --dev failed:\n${await new Response(build.stdout).text()}\n${await new Response(build.stderr).text()}`);
  }
  const home = mkdtempSync(join(tmpdir(), "counter-"));
  const boot = () => start(app, home, opts.host);
  let host = await boot();
  try {
    const get = async (path: string) => fetch(host.url + path, { headers: { cookie: host.cookie } });
    const page = async () => await (await get("/")).text();
    const bare = await fetch(host.url + "/");
    if (bare.status !== 403) throw new Error(`no token: HTTP ${bare.status}, want 403`);
    if (opts.spa) return await spaJourney(host, opts.spa, async () => { await stop(host); host = await boot(); return host; });
    const first = await get("/");
    if (first.status !== 200) throw new Error(`with the token: HTTP ${first.status}, want 200\n${(await first.text()).slice(0, 1000)}`);
    const html = await first.text();
    if (countIn(html) !== 0) throw new Error(`fresh data dir, but the page shows count: ${countIn(html)}`);
    const { action, body } = formIn(html);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(new URL(action, host.url), { method: "POST", redirect: "manual", headers: { cookie: host.cookie, "content-type": "application/x-www-form-urlencoded", origin: host.url, referer: host.url + "/" }, body: body.toString() });
      if (res.status >= 400) throw new Error(`POST ${action}: HTTP ${res.status}\n${(await res.text()).slice(0, 1000)}`);
    }
    const after = countIn(await page());
    if (after !== 2) throw new Error(`after two increments the page shows count: ${after}, want 2`);
    await stop(host);
    host = await boot();
    const again = countIn(await page());
    if (again !== 2) throw new Error(`after a restart the page shows count: ${again}, want 2`);
  } finally {
    await stop(host);
    rmSync(home, { recursive: true, force: true });
  }
  if (!opts.spa && opts.edge !== false) await edgePlan(app);
}

/**
 * What the edge would get: `rustybuns generate` writes the stack `plan` and `deploy` run, and it must declare
 * the Worker and the COUNTER namespace. A client-only SPA is desktop-only, so it has no Worker to check.
 */
export async function edgePlan(app: string): Promise<void> {
  const gen = Bun.spawn(["bun", cli, "generate"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (await gen.exited) throw new Error(`generate failed:\n${await new Response(gen.stdout).text()}\n${await new Response(gen.stderr).text()}`);
  const made = plannedResources(readFileSync(join(app, ".rustybuns/alchemy.run.ts"), "utf8"));
  const missing = [
    made.some((r) => r.type === "Cloudflare.Worker") ? "" : "a Cloudflare.Worker",
    made.some((r) => r.id === "COUNTER" && r.type === "Cloudflare.KV.Namespace") ? "" : "the COUNTER KV namespace",
  ].filter(Boolean);
  if (missing.length) throw new Error(`the edge plan is missing ${missing.join(" and ")}; it declares: ${made.map((r) => `${r.id} ${r.type}`).join(", ") || "nothing"}`);
}

// A client-only app (a Vite SPA) has no server render and no form: the page is a shell and the count lives
// in a "use server" action the desktop host runs. `action` is that module's path (`src/actions/counter.ts`);
// it exports getCount() and increment(), reached the way the page reaches them, through /__rb/action.
async function spaJourney(host: Host, action: string, restart: () => Promise<Host>): Promise<void> {
  const call = async (h: Host, fn: string) => {
    const res = await fetch(h.url + "/__rb/action", { method: "POST", headers: { cookie: h.cookie, "content-type": "application/json", origin: h.url }, body: JSON.stringify({ module: action, fn, args: [] }) });
    if (!res.ok) throw new Error(`${fn}: HTTP ${res.status}\n${(await res.text()).slice(0, 1000)}`);
    return await res.json();
  };
  const page = await fetch(host.url + "/", { headers: { cookie: host.cookie } });
  const html = await page.text();
  if (page.status !== 200 || !/<script[^>]*type="module"/.test(html)) throw new Error(`/ should be the built shell (HTTP ${page.status}):\n${html.slice(0, 1000)}`);
  if (await call(host, "getCount") !== 0) throw new Error("fresh data dir, but getCount() is not 0");
  await call(host, "increment");
  const two = await call(host, "increment");
  if (two !== 2) throw new Error(`after two increments the action says ${two}, want 2`);
  const again = await call(await restart(), "getCount");
  if (again !== 2) throw new Error(`after a restart getCount() is ${again}, want 2`);
}

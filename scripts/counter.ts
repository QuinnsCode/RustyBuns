// The sample-app contract every apps/<framework>-example meets (FRAMEWORKS.md, "The sample app contract"),
// checked over plain HTTP so one journey covers them all:
//
//   1. no token: 403                          2. `/` shows `count: 0` on a fresh data dir
//   3. the page's <form method="post"> increments it through the framework's own server mechanism
//      (an action, an endpoint, a server function); posted twice, `/` shows `count: 2`
//   4. the host quits and starts again on the same data dir: still `count: 2` (KV is the local twin, on disk)
//
// Each example's test is one line: `test("...", () => counterJourney(import.meta.dir + "/.."))`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "../packages/cli/src/index.ts");
const token = "counter-journey-token";

type Host = { proc: ReturnType<typeof Bun.spawn>; url: string; cookie: string };

async function start(app: string, home: string): Promise<Host> {
  const proc = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], { cwd: app, env: { ...process.env, HOME: home, USERPROFILE: home, RB_NO_BROWSER: "1", RB_TOKEN: token }, stdout: "pipe", stderr: "pipe" });
  let seen = "";
  const timer = Bun.sleep(30_000).then(() => { throw new Error(`host not serving after 30s:\n${seen}`); });
  const serving = (async () => {
    for await (const chunk of proc.stdout) {
      seen += new TextDecoder().decode(chunk);
      const url = seen.match(/serving (http:\/\/[\d.]+:\d+)/)?.[1];
      if (url) return { proc, url, cookie: `rb_token_${new URL(url).port}=${token}` };
    }
    throw new Error(`host exited before serving:\n${seen}\n${await new Response(proc.stderr).text()}`);
  })();
  return Promise.race([serving, timer]);
}

const stop = async (h: Host) => { h.proc.kill(); await h.proc.exited; };

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

export async function counterJourney(app: string, opts: { build?: boolean; spa?: string } = {}): Promise<void> {
  if (opts.build !== false) {
    const build = Bun.spawn(["bun", cli, "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (await build.exited) throw new Error(`build desktop --dev failed:\n${await new Response(build.stdout).text()}\n${await new Response(build.stderr).text()}`);
  }
  const home = mkdtempSync(join(tmpdir(), "counter-"));
  let host = await start(app, home);
  try {
    const get = async (path: string) => fetch(host.url + path, { headers: { cookie: host.cookie } });
    const page = async () => await (await get("/")).text();
    const bare = await fetch(host.url + "/");
    if (bare.status !== 403) throw new Error(`no token: HTTP ${bare.status}, want 403`);
    if (opts.spa) return await spaJourney(host, opts.spa, async () => { await stop(host); host = await start(app, home); return host; });
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
    host = await start(app, home);
    const again = countIn(await page());
    if (again !== 2) throw new Error(`after a restart the page shows count: ${again}, want 2`);
  } finally {
    await stop(host);
    rmSync(home, { recursive: true, force: true });
  }
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

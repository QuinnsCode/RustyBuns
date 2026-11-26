// Headless Chrome over CDP, and an app's Vite dev server, for scripts and end-to-end tests that drive a page
// (scripts/phone-smoke.ts, apps/alien-disc-golf/test/round.test.ts). Needs nothing installed beyond Chrome
// (CHROME=/path overrides where it looks).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Just enough of the protocol to load a page, run a script and take a picture. */
export class Cdp {
  private id = 0;
  private waiting = new Map<number, (r: any) => void>();
  private subs: ((m: any) => void)[] = [];
  private gone = false;
  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id) this.waiting.get(m.id)?.(m), this.waiting.delete(m.id);
      else for (const s of this.subs) s(m);
    };
    // Chrome crashed or was stopped: every call still waiting fails now, not at its 60 s
    ws.onclose = () => { this.gone = true; for (const w of this.waiting.values()) w({ gone: true }); this.waiting.clear(); };
  }
  static open = (url: string) => new Promise<Cdp>((ok, no) => { const ws = new WebSocket(url); ws.onopen = () => ok(new Cdp(ws)); ws.onerror = () => no(new Error("cannot reach Chrome")); });
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, no) => {
      if (this.gone) return no(new ChromeGone(method));
      const t = setTimeout(() => no(new Error(`${method}: no answer in 60s`)), 60_000);
      this.waiting.set(id, (m) => (clearTimeout(t), m.gone ? no(new ChromeGone(method)) : m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on = (f: (m: any) => void) => void this.subs.push(f);
  close = () => this.ws.close();
}

export function chromePath(): string | undefined {
  return [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
}

/** Software GL draws a three.js world at ~1 fps (Mythic Masters' intro never ended), so a Mac uses its GPU through Metal; anywhere else, or with CHROME_GL=software, SwiftShader. */
export function glFlags(): string[] {
  const software = process.platform !== "darwin" || process.env.CHROME_GL === "software";
  return software ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=metal", "--enable-gpu"];
}

/** Flags that skip what a fresh Linux box makes Chrome wait on (the keyring over D-Bus, first-run and default-browser checks, the
 * component updater's network calls), plus Chrome's own log on stderr, so a stall at least says how far startup got (#3435). */
const quietStart = ["--no-first-run", "--no-default-browser-check", "--password-store=basic", "--use-mock-keychain", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--enable-logging=stderr"];

/** One Chrome, up once its DevTools port file appears. Its stderr is read as it runs (an unread pipe fills and blocks Chrome),
 * keeping the last lines for an error. A stall gets one more try on a fresh profile: on a just-booted CI runner the first start
 * has sat silent past 30 s while the next went straight up (#3350, #3435). Each stall's error says what Chrome's processes were blocked on. */
export interface Chrome { cdp: Cdp; dir: string; stop: () => void }

const startWaits = [20_000, 30_000];
/** The longest `launchChrome` takes to start or to throw why it couldn't (both waits plus the clean-up after each stall). A test
 *  that launches Chrome sizes its timeout past this, or bun's timeout cuts the stall report off (#4915). */
export const chromeStartMs = startWaits.reduce((a, b) => a + b + 3000, 0);

/** A headless Chrome; `flags` are added to its command line (a check that needs no sound card asks for `--disable-audio-output`). */
export async function launchChrome(flags: string[] = []): Promise<Chrome> {
  const bin = chromePath();
  if (!bin) throw new Error("no Chrome found: set CHROME=/path/to/chrome");
  const stalls: string[] = [];
  for (const wait of startWaits) {
    const started = await startChrome(bin, wait, flags);
    if ("cdp" in started) {
      if (stalls.length) console.warn(`Chrome stalled once, then started:\n${stalls.join("\n")}`);
      return started;
    }
    stalls.push(started.stall);
    if (started.exited) break;
  }
  throw new Error(`Chrome did not start:\n${stalls.join("\n")}`);
}

async function startChrome(bin: string, wait: number, flags: string[]): Promise<Chrome | { exited: boolean; stall: string }> {
  const dir = mkdtempSync(join(tmpdir(), "chrome-cdp-"));
  const proc = Bun.spawn([bin, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, ...quietStart, ...glFlags(), ...flags, "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "pipe" });
  const watch = dieWith(dir, proc.pid);
  const said: string[] = [];
  const drained = (async () => { for await (const line of lines(proc.stderr)) said.push(line), said.length > 8 && said.shift(); })();
  const portFile = join(dir, "DevToolsActivePort");
  const t0 = Date.now();
  // Chrome makes the file before it writes the port and path into it: wait for both lines.
  const ready = () => existsSync(portFile) && readFileSync(portFile, "utf8").trim().split("\n").length >= 2;
  while (!ready() && proc.exitCode === null && Date.now() - t0 < wait) await Bun.sleep(100);
  if (!ready()) {
    const exited = proc.exitCode !== null;
    const blocked = exited ? "" : await blockedOn(dir);
    proc.kill();
    watch.kill(9);
    await Promise.race([drained, Bun.sleep(2000)]);
    rmSync(dir, { recursive: true, force: true });
    const how = exited ? `exited ${proc.exitCode}` : `no DevTools port in ${wait / 1000} s`;
    return { exited, stall: [`- ${how}`, ...blocked.split("\n").filter(Boolean).map((l) => `  ps: ${l}`), ...said.map((l) => `  stderr: ${l}`)].join("\n") };
  }
  if (Date.now() - t0 > 5000) console.warn(`Chrome took ${((Date.now() - t0) / 1000).toFixed(1)} s to start`);
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const cdp = await Cdp.open(`ws://127.0.0.1:${port}${path}`);
  return { cdp, dir, stop: () => { cdp.close(); proc.kill(); watch.kill(9); rmSync(dir, { recursive: true, force: true }); } };
}

/**
 * A watchdog beside a Chrome: once `parent` is gone (exited, timed out, or killed with -9, when nothing of ours gets to run),
 * it kills every process that carries the profile dir and deletes the dir. Chrome left behind this way filled the office
 * Mac's swap (#4905). It ignores Ctrl-C and hang-ups, so it outlives the parent; `stop` kills it with -9.
 */
export function dieWith(dir: string, chrome: number, parent = process.pid) {
  // the dir comes in the environment, so the watchdog's own command line doesn't match its pkill
  const script = 'trap "" INT HUP TERM; while kill -0 "$1" 2>/dev/null; do sleep 1; done; kill -9 "$2" 2>/dev/null; pkill -9 -f -- "$CHROME_DOG_DIR"; sleep 1; rm -rf -- "$CHROME_DOG_DIR"';
  const dog = Bun.spawn(["sh", "-c", script, "chrome-watchdog", String(parent), String(chrome)], { env: { ...process.env, CHROME_DOG_DIR: dir }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  dog.unref();
  return dog;
}

/**
 * The same watchdog for a whole process group (a child spawned `detached`, whose pid is its group): once `parent` is gone,
 * every process in the group goes with -9 and `dir` is deleted. `wrangler dev` is node, workerd and esbuild; killing node
 * alone, or a test run killed outright, left all three on the builder for days (#5337). `stop` kills it with -9.
 */
export function groupDiesWith(group: number, dir: string, parent = process.pid) {
  const script = 'trap "" INT HUP TERM; while kill -0 "$1" 2>/dev/null; do sleep 1; done; kill -9 "-$2" 2>/dev/null; rm -rf -- "$3"';
  const dog = Bun.spawn(["sh", "-c", script, "group-watchdog", String(parent), String(group), dir], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  dog.unref();
  return dog;
}

/** Ends a `detached` child's whole group: TERM, up to `graceMs` for it to go, then -9 for whatever is left. */
export async function killGroup(proc: { pid: number; exited: Promise<unknown> }, graceMs = 5000) {
  const signal = (s: NodeJS.Signals) => { try { process.kill(-proc.pid, s); } catch { /* already gone */ } };
  signal("SIGTERM");
  await Promise.race([proc.exited, Bun.sleep(graceMs)]);
  signal("SIGKILL");
}

async function* lines(stream: ReadableStream<Uint8Array>) {
  const text = new TextDecoder();
  let rest = "";
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    const parts = (rest + text.decode(r.value, { stream: true })).split("\n");
    rest = parts.pop()!;
    yield* parts.filter((l) => l.trim());
  }
  if (rest.trim()) yield rest;
}

/** Each of this Chrome's processes (they all carry its profile dir) with its state and the kernel call it sleeps in. */
async function blockedOn(dir: string) {
  const ps = Bun.spawn(["ps", "-A", "-o", `pid=,stat=,${process.platform === "linux" ? "wchan:32" : "wchan"}=,etime=,args=`], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(ps.stdout).text();
  return out.split("\n").filter((l) => l.includes(dir)).map((l) => l.trim().replace(/\s+/g, " ").replace(/ --(?!type)\S+/g, "").slice(0, 160)).join("\n");
}

export interface Tab {
  sessionId: string;
  call: (method: string, params?: object) => Promise<any>;
  /** Runs an expression in the page (awaiting a promise) and hands back its JSON value. */
  eval: <T = unknown>(expression: string) => Promise<T>;
  /** Uncaught errors, console.error and failed responses, as they happened. */
  noise: string[];
  /** The requests this tab has sent that haven't finished or failed yet, by request id. */
  pending: Map<string, string>;
  close: () => Promise<void>;
}

/** A fresh tab at this size (mobile: touch, phone UA, 2x), with the page's noise recorded from the start. `own`: in a
 *  browser context of its own (its own storage and cookies), as a second person on another computer would be. */
export async function openTab(cdp: Cdp, size: { w: number; h: number }, mobile = false, own = false): Promise<Tab> {
  const context = own ? (await cdp.send("Target.createBrowserContext", {})).browserContextId : undefined;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", ...(context ? { browserContextId: context } : {}) });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (m: string, p?: object) => cdp.send(m, p, sessionId);
  const noise: string[] = [];
  const pending = new Map<string, string>();
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === "Network.requestWillBeSent") pending.set(p.requestId, p.request.url);
    else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") pending.delete(p.requestId);
    if (m.method === "Runtime.exceptionThrown") noise.push(`uncaught: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).split("\n")[0]}`);
    else if (m.method === "Runtime.consoleAPICalled" && p.type === "error") noise.push(`console.error: ${p.args.map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 160)}`);
    else if (m.method === "Network.responseReceived" && p.response.status >= 400) noise.push(`HTTP ${p.response.status} ${p.response.url.slice(0, 120)}`);
  });
  await cdp.send("Target.activateTarget", { targetId });
  await Promise.all([call("Page.enable"), call("Runtime.enable"), call("Network.enable")]);
  await call("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  // Headless tabs report hidden and throttle requestAnimationFrame; a game loop needs to run as if on screen.
  await call("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (mobile) {
    await call("Emulation.setTouchEmulationEnabled", { enabled: true });
    await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  }
  const evaluate = async <T>(expression: string): Promise<T> => {
    const res = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value as T;
  };
  return { sessionId, call, eval: evaluate, noise, pending, close: () => cdp.send("Target.closeTarget", { targetId }).then(() => {}, () => {}) };
}

// How a wait fails: each one a tagged error whose message is one plain line naming what was stuck (the `_tag` is what
// packages/cli's renderError prints), thrown when its own deadline passes rather than at the test's timeout.
// No effect here: this file runs in every app's CI install, filtered to that app's packages, where effect isn't linked.
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const short = (u: string) => u.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/, "").slice(0, 100);

/** The page never fired its load event: the requests still open, and whether its main thread answered at all. */
export class LoadStalled extends Error {
  readonly _tag = "LoadStalled";
  constructor(readonly url: string, readonly waitedMs: number, readonly pending: string[], readonly busy: boolean) {
    super(`${short(url)} never finished loading after ${secs(waitedMs)}: ${pending.length ? `still waiting on ${pending.slice(0, 6).map(short).join(", ")}` : "no request open"}${busy ? ", and its main thread is busy (a script or a shader compile holding it)" : ""}`);
  }
}
/** Navigation itself failed (the server is down, the URL is wrong): known at once. */
export class LoadFailed extends Error {
  readonly _tag = "LoadFailed";
  constructor(readonly url: string, readonly why: string) { super(`${short(url)} did not load: ${why}`); }
}
/** `until` looked and looked, and the expression never came out true. */
export class NeverTrue extends Error {
  readonly _tag = "NeverTrue";
  constructor(readonly what: string, readonly waitedMs: number, readonly lastValue: unknown) {
    super(`${what} never came true in ${secs(waitedMs)} (last look: ${JSON.stringify(lastValue)?.slice(0, 120) ?? "undefined"})`);
  }
}
/** A look into the page got no answer: its main thread was held the whole time. */
export class MainThreadBusy extends Error {
  readonly _tag = "MainThreadBusy";
  constructor(readonly what: string, readonly heldMs: number) { super(`the page's main thread held ${secs(heldMs)} without answering while waiting for ${what}`); }
}
/** Chrome's DevTools socket closed: Chrome crashed or was stopped. */
export class ChromeGone extends Error {
  readonly _tag = "ChromeGone";
  constructor(readonly method: string) { super(`Chrome went away (its DevTools socket closed) during ${method}`); }
}

/** `p`, or `undefined` once `ms` pass. */
const within = <T>(p: Promise<T>, ms: number) => { let stop = () => {}; return Promise.race([p, new Promise<undefined>((ok) => { const t = setTimeout(ok, ms); stop = () => clearTimeout(t); })]).finally(() => stop()); };

/** Navigates and waits for the load event, then `settle` ms for modules and first frames. Throws `LoadFailed` at once if
 *  the navigation fails, and `LoadStalled` (naming the requests still open) if the page hasn't loaded in `waitMs`. The
 *  load event comes after the page's module scripts have run, so a page that builds a 3D room as it loads (software GL on CI
 *  compiles its shaders then) takes its time here: `waitMs` is sized for that. */
export async function load(cdp: Cdp, tab: Tab, url: string, settle = 2000, waitMs = 60_000) {
  const t0 = Date.now();
  let fired = false;
  const loaded = new Promise<void>((ok) => cdp.on((m) => m.sessionId === tab.sessionId && m.method === "Page.loadEventFired" && !fired && ((fired = true), ok())));
  const nav = await tab.call("Page.navigate", { url });
  if (nav.errorText) throw new LoadFailed(url, nav.errorText);
  await within(loaded, waitMs);
  if (!fired) {
    const answered = await within(tab.eval("1").then(() => true, () => true), 1000);
    throw new LoadStalled(url, Date.now() - t0, [...tab.pending.values()], !answered);
  }
  if (settle) await Bun.sleep(settle);
}

/** Waits for `expr` (awaited in the page) to come out true, looking every `everyMs`. Throws `NeverTrue` with the last value
 *  it saw after `waitMs`, or `MainThreadBusy` if the page answered no look at all in that time. A look that throws (the
 *  page is mid-navigation, or a name isn't defined yet) counts as false. */
export async function until(tab: Tab, expr: string, what = expr, waitMs = 30_000, everyMs = 100) {
  const t0 = Date.now(), end = t0 + waitMs;
  let last: unknown = "no answer yet", answered = false;
  for (;;) {
    const left = end - Date.now();
    const look = await within(tab.eval(expr).then((v) => ({ v }), (e: Error) => ({ v: `threw: ${e.message.split("\n")[0]}` })), Math.max(1, left));
    if (look) { answered = true; last = look.v; if (look.v === true) return; }
    if (Date.now() >= end) throw answered ? new NeverTrue(what, Date.now() - t0, last) : new MainThreadBusy(what, Date.now() - t0);
    await Bun.sleep(everyMs);
  }
}

/** `until` for any truthy answer of `expr`, awaited: a test's wait on its page. On a miss the error also carries what
 *  `state` (an expression, such as the game's `state()`) says then. */
export async function waitFor(tab: Tab, what: string, expr: string, ms = 30_000, state?: string, everyMs = 100) {
  try { await until(tab, `(async () => !!(await (${expr})))()`, what, ms, everyMs); } catch (e) {
    if (state && e instanceof Error) e.message += `; state: ${JSON.stringify(await tab.eval(state).catch(() => null))}`;
    throw e;
  }
}

export async function freePort() { const s = Bun.serve({ port: 0, fetch: () => new Response() }); const p = s.port!; await s.stop(true); return p; }

/** True when the app's vite config loads @cloudflare/vite-plugin, whose miniflare dies under `bun --bun` (`#runtimeDispatcher?.close is not a function`). */
export function needsNode(cwd: string) {
  const f = viteConfig(cwd);
  return !!f && readFileSync(f, "utf8").includes("@cloudflare/vite-plugin");
}

const viteConfig = (cwd: string) => ["ts", "mts", "js"].map((x) => join(cwd, `vite.config.${x}`)).find(existsSync);

/** Writes the app's boundary glue (`.rustybuns/vite.ts`) when its vite config imports it: git ignores that file, so a
 * fresh worktree or the probe's origin/main copy never has it and vite stops on the import (#5992). True when it ran. */
export function boundaryGlue(cwd: string): boolean {
  const config = viteConfig(cwd);
  if (!config || !readFileSync(config, "utf8").includes("./.rustybuns/vite")) return false;
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "../packages/cli/src/index.ts"), "boundary"], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`rustybuns boundary failed in ${cwd}:\n${r.stderr.toString().trim().split("\n").slice(-8).join("\n")}`);
  return true;
}

/** The app's `vite` dev server on a free port; resolves once it answers. Runs vite on Node when the config needs it (`needsNode`) or `node` says so. */
export async function startVite(cwd: string, node = needsNode(cwd)): Promise<{ url: string; stop: () => void }> {
  boundaryGlue(cwd);
  const port = await freePort();
  const server = Bun.spawn(["bun", ...(node ? [] : ["--bun"]), "x", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, BROWSER: "none" } });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error((await new Response(server.stderr).text() || await new Response(server.stdout).text()).trim().split("\n").slice(-8).join("\n") || `vite exited ${server.exitCode}`);
    if (await fetch(url).then((r) => r.ok, () => false)) return { url, stop: () => server.kill() };
    await Bun.sleep(500);
  }
  server.kill();
  throw new Error("dev server not up after 60s");
}

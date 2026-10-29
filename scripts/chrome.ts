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
  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id) this.waiting.get(m.id)?.(m), this.waiting.delete(m.id);
      else for (const s of this.subs) s(m);
    };
  }
  static open = (url: string) => new Promise<Cdp>((ok, no) => { const ws = new WebSocket(url); ws.onopen = () => ok(new Cdp(ws)); ws.onerror = () => no(new Error("cannot reach Chrome")); });
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`${method}: no answer in 60s`)), 60_000);
      this.waiting.set(id, (m) => (clearTimeout(t), m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on = (f: (m: any) => void) => void this.subs.push(f);
  close = () => this.ws.close();
}

export function chromePath(): string | undefined {
  return [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
}

export async function launchChrome() {
  const bin = chromePath();
  if (!bin) throw new Error("no Chrome found: set CHROME=/path/to/chrome");
  const dir = mkdtempSync(join(tmpdir(), "chrome-cdp-"));
  const proc = Bun.spawn([bin, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const portFile = join(dir, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await Bun.sleep(100);
  if (!existsSync(portFile)) { proc.kill(); throw new Error("Chrome did not start"); }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const cdp = await Cdp.open(`ws://127.0.0.1:${port}${path}`);
  return { cdp, stop: () => { cdp.close(); proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

export interface Tab {
  sessionId: string;
  call: (method: string, params?: object) => Promise<any>;
  /** Runs an expression in the page (awaiting a promise) and hands back its JSON value. */
  eval: <T = unknown>(expression: string) => Promise<T>;
  /** Uncaught errors, console.error and failed responses, as they happened. */
  noise: string[];
  close: () => Promise<void>;
}

/** A fresh tab at this size (mobile: touch, phone UA, 2x), with the page's noise recorded from the start. */
export async function openTab(cdp: Cdp, size: { w: number; h: number }, mobile = false): Promise<Tab> {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (m: string, p?: object) => cdp.send(m, p, sessionId);
  const noise: string[] = [];
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
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
  return { sessionId, call, eval: evaluate, noise, close: () => cdp.send("Target.closeTarget", { targetId }).then(() => {}, () => {}) };
}

/** Navigates and waits for the load event (or 20 s), then `settle` ms for modules and first frames. */
export async function load(cdp: Cdp, tab: Tab, url: string, settle = 2000) {
  const loaded = new Promise<void>((ok) => cdp.on((m) => m.sessionId === tab.sessionId && m.method === "Page.loadEventFired" && ok()));
  await tab.call("Page.navigate", { url });
  await Promise.race([loaded, Bun.sleep(20_000)]);
  await Bun.sleep(settle);
}

export async function freePort() { const s = Bun.serve({ port: 0, fetch: () => new Response() }); const p = s.port!; await s.stop(true); return p; }

/** The app's `vite` dev server on a free port; resolves once it answers. */
export async function startVite(cwd: string): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const server = Bun.spawn(["bun", "x", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, BROWSER: "none" } });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error((await new Response(server.stderr).text() || await new Response(server.stdout).text()).trim().split("\n").slice(-8).join("\n") || `vite exited ${server.exitCode}`);
    if (await fetch(url).then((r) => r.ok, () => false)) return { url, stop: () => server.kill() };
    await Bun.sleep(500);
  }
  server.kill();
  throw new Error("dev server not up after 60s");
}

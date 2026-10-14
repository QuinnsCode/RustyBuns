// Phone smoke: boot each web app's dev server, open it in Chrome at the common phone sizes, and write a
// triage board (dist/phone-smoke/index.html): a screenshot per phone, and findings for what broke (a page wider
// than the screen, a button cut off, covered, or gone since the laptop layout). Chrome is driven over CDP, so
// it needs no install beyond Chrome itself (CHROME=/path overrides where it looks).
//
//   bun scripts/phone-smoke.ts                       every app below, three at a time
//   bun scripts/phone-smoke.ts --apps git-recon,two-fronts
//   bun scripts/phone-smoke.ts --shard 2/4           this runner's quarter of the apps (one ephemeral runner each)
//   bun scripts/phone-smoke.ts --merge a/ b/ c/      join the shards' output folders into one board
//   --out <dir> (default dist/phone-smoke)   --jobs <n> (default 3)   --fail   exit 1 when something is broken
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PHONES, REFERENCE, analyze, appStatus, board, mergeReports, pageAudit, shardOf, type AppResult, type Audit, type PhoneResult, type Report } from "./phone-smoke-lib.ts";

/** The web apps with a plain `vite` dev page. Others (desktop hosts, redwood workers) need their own host; add them as they get a page. */
export const WEB_APPS = ["git-recon", "hippo-tycoon", "park-hide-seek", "splat-spray", "two-fronts", "meshy-studio", "splat-desktop", "tscircuit-desktop"];

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => (flag(n) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const root = resolve(import.meta.dir, "..");

// ---- CDP: just enough of the protocol to load a page, run a script and take a picture.
class Cdp {
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

function chromePath() {
  const found = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
  if (!found) throw new Error("no Chrome found: set CHROME=/path/to/chrome");
  return found;
}

async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "phone-smoke-"));
  const proc = Bun.spawn([chromePath(), "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  const portFile = join(dir, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await Bun.sleep(100);
  if (!existsSync(portFile)) { proc.kill(); throw new Error("Chrome did not start"); }
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const cdp = await Cdp.open(`ws://127.0.0.1:${port}${path}`);
  return { cdp, stop: () => { cdp.close(); proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Opens `url` in a fresh tab sized like `size`, and returns what the audit saw, a screenshot and the noise the page made. */
async function visit(cdp: Cdp, url: string, size: { w: number; h: number }, mobile: boolean) {
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
  try {
    await cdp.send("Target.activateTarget", { targetId });
    await Promise.all([call("Page.enable"), call("Runtime.enable"), call("Network.enable")]);
    await call("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) {
      await call("Emulation.setTouchEmulationEnabled", { enabled: true });
      await call("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
    }
    const loaded = new Promise<void>((ok) => cdp.on((m) => m.sessionId === sessionId && m.method === "Page.loadEventFired" && ok()));
    await call("Page.navigate", { url });
    await Promise.race([loaded, Bun.sleep(20_000)]);
    await Bun.sleep(2000); // modules, fonts and first frames settle
    const res = await call("Runtime.evaluate", { expression: `(${pageAudit})()`, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    const shot = await call("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: mobile ? 0.6 : 0.4 } });
    return { audit: res.result.value as Audit, shot: Buffer.from(shot.data, "base64"), noise: [...new Set(noise)].slice(0, 5) };
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// ---- one app: boot it, look at it on the laptop and then on every phone.
async function freePort() { const s = Bun.serve({ port: 0, fetch: () => new Response() }); const p = s.port!; await s.stop(true); return p; }

async function smokeApp(app: string, cdp: Cdp, out: string): Promise<AppResult> {
  const cwd = join(root, "apps", app);
  const port = await freePort();
  const server = Bun.spawn(["bun", "x", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, BROWSER: "none" } });
  const url = `http://127.0.0.1:${port}/`;
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      if (server.exitCode !== null) throw new Error((await new Response(server.stderr).text() || await new Response(server.stdout).text()).trim().split("\n").slice(-8).join("\n") || `vite exited ${server.exitCode}`);
      up = await fetch(url).then((r) => r.ok, () => false);
      if (!up) await Bun.sleep(500);
    }
    if (!up) throw new Error("dev server not up after 60s");
    mkdirSync(join(out, app), { recursive: true });
    const ref = await visit(cdp, url, REFERENCE, false);
    const phones: PhoneResult[] = [];
    for (const ph of PHONES) {
      const shotName = `${app}/${ph.name.replaceAll(" ", "-").toLowerCase()}.jpg`;
      try {
        const v = await visit(cdp, url, ph, true).catch(() => visit(cdp, url, ph, true));
        writeFileSync(join(out, shotName), v.shot);
        phones.push({ phone: ph.name, w: ph.w, h: ph.h, shot: shotName, findings: analyze(v.audit, ref.audit, v.noise) });
      } catch (e) {
        phones.push({ phone: ph.name, w: ph.w, h: ph.h, findings: [{ kind: "visit-failed", sev: "error", detail: String(e instanceof Error ? e.message : e) }] });
      }
    }
    return { app, phones };
  } catch (e) {
    return { app, phones: [], bootError: String(e instanceof Error ? e.message : e) };
  } finally {
    server.kill();
  }
}

// ---- main
const out = resolve(opt("out") ?? "dist/phone-smoke");

if (flag("merge")) {
  const dirs = argv.slice(argv.indexOf("--merge") + 1).filter((a) => !a.startsWith("--") && a !== out).map((d) => resolve(d));
  mkdirSync(out, { recursive: true });
  const reports = dirs.map((d) => { cpSync(d, out, { recursive: true }); return JSON.parse(readFileSync(join(d, "report.json"), "utf8")) as Report; });
  finish(mergeReports(reports));
} else {
  let apps = opt("apps")?.split(",") ?? WEB_APPS;
  if (opt("shard")) { const [i, n] = opt("shard")!.split("/").map(Number); apps = shardOf(apps, i, n); }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const results: AppResult[] = [];
  const queue = [...apps];
  // One Chrome per worker: software-rendered WebGL tabs in a shared Chrome starve each other.
  await Promise.all(Array.from({ length: Math.max(1, Number(opt("jobs") ?? 3)) }, async () => {
    const chrome = await launchChrome();
    try {
      for (let app = queue.shift(); app; app = queue.shift()) {
        const r = await Promise.race([smokeApp(app, chrome.cdp, out), Bun.sleep(300_000).then((): AppResult => ({ app, phones: [], bootError: "gave up after 5 minutes" }))]);
        results.push(r);
        console.log(`${appStatus(r).padEnd(5)} ${app}${r.bootError ? `  (did not finish: ${r.bootError.split("\n")[0]})` : `  ${r.phones.reduce((s, p) => s + p.findings.length, 0)} findings`}`);
      }
    } finally {
      chrome.stop();
    }
  }));
  finish({ generatedAt: new Date().toISOString(), apps: results });
}

function finish(report: Report) {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  writeFileSync(join(out, "index.html"), board(report));
  const bad = report.apps.filter((a) => appStatus(a) === "error").length;
  console.log(`\nphone-smoke: ${report.apps.length} apps, ${bad} broken -> ${join(out, "index.html")}`);
  if (flag("fail") && bad) process.exit(1);
}

// Phone smoke: boot each web app's dev server, open it in Chrome at the common phone sizes, and write a
// triage board (dist/phone-smoke/index.html): a screenshot per phone, and findings for what broke (a page wider
// than the screen, a button cut off, covered, or gone since the laptop layout). Chrome is driven over CDP, so
// it needs no install beyond Chrome itself (CHROME=/path overrides where it looks).
//
//   bun scripts/phone-smoke.ts                       every app below, three at a time
//   bun scripts/phone-smoke.ts --apps git-recon,two-fronts
//   bun scripts/phone-smoke.ts --shard 2/4           this runner's quarter of the apps (one ephemeral runner each)
//   bun scripts/phone-smoke.ts --merge a/ b/ c/      join the shards' output folders into one board
//   bun scripts/phone-smoke.ts --phones "iPhone Duo"  only the phones whose name has this in it (the fold's three screens)
//   --out <dir> (default dist/phone-smoke)   --jobs <n> (default 3)   --fail   exit 1 when something is broken
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite, type Cdp } from "./chrome.ts";
import { PHONES, REFERENCE, analyze, appStatus, board, mergeReports, pageAudit, shardOf, type AppResult, type Audit, type PhoneResult, type Report } from "./phone-smoke-lib.ts";

/** The web apps with a plain `vite` dev page, or a static `public/` (the playground). Others need their own host first:
 *  codeSplitter's worker, and auto-rig, fm-daw and tscircuit-desktop (a desktop host or a generated `.rustybuns/`). */
export const WEB_APPS = ["playground", "alien-disc-golf", "delayed-reaction", "eqosys", "excalibrawl", "geoboxq", "git-recon", "hello-world",
  "hippo-tycoon", "meshy-studio", "mythic-masters", "park-hide-seek", "skate-tech-park", "splat-desktop", "splat-spray", "two-fronts"];
/** Where an app opens for the run, when its root is random: the same course on every screen, so the laptop and the phones show the same buttons. */
export const PATHS: Record<string, string> = { "alien-disc-golf": "/?seed=42&wind=synthetic" };

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => (flag(n) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const root = resolve(import.meta.dir, "..");
const screens = PHONES.filter((p) => !opt("phones") || p.name.includes(opt("phones")!));

/** An app with no vite config but a `public/index.html` is static: serve the folder as it is. */
function serve(app: string, cwd: string) {
  if (["ts", "js", "mts"].some((x) => existsSync(join(cwd, `vite.config.${x}`))) || !existsSync(join(cwd, "public/index.html"))) return startVite(cwd);
  const dir = join(cwd, "public");
  const s = Bun.serve({ port: 0, async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname), f = Bun.file(join(dir, p.endsWith("/") ? `${p}index.html` : p));
    return !p.includes("..") && (await f.exists()) ? new Response(f) : new Response("not found", { status: 404 });
  } });
  return Promise.resolve({ url: `http://127.0.0.1:${s.port}/`, stop: () => void s.stop(true) });
}

/** Opens `url` in a fresh tab sized like `size`, and returns what the audit saw, a screenshot and the noise the page made. */
async function visit(cdp: Cdp, url: string, size: { w: number; h: number }, mobile: boolean) {
  const tab = await openTab(cdp, size, mobile);
  try {
    // Every visit starts as a first visit: a game that autosaves (Two Fronts) would otherwise hand the laptop's run to the phones.
    await tab.call("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "all" });
    await load(cdp, tab, url);
    const audit = await tab.eval<Audit>(`(${pageAudit})()`);
    const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: mobile ? 0.6 : 0.4 } });
    return { audit, shot: Buffer.from(shot.data, "base64"), noise: [...new Set(tab.noise)].slice(0, 5) };
  } finally {
    await tab.close();
  }
}

// ---- one app: boot it, look at it on the laptop and then on every phone.
async function smokeApp(app: string, cdp: Cdp, out: string): Promise<AppResult> {
  const cwd = join(root, "apps", app);
  let server: { url: string; stop: () => void } | undefined;
  try {
    server = await serve(app, cwd);
    const url = new URL(PATHS[app] ?? "/", server.url).href;
    mkdirSync(join(out, app), { recursive: true });
    const ref = await visit(cdp, url, REFERENCE, false);
    const phones: PhoneResult[] = [];
    for (const ph of screens) {
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
    server?.stop();
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

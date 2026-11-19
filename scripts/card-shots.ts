// Card shots: every app's slides (up to four screenshots, each loaded by a jump-to-state link, the same ones the
// manual-run window uses) and, from the first slide, its picture everywhere an app has one. One run writes
//
//   docs/cards/<app>-<n>-<slug>.jpg            the slides, 1280x800, for the QNTBR site's cards
//   apps/playground/public/shots/<app>.jpg     the playground's card, 720x450
//   apps/eqosys/public/cards/<app>.jpg         the same picture, for an app in eqosys's APPS (it needs `shot: true` there)
//   docs/readme/<app>.jpg                      the README gallery's thumbnail (scripts/readme-shots.ts)
//
//   bun run card-shots                              every app below (about 15 minutes)
//   bun run card-shots skate-tech-park two-fronts   just these
//   bun run card-shots --slides-only qcrm           the slides, leaving the cards as they are
//
// Look at each slide before you commit: a game that changed its first screen shoots a menu or a loading bar.
// macOS only (the cards are resized with `sips`). Run `bun run docs` after, to write the README gallery.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { freePort, launchChrome, load, openTab, startVite } from "./chrome.ts";
import { APPS as EQOSYS } from "../apps/eqosys/src/apps.ts";
import { help } from "./help.ts";
import { readGroups } from "./readme-apps.ts";

const root = resolve(import.meta.dir, "..");
const hp = "/?level=yosemite-falls&spawn=creek%20halfpipe";
const battle = (q: string) => `/?battle=1&${q}`;
const clash = (a: string, b: string, skin: string) => `/?a=${a}&b=${b}&skin=${skin}`;

/** One slide: where to open, how long the scene needs (ms), then a click ("text:Solo" or a selector; `press` makes it a real
 * mouse press, for a page that starts its sound only on one), a script, or a held mouse. */
export interface Slide { name: string; path: string; wait?: number; click?: string; press?: boolean; js?: string; hold?: number }
/** How an app's page is served for its shots. Left out, its Vite dev server. `public`: the files in its public/ folder.
 * `cmd`: a script of its own that listens on the port in the `port` variable. `live`: the deployed site (no local run). */
export type Serve = { public: true } | { cmd: string[]; port: string } | { live: string } | { config: string };
export interface AppShots { serve?: Serve; shots: Slide[] }

/** app folder -> its slides. The first is the card everywhere. */
export const APPS: Record<string, AppShots> = {
  "skate-tech-park": { shots: [{ name: "el-capitan", path: "/?level=el-capitan&nosweep", wait: 5000 }, { name: "halfpipe", path: hp + "&nosweep", wait: 5000 }, { name: "rail", path: "/?level=el-capitan&spawn=rail&nosweep", wait: 5000 }] },
  "two-fronts": { shots: [{ name: "desert", path: battle("side=marines&world=desert"), wait: 5000 }, { name: "beach", path: battle("side=wooka&world=beach"), wait: 5000 }, { name: "station", path: battle("world=station&side=attacker"), wait: 5000 }] },
  "delayed-reaction": { shots: [{ name: "stab", path: "/?level=5&stem=dub", wait: 5000, click: "#scenario" }, { name: "drums", path: "/?level=5&stem=drums", wait: 5000, click: "#scenario" }, { name: "everything", path: "/?level=5", wait: 6000, click: "#scenario" }] },
  "mythic-masters": { shots: [{ name: "stadium", path: clash("jackalope", "jersey-devil", "stadium"), wait: 6000 }, { name: "volcano", path: clash("jersey-devil", "hodag", "volcano"), wait: 6000 }, { name: "world", path: "/?world=1&a=jackalope", wait: 8000 }, { name: "book", path: "/?world=1", wait: 6000 }] },
  "alien-disc-golf": { shots: [{ name: "round", path: "/?seed=42", wait: 5000 }, { name: "gulf-stream", path: "/?seed=42&swim=36.5,-72", wait: 5000 }, { name: "open-pacific", path: "/?seed=42&swim=-25,-120", wait: 5000 }] },
  "park-hide-seek": { shots: [{ name: "hiding", path: "/", wait: 20000, click: "#play" }] },
  "hippo-tycoon": { shots: [{ name: "round", path: "/", wait: 8000, click: "text:Solo" }] },
  "splat-spray": { shots: [{ name: "scan", path: "/", wait: 6000, click: "text:Solo training", hold: 2500 }] },
  "git-recon": { shots: [{ name: "kitchen", path: "/", wait: 9000, click: "#levels > *" }] },
  qcrm: { shots: [{ name: "home", path: "/", wait: 2000 }, { name: "contacts", path: "/app?scenario=populated", wait: 3000 }, { name: "webhooks", path: "/app?scenario=webhooks", wait: 3000 }] },
  "load-in": { shots: [{ name: "dj-booth", path: "/?level=dj-booth&wired=1", wait: 5000, js: "loadIn.start()" }, { name: "first-gig", path: "/?level=first-gig", wait: 5000, js: "loadIn.start()" }, { name: "garage", path: "/?level=garage", wait: 5000, js: "loadIn.start()" }] },
  "fm-daw": { shots: [{ name: "studio", path: "/studio.html", wait: 6000, click: "text:Walk in" }, { name: "groovebox", path: "/", wait: 4000, click: "text:Start audio", press: true }, { name: "amp", path: "/amp.html", wait: 6000, click: "text:Plug in", press: true }] },
  "motion-midi": { serve: { config: "vite.desktop.config.ts" }, shots: [{ name: "home", path: "/", wait: 4000 }] },
  // A finished brawl's replay from the live site: this machine has no fights, and the home page is a countdown between them.
  excalibrawl: { serve: { live: "https://excalibrawl.notryanquinn.workers.dev/" }, shots: [{ name: "brawl", path: "/brawls", wait: 8000, click: 'a[href^="/brawls/"]' }] },
  // Live, because the human check only loads on the site's own address.
  "what-would-fantano-say": { serve: { live: "https://what-would-fantano-say.notryanquinn.workers.dev/" }, shots: [{ name: "home", path: "/", wait: 4000 }] },
  brianfloresblitzing: { serve: { public: true }, shots: [{ name: "home", path: "/", wait: 3000 }] },
  geoboxq: { shots: [{ name: "home", path: "/", wait: 4000 }] },
  qview3d: { serve: { cmd: ["bun", "scripts/dev.ts"], port: "QVIEW_PORT" }, shots: [{ name: "shop", path: "/", wait: 7000 }, { name: "admin", path: "/admin.html", wait: 5000 }] },
  sharesplat: { shots: [{ name: "carton", path: "/?demo=1", wait: 7000 }, { name: "embed", path: "/?demo=1&embed=1", wait: 7000 }] },
  "splat-rooms": { shots: [{ name: "rooms", path: "/", wait: 6000 }] },
  "auto-rig": { shots: [{ name: "home", path: "/", wait: 5000 }] },
  "meshy-studio": { shots: [{ name: "home", path: "/", wait: 4000 }] },
  "at-lens": { shots: [{ name: "home", path: "/", wait: 4000 }] },
  "pixel-rag": { shots: [{ name: "home", path: "/", wait: 5000 }] },
  "starter-game": { shots: [{ name: "round", path: "/", wait: 4000, js: "starterGame.start()" }] },
  "hello-world": { shots: [{ name: "home", path: "/", wait: 3000 }] },
  eqosys: { serve: { cmd: ["bun", "scripts/preview-home.tsx", "--serve"], port: "PORT" }, shots: [{ name: "library", path: "/", wait: 3000 }, { name: "sign-in", path: "/login", wait: 3000 }] },
  playground: { serve: { public: true }, shots: [{ name: "home", path: "/", wait: 4000 }] },
  codesplitter: { serve: { live: "https://codesplitter.notryanquinn.workers.dev/" }, shots: [{ name: "home", path: "/", wait: 5000 }] },
  // The QNTBR site lives in another repo; eqosys lists it, so its card is shot from the live page.
  qntbr: { serve: { live: "https://qntbr.com/" }, shots: [{ name: "home", path: "/", wait: 5000 }] },
};

type Server = { url: string; stop: () => void };
const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp", wasm: "application/wasm" };

async function up(url: string, alive: () => boolean, said: () => Promise<string>): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (!alive()) throw new Error((await said()).trim().split("\n").slice(-6).join("\n") || "the server exited");
    if (await fetch(url).then((r) => r.status < 500, () => false)) return;
    await Bun.sleep(500);
  }
  throw new Error("server not up after 60s");
}

/** The app's page, served the way `serve` says. */
export async function serve(app: string, how?: Serve): Promise<Server> {
  const dir = join(root, "apps", app);
  // A config that imports ./.rustybuns/vite needs the generated folder, which a fresh checkout doesn't have.
  if ((!how || "config" in how) && !existsSync(join(dir, ".rustybuns/vite.ts")) && readFileSync(join(dir, how ? how.config : "vite.config.ts"), "utf8").includes("./.rustybuns/vite")) Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
  if (!how) return startVite(dir);
  if ("live" in how) return { url: how.live, stop() {} };
  if ("public" in how) {
    const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(r) {
      const path = decodeURIComponent(new URL(r.url).pathname), file = join(dir, "public", path.endsWith("/") ? path + "index.html" : path);
      if (!file.startsWith(join(dir, "public")) || !existsSync(file)) return new Response("", { status: 404 });
      return new Response(Bun.file(file), { headers: { "content-type": TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream" } });
    } });
    return { url: `http://127.0.0.1:${srv.port}/`, stop: () => void srv.stop(true) };
  }
  // A script of the app's own may listen on localhost only (QView3D's Vite does).
  const port = await freePort(), url = `http://${"cmd" in how ? "localhost" : "127.0.0.1"}:${port}/`;
  const cmd = "config" in how ? ["bun", "x", "vite", "--config", how.config, "--port", String(port), "--strictPort", "--host", "127.0.0.1"] : how.cmd;
  const p = Bun.spawn(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...process.env, BROWSER: "none", ...("port" in how ? { [how.port]: String(port) } : {}) } });
  try { await up(url, () => p.exitCode === null, async () => (await new Response(p.stderr).text()) || (await new Response(p.stdout).text())); }
  catch (e) { p.kill(); throw e; }
  return { url, stop: () => p.kill() };
}

const sips = (args: string[]) => { const p = Bun.spawnSync(["sips", ...args], { stderr: "pipe", stdout: "pipe" }); if (p.exitCode !== 0) throw new Error(`sips ${args.join(" ")}: ${p.stderr.toString()}`); };

/** The first slide as the app's card (720x450) on the playground, on eqosys when it lists the app, and in the README when its gallery does. */
function cards(app: string, slide: string): void {
  const card = join(root, "apps/playground/public/shots", `${app}.jpg`);
  mkdirSync(join(root, "apps/playground/public/shots"), { recursive: true });
  sips(["-s", "format", "jpeg", "-s", "formatOptions", "70", "-z", "450", "720", slide, "--out", card]);
  if (EQOSYS.some((a) => a.id === app)) cpSync(card, join(root, "apps/eqosys/public/cards", `${app}.jpg`));
  if (!readGroups().some((g) => g.apps.some((e) => e.app === app))) return;
  const p = Bun.spawnSync(["bun", "scripts/readme-shots.ts", `${app}=${slide}`], { cwd: root, stderr: "pipe", stdout: "pipe" });
  if (p.exitCode !== 0) throw new Error(`readme-shots ${app}: ${p.stderr.toString().trim().split("\n")[0]}`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  help(import.meta.path);
  const slidesOnly = argv.includes("--slides-only"), want = argv.filter((a) => !a.startsWith("-"));
  const unknown = want.filter((a) => !(a in APPS));
  if (unknown.length) { console.error(`no slides for ${unknown.join(", ")}: add it to APPS in scripts/card-shots.ts`); process.exit(2); }
  const { cdp, stop } = await launchChrome();
  const report: string[] = [];
  try {
    for (const [app, g] of Object.entries(APPS)) {
      if (want.length && !want.includes(app)) continue;
      let server: Server | undefined;
      try {
        server = await serve(app, g.serve);
        for (const [i, s] of g.shots.entries()) {
          const tab = await openTab(cdp, { w: 1280, h: 800 });
          try {
            await load(cdp, tab, new URL(s.path.replace(/^\//, ""), server.url).href, s.wait ?? 3000);
            if (s.click) {
              // "text:Solo" clicks the first button or link whose words start that way; anything else is a selector.
              const find = s.click.startsWith("text:") ? `[...document.querySelectorAll("button,a,[role=button]")].find((e) => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(s.click.slice(5).toLowerCase())}))` : `document.querySelector(${JSON.stringify(s.click)})`;
              if (s.press) {
                const at = await tab.eval<{ x: number; y: number } | null>(`(() => { const r = ${find}?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
                if (at) for (const type of ["mousePressed", "mouseReleased"]) await tab.call("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
              } else await tab.eval(`${find}?.click()`);
              await Bun.sleep(s.wait ?? 3000);
            }
            if (s.js) { await tab.eval(s.js); await Bun.sleep(s.wait ?? 3000); }
            // A held left button (a scanner that lights a dark room), sweeping a little so the light moves.
            if (s.hold) {
              const at = (type: string, x: number, y: number) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
              await at("mousePressed", 560, 380);
              for (let x = 560; x <= 760; x += 20) { await at("mouseMoved", x, 380 + (x - 660) / 4); await Bun.sleep(s.hold / 11); }
            }
            const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
            const file = join(root, "docs/cards", `${app}-${i + 1}-${s.name}.jpg`);
            mkdirSync(join(root, "docs/cards"), { recursive: true });
            writeFileSync(file, Buffer.from(shot.data, "base64"));
            if (i === 0 && !slidesOnly) cards(app, file);
            report.push(`ok   ${app}-${i + 1}-${s.name}.jpg  ${[...new Set(tab.noise)].slice(0, 2).join(" | ")}`);
          } finally { await tab.close(); }
        }
      } catch (e) { report.push(`FAIL ${app}: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`); }
      finally { server?.stop(); }
    }
  } finally { stop(); }
  console.log(report.join("\n"));
  if (report.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
}

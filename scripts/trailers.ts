// Trailers: short clips of each app being played for real, cut like an ad, that eqosys plays on an app's page and when a
// tile is hovered (the way a streaming service starts a show's clip). Two steps, each cached:
//
//   1. Takes: an app is opened at a jump link in headless Chrome (the GPU, 60 fps), a script plays it (keys held, the
//      app's own __commands, clicks), and every frame is kept. ~/.cache/rustybuns-trailers/<app>/<take>.mp4
//   2. Reels: cuts of 3 s or less from the takes, with zoom punches, slow motion, flashes, shakes and captions (drawn by
//      Chrome too, so they use real fonts), joined into apps/eqosys/public/trailers/<app>-<reel>.mp4, plus
//      apps/eqosys/src/trailers.json, the list eqosys reads.
//
//   bun scripts/trailers.ts                           every app below (a take is shot only when it isn't cached)
//   bun scripts/trailers.ts git-recon two-fronts      just these
//   bun scripts/trailers.ts --retake skate-tech-park  shoot its takes again
//   bun scripts/trailers.ts --takes-only git-recon    shoot, cut nothing (then look: <cache>/<app>/<take>-sheet.jpg)
//
// The cuts are written for the takes as they play today: a game that changes its jump links needs its takes looked at
// again. macOS or Linux with ffmpeg (libx264) on the PATH.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, type Cdp, type Tab as Page } from "./chrome.ts";

type Tab = Page & { cdp: Cdp };
import { serve, type Serve } from "./card-shots.ts";
import { help } from "./help.ts";
import { arr, check, num, obj, rec, str, type Of } from "../packages/util/src/guard.ts";
import { STAGES, type Reel, type Step, type Take } from "./trailer-plans.ts";

const root = resolve(import.meta.dir, "..");
const cache = join(homedir(), ".cache/rustybuns-trailers");
const outDir = join(root, "apps/eqosys/public/trailers");
const W = 960, H = 540, FPS = 30;
/** What a reel is cut down to: small enough that a page of tiles can each start one. */
const OUT_W = 854, OUT_H = 480;

function ff(args: string[]): void {
  const p = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`ffmpeg ${args.slice(-1)[0]}: ${p.stderr.toString().trim().split("\n").slice(-3).join(" | ")}`);
}

/** How long a video is, in seconds. */
const secsOf = (file: string): number => Number(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.toString().trim()) || 0;

/** Runs one step of a take's script against the open tab. */
async function step(tab: Tab, s: Step): Promise<void> {
  if ("js" in s) { await tab.eval(`(async () => { ${s.js} })()`).catch((e) => console.warn(`  js: ${String(e).split("\n")[0].slice(0, 160)}`)); return; }
  if ("key" in s) {
    const code = s.key, key = code.startsWith("Key") ? code.slice(3).toLowerCase() : code.startsWith("Digit") ? code.slice(5) : code === "Space" ? " " : code;
    const kc = code === "Space" ? 32 : code.startsWith("Key") || code.startsWith("Digit") ? code.at(-1)!.toUpperCase().charCodeAt(0) : ({ ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, ShiftLeft: 16, Enter: 13, Escape: 27, Tab: 9 } as Record<string, number>)[code] ?? 0;
    const send = (type: string) => tab.call("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: kc, ...(type === "keyDown" && key.length === 1 ? { text: key } : {}) });
    if (s.up !== true) await send("keyDown");
    if (s.up !== false) { if (s.hold) await Bun.sleep(s.hold); await send("keyUp"); }
    return;
  }
  if ("sweep" in s) {
    // The left button held while the pointer slides from one point to the other (a scanner lighting a dark room).
    const [x0, y0, x1, y1] = s.sweep, at = (type: string, f: number) => tab.call("Input.dispatchMouseEvent", { type, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await at("mousePressed", 0);
    for (let i = 1; i <= 24; i++) { await Bun.sleep(s.ms / 24); await at("mouseMoved", i / 24); }
    await at("mouseReleased", 1);
    return;
  }
  const [x, y] = "click" in s ? s.click : s.move;
  const mouse = (type: string, buttons: number) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: 1 });
  if ("move" in s) return void await mouse("mouseMoved", 0);
  await mouse("mousePressed", 1);
  await mouse("mouseReleased", 0);
}

/** One take: the page at its link, `setup` run, then `secs` of frames while its steps play on their clock. */
async function shoot(tab: Tab, base: string, t: Take, file: string): Promise<void> {
  await load(tab.cdp, tab, new URL(t.path.replace(/^\//, ""), base).href, t.wait ?? 6000);
  if (t.css) await tab.eval(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(t.css)}; document.head.append(s); })()`);
  for (const s of t.setup ?? []) await step(tab, s), await Bun.sleep(s.after ?? 0);
  const dir = file.replace(/\.mp4$/, ".frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const stamps: number[] = [];
  let live = true;
  tab.cdp.on((m) => {
    if (!live || m.sessionId !== tab.sessionId || m.method !== "Page.screencastFrame") return;
    writeFileSync(join(dir, `${String(stamps.length).padStart(5, "0")}.jpg`), Buffer.from(m.params.data, "base64"));
    stamps.push(m.params.metadata.timestamp);
    void tab.call("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
  });
  await tab.call("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1 });
  const t0 = Date.now();
  const script = (async () => { for (const s of t.steps ?? []) { const wait = (s.at ?? 0) * 1000 - (Date.now() - t0); if (wait > 0) await Bun.sleep(wait); await step(tab, s); } })();
  await Bun.sleep(t.secs * 1000);
  const end = Date.now() / 1000;
  await tab.call("Page.stopScreencast");
  live = false;
  await script.catch(() => {});
  if (stamps.length < 1) throw new Error(`${t.name}: only ${stamps.length} frames`);
  // Each frame held until the next one came, as Chrome only sends a frame when the page changed.
  const list = stamps.map((ts, i) => `file '${join(dir, `${String(i).padStart(5, "0")}.jpg`)}'\nduration ${Math.max(0.001, (stamps[i + 1] ?? Math.max(end, ts + 1 / FPS)) - ts).toFixed(4)}`);
  // The concat reader skips the last entry's duration unless the file is named once more after it.
  writeFileSync(join(dir, "list.txt"), `ffconcat version 1.0\n${list.join("\n")}\nfile '${join(dir, `${String(stamps.length - 1).padStart(5, "0")}.jpg`)}'\n`);
  ff(["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS}`, "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-pix_fmt", "yuv420p", file]);
  // A contact sheet (one frame a second) to pick the cuts from without playing the take.
  ff(["-i", file, "-vf", `fps=1,scale=320:-1,tile=6x${Math.ceil(t.secs / 6)}`, "-frames:v", "1", "-q:v", "4", file.replace(/\.mp4$/, "-sheet.jpg")]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`  take ${t.name}: ${stamps.length} frames, ${(stamps.length / (stamps.at(-1)! - stamps[0])).toFixed(0)} fps`);
}

/** A caption or a title card as a PNG the size of the reel, drawn by Chrome (transparent around a caption). */
async function drawText(tab: Tab, html: string, file: string, opaque: boolean): Promise<void> {
  const font = `@font-face{font-family:Lexend;src:url(data:font/woff2;base64,${readFileSync(join(root, "apps/eqosys/public/fonts/lexend-latin.woff2")).toString("base64")})}`;
  await tab.call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await tab.call("Page.navigate", { url: "about:blank" });
  await Bun.sleep(150);
  await tab.eval(`(() => { document.open(); document.write(${JSON.stringify(`<!doctype html><style>${font}${CARD_CSS}</style><body class="${opaque ? "card" : "cap"}">${html}</body>`)}); document.close(); return document.fonts.ready.then(() => 1); })()`);
  await Bun.sleep(100);
  const shot = await tab.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
}

const CARD_CSS = `html,body{margin:0;width:${OUT_W}px;height:${OUT_H}px;overflow:hidden}
body{font-family:Lexend,"Arial Black",sans-serif;color:#fff;display:grid}
body.cap{background:linear-gradient(180deg,transparent 58%,rgba(0,0,0,.5));align-content:end;justify-items:start;padding:0 0 46px 44px;box-sizing:border-box}
body.cap b{font-weight:800;font-size:40px;letter-spacing:-.02em;line-height:1.02;text-transform:uppercase;font-style:italic;max-width:${OUT_W - 120}px;
  text-shadow:0 3px 0 rgba(0,0,0,.55),0 0 22px rgba(0,0,0,.6);-webkit-text-stroke:1px rgba(0,0,0,.35)}
body.cap small{display:block;margin-top:8px;font-size:17px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:.92;text-shadow:0 2px 8px rgba(0,0,0,.8)}
body.card{background:radial-gradient(120% 90% at 50% 40%,#1d2b33 0%,#0b1014 70%);place-content:center;text-align:center;gap:14px}
body.card b{font-size:66px;max-width:780px;justify-self:center;text-wrap:balance;font-weight:800;letter-spacing:-.04em;line-height:1}
body.card small{font-size:20px;letter-spacing:.32em;text-transform:uppercase;color:#7fe3d0}
body.card i{font-style:normal;font-size:22px;opacity:.85;max-width:640px;justify-self:center;line-height:1.35}
body.card pre{justify-self:center;text-align:left;margin:6px 0 0;padding:14px 18px;border-radius:12px;background:rgba(0,0,0,.45);border:1px solid rgba(127,227,208,.35);font:15px/1.5 Menlo,monospace;color:#d8fff6}
body.card .q{font-size:15px;letter-spacing:.4em;color:#9aa;margin-top:18px}`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** The ffmpeg filter for one cut's look (it starts from the take at 960x540 and ends at the reel's size). */
function look(fx: string[], len: number): string {
  const f: string[] = [];
  if (fx.includes("slow")) f.push("setpts=2*PTS");
  if (fx.includes("fast")) f.push("setpts=0.5*PTS");
  // A push in: 0 to 18% over the cut; a punch is the same in a quarter second, then held.
  if (fx.includes("push")) f.push(`scale=w='trunc(${W}*(1+0.18*t/${len})/2)*2':h='trunc(${H}*(1+0.18*t/${len})/2)*2':eval=frame,crop=${W}:${H}`);
  if (fx.includes("punch")) f.push(`scale=w='trunc(${W}*(1+0.22*min(t/0.25,1))/2)*2':h='trunc(${H}*(1+0.22*min(t/0.25,1))/2)*2':eval=frame,crop=${W}:${H}`);
  if (fx.includes("shake")) f.push(`scale=${Math.round(W * 1.08)}:${Math.round(H * 1.08)},crop=${W}:${H}:x='${(W * 0.04).toFixed(0)}+${(W * 0.03).toFixed(0)}*sin(t*71)*exp(-t*2.5)':y='${(H * 0.04).toFixed(0)}+${(H * 0.03).toFixed(0)}*cos(t*53)*exp(-t*2.5)'`);
  if (fx.includes("glitch")) f.push("rgbashift=rh=-7:bh=7:gv=3:enable='lt(t,0.35)'");
  if (fx.includes("mono")) f.push("hue=s=0.15");
  f.push(fx.includes("mono") ? "eq=contrast=1.25" : "eq=contrast=1.08:saturation=1.22", "vignette=PI/5");
  f.push(`scale=${OUT_W}:${OUT_H}`);
  if (fx.includes("flash")) f.push("fade=in:st=0:d=0.18:color=white");
  if (fx.includes("dark")) f.push("fade=in:st=0:d=0.3:color=black");
  f.push(`fps=${FPS}`, "format=yuv420p");
  return f.join(",");
}

/** Cuts a reel out of its app's takes. */
async function cut(tab: Tab, app: string, reel: Reel, takes: string): Promise<{ file: string; secs: number }> {
  const work = join(cache, app, `reel-${reel.name}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const parts: string[] = [];
  let total = 0;
  for (const [i, c] of reel.cuts.entries()) {
    const part = join(work, `${String(i).padStart(3, "0")}.mp4`);
    if ("card" in c) {
      const png = join(work, `${i}.png`);
      await drawText(tab, `${c.kicker ? `<small>${esc(c.kicker)}</small>` : ""}<b>${esc(c.card)}</b>${c.line ? `<i>${esc(c.line)}</i>` : ""}${c.code ? `<pre>${esc(c.code)}</pre>` : ""}${c.end ? `<span class="q">PLAY IT ON EQOSYS</span>` : ""}`, png, true);
      const len = c.len ?? 1.6;
      ff(["-loop", "1", "-t", String(len), "-i", png, "-vf", `scale=w='trunc(${OUT_W}*(1+0.06*t/${len})/2)*2':h='trunc(${OUT_H}*(1+0.06*t/${len})/2)*2':eval=frame,crop=${OUT_W}:${OUT_H},fade=in:st=0:d=0.2,fade=out:st=${len - 0.2}:d=0.2,fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", part]);
      total += len;
    } else {
      // "fm-daw/jam" is another app's take.
      const src = c.take.includes("/") ? join(cache, `${c.take}.mp4`) : join(takes, `${c.take}.mp4`), fx = c.fx ?? [];
      if (!existsSync(src)) throw new Error(`${app}/${reel.name}: no take ${c.take}`);
      const speed = fx.includes("slow") ? 2 : fx.includes("fast") ? 0.5 : 1, len = c.len ?? 2.4;
      // A cut that would run past its take's end starts earlier, so it never runs out of frames.
      const from = Math.max(0, Math.min(c.at, secsOf(src) - len / speed - 0.1));
      const args = ["-ss", String(from), "-t", String(len / speed), "-i", src];
      let filter = `[0:v]${look(fx, len)}[v]`;
      if (c.say) {
        const png = join(work, `${i}.png`);
        await drawText(tab, `<b>${esc(c.say)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}`, png, false);
        args.push("-loop", "1", "-t", String(len), "-i", png);
        filter = `[0:v]${look(fx, len)}[b];[1:v]format=rgba,fade=in:st=0:d=0.12:alpha=1[t];[b][t]overlay=0:0:shortest=1,format=yuv420p[v]`;
      }
      ff([...args, "-filter_complex", filter, "-map", "[v]", "-t", String(len), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", part]);
      total += len;
    }
    parts.push(part);
  }
  writeFileSync(join(work, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
  mkdirSync(outDir, { recursive: true });
  const file = `${app}-${reel.name}.mp4`;
  ff(["-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-an", "-c:v", "libx264", "-crf", String(reel.crf ?? 30), "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(outDir, file)]);
  // The poster: a frame a third of the way in.
  ff(["-ss", (total / 3).toFixed(2), "-i", join(outDir, file), "-frames:v", "1", "-q:v", "5", join(outDir, file.replace(/\.mp4$/, ".jpg"))]);
  return { file, secs: Math.round(total * 10) / 10 };
}

/** What eqosys reads: each app's reels in the order they play, with a title and length (the same shape as its src/trailers.ts). */
const Manifest = rec(arr(obj({ file: str(120), title: str(60), secs: num(0, 300) }), 12), 100);
type Manifest = Of<typeof Manifest>;
const manifestFile = join(root, "apps/eqosys/src/trailers.json");

if (import.meta.main) {
  const argv = process.argv.slice(2);
  help(import.meta.path);
  const retake = argv.includes("--retake"), takesOnly = argv.includes("--takes-only"), want = argv.filter((a) => !a.startsWith("-"));
  const unknown = want.filter((a) => !(a in STAGES));
  if (unknown.length) { console.error(`no trailers for ${unknown.join(", ")}: add it to STAGES in scripts/trailer-plans.ts`); process.exit(2); }
  const manifest = (existsSync(manifestFile) ? check(Manifest, JSON.parse(readFileSync(manifestFile, "utf8"))) : null) ?? {};
  const { cdp, stop } = await launchChrome(["--autoplay-policy=no-user-gesture-required", "--mute-audio"]);
  const report: string[] = [];
  try {
    for (const [app, plan] of Object.entries(STAGES)) {
      if (want.length && !want.includes(app)) continue;
      console.log(app);
      const takes = join(cache, app);
      mkdirSync(takes, { recursive: true });
      let server: { url: string; stop: () => void } | undefined;
      try {
        for (const t of plan.takes) {
          const file = join(takes, `${t.name}.mp4`);
          if (existsSync(file) && !retake) continue;
          server ??= await serve(plan.app ?? app, plan.serve as Serve | undefined);
          const tab = { ...(await openTab(cdp, { w: t.size?.[0] ?? W, h: t.size?.[1] ?? H })), cdp };
          try { await shoot(tab, t.url ?? server.url, t, file); } finally { await tab.close(); }
        }
        server?.stop(), server = undefined;
        if (takesOnly) { report.push(`ok   ${app}: takes in ${takes}`); continue; }
        const tab = { ...(await openTab(cdp, { w: OUT_W, h: OUT_H })), cdp };
        try {
          manifest[app] = [];
          for (const r of plan.reels) {
            const { file, secs } = await cut(tab, app, r, takes);
            manifest[app].push({ file, title: r.title, secs });
            report.push(`ok   ${file} ${secs}s ${(Bun.file(join(outDir, file)).size / 1024).toFixed(0)} KB`);
          }
        } finally { await tab.close(); }
      } catch (e) { report.push(`FAIL ${app}: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`); }
      finally { server?.stop(); }
    }
  } finally { stop(); }
  if (!takesOnly) writeFileSync(manifestFile, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + "\n");
  console.log(report.join("\n"));
  if (report.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
}

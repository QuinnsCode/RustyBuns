// A Thanksgiving pie for mpl (github.com/ivarvong/mpl): the chart types in its own code, drawn with its own
// brand-new `ax.pie` (ivarvong/mpl#85). Each slice is how many of mpl's pixel-exact reference fixtures
// (`fixtures/ref/*.json`) call that chart type.
//
//   bun notes/mpl-pie/pie.ts          clones mpl at PIN into a temp folder, counts, writes pie.png, oilslick.html and lavalamp.svg here
//   bun notes/mpl-pie/pie.ts --gif    also records oilslick.gif and lavalamp.gif (headless Chrome + ffmpeg); --gif=lavalamp for one
//
// mpl isn't on npm (the `mpl` package there is someone else's), so this reads its source straight from a clone.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../scripts/help.ts";
import { lavaLamp } from "./lavalamp.ts";

help(import.meta.path);

/** mpl's main right after #85 (pie) merged. */
const PIN = "689ebd4383c0f55b4219e73303f0b1dea6660bbf";
/** The plotting calls in mpl's Axes API that draw a chart (docs/api.md), not lines or text laid on one. */
const CHARTS = ["plot", "step", "errorbar", "hist", "boxplot", "pie", "bar", "barh", "fill_between", "imshow", "scatter"];
/** One pumpkin hue for every slice, from the biggest (brightest) to the smallest (darkest). */
const BRIGHT = "#ffae4f", DARK = "#4a220e";
/** The page, the gaps between slices, and the light and quiet inks on it. */
const PAGE = "#0d0f13", INK = "#f4efe6", QUIET = "#9a9ca3";

const dir = mkdtempSync(join(tmpdir(), "mpl-pie-"));
const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: dir, stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
};
git("init", "-q");
git("fetch", "-q", "--depth", "1", "https://github.com/ivarvong/mpl.git", PIN);
git("checkout", "-q", "FETCH_HEAD");

/** Every chart type a fixture's spec calls, at any depth (a spec nests calls per axes). */
function called(v: unknown, hit: Set<string>): Set<string> {
  if (Array.isArray(v)) {
    if (typeof v[0] === "string" && CHARTS.includes(v[0])) hit.add(v[0]);
    for (const x of v) called(x, hit);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) called(x, hit);
  return hit;
}

const refs = join(dir, "fixtures/ref");
const fixtures = readdirSync(refs).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const tally = new Map<string, number>();
for (const f of fixtures) {
  const fixture: unknown = JSON.parse(readFileSync(join(refs, f), "utf8"));
  const spec = fixture && typeof fixture === "object" && "spec" in fixture ? fixture.spec : null;
  for (const c of called(spec, new Set())) tally.set(c, (tally.get(c) ?? 0) + 1);
}
const counts = [...tally].sort((a, b) => b[1] - a[1]);

const { subplots, registerFonts } = await import(join(dir, "src/index.ts"));
for (const face of ["regular", "medium", "semibold", "bold"]) {
  const name = `inter${face[0].toUpperCase()}${face.slice(1)}`;
  registerFonts((await import(join(dir, `src/fonts/inter-${face}.ts`)))[name]);
}

const mix = (a: string, b: string, t: number) => `#${[1, 3, 5].map((j) => Math.round(parseInt(a.slice(j, j + 2), 16) * (1 - t) + parseInt(b.slice(j, j + 2), 16) * t).toString(16).padStart(2, "0")).join("")}`;
/** Brighter is bigger: counts are sorted, so slice i takes step i of the ramp. */
const colors = counts.map((_, i) => mix(BRIGHT, DARK, Math.pow(i / (counts.length - 1), 0.85)));

/** Turned so the eight smaller slices sit around 3 o'clock, each label level with its slice down the right. */
const START = 36.5;
const EXPLODE = 0.08;
/** The ring: outer radius 1, this thick. */
const RING = 0.42;
/** Slices this many degrees or wider carry their label inside the ring; the rest get a leader to the right column. */
const INSIDE = 30;
/** The right column at x = COL, labels at least GAP apart so the thin slices' names fan out. */
const COL = 1.3, GAP = 0.15, TOP = 1.2;
const total = counts.reduce((sum, [, n]) => sum + n, 0);
let before = 0;
const slices = counts.map(([k, n], i) => {
  const span = (360 * n) / total, mid = START + (360 * (before + n / 2)) / total;
  before += n;
  const [cx, cy] = [Math.cos((mid * Math.PI) / 180), Math.sin((mid * Math.PI) / 180)];
  const off = k === "pie" ? EXPLODE : 0;
  return {
    i, name: k === "pie" ? "pie (new!)" : k, n, inside: span >= INSIDE,
    centre: [cx * (1 - RING / 2), cy * (1 - RING / 2)], rim: [cx * (1.06 + off), cy * (1.06 + off)], elbow: [cx * (1.13 + off), cy * (1.13 + off)], y: 0,
  };
});
const outside = slices.filter((l) => !l.inside).sort((a, b) => b.elbow[1] - a.elbow[1]);
outside.forEach((l, j) => (l.y = Math.min(l.elbow[1], TOP, j ? outside[j - 1].y - GAP : TOP)));
// Then centre the column on its slices, so it doesn't all sag below them.
const sag = (outside.reduce((sum, l) => sum + l.elbow[1] - l.y, 0)) / outside.length;
for (const l of outside) l.y += sag;

/** The chart: a pumpkin donut on a dark page. `clear` leaves the page see-through (the oil-slick page draws its own);
 *  `wedgesOnly` draws just the slices in the same place, which that page uses as its sheen's mask. */
function chart({ clear = false, wedgesOnly = false } = {}) {
  const rc = {
    "font.family": "Inter", "text.color": INK, "figure.facecolor": clear ? "none" : PAGE, "axes.facecolor": "none",
    "figure.subplot.left": 0, "figure.subplot.right": 1, "figure.subplot.bottom": 0, "figure.subplot.top": 1,
    // Text as glyph outlines: a browser without Inter would swap in its own font.
    "svg.fonttype": "path",
  };
  const [fig, ax] = subplots({ figsize: [12, 7], dpi: 120, rc });
  const values = counts.map(([, n]) => n), explode = counts.map(([k]) => (k === "pie" ? EXPLODE : 0));
  // As a mask the slices are white and the gaps black, read by brightness, so the sheen stays off the gaps and edges.
  ax.pie(values, { colors: wedgesOnly ? counts.map(() => "white") : colors, startangle: START, explode, labels: counts.map(() => ""), wedgeprops: { width: RING, edgecolor: wedgesOnly ? "black" : PAGE, linewidth: 4 } });
  // The donut is the star: centred and as tall as the page allows under the two-line greeting.
  ax.set_xlim(-2.09, 2.09);
  ax.set_ylim(-1.06, 1.38);
  if (wedgesOnly) return fig;
  for (const l of slices) {
    if (l.inside) {
      // Dark ink on the bright slices, light on the dark ones, as on a printed chart.
      const ink = l.i < 3 ? "#2a1406" : INK;
      ax.text(l.centre[0], l.centre[1] + 0.045, l.name, { ha: "center", va: "center", fontsize: 17, fontweight: "semibold", color: ink });
      ax.text(l.centre[0], l.centre[1] - 0.075, String(l.n), { ha: "center", va: "center", fontsize: 14, color: ink });
    } else {
      ax.plot([l.rim[0], l.elbow[0], COL], [l.rim[1], l.elbow[1], l.y], { color: "#5b5d63", linewidth: 1 });
      // A small table: the count right-aligned in grey, then the name.
      ax.text(COL + 0.17, l.y, String(l.n), { ha: "right", va: "center", fontsize: 14, color: QUIET });
      // The one accent: pie, new in #85, in the bright pumpkin.
      ax.text(COL + 0.23, l.y, l.name, { ha: "left", va: "center", fontsize: 14, fontweight: "medium", color: l.name.startsWith("pie") ? BRIGHT : INK });
    }
  }
  ax.text(0, 0.06, String(fixtures.length), { ha: "center", va: "center", fontsize: 44, fontweight: "bold", color: INK });
  ax.text(0, -0.13, "fixtures", { ha: "center", va: "center", fontsize: 14, color: QUIET });
  // The greeting, small and centred above the pie so it doesn't compete with it.
  ax.text(0.5, 0.95, "Thanks for adding Pie charts!", { transform: ax.transAxes, ha: "center", va: "center", fontsize: 20, fontweight: "semibold", color: INK });
  ax.text(0.5, 0.905, "Happy Thanksgiving!", { transform: ax.transAxes, ha: "center", va: "center", fontsize: 14, color: QUIET });
  return fig;
}

const here = import.meta.dir;
await Bun.write(join(here, "pie.png"), await chart().toPNG());

// The oil-slick page: mpl's own SVG with one slow sheen of light sweeping across the slices, like light on a glossy
// glaze, masked to the slices (a second SVG of the slices alone is the mask). Its period divides LOOP seconds, so frame
// LOOP is frame 0 again and the GIF loops without a seam.
const LOOP = 8;
const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const mask = uri(chart({ clear: true, wedgesOnly: true }).toSVG());
const html = `<!doctype html>
<meta charset="utf-8">
<title>A pie of mpl's chart types</title>
<style>
  html, body { margin: 0; height: 100%; background: ${PAGE}; }
  .stage { position: relative; width: 1440px; height: 840px; margin: 0 auto; }
  .stage > * { position: absolute; inset: 0; width: 100%; height: 100%; }
  .sheen { mask: url(${mask}) center / 100% 100% no-repeat luminance; }
  /* A narrow band of warm light, with a soft glow either side, crossing once per loop and resting off the pie between. */
  .sheen::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(110deg, transparent 43%, rgba(255,240,215,.07) 47%, rgba(255,246,230,.42) 49.6%, rgba(255,240,215,.07) 52%, transparent 56%) 0 0 / 300% 100%;
    mix-blend-mode: screen;
    animation: sheen ${LOOP}s cubic-bezier(.55, 0, .45, 1) infinite;
  }
  @keyframes sheen { 0% { background-position: 100% 0; } 70%, 100% { background-position: 0% 0; } }
</style>
<div class="stage">
  <img src="${uri(chart({ clear: true }).toSVG())}" alt="Chart types in mpl: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")}">
  <div class="sheen"></div>
</div>
`;
await Bun.write(join(here, "oilslick.html"), html);
console.log(`pie.png + oilslick.html: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")} (${fixtures.length} fixtures)`);


// The lava-lamp edition: one SVG, SMIL only, so it plays straight from the file. Its loop is slower than the sheen's.
const LAVA_LOOP = 12;
const lava = lavaLamp(chart().toSVG(), colors, LAVA_LOOP, PAGE);
await Bun.write(join(here, "lavalamp.svg"), lava);
console.log(`lavalamp.svg: ${Math.round(lava.length / 1024)} KB`);

/** Records `page` as a 960 px GIF, `loop` seconds at `fps`. Every animation is paused and stepped to each frame's exact
 *  time before its screenshot, so frames are exact, not as fast as Chrome draws, and frame `loop` would be frame 0.
 *  The GIF's one 256-colour palette is built from the frames plus a picture of the chart's colours in stripes: without
 *  it, a page that is mostly near black spends the palette on greys and the small coloured labels drift (red to orange). */
async function record(page: string, gif: string, loop: number, fps: number, step: (ms: number) => string) {
  const { launchChrome, openTab } = await import("../../scripts/chrome.ts");
  const frames = mkdtempSync(join(tmpdir(), "mpl-pie-frames-"));
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1440, h: 840 });
    await tab.call("Page.navigate", { url: `file://${join(here, page)}` });
    await Bun.sleep(1500);
    for (let i = 0; i < loop * fps; i++) {
      await tab.eval(step((i * 1000) / fps));
      const { data } = await tab.call("Page.captureScreenshot", { format: "png" });
      await Bun.write(join(frames, `f${String(i).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
    }
    const inks = [...new Set([...colors, INK, QUIET, PAGE])];
    const stripes = inks.map((c, j) => `<rect y="${j * 10}" width="10" height="10" fill="${c}"/>`).join("");
    await tab.call("Page.navigate", { url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 ${inks.length * 10}" preserveAspectRatio="none" width="100%" height="100%">${stripes}</svg>`)}` });
    await Bun.sleep(300);
    const { data } = await tab.call("Page.captureScreenshot", { format: "png" });
    await Bun.write(join(frames, "inks.png"), Buffer.from(data, "base64"));
    if (tab.noise.length) console.warn(tab.noise.join("\n"));
  } finally {
    chrome.stop();
  }
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "f%04d.png"), "-i", join(frames, "inks.png"),
    "-filter_complex", `[1]scale=960:-1,loop=loop=${(loop * fps) / 2}:size=1:start=0[inks];[0]scale=960:-1:flags=lanczos,split[a][b];` +
      "[a][inks]concat=n=2:v=1,palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a", "-loop", "0", join(here, gif)], { stderr: "inherit" });
  if (ff.exitCode !== 0) throw new Error("ffmpeg failed (brew install ffmpeg)");
  console.log(`${gif}: ${loop * fps} frames, ${loop}s loop`);
}

const only = process.argv.find((a) => a.startsWith("--gif="))?.slice(6);
if (process.argv.includes("--gif") || only) {
  if (!only || only === "oilslick")
    await record("oilslick.html", "oilslick.gif", LOOP, 15, (ms) => `document.getAnimations().forEach(a => { a.pause(); a.currentTime = ${ms}; })`);
  if (!only || only === "lavalamp")
    await record("lavalamp.svg", "lavalamp.gif", LAVA_LOOP, 15, (ms) => `(s => { s.pauseAnimations(); s.setCurrentTime(${ms / 1000}); })(document.documentElement)`);
}

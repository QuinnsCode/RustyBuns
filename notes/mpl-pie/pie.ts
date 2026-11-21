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
/** tab10 for the other ten chart types; pie gets pumpkin. */
const TAB10 = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
const PUMPKIN = "#C8601A";

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
const { dejavuSansBold } = await import(join(dir, "src/fonts/dejavu-sans-bold.ts"));
registerFonts(dejavuSansBold);

let next = 0;
const colors = counts.map(([k]) => (k === "pie" ? PUMPKIN : TAB10[next++ % TAB10.length]));

/** Turned so the three thinnest slices sit just left of 12 o'clock: with plot, they fill the left label column. */
const START = 102;
const EXPLODE = 0.18;
/** Label columns at x = ±COL (pie radius 1), labels at least GAP apart so the thin slices' names fan out. */
const COL = 1.28, GAP = 0.13, TOP = 1.2, BOTTOM = -0.98;
const total = counts.reduce((s, [, n]) => s + n, 0);
let before = 0;
const labelled = counts.map(([k, n], i) => {
  const mid = START + (360 * (before + n / 2)) / total;
  before += n;
  const [cx, cy] = [Math.cos((mid * Math.PI) / 180), Math.sin((mid * Math.PI) / 180)];
  const off = k === "pie" ? EXPLODE : 0;
  const deg = ((mid % 360) + 360) % 360;
  // Slices within 5° right of 12 o'clock go left too (pie, pulled out), so the columns split 5 and 6.
  const left = deg >= 85 && deg <= 275;
  return {
    i, left, text: k === "pie" ? `pie ${n} (new!)` : `${k} ${n}`,
    rim: [cx * (1.02 + off), cy * (1.02 + off)], elbow: [cx * (1.08 + off), cy * (1.08 + off)], at: [left ? -COL : COL, 0], y: 0, ink: "",
  };
});
for (const left of [true, false]) {
  const side = labelled.filter((l) => l.left === left).sort((a, b) => b.elbow[1] - a.elbow[1]);
  side.forEach((l, j) => (l.y = Math.min(l.elbow[1], TOP, j ? side[j - 1].y - GAP : TOP)));
  for (let j = side.length - 1; j >= 0; j--) side[j].y = Math.max(side[j].y, j < side.length - 1 ? side[j + 1].y + GAP : BOTTOM);
}

/** `hex` mixed toward white by k: tab10's darker colours, lifted a little to read as text on a dark page. */
const lift = (hex: string, k: number) => `#${[1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16)).map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, "0")).join("")}`;
/** Oil on asphalt: each slice near black, with a hint of its own colour. */
const OIL = colors.map((c) => `#${[1, 3, 5].map((j) => Math.round(parseInt(c.slice(j, j + 2), 16) * 0.2).toString(16).padStart(2, "0")).join("")}`);

/** The chart. `dark` draws light text on a see-through figure for the dark pages; `wedgesOnly` draws just the slices
 *  in the same place, which the oil-slick page uses as the shimmer's mask; `wedgeColors` fills the slices. */
function chart({ dark = false, wedgesOnly = false, wedgeColors = colors } = {}) {
  for (const l of labelled) l.ink = dark ? lift(colors[l.i], 0.2) : colors[l.i];
  const ink = dark ? "#f4efe6" : "#000000";
  const rc = {
    "figure.subplot.left": 0.02,
    "figure.subplot.right": 0.6,
    // Text as glyph outlines: a browser without DejaVu Sans would swap in its own font.
    ...(dark ? { "figure.facecolor": "none", "axes.facecolor": "none", "text.color": ink, "legend.labelcolor": ink, "svg.fonttype": "path" } : {}),
  };
  const [fig, ax] = subplots({ figsize: [12, 7], dpi: 120, rc: { ...rc, "figure.subplot.left": 0, "figure.subplot.right": 1, "figure.subplot.bottom": 0.01, "figure.subplot.top": 0.925 } });
  ax.pie(counts.map(([, n]) => n), {
    colors: wedgeColors,
    startangle: START,
    labels: counts.map(() => ""),
    explode: counts.map(([k]) => (k === "pie" ? EXPLODE : 0)),
    wedgeprops: { edgecolor: dark ? "#0b0a12" : "white", linewidth: 1.5 },
  });
  // The pie fills the height; the two label columns take the width a legend box used to.
  ax.set_xlim(-2.4, 2.4);
  ax.set_ylim(-1.04, 1.27);
  if (wedgesOnly) return fig;
  for (const l of labelled) {
    ax.plot([l.rim[0], l.elbow[0], l.at[0]], [l.rim[1], l.elbow[1], l.y], { color: l.ink, linewidth: 1 });
    // A dot where the leader leaves its slice: the thin slices' leaders start close together.
    ax.plot([l.rim[0]], [l.rim[1]], { color: l.ink, marker: "o", markersize: 3.5, linestyle: "none" });
    ax.text(l.at[0] + (l.left ? -0.03 : 0.03), l.y, l.text, { ha: l.left ? "right" : "left", va: "center", fontsize: 14, color: l.ink });
  }
  fig.suptitle("Happy Thanksgiving, mpl: a pie of your own chart types", { fontsize: 18, fontweight: "bold" });
  return fig;
}

const here = import.meta.dir;
await Bun.write(join(here, "pie.png"), await chart().toPNG());

// The oil-slick page: mpl's own SVG with the slices near black, like oil on asphalt, a faint slow rainbow film and a
// sheen of light sweeping across, both masked to the slices. Every animation's period divides
// LOOP seconds, so frame LOOP is frame 0 again and the GIF loops without a seam.
const LOOP = 8;
const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const html = `<!doctype html>
<meta charset="utf-8">
<title>A pie of mpl's chart types</title>
<style>
  @property --a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
  html, body { margin: 0; height: 100%; background: radial-gradient(ellipse at 50% 45%, #2a2a2e 0%, #17171a 75%); }
  .stage { position: relative; width: 1440px; height: 840px; margin: 0 auto; }
  .stage > * { position: absolute; inset: 0; width: 100%; height: 100%; }
  .slick {
    -webkit-mask: url(${uri(chart({ dark: true, wedgesOnly: true }).toSVG())}) center / 100% 100% no-repeat;
    mask: url(${uri(chart({ dark: true, wedgesOnly: true }).toSVG())}) center / 100% 100% no-repeat;
  }
  .slick::before, .slick::after { content: ""; position: absolute; inset: 0; }
  /* The film: fine rainbow rings over a rainbow that sways a sixth of a turn and back each loop (out and back, so half a loop each way), its hue drifting a
     little. Faint and slow: the slices stay black with a hint of their own colour. */
  .slick::before {
    background:
      repeating-radial-gradient(circle at 24% 38%, #ff5ec8 0, #ffb35e 22px, #f7ff6b 44px, #5effa4 66px, #5ed8ff 88px, #8a6bff 110px, #ff5ec8 132px),
      conic-gradient(from var(--a) at 31% 50%, #ff5ec8, #ffb35e, #f7ff6b, #5effa4, #5ed8ff, #8a6bff, #ff5ec8);
    background-blend-mode: overlay;
    mix-blend-mode: soft-light; opacity: .07;
    animation: turn ${LOOP / 2}s ease-in-out infinite alternate, drift ${LOOP / 2}s ease-in-out infinite alternate;
  }
  /* The sheen: a soft band of light sliding across, once per loop. */
  .slick::after {
    background: linear-gradient(115deg, transparent 45%, rgba(255,255,255,.06) 47.5%, rgba(255,255,255,.3) 49.5%, rgba(205,235,255,.16) 50.7%, transparent 53.5%) 0 0 / 300% 100%;
    mix-blend-mode: screen;
    animation: sheen ${LOOP}s ease-in-out infinite;
  }
  @keyframes turn { to { --a: 60deg; } }
  @keyframes drift { to { filter: hue-rotate(-40deg); } }
  @keyframes sheen { from { background-position: 100% 0; } to { background-position: 0% 0; } }
</style>
<div class="stage">
  <img src="${uri(chart({ dark: true, wedgeColors: OIL }).toSVG())}" alt="Chart types in mpl: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")}">
  <div class="slick"></div>
</div>
`;
await Bun.write(join(here, "oilslick.html"), html);
console.log(`pie.png + oilslick.html: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")} (${fixtures.length} fixtures)`);


// The lava-lamp edition: one SVG, SMIL only, so it plays straight from the file. Its loop is slower than the sheen's.
const LAVA_LOOP = 12;
const lava = lavaLamp(chart({ dark: true }).toSVG(), colors, LAVA_LOOP);
await Bun.write(join(here, "lavalamp.svg"), lava);
console.log(`lavalamp.svg: ${Math.round(lava.length / 1024)} KB`);

/** Records `page` as a 960 px GIF, `loop` seconds at `fps`. Every animation is paused and stepped to each frame's exact
 *  time before its screenshot, so frames are exact, not as fast as Chrome draws, and frame `loop` would be frame 0.
 *  The GIF's one 256-colour palette is built from the frames plus a picture of the label colours in stripes: without
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
    const inks = [...new Set(labelled.map((l) => lift(colors[l.i], 0.2)))];
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

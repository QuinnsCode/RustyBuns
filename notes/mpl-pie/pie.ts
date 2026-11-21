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

/** The chart. `dark` draws light text on a see-through figure for the oil-slick page; `wedgesOnly` draws just the
 *  slices in the same place, which that page uses as the shimmer's mask. */
function chart({ dark = false, wedgesOnly = false } = {}) {
  const ink = dark ? "#f4efe6" : "#000000";
  const rc = {
    "figure.subplot.left": 0.02,
    "figure.subplot.right": 0.6,
    // Text as glyph outlines: a browser without DejaVu Sans would swap in its own font.
    ...(dark ? { "figure.facecolor": "none", "axes.facecolor": "none", "text.color": ink, "legend.labelcolor": ink, "svg.fonttype": "path" } : {}),
  };
  const [fig, ax] = subplots({ figsize: [12, 7], dpi: 120, rc });
  ax.pie(counts.map(([, n]) => n), {
    colors,
    startangle: 90,
    labels: counts.map(([k]) => (k === "pie" && !wedgesOnly ? "pie (new!)" : "")),
    explode: counts.map(([k]) => (k === "pie" ? 0.18 : 0)),
    wedgeprops: { edgecolor: dark ? "#0b0a12" : "white", linewidth: 1.5 },
  });
  if (wedgesOnly) return fig;
  fig.suptitle("Happy Thanksgiving, mpl: a pie of your own chart types", { fontsize: 18, fontweight: "bold" });
  fig.text(0.5, 0.03, `Slice = how many of mpl's ${fixtures.length} pixel-exact fixtures use each chart type. Drawn with ax.pie from mpl #85.`, {
    ha: "center",
    fontsize: 11,
    color: dark ? "#9d97a8" : "#555555",
  });
  // The legend sits in its own empty axes to the right: one zero-height bar per slice carries the label and colour.
  const key = fig.addAxesAt([0.62, 0.15, 0.98, 0.85]);
  counts.forEach(([k, n], i) => key.bar([0], [0], { color: colors[i], label: `${k}  (${n})` }));
  key.legend({ loc: "center", frameon: false, fontsize: 13 });
  key.set_xticks([]);
  key.set_yticks([]);
  for (const s of Object.values(key.spines)) (s as { set_visible(b: boolean): void }).set_visible(false);
  return fig;
}

const here = import.meta.dir;
await Bun.write(join(here, "pie.png"), await chart().toPNG());

// The oil-slick page: mpl's own SVG, with a slow rainbow sheen masked to the slices. Every animation's period divides
// LOOP seconds, so frame LOOP is frame 0 again and the GIF loops without a seam.
const LOOP = 8;
const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const html = `<!doctype html>
<meta charset="utf-8">
<title>A pie of mpl's chart types</title>
<style>
  @property --a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
  html, body { margin: 0; height: 100%; background: radial-gradient(ellipse at 30% 40%, #1b1626 0%, #0b0a12 70%); }
  .stage { position: relative; width: 1440px; height: 840px; margin: 0 auto; }
  .stage > * { position: absolute; inset: 0; width: 100%; height: 100%; }
  .slick {
    -webkit-mask: url(${uri(chart({ dark: true, wedgesOnly: true }).toSVG())}) center / 100% 100% no-repeat;
    mask: url(${uri(chart({ dark: true, wedgesOnly: true }).toSVG())}) center / 100% 100% no-repeat;
  }
  .slick::before, .slick::after { content: ""; position: absolute; inset: 0; }
  /* The film: fine rainbow rings over a rainbow turning once per loop, the hue drifting the other way. Kept faint so
     every slice still matches its legend colour. */
  .slick::before {
    background:
      repeating-radial-gradient(circle at 24% 38%, #ff5ec8 0, #ffb35e 22px, #f7ff6b 44px, #5effa4 66px, #5ed8ff 88px, #8a6bff 110px, #ff5ec8 132px),
      conic-gradient(from var(--a) at 31% 50%, #ff5ec8, #ffb35e, #f7ff6b, #5effa4, #5ed8ff, #8a6bff, #ff5ec8);
    background-blend-mode: overlay;
    mix-blend-mode: soft-light; opacity: .32;
    animation: turn ${LOOP}s linear infinite, drift ${LOOP}s linear infinite;
  }
  /* The sheen: a soft band of light sliding across, twice per loop. */
  .slick::after {
    background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,.22) 47%, rgba(190,255,250,.14) 50%, transparent 62%) 0 0 / 300% 100%;
    mix-blend-mode: screen;
    animation: sheen ${LOOP / 2}s ease-in-out infinite;
  }
  @keyframes turn { to { --a: 360deg; } }
  @keyframes drift { to { filter: hue-rotate(-360deg); } }
  @keyframes sheen { from { background-position: 100% 0; } to { background-position: 0% 0; } }
</style>
<div class="stage">
  <img src="${uri(chart({ dark: true }).toSVG())}" alt="Chart types in mpl: ${counts.map(([k, n]) => `${k} ${n}`).join(", ")}">
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
 *  time before its screenshot, so frames are exact, not as fast as Chrome draws, and frame `loop` would be frame 0. */
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
    if (tab.noise.length) console.warn(tab.noise.join("\n"));
  } finally {
    chrome.stop();
  }
  const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "f%04d.png"),
    "-vf", "scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a", "-loop", "0", join(here, gif)], { stderr: "inherit" });
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

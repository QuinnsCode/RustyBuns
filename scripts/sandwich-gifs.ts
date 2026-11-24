// Draws the README's sandwich GIFs (docs/sandwich/<scene>.gif) from docs/sandwich/scenes.js: a headless Chrome
// paints each frame on a canvas, ffmpeg packs the frames into a looping GIF. Needs Chrome and ffmpeg.
//   bun scripts/sandwich-gifs.ts               every scene
//   bun scripts/sandwich-gifs.ts swap club     just these
//   bun scripts/sandwich-gifs.ts --fps 15      fewer frames, a smaller file (default 20)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "./help.ts";
import { launchChrome, openTab } from "./chrome.ts";

help(import.meta.path);
const root = join(import.meta.dir, "..");
const out = join(root, "docs/sandwich");
const argv = process.argv.slice(2);
const fpsAt = argv.indexOf("--fps");
const fps = fpsAt >= 0 ? Number(argv[fpsAt + 1]) : 20;
const wanted = argv.filter((a, i) => !a.startsWith("--") && !(fpsAt >= 0 && i === fpsAt + 1));

const chrome = await launchChrome();
try {
  const tab = await openTab(chrome.cdp, { w: 800, h: 450 });
  await tab.eval(`document.body.style.margin = "0"; document.body.innerHTML = '<canvas width="800" height="450"></canvas>'; true`);
  await tab.eval(readFileSync(join(out, "scenes.js"), "utf8") + ";true");
  const scenes = await tab.eval<Record<string, number>>("window.SCENES");
  for (const [name, seconds] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const dir = mkdtempSync(join(tmpdir(), `sandwich-${name}-`));
    const frames = Math.round(seconds * fps);
    for (let f = 0; f < frames; f++) {
      const url = await tab.eval<string>(`drawFrame(${JSON.stringify(name)}, ${f / fps})`);
      writeFileSync(join(dir, `${String(f).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const gif = join(out, `${name}.gif`);
    const ff = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(dir, "%04d.png"),
      "-vf", "split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", gif]);
    rmSync(dir, { recursive: true, force: true });
    if (ff.exitCode) throw new Error(`ffmpeg: ${ff.stderr.toString()}`);
    console.log(`${name}.gif  ${frames} frames  ${(Bun.file(gif).size / 1024).toFixed(0)} KB`);
  }
} finally {
  chrome.stop();
}

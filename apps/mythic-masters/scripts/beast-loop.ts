// The look half of the beast loop (scripts/beasts.ts --shots / --judge): the four ?gallery pages as PNGs from headless
// Chrome, and a fresh judge (a `claude -p` with no memory of the work) that scores BEFORE against NOW. Needs Chrome
// (CHROME=/path overrides where it looks) and, for the judge, the `claude` CLI.
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { APP, judgePairs, OUT } from "./judge-loop.ts";

export { OUT };
export const shotDir = (label: string) => join(OUT, "shots", label);

// Each beast is shot alone, filling a square frame from three-quarter (the gallery's focus()), and the page's sixteen
// are tiled 4 x 4 with the name on each tile. The whole-arena view drew each beast ~50 px tall, too small to judge
// detail, with the names in a list far from the beasts (#3132). The page is held still (one pose, shimmer at time zero) so an
// unchanged beast shoots the same twice and the judge only sees what the work changed.
const FRAME = 800, TILE = 400;

/** Writes gallery-<page>.png (a 4 x 4 contact sheet of close-ups) for the given pages (all of them when none) into blender/out/shots/<label>/; returns the paths. */
export async function shoot(label: string, pages?: number[]): Promise<string[]> {
  const dir = shotDir(label);
  mkdirSync(dir, { recursive: true });
  const vite = await startVite(APP);
  const { cdp, stop } = await launchChrome();
  const files: string[] = [];
  try {
    const tab = await openTab(cdp, { w: FRAME, h: FRAME });
    try {
      await load(cdp, tab, `${vite.url}?gallery=0`, 1500);
      const all = Array.from({ length: Math.ceil((await tab.eval<number>(`mythicMasters.roster().length`)) / 16) }, (_, i) => i);
      for (const page of pages ?? all) {
        await load(cdp, tab, `${vite.url}?gallery=${page}`, 500);
        const missing = await tab.eval<string[]>(`new Promise(async (done) => {
          setTimeout(() => done(["timed out"]), 30000);
          while (!globalThis.mythicMasters?.shelf()) await new Promise((r) => setTimeout(r, 100));
          done(await globalThis.mythicMasters.shelf().ready());
        })`);
        if (missing.length) console.warn(`gallery ${page}: not loaded: ${missing.join(", ")}`);
        const ids = await tab.eval<string[]>(`(document.head.append(Object.assign(document.createElement("style"), { textContent: "body *:not(#view) { visibility: hidden !important } #view { visibility: visible !important }" })), mythicMasters.shelf().still(true), mythicMasters.shelf().stands.map((s) => s.id))`);
        const names = await tab.eval<string[]>(`mythicMasters.shelf().names`);
        const shots: (string | null)[] = [];
        for (const id of ids) {
          if (!(await tab.eval<boolean>(`mythicMasters.shelf().focus(${JSON.stringify(id)}, "three-quarter")`))) { shots.push(null); continue; }
          await Bun.sleep(400); // a few frames from the new camera
          shots.push((await tab.call("Page.captureScreenshot", { format: "png" })).data);
        }
        const sheet = await tab.eval<string>(tileSheet(shots, names));
        const file = join(dir, `gallery-${page}.png`);
        await Bun.write(file, Buffer.from(sheet, "base64"));
        files.push(file);
      }
      if (tab.noise.length) console.warn(`page noise: ${[...new Set(tab.noise)].slice(0, 3).join("; ")}`);
    } finally { await tab.close(); }
  } finally { stop(); vite.stop(); }
  return files;
}

/** Page code that tiles the close-ups 4 x 4 on a 2D canvas, a name label on each (a missing beast's tile says so), and answers base64 PNG. */
function tileSheet(shots: (string | null)[], names: string[]): string {
  return `(async () => {
    const shots = ${JSON.stringify(shots)}, names = ${JSON.stringify(names)}, T = ${TILE};
    const c = document.createElement("canvas"); c.width = T * 4; c.height = T * Math.ceil(shots.length / 4);
    const g = c.getContext("2d"); g.fillStyle = "#222"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < shots.length; i++) {
      const x = (i % 4) * T, y = Math.floor(i / 4) * T;
      if (shots[i]) { const im = new Image(); im.src = "data:image/png;base64," + shots[i]; await im.decode(); g.drawImage(im, x, y, T, T); }
      g.strokeStyle = "#000"; g.lineWidth = 2; g.strokeRect(x, y, T, T);
      const label = (i + 1) + ". " + (names[i] ?? "?") + (shots[i] ? "" : " (not loaded)");
      g.font = "bold 22px sans-serif"; const w = g.measureText(label).width;
      g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(x + 6, y + 6, w + 16, 32);
      g.fillStyle = "#fff"; g.fillText(label, x + 14, y + 30);
    }
    return c.toDataURL("image/png").split(",")[1];
  })()`;
}

/** A fresh judge compares the BEFORE and NOW galleries and answers with a markdown score table, written to blender/out/judge.md for the PR body. */
export async function judge(): Promise<string> {
  const before = readdirSync(shotDir("before")).filter((f) => f.endsWith(".png")).sort();
  if (before.length === 0) throw new Error("no BEFORE shots: run `bun scripts/beasts.ts --shots --as before` on the old build first");
  await shoot("now", before.map((f) => Number(/(\d+)\.png$/.exec(f)?.[1])));
  return judgePairs(shotDir("before"), shotDir("now"), {
    subject: "the same gallery page: a 4 x 4 contact sheet, one beast per tile, close up from three-quarter, its name in the tile's top-left corner",
    rubric: "For each beast that looks different between BEFORE and NOW, score NOW from 1 to 10 on: silhouette (reads at a glance, unlike its neighbours), anatomy (limbs, head and tail attach where they should), and polish (no stretched, torn or floating geometry). Say BEFORE's total too.",
    row: "| beast | silhouette | anatomy | polish | BEFORE total | NOW total | note (one short phrase) |",
    out: join(OUT, "judge.md"),
    take: "run `bun scripts/beasts.ts --shots --as before` on the old build first",
  });
}

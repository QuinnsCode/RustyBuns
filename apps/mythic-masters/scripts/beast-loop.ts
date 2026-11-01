// The look half of the beast loop (scripts/beasts.ts --shots / --judge): the four ?gallery pages as PNGs from headless
// Chrome, and a fresh judge (a `claude -p` with no memory of the work) that scores BEFORE against NOW. Needs Chrome
// (CHROME=/path overrides where it looks) and, for the judge, the `claude` CLI.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const APP = join(import.meta.dir, "..");
export const OUT = join(APP, "blender", "out");
export const shotDir = (label: string) => join(OUT, "shots", label);

/** Writes gallery-<page>.png for the given pages (all of them when none) into blender/out/shots/<label>/; returns the paths. */
export async function shoot(label: string, pages?: number[]): Promise<string[]> {
  const dir = shotDir(label);
  mkdirSync(dir, { recursive: true });
  const vite = await startVite(APP);
  const { cdp, stop } = await launchChrome();
  const files: string[] = [];
  try {
    const tab = await openTab(cdp, { w: 1280, h: 800 });
    try {
      await load(cdp, tab, `${vite.url}?gallery=0`, 1500);
      const all = Array.from({ length: Math.ceil((await tab.eval<number>(`mythicMasters.roster().length`)) / 16) }, (_, i) => i);
      for (const page of pages ?? all) {
        await load(cdp, tab, `${vite.url}?gallery=${page}`, 6000);
        const shot = await tab.call("Page.captureScreenshot", { format: "png" });
        const file = join(dir, `gallery-${page}.png`);
        await Bun.write(file, Buffer.from(shot.data, "base64"));
        files.push(file);
      }
      if (tab.noise.length) console.warn(`page noise: ${[...new Set(tab.noise)].slice(0, 3).join("; ")}`);
    } finally { await tab.close(); }
  } finally { stop(); vite.stop(); }
  return files;
}

/** A fresh judge compares the BEFORE and NOW galleries and answers with a markdown score table, written to blender/out/judge.md for the PR body. */
export async function judge(): Promise<string> {
  const before = readdirSync(shotDir("before")).filter((f) => f.endsWith(".png")).sort();
  if (before.length === 0) throw new Error("no BEFORE shots: run `bun scripts/beasts.ts --shots --as before` on the old build first");
  await shoot("now", before.map((f) => Number(/(\d+)\.png$/.exec(f)?.[1])));
  const prompt = `You are a fresh art judge for a creature-fighting game. Each pair below is the same gallery page (16 beasts in a 4 x 4 grid, names in order along the bottom), BEFORE a change and NOW.
${before.map((f) => `BEFORE ${f}: ${join(shotDir("before"), f)}\nNOW    ${f}: ${join(shotDir("now"), f)}`).join("\n")}
Read every image. For each beast that looks different between BEFORE and NOW, score NOW from 1 to 10 on: silhouette (reads at a glance, unlike its neighbours), anatomy (limbs, head and tail attach where they should), and polish (no stretched, torn or floating geometry). Say BEFORE's total too.
Answer with ONLY a markdown table, one row per changed beast: | beast | silhouette | anatomy | polish | BEFORE total | NOW total | note (one short phrase) |, then one line "Verdict: better | same | worse".`;
  const p = Bun.spawn(["claude", "-p", prompt, "--no-session-persistence", "--allowedTools", "Read", "--add-dir", OUT], { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const text = (await new Response(p.stdout).text()).trim();
  if ((await p.exited) !== 0 || !text) throw new Error(`the judge did not answer:\n${(await new Response(p.stderr).text()).slice(-400)}`);
  writeFileSync(join(OUT, "judge.md"), text + "\n");
  return text;
}

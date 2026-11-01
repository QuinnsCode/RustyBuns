// Card shots: three screenshots per game, each loaded by a jump-to-state link (the same ones the manual-run
// window uses), for the game cards on the QNTBR site. Writes docs/cards/<game>-<n>-<slug>.jpg.
//
//   bun scripts/card-shots.ts                 every game below
//   bun scripts/card-shots.ts skate two-fronts
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "./chrome.ts";

const root = resolve(import.meta.dir, "..");
const hp = "/?level=yosemite-falls&spawn=creek%20halfpipe";
const battle = (q: string) => `/?battle=1&${q}`;
const clash = (a: string, b: string, skin: string) => `/?a=${a}&b=${b}&skin=${skin}`;

/** slug -> app folder and the three moments (path, and a wait in ms for the scene to get going). */
export const GAMES: Record<string, { dir: string; shots: { name: string; path: string; wait?: number; click?: string }[] }> = {
  "skate-tech-park": { dir: "skate-tech-park", shots: [{ name: "el-capitan", path: "/?level=el-capitan&nosweep", wait: 5000 }, { name: "halfpipe", path: hp + "&nosweep", wait: 5000 }, { name: "rail", path: "/?level=el-capitan&spawn=rail&nosweep", wait: 5000 }] },
  "two-fronts": { dir: "two-fronts", shots: [{ name: "desert", path: battle("side=marines&world=desert"), wait: 5000 }, { name: "beach", path: battle("side=wooka&world=beach"), wait: 5000 }, { name: "station", path: battle("world=station&side=attacker"), wait: 5000 }] },
  "delayed-reaction": { dir: "delayed-reaction", shots: [{ name: "stab", path: "/?level=5&stem=dub", wait: 5000, click: "#scenario" }, { name: "drums", path: "/?level=5&stem=drums", wait: 5000, click: "#scenario" }, { name: "everything", path: "/?level=5", wait: 6000, click: "#scenario" }] },
  "mythic-masters": { dir: "mythic-masters", shots: [{ name: "stadium", path: clash("jackalope", "jersey-devil", "stadium"), wait: 6000 }, { name: "volcano", path: clash("jersey-devil", "hodag", "volcano"), wait: 6000 }, { name: "world", path: "/?world=1", wait: 6000 }] },
  "alien-disc-golf": { dir: "alien-disc-golf", shots: [{ name: "round", path: "/?seed=42", wait: 5000 }, { name: "gulf-stream", path: "/?seed=42&swim=36.5,-72", wait: 5000 }, { name: "open-pacific", path: "/?seed=42&swim=-25,-120", wait: 5000 }] },
  qcrm: { dir: "qcrm", shots: [{ name: "home", path: "/", wait: 2000 }, { name: "contacts", path: "/app?scenario=populated", wait: 3000 }, { name: "webhooks", path: "/app?scenario=webhooks", wait: 3000 }] },
};

const want = process.argv.slice(2);
const { cdp, stop } = await launchChrome();
const report: string[] = [];
try {
  for (const [slug, g] of Object.entries(GAMES)) {
    if (want.length && !want.includes(slug)) continue;
    let server: Awaited<ReturnType<typeof startVite>> | undefined;
    try {
      server = await startVite(join(root, "apps", g.dir));
      for (const [i, s] of g.shots.entries()) {
        const tab = await openTab(cdp, { w: 1280, h: 800 });
        try {
          await load(cdp, tab, server.url.replace(/\/$/, "") + s.path, s.wait ?? 3000);
          if (s.click) { await tab.eval(`document.querySelector(${JSON.stringify(s.click)})?.click()`); await Bun.sleep(s.wait ?? 3000); }
          const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
          const file = `${slug}-${i + 1}-${s.name}.jpg`;
          mkdirSync(join(root, "docs/cards"), { recursive: true });
          writeFileSync(join(root, "docs/cards", file), Buffer.from(shot.data, "base64"));
          report.push(`ok   ${file}  ${[...new Set(tab.noise)].slice(0, 2).join(" | ")}`);
        } finally { await tab.close(); }
      }
    } catch (e) { report.push(`FAIL ${slug}: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`); }
    finally { server?.stop(); }
  }
} finally { stop(); }
console.log(report.join("\n"));

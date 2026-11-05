// Every screen and scene of a game, shot at a phone, a tablet and a desk: `bun run shots <app>` writes
// apps/<app>/docs/shots-<date>/<name>-<phone|tablet|desk>.png from one dev server and one headless Chrome (the same
// ones `bun run probe` uses). A screen is an address (SCREENS below); a scene is any name the page lists on
// window.__scenes (@rustybuns/util/director), opened as ?scene=<name>&t=<second> and held there. The UI climbs'
// rounds shoot with this instead of a loop of their own.
//
//   bun run shots git-recon                    everything, into apps/git-recon/docs/shots-<today>/
//   bun run shots git-recon --only credits     names that contain "credits"
//   bun run shots mythic-masters --out /tmp/x  somewhere else
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "./chrome.ts";

export const SIZES = { phone: { w: 390, h: 844, mobile: true }, tablet: { w: 820, h: 1180, mobile: true }, desk: { w: 1280, h: 800, mobile: false } } as const;

/** Each game's screens by name (an address to open fresh), and the seconds worth a look in its scenes (default: 1.5). */
export const SCREENS: Record<string, { screens: Record<string, string>; frames?: Record<string, number[]> }> = {
  "git-recon": {
    screens: { menu: "/", loadout: "/?screen=loadout", won: "/?screen=won", lost: "/?screen=lost" },
    frames: { credits: [2.5, 7.3, 18] },
  },
  "mythic-masters": { screens: { title: "/" }, frames: { faceoff: [1.2], abduction: [8], freeze: [1] } },
};

export interface Shot { name: string; path: string }
/** What to shoot for `app`: its screens, then each scene at each second worth a look; `only` keeps names containing it. */
export function plan(app: string, scenes: string[], only = ""): Shot[] {
  const cfg = SCREENS[app] ?? { screens: { home: "/" } };
  const shots = [
    ...Object.entries(cfg.screens).map(([name, path]) => ({ name, path })),
    ...scenes.flatMap((s) => (cfg.frames?.[s] ?? [1.5]).map((t, i, all) => ({ name: all.length > 1 ? `${s}-${t}s` : s, path: `/?scene=${encodeURIComponent(s)}&t=${t}` }))),
  ];
  return shots.filter((s) => s.name.includes(only));
}

if (import.meta.main) {
  const argv = process.argv.slice(2), flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const app = argv.find((a) => !a.startsWith("-") && a !== flag("--only") && a !== flag("--out"));
  if (!app) { console.error("usage: bun run shots <app> [--only <name>] [--out <dir>]"); process.exit(2); }
  const root = resolve(import.meta.dir, ".."), out = resolve(flag("--out") ?? join(root, "apps", app, "docs", `shots-${new Date().toISOString().slice(0, 10)}`));
  mkdirSync(out, { recursive: true });
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(join(root, "apps", app))]);
  try {
    // The scenes come from the page itself.
    const first = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, first, vite.url, 2500);
    const scenes = await first.eval<string[]>(`globalThis.__scenes?.list() ?? []`);
    await first.close();
    const shots = plan(app, scenes, flag("--only") ?? "");
    for (const [size, s] of Object.entries(SIZES)) for (const sh of shots) {
      const tab = await openTab(chrome.cdp, { w: s.w, h: s.h }, s.mobile);
      await tab.call("Storage.clearDataForOrigin", { origin: new URL(vite.url).origin, storageTypes: "all" });
      await load(chrome.cdp, tab, new URL(sh.path, vite.url).href, 3000);
      const { data } = await tab.call("Page.captureScreenshot", { format: "png" });
      const file = join(out, `${sh.name}-${size}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      const noise = tab.noise.filter((n) => !n.startsWith("HTTP "));
      console.log(file, noise.length ? `\n  ${noise.join("\n  ")}` : "");
      await tab.close();
    }
    console.log(`${shots.length} shots x ${Object.keys(SIZES).length} sizes in ${out}`);
  } finally {
    chrome.stop(); vite.stop();
  }
}

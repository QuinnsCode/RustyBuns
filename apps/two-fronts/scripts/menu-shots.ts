// The menus, shot the same way every round of the menu climb (#3531): title, lobby, panel, line-up, settings and
// vote, on a desk, a tablet and a phone, from one dev server and one headless Chrome (scripts/chrome.ts, what
// `bun run probe` runs on). `bun scripts/menu-shots.ts <dir>` writes <dir>/<screen>-<desk|tablet|phone>.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const out = resolve(process.argv[2] ?? "shots");
mkdirSync(out, { recursive: true });
const SIZES = { desk: { w: 1280, h: 800, mobile: false }, tablet: { w: 820, h: 1180, mobile: true }, phone: { w: 390, h: 844, mobile: true } };
const click = (sel: string) => `document.querySelector(${JSON.stringify(sel)})?.click()`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Each screen: the address to open fresh (empty storage), then a script that brings the screen up.
// A war starts on the fleet chooser (the line-up), so the other screens take a fleet first.
const fleet = click('[data-preset="line"]');
const SCREENS: { name: string; path: string; js?: string }[] = [
  { name: "title", path: "/" },
  { name: "lineup", path: "/?war=short&side=marines&vs=ai" },
  { name: "panel", path: "/?war=short&side=marines&vs=ai", js: fleet },
  { name: "lobby", path: "/?war=short&side=marines&vs=ai", js: `${fleet}; ${click("#restart")}` },
  { name: "settings", path: "/?war=short&side=marines&vs=ai", js: `${fleet}; ${click(".gc-cog")}` },
  { name: "vote", path: "/?war=short&side=marines&vs=ai", js: `(async () => { ${fleet}; const { voteScreen } = await import("/src/ui/vote.ts");
      voteScreen(document.getElementById("vote"), { title: "Next match", text: "Everyone gets one vote for how the next ground battle is fought.",
        seats: [{ faction: "marines", who: "here" }, { faction: "wooka", who: "ai", vote: "assault" }], cast() {}, done() {} }); })()` },
];

const [chrome, vite] = await Promise.all([launchChrome(), startVite(resolve(import.meta.dir, ".."))]);
try {
  for (const [size, s] of Object.entries(SIZES)) {
    for (const sc of SCREENS) {
      const tab = await openTab(chrome.cdp, { w: s.w, h: s.h }, s.mobile);
      await tab.call("Storage.clearDataForOrigin", { origin: new URL(vite.url).origin, storageTypes: "all" });
      await load(chrome.cdp, tab, new URL(sc.path, vite.url).href, 2500);
      if (sc.js) { await tab.eval(sc.js); await sleep(600); }
      const { data } = await tab.call("Page.captureScreenshot", { format: "png" });
      const file = join(out, `${sc.name}-${size}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      const noise = tab.noise.filter((n) => !n.startsWith("HTTP "));
      console.log(file, noise.length ? `\n  ${noise.join("\n  ")}` : "");
      await tab.close();
    }
  }
} finally {
  chrome.stop(); vite.stop();
}

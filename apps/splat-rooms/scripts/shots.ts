// Every screen of Splat Rooms at phone and desktop size, for a look round's before/after shots.
// Start the host headless first (it builds the page and serves your scenes):
//   RB_NO_BROWSER=1 RB_TOKEN=shot bunx rustybuns run desktop
// then: bun scripts/shots.ts --url http://127.0.0.1:<port> --out docs/shots-<date> --name now [--room 0001_839920]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const url = arg("url", ""), out = arg("out", "docs/shots"), name = arg("name", "now"), room = arg("room", "0001_839920");
if (!url) { console.error("usage: bun scripts/shots.ts --url <host url> [--out dir] [--name now] [--room id]"); process.exit(2); }

const SIZES = [{ tag: "desktop", w: 1280, h: 800, mobile: false }, { tag: "phone", w: 390, h: 844, mobile: true }];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Click the first button whose text starts with `text`. */
const click = (tab: Tab, text: string) => tab.eval(`(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); b?.click(); return !!b; })()`);
const until = async (tab: Tab, expr: string, ms = 60_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(400)) if (await tab.eval(expr).catch(() => false)) return true; return false; };

await mkdir(out, { recursive: true });
const chrome = await launchChrome();
try {
  for (const s of SIZES) {
    const tab = await openTab(chrome.cdp, { w: s.w, h: s.h }, s.mobile);
    const shot = async (screen: string) => {
      const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 72 });
      const file = join(out, `${name}-${screen}-${s.tag}.jpg`);
      await Bun.write(file, Buffer.from(data, "base64"));
      console.log(file);
    };
    const home = async () => { await load(chrome.cdp, tab, new URL("/?token=shot", url).href, 1500); await until(tab, `!document.body.textContent.includes("Looking for scenes")`, 10_000); };

    await home(); await shot("menu");
    await tab.eval(`document.querySelector(".gc-cog")?.click()`); await wait(400); await shot("controls");
    await home(); await click(tab, "How to play"); await wait(300); await shot("howto");
    await home(); await click(tab, "Choose a room"); await wait(300); await shot("rooms");
    await home(); await click(tab, "Room browser"); await wait(500);
    await tab.eval(`splatRooms.open(${JSON.stringify(room)})`); await wait(6000); await shot("browser");
    await home(); await click(tab, "Choose a room"); await wait(300);
    await tab.eval(`[...document.querySelectorAll(".room-card")].find((b) => b.textContent.includes(${JSON.stringify(room)}))?.click()`);
    if (!await until(tab, `window.splatHunt?.state().phase === "hunting"`)) console.log(`${s.tag}: the hunt never started`);
    await tab.eval(`splatHunt.fire(8)`); await wait(1500); await shot("hunt");
    await tab.eval(`splatHunt.pause()`); await wait(300); await shot("paused");
    await tab.eval(`splatHunt.resume()`); await wait(200); await tab.eval(`splatHunt.find()`); await wait(1500); await shot("won");
    if (tab.noise.length) console.log(`noise (${s.tag}):\n  ${[...new Set(tab.noise)].slice(0, 8).join("\n  ")}`);
    await tab.close();
  }
} finally { chrome.stop(); }

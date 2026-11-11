// Shots of every eqosys surface in each game's skin, for the skin climb (#4148): the account chip, party lobby and spaces
// panel up top, the achievement toast, and the report form, open, at phone size (open, and shut to see the panels) and desktop size, over the game's own stylesheet.
//   bun packages/util/scripts/skin-shots.ts <dir> [prefix]   writes <dir>/<prefix>-<game>-<phone|phone-panels|desktop>.jpg
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { GAMES, skinServer } from "../test/skin-server.ts";

const [dir = "shots", prefix = "now"] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const server = await skinServer({ fonts: true }), chrome = await launchChrome();
try {
  for (const game of [...Object.keys(GAMES), "house"]) {
    for (const [size, w, h, mobile, more] of [["phone", 390, 844, true, ""], ["phone-panels", 390, 844, true, "&closed"], ["desktop", 1280, 800, false, ""]] as const) {
      const tab = await openTab(chrome.cdp, { w, h }, mobile);
      await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await load(chrome.cdp, tab, `http://127.0.0.1:${server.port}/${game === "house" ? "?house" : `?game=${game}`}${more}`, 1500);
      const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 80 });
      const file = join(dir, `${prefix}-${game}-${size}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log(file);
      await tab.close();
    }
  }
} finally { chrome.stop(); server.stop(true); }

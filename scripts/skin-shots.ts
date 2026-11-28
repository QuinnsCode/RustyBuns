// Shots of every eqosys surface in each skin, for a round of the skin climb (#4274): the house look, Two Fronts, Mythic
// Masters and Skate Tech Park, at phone (390x844, 2x) and desktop (1024x700) size, plus the account chip close up at 1x
// and 3x so the badge can be compared across screens. JPEGs land in the folder you name.
//
//   bun scripts/skin-shots.ts packages/util/docs/shots-2026-11-15-round9 before
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { help } from "./help.ts";
import { launchChrome, load, openTab } from "./chrome.ts";
import { skinServer } from "../packages/util/test/skin-server.ts";

help(import.meta.path);
const [dir, tag = "now"] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun scripts/skin-shots.ts <dir> [tag]");
mkdirSync(dir, { recursive: true });

const server = await skinServer({ fonts: true });
const chrome = await launchChrome();
const shoot = async (file: string, query: string, size: { w: number; h: number }, o: { mobile?: boolean; scale?: number; clip?: string } = {}) => {
  const tab = await openTab(chrome.cdp, size, o.mobile);
  if (o.scale) await tab.call("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: o.scale, mobile: false });
  await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await load(chrome.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 1500);
  const clip = o.clip ? await tab.eval<{ x: number; y: number; width: number; height: number }>(`(() => { const r = document.querySelector(${JSON.stringify(o.clip)}).getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`) : undefined;
  const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  await Bun.write(join(dir, `${tag}-${file}.jpg`), Buffer.from(data, "base64"));
  await tab.close();
};

try {
  for (const [name, query] of [["house", "?house"], ["two-fronts", "?game=two-fronts"], ["mythic-masters", "?game=mythic-masters"], ["skate-tech-park", "?game=skate-tech-park"]] as const) {
    await shoot(`${name}-desktop`, query, { w: 1024, h: 700 });
    await shoot(`${name}-phone`, query, { w: 390, h: 844 }, { mobile: true });
    await shoot(`${name}-phone-panels`, `${query}&closed`, { w: 390, h: 844 }, { mobile: true });
    for (const scale of [1, 3]) await shoot(`${name}-chip-${scale}x`, `${query}&closed`, { w: 1024, h: 700 }, { scale, clip: ".eq-chip" });
  }
} finally {
  chrome.stop();
  server.stop(true);
}
console.log(`shots in ${dir}`);

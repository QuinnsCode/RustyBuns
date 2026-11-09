// A game skins every eqosys surface once (`eqosys({ ..., skin })`, src/skin.ts): in a real page, the account chip, the
// report form, the achievement toast, the party lobby and the spaces panel all wear its tokens and extra rules, and with no skin they wear the house tokens, dark ones on a dark system.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { TOKENS } from "@rustybuns/ui";
import { chromePath, launchChrome, load, openTab } from "../../../scripts/chrome.ts";

setDefaultTimeout(60_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "skin-page.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => new URL(req.url).pathname === "/page.js"
  ? new Response(script, { headers: { "content-type": "text/javascript" } })
  : new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } }) });
let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
beforeAll(async () => { if (chromePath()) chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); server.stop(true); });

type Look = { bg: string; border: string; radius: string; font: string };
const looks = async (query: string, dark = false) => {
  const tab = await openTab(chrome!.cdp, { w: 1024, h: 700 });
  await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 300);
  const got = await tab.eval<{ surfaces: Record<string, Look>; who: string; noise: number }>(`(() => {
    const look = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius, font: s.fontFamily }; };
    return { surfaces: { chip: look(".eq-chip"), form: look(".rb-report .eq-form"), toast: look(".eq-toast"), lobby: look(".rb-lobby"), spaces: look(".rb-spaces") }, who: getComputedStyle(document.querySelector(".eq-who")).textTransform };
  })()`);
  await tab.close();
  return got;
};

test.skipIf(!chromePath())("a skin's tokens land on the chip, report form, toast, lobby and spaces; no skin is the house look, light or dark", async () => {
  const skinned = await looks("");
  for (const [name, l] of Object.entries(skinned.surfaces)) expect({ name, ...l }).toEqual({ name, bg: "rgb(28, 33, 40)", border: "rgb(156, 122, 42)", radius: "1px", font: "Courier" });
  expect(skinned.who).toBe("uppercase");
  const house = await looks("?house");
  for (const [name, l] of Object.entries(house.surfaces)) expect({ name, bg: l.bg, radius: l.radius }).toEqual({ name, bg: "rgb(255, 255, 255)", radius: name === "chip" ? TOKENS["--ui-radius-sm"] : TOKENS["--ui-radius"] });
  // The house look follows a dark system; a game's own skin doesn't.
  for (const [name, l] of Object.entries((await looks("?house", true)).surfaces)) expect({ name, bg: l.bg }).toEqual({ name, bg: "rgb(23, 23, 26)" });
  for (const [name, l] of Object.entries((await looks("", true)).surfaces)) expect({ name, bg: l.bg }).toEqual({ name, bg: "rgb(28, 33, 40)" });
});

// #3069: at phone width the worded corner button sat on games' bottom-row controls; there it is a flag alone, and its form still fits.
test.skipIf(!chromePath())("the Report button is a small flag at phone width, worded on a desktop, and its form opens on screen", async () => {
  const corner = async (w: number, h: number) => {
    const tab = await openTab(chrome!.cdp, { w, h }, w < 600);
    await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/`, 300);
    const got = await tab.eval<{ button: number[]; form: number[] }>(`(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      return { button: rect(document.querySelector(".rb-report > .eq-btn")), form: rect(document.querySelector(".rb-report .eq-form")) };
    })()`);
    await tab.close();
    return got;
  };
  const phone = await corner(390, 844);
  expect(phone.button).toEqual([342, 796, 378, 832]);
  const [l, t, r, b] = phone.form;
  expect(l >= 0 && t >= 0 && r <= 390 && b <= 844).toBe(true);
  const desk = await corner(1024, 700);
  expect(desk.button[2]! - desk.button[0]!).toBeGreaterThan(60);
});

// A game skins every eqosys surface once (`eqosys({ ..., skin })`, src/skin.ts): in a real page, the account chip, the
// report form, the achievement toast, the party lobby and the spaces panel all wear its tokens and extra rules, and with no skin they wear the house tokens, dark ones on a dark system.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { TOKENS } from "@rustybuns/ui";
import { chromePath, launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { skinServer } from "./skin-server.ts";

setDefaultTimeout(60_000);

const server = await skinServer();
let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
beforeAll(async () => { if (chromePath()) chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); server.stop(true); });

type Look = { bg: string; image: string; border: string; radius: string; font: string };
const looks = async (query: string, dark = false) => {
  const tab = await openTab(chrome!.cdp, { w: 1024, h: 700 });
  await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 300);
  const got = await tab.eval<{ surfaces: Record<string, Look>; who: string; fits: { select: boolean; members: boolean } }>(`(() => {
    const look = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, image: s.backgroundImage, border: s.borderTopColor, radius: s.borderTopLeftRadius, font: s.fontFamily }; };
    return { surfaces: { chip: look(".eq-chip"), form: look(".rb-report .eq-form"), toast: look(".eq-toast"), lobby: look(".rb-lobby"), spaces: look(".rb-spaces") }, who: getComputedStyle(document.querySelector(".eq-who")).textTransform,
      // A game page's own rules stop at the surfaces: the form's Kind is as wide as its other fields, and the member column's buttons stay inside the panel.
      fits: { select: document.querySelector(".rb-report select").offsetWidth === document.querySelector(".rb-report input").offsetWidth,
        members: [...document.querySelectorAll(".rb-spaces-online .eq-btn")].every((b) => b.getBoundingClientRect().right <= document.querySelector(".rb-spaces").getBoundingClientRect().right) } };
  })()`);
  await tab.close();
  return got;
};

test.skipIf(!chromePath())("a skin's tokens land on the chip, report form, toast, lobby and spaces; no skin is the house look, light or dark", async () => {
  const skinned = await looks("");
  for (const [name, l] of Object.entries(skinned.surfaces)) expect({ name, bg: l.bg, border: l.border, radius: l.radius, font: l.font }).toEqual({ name, bg: "rgb(28, 33, 40)", border: "rgb(156, 122, 42)", radius: "1px", font: "Courier" });
  expect(skinned.who).toBe("uppercase");
  const house = await looks("?house");
  for (const [name, l] of Object.entries(house.surfaces)) expect({ name, bg: l.bg, radius: l.radius }).toEqual({ name, bg: "rgb(255, 255, 255)", radius: name === "chip" ? TOKENS["--ui-radius-sm"] : TOKENS["--ui-radius"] });
  // The house look follows a dark system; a game's own skin doesn't.
  for (const [name, l] of Object.entries((await looks("?house", true)).surfaces)) expect({ name, bg: l.bg }).toEqual({ name, bg: "rgb(23, 23, 26)" });
  for (const [name, l] of Object.entries((await looks("", true)).surfaces)) expect({ name, bg: l.bg }).toEqual({ name, bg: "rgb(28, 33, 40)" });
});

// #4148: a real game's skin points at its own stylesheet (var(--plate), var(--paper), var(--f-book)); over that stylesheet,
// its paper or plate and its face reach every surface, under a texture where the game lays one (the colour is in the image).
test.skipIf(!chromePath())("each game's own paper and face land on the chip, report form, toast, lobby and spaces, and its page rules stay out", async () => {
  const games = [
    ["two-fronts", "rgb(23, 28, 35)", `"Share Tech Mono", ui-monospace, monospace`],
    ["mythic-masters", "rgb(232, 217, 181)", `"IM Fell English", Georgia, "Times New Roman", serif`],
    ["skate-tech-park", "rgb(251, 247, 240)", "system-ui, sans-serif"],
  ] as const;
  for (const [game, paper, face] of games) {
    const got = await looks(`?game=${game}`);
    expect({ game, ...got.fits }).toEqual({ game, select: true, members: true });
    for (const [name, l] of Object.entries(got.surfaces)) {
      expect({ game, name, paper: l.bg === paper || l.image.includes(paper), font: l.font }).toEqual({ game, name, paper: true, font: face });
    }
  }
});

// #3600: eqosys's badge is its own mark: the same pixels on the report form and the toast whatever a game's skin does.
test.skipIf(!chromePath())("the eqosys badge looks the same in Two Fronts, Mythic Masters, Skate Tech Park and the house look", async () => {
  const badges = async (query: string) => {
    const tab = await openTab(chrome!.cdp, { w: 1024, h: 700 });
    await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 300);
    const got = await tab.eval<unknown[]>(`[".rb-report .eq-badge", ".eq-toast .eq-badge"].map((sel) => {
      const look = (el, keys) => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), ...keys.map((k) => s[k])]; };
      const b = document.querySelector(sel);
      return [look(b, ["borderRadius", "boxShadow", "opacity"]), look(b.querySelector("b"), ["backgroundImage", "color", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "textTransform"]), look(b.querySelector("i"), ["filter"])];
    })`);
    await tab.close();
    return got;
  };
  const house = await badges("?house");
  expect(house[0]).toEqual(house[1]);
  for (const game of ["two-fronts", "mythic-masters", "skate-tech-park"]) expect({ game, badge: await badges(`?game=${game}`) }).toEqual({ game, badge: house });
});

// #3069: at phone width the worded corner button sat on games' bottom-row controls; there it is a flag alone, and its form still fits.
test.skipIf(!chromePath())("the Report button is a small flag at phone width, worded on a desktop, and its form opens on screen", async () => {
  const corner = async (w: number, h: number) => {
    const tab = await openTab(chrome!.cdp, { w, h }, w < 600);
    await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/`, 300);
    const got = await tab.eval<{ button: number[]; form: number[]; flag: boolean; closed: boolean }>(`(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
      const flag = document.querySelector(".rb-report > .eq-btn"), form = document.querySelector(".rb-report .eq-form");
      form.hidden = true;
      const button = rect(flag);
      flag.click();
      const open = { form: rect(form), flag: flag.getBoundingClientRect().width > 0 };
      form.querySelector(".eq-head .eq-btn").click();
      return { button, ...open, closed: form.hidden };
    })()`);
    await tab.close();
    return got;
  };
  const phone = await corner(390, 844);
  expect(phone.button).toEqual([342, 796, 378, 832]);
  // Open on a phone, the form is a sheet across the bottom, under half the screen, the flag gives way and Close shuts it.
  const [l, t, r, b] = phone.form;
  expect([l, r, b]).toEqual([0, 390, 844]);
  expect(t).toBeGreaterThan(844 / 2);
  expect(phone.flag).toBe(false);
  expect(phone.closed).toBe(true);
  const desk = await corner(1024, 700);
  expect(desk.button[2]! - desk.button[0]!).toBeGreaterThan(60);
});

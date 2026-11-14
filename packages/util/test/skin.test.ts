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
  const got = await tab.eval<{ surfaces: Record<string, Look>; who: string; fits: { select: boolean; members: boolean; chip: boolean; lobby: boolean } }>(`(() => {
    const look = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, image: s.backgroundImage, border: s.borderTopColor, radius: s.borderTopLeftRadius, font: s.fontFamily }; };
    return { surfaces: { chip: look(".eq-chip"), form: look(".rb-report .eq-form"), toast: look(".eq-toast"), lobby: look(".rb-lobby"), spaces: look(".rb-spaces") }, who: getComputedStyle(document.querySelector(".eq-who")).textTransform,
      // A game page's own rules stop at the surfaces: the form's Kind is as wide as its other fields, and the member column's buttons stay inside the panel.
      fits: { select: document.querySelector(".rb-report select").offsetWidth === document.querySelector(".rb-report input").offsetWidth,
        members: [...document.querySelectorAll(".rb-spaces-online .eq-btn")].every((b) => b.getBoundingClientRect().right <= document.querySelector(".rb-spaces").getBoundingClientRect().right),
        // The chip is a tag the size of its name and button, lifted off the page like the panels, not a bar across the column.
        chip: (() => { const c = document.querySelector(".eq-chip.in"); return c.offsetWidth < c.parentElement.parentElement.clientWidth / 2 && getComputedStyle(c).boxShadow !== "none"; })(),
        // The lobby reads "Party KRTZ: Ada (host), Grace ready" on one line, and Start, Copy link and Settings share the row under it.
        lobby: (() => { const who = document.querySelector(".rb-lobby-who"), rows = new Set([...document.querySelectorAll(".rb-lobby > .eq-btn")].map((b) => { const r = b.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); }));
          return who.getClientRects().length === 1 && who.offsetHeight < 2 * parseFloat(getComputedStyle(who).lineHeight) && rows.size === 1; })() } };
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
// Two Fronts' chip is the one exception it chose: a brass tag (#4210), so its "paper" there is the brass.
test.skipIf(!chromePath())("each game's own paper and face land on the chip, report form, toast, lobby and spaces, and its page rules stay out", async () => {
  const games = [
    ["two-fronts", "rgb(23, 28, 35)", `"Share Tech Mono", ui-monospace, monospace`, "rgb(216, 168, 63)"],
    ["mythic-masters", "rgb(232, 217, 181)", `"IM Fell English", Georgia, "Times New Roman", serif`],
    ["skate-tech-park", "rgb(251, 247, 240)", "system-ui, sans-serif"],
  ] as const;
  for (const [game, plain, face, chip] of games as readonly (readonly [string, string, string, string?])[]) {
    const got = await looks(`?game=${game}`);
    expect({ game, ...got.fits }).toEqual({ game, select: true, members: true, chip: true, lobby: true });
    for (const [name, l] of Object.entries(got.surfaces)) {
      const paper = name === "chip" && chip ? chip : plain;
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
    const got = await tab.eval<unknown[]>(`[".rb-report .eq-badge", ".eq-toast .eq-badge", ".eq-chip .eq-badge"].map((sel) => {
      const look = (el, keys) => { const s = getComputedStyle(el); return [el.offsetWidth, el.offsetHeight, ...keys.map((k) => s[k])]; };
      const b = document.querySelector(sel);
      return [look(b, ["borderRadius", "boxShadow", "opacity"]), look(b.querySelector("b"), ["backgroundImage", "color", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "textTransform"]), look(b.querySelector("i"), ["filter"])];
    })`);
    await tab.close();
    return got;
  };
  const house = await badges("?house");
  expect(house[1]).toEqual(house[0]);
  expect(house[2]).toEqual(house[0]);
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

// The chip folds into its badge and back, the parts gliding over a state that already changed; a lobby member's dot pops
// once as they turn ready. All of it is done moving a moment later, and under reduced motion nothing moves at all.
test.skipIf(!chromePath())("the chip folds into its badge and back, a dot lights as someone turns ready, and nothing keeps moving", async () => {
  const run = async (reduce: boolean) => {
    const tab = await openTab(chrome!.cdp, { w: 390, h: 844 }, true);
    await tab.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
    await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/?game=skate-tech-park&closed`, 300);
    const got = await tab.eval<Record<string, unknown>>(`(async () => {
      const chip = document.querySelector(".eq-chip"), parts = () => [...chip.querySelectorAll("[data-part]")].map((p) => p.dataset.part).join(" ");
      const moving = (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running" && a.effect.getTiming().iterations !== Infinity).length;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const open = parts();
      chip.querySelector(".eq-fold").click();
      const folded = { parts: parts(), expanded: chip.querySelector(".eq-fold").getAttribute("aria-expanded"), frame: chip.classList.contains("in"), kept: localStorage.getItem("eq.chip.folded"), moving: moving(chip) };
      await wait(450);
      const settled = moving(chip) + chip.querySelectorAll(":scope > :not([data-part])").length;
      chip.querySelector(".eq-fold").click();
      const back = { parts: parts(), frame: chip.classList.contains("in"), kept: localStorage.getItem("eq.chip.folded") };
      members([{ id: "a", name: "Ada", host: true, ready: true }, { id: "b", name: "Grace", host: false, ready: false }]);
      members([{ id: "a", name: "Ada", host: true, ready: true }, { id: "b", name: "Grace", host: false, ready: true }]);
      const lit = [...document.querySelectorAll(".rb-lobby-m.lit")].map((m) => m.firstChild.textContent);
      await wait(450);
      const still = moving(document.querySelector(".rb-lobby")) + moving(chip);
      // Folded, then signed out: Sign in still shows beside the badge, which is only a mark there.
      localStorage.setItem("eq.chip.folded", "1");
      chip.querySelector("[data-part=act]").click();
      const out = { parts: parts(), folds: !!chip.querySelector(".eq-fold"), word: chip.querySelector("[data-part=act]")?.textContent };
      localStorage.removeItem("eq.chip.folded");
      return { open, folded, settled, back, lit, still, out };
    })()`);
    await tab.close();
    return got;
  };
  const moved = await run(false);
  expect(moved).toMatchObject({ open: "badge who act", folded: { parts: "badge", expanded: "false", frame: true, kept: "1" }, settled: 0, back: { parts: "badge who act", frame: true, kept: null }, lit: ["Grace"], still: 0, out: { parts: "badge act", folds: false, word: "Sign in" } });
  expect((moved.folded as { moving: number }).moving).toBeGreaterThan(0);
  const calm = await run(true);
  expect((calm.folded as { moving: number }).moving).toBe(0);
});

test.skipIf(!chromePath())("the lobby's voice row: join, see who is talking, mute yourself, hang up", async () => {
  const tab = await openTab(chrome!.cdp, { w: 390, h: 844 }, true);
  await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/?closed`, 300);
  const got = await tab.eval<Record<string, unknown>>(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = () => document.querySelector(".rb-lobby-voice"), btn = (label) => row().querySelector(\`[aria-label="\${label}"]\`);
    members([{ id: "a", name: "Ada", host: true, ready: true }, { id: "b", name: "Grace", host: false, ready: true, voice: true }]);
    const before = row().querySelector("p").textContent;
    btn("Join voice").click();
    await wait(50);
    const speakers = [...row().querySelectorAll("li")].map((li) => li.textContent + (li.classList.contains("talking") ? " (talking)" : ""));
    btn("Mute yourself").click();
    const muted = call.selfMuted && !!btn("Unmute yourself");
    btn("Leave voice").click();
    return { before, speakers, muted, left: call.left, said: voiceSaid.join(), after: !!btn("Join voice") };
  })()`);
  await tab.close();
  expect(got).toEqual({ before: "In voice: Grace", speakers: ["Ada", "Grace (talking)"], muted: true, left: true, said: "in,out", after: true });
});

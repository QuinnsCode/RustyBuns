// Settings' music and Display tab: the Book's score is the same every time and each cue sounds its own (src/music.ts),
// what the rows ask of the view (src/display.ts), and one journey through the running app: the first key wakes the
// music, the Music slider and switch reach the player's gain, a quality picked by hand applies and survives a reload,
// Auto forgets it, and a save in the wrong shape loads as the defaults.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { DEFAULTS, parseSettings, volumeOf } from "@rustybuns/game-controls";
import { pickQuality, STORE_KEY } from "@rustybuns/util/quality";
import { musicLevel, phrase, SCORE, sting, type Cue } from "../src/music.ts";
import { choose, looksOf, startChoice } from "../src/display.ts";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(300_000);

const CUES = Object.keys(SCORE) as Cue[];
const bars = (cue: Cue, seed: number, lift = false) => Array.from({ length: 8 }, (_, b) => phrase(cue, b, seed, lift));

describe("the score", () => {
  test("is the same notes for the same seed, and another seed writes another tune", () => {
    for (const cue of CUES) {
      expect(bars(cue, 7)).toEqual(bars(cue, 7));
      expect(bars(cue, 7).flat().length).toBeGreaterThan(0);
    }
    expect(bars("book", 7)).not.toEqual(bars("book", 8));
  });

  test("each cue is its own: its pitches, its voices, and how busy it is", () => {
    const sig = (cue: Cue) => JSON.stringify(bars(cue, 7).flat().map((n) => [n.midi, n.voice]));
    expect(new Set(CUES.map(sig)).size).toBe(CUES.length);
    const perBar = (cue: Cue) => bars(cue, 7).flat().length / 8;
    // the world leaves room for the wilds; a fight drives; its last stretch drives harder
    expect(perBar("day")).toBeLessThan(perBar("book"));
    expect(perBar("night")).toBeLessThan(perBar("book"));
    expect(perBar("fight")).toBeGreaterThan(perBar("book") * 2);
    expect(bars("fight", 7, true).flat().length).toBeGreaterThan(bars("fight", 7).flat().length);
    expect(bars("fight", 7).flat().some((n) => n.voice === "drum")).toBe(true);
    // every note sits inside its bar's time and the hearing range
    for (const cue of CUES) for (const n of bars(cue, 3).flat()) {
      expect(n.at).toBeGreaterThanOrEqual(0); expect(n.at).toBeLessThan(SCORE[cue].beats);
      expect(n.midi).toBeGreaterThan(20); expect(n.midi).toBeLessThan(110);
    }
  });

  test("a win, a loss and a bind each have a sting of their own", () => {
    const s = (["win", "loss", "bind"] as const).map((k) => JSON.stringify(sting(k, 7)));
    expect(new Set(s).size).toBe(3);
    expect(sting("win", 7)).toEqual(sting("win", 7));
  });

  test.each([
    ["shipped", {}, false, 1],
    ["the slider down", { music: 0 }, false, 0],
    ["Music on switched off", { musicOn: false }, false, 0],
    ["the slider halfway", { music: 0.5 }, false, 0.5],
    ["under the Settings card", {}, true, 0.35],
  ] as const)("the player's level: %s", (_n, s, ducked, want) => {
    expect(musicLevel(volumeOf({ ...DEFAULTS, ...s }, "music"), ducked)).toBeCloseTo(want);
  });
});

describe("the Display rows", () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
  const machine = { gpu: "Apple M2", webgl2: true, memory: 16, cores: 8 };

  test("a tier picked by hand is where the next load starts; Auto forgets it and the machine's guess is back", () => {
    const st = store();
    choose("low", st);
    expect(startChoice({ search: "", store: st, machine })).toEqual({ tier: "low", choice: "low" });
    choose("auto", st);
    expect(st.getItem(STORE_KEY)).toBeNull();
    expect(startChoice({ search: "", store: st, machine })).toEqual({ tier: pickQuality({ search: "", store: null, machine }).quality, choice: "auto" });
  });

  test("a stored quality or save in the wrong shape loads as the defaults", () => {
    const st = store();
    st.setItem(STORE_KEY, "ultra");
    expect(startChoice({ search: "", store: st, machine }).choice).toBe("auto");
    const s = parseSettings({ music: "loud", musicOn: "yes", brightness: 9, more: { bloom: "on", shake: "lots", reduceMotion: 1 } });
    expect([s.music, s.musicOn, s.brightness]).toEqual([1, true, 1.5]);
    expect(looksOf(s, false)).toEqual({ brightness: 1.5, shake: 1, still: false, bloom: true });
  });

  test.each([
    ["shipped", {}, false, { shake: 1, still: false, bloom: true }],
    ["shake halved, bloom off", { shake: 0.5, bloom: false }, false, { shake: 0.5, still: false, bloom: false }],
    ["Reduce motion: still pages and a steady camera", { reduceMotion: true }, false, { shake: 0, still: true, bloom: true }],
    ["the OS asks for less motion", {}, true, { shake: 0, still: true, bloom: true }],
  ] as const)("looks: %s", (_n, more, os, want) => {
    expect(looksOf({ ...DEFAULTS, more: { ...more } }, os)).toMatchObject(want);
  });
});

test.skipIf(!chromePath())("in the running app: the music wakes on a key and follows Settings; a quality pick survives a reload", async () => {
  // no sound out of the test machine's speakers, and no wait on the autoplay rules (a headless key press may not count as a gesture)
  const [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required"]), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 }, false, true);
    await load(chrome.cdp, tab, vite.url, 1500);
    type Music = { cue: string; playing: boolean; volume: number; gain: number };
    type Q = { now: string; choice: string; pixelRatio: number; shadows: boolean };
    const music = () => tab.eval<Music>("mythicMasters.music()");
    const quality = () => tab.eval<Q>("mythicMasters.quality()");
    const until = async (what: string, ok: () => Promise<boolean>, ms = 20_000) => {
      for (const end = Date.now() + ms; !(await ok()); await Bun.sleep(100)) if (Date.now() > end) throw new Error(`never saw ${what}: ${JSON.stringify(await music())}`);
    };
    // the panel's own inputs, moved as a hand would: a slider dragged, a box ticked, a button pressed
    const slide = (name: string, v: number) => tab.eval(`(() => { const i = document.querySelector('.gc-dialog input[name="${name}"]'); i.value = "${v}"; i.dispatchEvent(new Event("input")); })()`);
    const tick = (name: string, on: boolean) => tab.eval(`(() => { const i = document.querySelector('.gc-dialog input[name="${name}"]'); i.checked = ${on}; i.dispatchEvent(new Event("change")); })()`);
    const press = (name: string) => tab.eval(`document.querySelector('.gc-dialog button[name="${name}"]').click()`);

    // Silent until a key: then the Book's cue plays at full Music volume.
    expect((await music()).playing).toBe(false);
    await tab.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
    await tab.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
    await until("the music playing", async () => (await music()).playing && (await music()).gain > 0.4);
    expect((await music()).cue).toBe("book");

    // Settings open: the music ducks under the card; the slider at 0 silences the gain, raised it comes back.
    await tab.eval("mythicMasters.settings(true)");
    await until("the duck", async () => (await music()).volume < 0.5);
    await slide("music", 0);
    await until("silence", async () => (await music()).gain < 0.01);
    expect((await music()).playing).toBe(false);
    await slide("music", 0.8);
    await until("the raised slider heard", async () => (await music()).gain > 0.1);
    await tick("musicOn", false);
    await until("Music on off", async () => (await music()).gain < 0.01);
    await tick("musicOn", true);
    await tab.eval("mythicMasters.settings(false)");
    await until("back up after Settings shut", async () => Math.abs((await music()).volume - 0.8) < 0.01);
    // a fight's cue, held for the harness, takes over from the Book's
    await tab.eval(`mythicMasters.music("fight")`);
    await until("the fight cue", async () => (await music()).cue === "fight");

    // Quality: Low applies now (pixel ratio and shadows) and is where the next load starts; Auto forgets it.
    await tab.eval("mythicMasters.settings(true)");
    await press("quality-low");
    expect(await quality()).toMatchObject({ now: "low", choice: "low", pixelRatio: 1, shadows: false });
    await load(chrome.cdp, tab, vite.url, 1500);
    expect(await quality()).toMatchObject({ now: "low", choice: "low" });
    await tab.eval("mythicMasters.settings(true)");
    await press("quality-auto");
    expect((await quality()).choice).toBe("auto");
    await load(chrome.cdp, tab, vite.url, 1500);
    expect((await quality()).choice).toBe("auto");

    // A save in the wrong shape: the defaults, and Auto.
    await tab.eval(`localStorage.setItem("mythic-masters.controls", JSON.stringify({ music: "loud", musicOn: 3, more: { bloom: "yes" } })); localStorage.setItem("${STORE_KEY}", "ultra")`);
    await load(chrome.cdp, tab, vite.url, 1500);
    expect(await tab.eval<unknown>("(() => { const q = mythicMasters.quality(); return { choice: q.choice, bloom: q.looks.bloom }; })()")).toEqual({ choice: "auto", bloom: true });
    await tab.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
    await until("the music at the default volume", async () => (await music()).volume === 1);
    expect(tab.noise.filter((n) => n.startsWith("uncaught"))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop();
  }
});

// Every game with page commands answers `<prefix>_how_to_play` on its landing: an agent new to the game reads the
// goal, the controls on a computer and on a phone, and the first step from the words the page shows a person.
// Each app's own dev server, one headless Chrome, the command called through window.__commands as an agent would.
import { expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "./chrome.ts";

setDefaultTimeout(600_000);

const GAMES = [
  ["mythic-masters", "mm"], ["two-fronts", "tf"], ["alien-disc-golf", "golf"], ["skate-tech-park", "skate"],
  ["park-hide-seek", "phs"], ["git-recon", "recon"], ["delayed-reaction", "dr"],
] as const;

type HowTo = { goal: string; desktop: string; phone: string; first: string; steps?: { title: string }[] };

test.skipIf(!chromePath())("each game's landing says how to play: goal, computer and phone controls, first step", async () => {
  const chrome = await launchChrome();
  const said: Record<string, HowTo> = {};
  try {
    for (const [app, prefix] of GAMES) {
      const vite = await startVite(join(import.meta.dir, "../apps", app));
      try {
        const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
        await load(chrome.cdp, tab, vite.url, 4000);
        said[app] = await tab.eval<HowTo>(`window.__commands.run("${prefix}_how_to_play")`);
        await tab.close();
      } finally { vite.stop(); }
    }
  } finally { chrome.stop(); }
  console.log(JSON.stringify(said, null, 1)); // what an agent reads, in the CI log
  for (const [app] of GAMES) {
    const h = said[app]!;
    for (const k of ["goal", "desktop", "phone", "first"] as const) expect({ app, k, ok: h[k].trim().length > 10 }).toEqual({ app, k, ok: true });
    expect({ app, steps: (h.steps?.length ?? 0) > 0 }).toEqual({ app, steps: true });
  }
});

// The starter (the game `bun run new-game` copies) brings its commands along: a new game has agent tools from its first run.
test.skipIf(!chromePath())("the starter's landing: how to play in the menu's words, then Play through a command", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, "../apps/starter-game"))]);
  try {
    const tab = await openTab(chrome.cdp, { w: 400, h: 800 }, true, true);
    await load(chrome.cdp, tab, vite.url, 1500);
    const run = <T>(name: string) => tab.eval<T>(`window.__commands.run(${JSON.stringify(name)})`);
    const how = await run<HowTo>("starter_game_how_to_play");
    expect(how.goal).toBe(await tab.eval<string>(`document.getElementById("goal").innerText`));
    expect(how.phone).toContain("finger");
    expect(await run<{ phase: string }>("starter_game_state")).toMatchObject({ phase: "menu" });
    expect(await run<{ phase: string }>("starter_game_start")).toMatchObject({ phase: "play", lives: 3 });
    expect(await tab.eval<boolean>(`document.getElementById("menu").hidden`)).toBe(true);
  } finally { vite.stop(); chrome.stop(); }
});

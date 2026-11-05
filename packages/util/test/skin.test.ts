// A game skins every eqosys surface once (`eqosys({ ..., skin })`, src/skin.ts): in a real page, the account chip, the
// report form, the achievement toast, the party lobby and the spaces panel all wear its tokens and extra rules, and with no skin they wear the house tokens.
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
const looks = async (query: string) => {
  const tab = await openTab(chrome!.cdp, { w: 1024, h: 700 });
  await load(chrome!.cdp, tab, `http://127.0.0.1:${server.port}/${query}`, 300);
  const got = await tab.eval<{ surfaces: Record<string, Look>; who: string; noise: number }>(`(() => {
    const look = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius, font: s.fontFamily }; };
    return { surfaces: { chip: look(".eq-chip"), form: look(".rb-report .eq-form"), toast: look(".eq-toast"), lobby: look(".rb-lobby"), spaces: look(".rb-spaces") }, who: getComputedStyle(document.querySelector(".eq-who")).textTransform };
  })()`);
  await tab.close();
  return got;
};

test.skipIf(!chromePath())("a skin's tokens land on the chip, report form, toast, lobby and spaces; no skin is the house look", async () => {
  const skinned = await looks("");
  for (const [name, l] of Object.entries(skinned.surfaces)) expect({ name, ...l }).toEqual({ name, bg: "rgb(28, 33, 40)", border: "rgb(156, 122, 42)", radius: "1px", font: "Courier" });
  expect(skinned.who).toBe("uppercase");
  const house = await looks("?house");
  for (const [name, l] of Object.entries(house.surfaces)) expect({ name, bg: l.bg, radius: l.radius }).toEqual({ name, bg: "rgb(255, 255, 255)", radius: name === "chip" ? TOKENS["--ui-radius-sm"] : TOKENS["--ui-radius"] });
});

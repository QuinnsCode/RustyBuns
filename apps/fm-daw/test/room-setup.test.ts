// Nobody is asked for a studio at the front door (#6420): a new browser's first room opens in the desert gathering, and
// after an owner picked another in a room's Settings (door.ts saveSetup) their next room opens in that one. Headless
// Chrome over CDP (scripts/chrome.ts). The room itself is never loaded: its navigation is stopped (CDP Fetch) and the
// link read off it, so the front door stays up.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(60_000); // two front-door loads and a fresh browser on CI's software GL (#5905)
useBrowser();

test.skipIf(!hasChrome)("a new room opens in the desert gathering, or in the studio its owner last picked in Settings", async () => {
  // its own browser context: a fresh browser's storage, not another test's
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
  const page = async <T>(expr: string): Promise<T> => tab.eval<T>(`(async () => (${expr}))()`);
  const links: string[] = [];
  chrome.cdp.on((m) => {
    if (m.sessionId !== tab.sessionId) return;
    if (m.method === "Fetch.requestPaused") {
      links.push(m.params.request.url);
      void tab.call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "Aborted" });
    }
  });
  await tab.call("Fetch.enable", { patterns: [{ urlPattern: "*jam.html?room=*", resourceType: "Document" }] });
  const frontDoor = async () => {
    await load(chrome.cdp, tab, `${vite.url}jam.html?quality=low`, 0);
    await until(tab, `!!window.qjam && !document.getElementById("door-lobby").hidden`, "the front door's lobby", 30_000);
  };
  /** Make a room on the front door: the studio its link names. */
  const make = async (name: string) => {
    const n = links.length;
    await page(`(() => { document.getElementById("room-name").value = ${JSON.stringify(name)}; document.getElementById("make").requestSubmit(); return 1; })()`);
    for (const end = Date.now() + 10_000; links.length === n && Date.now() < end;) await Bun.sleep(50);
    const link = links[n];
    if (!link) throw new Error(`${name}: the front door never walked to a room`);
    expect(new URL(link).searchParams.get("name")).toBe(name);
    return new URL(link).searchParams.get("studio");
  };
  try {
    await frontDoor();
    // the lobby shows no studio to pick: just the room's name and Make a room
    expect(await page<number>(`document.querySelectorAll("#door-lobby svg, #door-lobby [role=radio]").length`)).toBe(0);
    expect(await make("first jam")).toBe("desert-gathering");
    // an owner who moved a room to the console room in its Settings makes their next one there
    await page(`(localStorage.setItem("qollab-studio:setup", "console-room"), 1)`);
    await frontDoor();
    expect(await make("second jam")).toBe("console-room");
  } finally {
    if (tab.noise.length) console.log(`room-setup noise:\n  ${tab.noise.slice(0, 30).join("\n  ")}`);
    await tab.close();
  }
});

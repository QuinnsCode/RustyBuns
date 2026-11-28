// Event's start on the front door (#6551) forks, Host or Join. Join takes what the host sent (an event's link or the
// room's code) and lands the guest in that room, not on the planner; a bad entry says why and stays, in headless
// Chrome over CDP.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(240_000); // the planner and the room are 3D scenes, drawn in software on CI's runners
useBrowser();

test.skipIf(!hasChrome)("a guest joins an event by its link or code from the door", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string) => waitFor(tab, what, expr, 60_000, undefined, 100);
  const door = async () => {
    await load(chrome.cdp, tab, `${vite.url}door.html`, 0);
    await until("the door", "!!window.qdoor");
  };
  const join = (entry: string) => page(`(() => { document.querySelector(".lane a[data-join]").click(); const d = document.querySelector("#join"); d.querySelector("input").value = ${JSON.stringify(entry)}; d.querySelector("form").requestSubmit(); })()`);
  const why = () => page<string>(`document.querySelector("#join .why").textContent`);
  try {
    // the host's event, and its link
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await tab.eval(`localStorage.setItem("qollab-studio:quality", "low")`);
    await until("the planner", "!!window.qrooms && !!qrooms.state()");
    const link = await page<string>("qrooms.event().link");
    const room = new URL(link).searchParams.get("room")!;

    // both halves of Event's start are on the card
    await door();
    expect(await page<string[]>(`[...document.querySelectorAll(".lane[data-lane=event] .start a")].filter((a) => a.checkVisibility()).map((a) => a.textContent)`)).toEqual(["Host", "Join"]);
    // a bad entry says why, and the guest stays on the door
    for (const [entry, says] of [["tuesday", /isn't a code/], ["https://example.com/jam.html?room=a-b", /another site/], [`${vite.url}speakers.html`, /doesn't open a room/]] as const) {
      await join(entry);
      expect(await why()).toMatch(says);
      expect(await page<string>("location.pathname")).toBe("/door.html");
      await page(`document.querySelector("#join .back").click()`);
    }
    // the link, then the code alone: the event's room each time
    for (const entry of [link, room]) {
      await door();
      await join(entry);
      await until(`the room for ${entry === link ? "the link" : "the code"}`, `location.pathname === "/jam.html" && new URLSearchParams(location.search).get("room") === ${JSON.stringify(room)} && !!window.qjam`);
    }
  } finally { await tab.close(); }
});

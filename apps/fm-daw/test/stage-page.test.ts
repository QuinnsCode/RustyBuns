// The Stage Builder (#6053) in headless Chrome over CDP (scripts/chrome.ts), by real presses on /rooms.html: + New,
// open ground and a 10 × 7 m stage, a three box stack, place two, Test it and listen from the crowd; move a stack and
// roll History back a save; Lock in, find the order under Old, and open it as The Event, whose jam room plays that PA.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(240_000); // vite serves cold, software GL, then a jam room
useBrowser("--autoplay-policy=no-user-gesture-required");

type State = {
  on: boolean; why: string; placing: { kind: string; at: [number, number] } | null;
  build: { size: { w: number; d: number }; outdoor: boolean; stage: { w: number; d: number } | null; saves: string[]; stacks: { at: [number, number]; rows: { box: string }[] }[] } | null;
  crowd: { m2: number; cap: number } | null;
  test: { ref: number; spot: [number, number] | null; listening: boolean; heard: unknown[] | null } | null;
  orders: { name: string; stacks: number }[];
};

test.skipIf(!hasChrome)("build a show: field, stage, two stacks, test it, move one and roll back, lock in and play it", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  const state = () => tab.eval<State>("qstage.state()");
  const until = (ready: string) => pageUntil(tab, ready, ready, 30_000, 50);
  const mouse = async (x: number, y: number) => {
    await tab.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (const type of ["mousePressed", "mouseReleased"]) await tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  };
  // a press where the control is, so one that is covered or off the screen fails
  const press = async (sel: string) => {
    await until(`!!document.querySelector(${JSON.stringify(sel)})?.getClientRects().length`);
    const [x, y] = await tab.eval<[number, number]>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await mouse(x, y);
  };
  const floor = async (x: number, z: number) => { const [px, py] = await tab.eval<[number, number]>(`qstage.screen(${x}, ${z})`); await mouse(px, py); };
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until("!!window.qstage");
    await press("#stage-plus");
    await press('#sb-menu [data-act="new"]');
    for (const sel of ['[data-outdoor="1"]', '[data-arena="1"]', '[data-act="next"]', '[data-stage="2"]', '[data-act="next"]', '[data-box="horn-sub-21"]', '[data-box="stack-mid-bass"]', '[data-box="stack-mid-high"]', '[data-act="place"]'])
      await press(`#sb-dialog ${sel}`);

    // the stage goes where it's pressed, then two stacks either side of it
    expect((await state()).placing?.kind).toBe("stage");
    await floor(0, -16);
    expect((await state()).placing?.kind).toBe("stack");
    await floor(-8, -11);
    await floor(8, -11);
    await press('.sb-place [data-act="done"]');
    const built = await state();
    expect(built.why).toBe("");
    expect(built.build).toMatchObject({ outdoor: true, size: { w: 60, d: 40 }, stage: { w: 10, d: 7 } });
    expect(built.build!.stacks.map((s) => s.at)).toEqual([[-8, -11], [8, -11]]);
    expect(built.build!.stacks[1]!.rows.map((r) => r.box)).toEqual(["horn-sub-21", "stack-mid-bass", "stack-mid-high"]);
    expect(built.crowd!.cap).toBe(built.crowd!.m2 * 2);

    // test it: the map's level on the floor, and a listen from the crowd through the six boxes
    await press('.sb-bar [data-act="test"]');
    expect((await state()).test!.ref).toBeGreaterThan(90);
    await floor(3, -2);
    const heard = (await state()).test!;
    expect(heard.spot).toEqual([3, -2]);
    expect(heard.listening).toBe(true);
    expect(heard.heard!.length).toBe(2);
    await press('.sb-bar [data-act="test"]');

    // pick the left stack up and set it down elsewhere, then roll History back one save
    await floor(-8, -11);
    expect((await state()).placing?.kind).toBe("stack");
    await floor(-14, -6);
    expect((await state()).build!.stacks[0]!.at).toEqual([-14, -6]);
    await press('.sb-bar [data-act="history"]');
    await press("#sb-dialog [data-roll]"); // the newest first, "now" has no button: this is the save before the move
    const back = await state();
    expect(back.build!.stacks.map((s) => s.at)).toEqual([[-8, -11], [8, -11]]);
    expect(back.build!.saves.at(-1)).toBe("back to: stack 2 placed");

    // lock in: the order is under Old, and stays with this browser
    await press('.sb-bar [data-act="lock"]');
    await tab.eval(`document.querySelector("#sb-dialog input").value = "Friday field"`);
    await press('#sb-dialog [data-act="locked"]');
    await press('#sb-dialog .sb-foot [data-act="shut"]');
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until("window.qstage?.state().build?.stacks.length === 2"); // a build left up comes back up
    await press('.sb-bar [data-act="menu"]');
    await press('#sb-menu [data-act="old"]');
    expect(await tab.eval<string>(`document.querySelector("#sb-dialog .sb-list").textContent`)).toContain("Friday field");
    expect((await state()).orders).toEqual([{ name: "Friday field", stacks: 2 }]);

    // The Event: its jam room plays the PA that was placed
    await tab.eval(`window.open = () => null`);
    await press('#sb-dialog [data-order="0"] [data-act="event"]');
    const link = await tab.eval<string>(`document.querySelector("#sb-dialog a").href`);
    expect(tab.noise.filter((n) => n.startsWith("uncaught"))).toEqual([]);
    await load(chrome.cdp, tab, `${link}&quality=low`, 0);
    await pageUntil(tab, "!!window.qjam && !!window.qjam.state().me.wearing", "the room", 60_000);
    expect(await tab.eval<number>(`qjam.state().pa.sources.length`)).toBe(6);
    expect(tab.noise.filter((n) => n.startsWith("uncaught"))).toEqual([]);
  } finally { await tab.close(); }
});

// The piano roll's four tools on the desk, in headless Chrome over CDP (scripts/chrome.ts): the pencil draws a note
// through its desk_ command, the scissors open that note's popover (a third of the window wide) where a scroll and a
// drag of the thumbs trim its start earlier and its end later, one undo takes the whole trim back, the hand's command
// moves it off the grid, and the eraser's takes it off.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(60_000);
useBrowser();

type RollNote = { index: number; s: number; l: number; m: number; v: number };
type Roll = { span: number; snap: number | null; tool: string; notes: RollNote[] };

test.skipIf(!hasChrome)("draw a note, trim it in the scissors' popover, undo the trim, move it and erase it", async () => {
  const tab = await openTab(chrome.cdp, { w: 1200, h: 800 });
  try {
    await load(chrome.cdp, tab, `${vite.url}desk`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const run = <T>(name: string, args: object = {}) => page<T>(`window.__commands.run(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
    const until = (what: string, expr: string) => waitFor(tab, what, expr, 30_000);
    const centre = (sel: string) => page<{ x: number; y: number }>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    const mouse = (type: string, x: number, y: number, extra: object = {}) => tab.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });

    // past the start card, a melodic track (the Keys) shows the piano roll and its commands
    await until("the start card", `!!window.fmdaw && !!document.querySelector(".gate .play")`);
    const play = await centre(".gate .play");
    await mouse("mousePressed", play.x, play.y);
    await mouse("mouseReleased", play.x, play.y);
    await until("the desk", `!document.querySelector(".gate") && fmdaw.state().tracks.length > 6 && !!document.querySelectorAll(".track-name")[6]`);
    await page(`document.querySelectorAll(".track-name")[6].click()`);
    await until("the roll's commands", `!!document.querySelector(".roll-area") && window.__commands.list().some((c) => c.name === "desk_roll_notes")`);
    expect(await page<string[]>(`[...document.querySelectorAll("[data-tool]")].map((b) => b.dataset.tool)`)).toEqual(["pencil", "eraser", "scissors", "hand"]);
    const before = await run<Roll>("desk_roll_notes");
    expect(before.snap).not.toBeNull();
    const grid = before.snap!;
    // a key the roll shows (one of the track's own), on a roll the eraser's command has cleared
    const midi = before.notes[0]!.m;
    for (let i = before.notes.length - 1; i >= 0; i--) expect(await run<{ erased: boolean }>("desk_erase_note", { index: i })).toEqual({ erased: true });
    expect((await run<Roll>("desk_roll_notes")).notes).toEqual([]);

    // the pencil: the start lands on the grid line before it, the end stays at 2.37
    const { index } = await run<{ index: number }>("desk_draw_note", { start: grid * 4 + grid / 3, end: 2.37, midi });
    let roll = await run<Roll>("desk_roll_notes");
    expect(index).toBe(0);
    expect(roll.notes).toHaveLength(1);
    expect(roll.notes[0]).toMatchObject({ s: grid * 4, m: midi });
    expect(roll.notes[0]!.l).toBeCloseTo(2.37 - grid * 4, 6);

    // the scissors: click the note, and the popover opens a third of the window wide
    expect(await run<string>("desk_roll_tool", { tool: "scissors" })).toBe("scissors");
    await page(`document.querySelector(".roll-area").scrollIntoView({ block: "center" })`);
    const note = await centre(`.roll-area [data-k="${index}"]`);
    await mouse("mousePressed", note.x, note.y);
    await mouse("mouseReleased", note.x, note.y);
    await until("the popover", `!!document.querySelector(".trim-pop")`);
    const w = await page<{ pop: number; win: number }>(`({ pop: document.querySelector(".trim-pop").getBoundingClientRect().width, win: innerWidth })`);
    expect(w.pop).toBeCloseTo(w.win / 3, 0);

    // a scroll up over the start thumb takes the start a grid step earlier
    const start = await centre(`.trim-thumb[data-end="start"]`);
    await mouse("mouseWheel", start.x, start.y, { deltaX: 0, deltaY: -100 });
    await until("the start a step earlier", `window.__commands.run("desk_roll_notes").then((r) => r.notes[${index}].s === ${grid * 3})`);
    // and dragging the end thumb right takes the end later
    const end = await centre(`.trim-thumb[data-end="end"]`);
    await mouse("mousePressed", end.x, end.y);
    await mouse("mouseMoved", end.x + 40, end.y, { buttons: 1 });
    await mouse("mouseReleased", end.x + 40, end.y);
    roll = await run<Roll>("desk_roll_notes");
    const trimmed = roll.notes[index]!;
    expect(trimmed.s).toBe(grid * 3);
    expect(trimmed.s + trimmed.l).toBeGreaterThan(2.37);

    // Escape closes it, and one undo takes the whole trim back to the note as drawn
    await tab.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until("the popover closed", `!document.querySelector(".trim-pop")`);
    await page(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", key: "z", metaKey: true }))`);
    roll = await run<Roll>("desk_roll_notes");
    expect(roll.notes[index]).toMatchObject({ s: grid * 4, m: midi });
    expect(roll.notes[index]!.l).toBeCloseTo(2.37 - grid * 4, 6);

    // the trim's own command, the hand's (off the grid) and the eraser's
    expect(await run<RollNote>("desk_set_note_ends", { index, end: 3 })).toMatchObject({ index, s: grid * 4, l: 3 - grid * 4 });
    const moved = await run<RollNote>("desk_move_note", { index, beats: 0.13, semis: -2 });
    expect(moved).toMatchObject({ index, m: midi - 2 });
    expect(moved.s).toBeCloseTo(grid * 4 + 0.13, 6);
    expect(await run<{ erased: boolean }>("desk_erase_note", { index })).toEqual({ erased: true });
    expect((await run<Roll>("desk_roll_notes")).notes).toEqual([]);
  } finally {
    await tab.close();
  }
});

// #5762: the office diffs a busy worker's screen by the rows whose cells changed. The frames it sends must stay the
// ones upstream's snapshotScreen sent, through upstream's own flushScreens, as the screen scrolls, recolours and resizes.
import { expect, setDefaultTimeout } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { screenTerminal } from "../scripts/screen.ts";
import { beforePinned, pinnedTest, unpackPinned } from "./pinned.ts";

setDefaultTimeout(60_000);

type Snapshot = (term: unknown, last: string[]) => unknown;
let ours: { flushScreens(workers: unknown[], events: unknown, check: (w: unknown) => void): void };
let upstream: Snapshot;
beforePinned(async () => {
  const srv = path.join(await unpackPinned(), "dist/server/server");
  writeFileSync(path.join(srv, "rb-screen.js"), `export * from ${JSON.stringify(path.join(import.meta.dir, "../live/screen.ts"))};\n`);
  // the release's node_modules aren't installed here: keep only our import, and give upstream's copy its constants
  const terminal = path.join(srv, "workers/terminal.js"), js = readFileSync(terminal, "utf8");
  const consts = "const RGB_FLAG = 0x1000000, FLAG_BOLD = 1, FLAG_INVERSE = 2, FLAG_DIM = 4, KEYFRAME_MS = 8000;\n";
  const strip = (s: string) => consts + s.replace(/^import (?!.*rb-screen).*$/gm, "").replace(/^const KEYFRAME_MS.*$/m, "");
  writeFileSync(path.join(srv, "workers/upstream.js"), strip(js));
  writeFileSync(terminal, strip(screenTerminal(js)));
  ours = await import(terminal);
  ({ snapshotScreen: upstream } = await import(path.join(srv, "workers/upstream.js")));
});

/** A cell as xterm's headless terminal hands it out. */
interface Cell { ch: string; fg: number; bg: number; bold: boolean; width: number }
const blank = (): Cell => ({ ch: "", fg: -1, bg: -1, bold: false, width: 1 });

/** Enough of a headless xterm: rows of cells, each row's raw words in `_line._data` as xterm keeps them. */
class Screen {
  lines: Cell[][] = [];
  viewportY = 0;
  constructor(public cols: number, public rows: number) { for (let y = 0; y < rows; y++) this.lines.push(this.row()); }
  row() { return Array.from({ length: this.cols }, blank); }
  write(y: number, x: number, text: string, style: Partial<Cell> = {}) {
    [...text].forEach((ch, i) => { if (x + i < this.cols) this.lines[this.viewportY + y]![x + i] = { ...blank(), ...style, ch }; });
  }
  scroll() { this.lines.push(this.row()); this.viewportY++; }
  resize(cols: number) { this.cols = cols; this.lines = this.lines.map((l) => Array.from({ length: cols }, (_, x) => l[x] ?? blank())); }
  get buffer() {
    const s = this;
    let cur: Cell = blank();
    const cell = {
      getWidth: () => cur.width, getChars: () => cur.ch,
      isFgDefault: () => cur.fg < 0, isFgRGB: () => cur.fg > 255, getFgColor: () => cur.fg & 0xffffff,
      isBgDefault: () => cur.bg < 0, isBgRGB: () => cur.bg > 255, getBgColor: () => cur.bg & 0xffffff,
      isBold: () => cur.bold, isInverse: () => false, isDim: () => false,
    };
    return {
      active: {
        viewportY: s.viewportY, cursorX: 0, cursorY: 0, getNullCell: () => cell,
        getLine: (y: number) => {
          const cells = s.lines[y];
          if (!cells) return undefined;
          const data = new Uint32Array(cells.length * 3);
          cells.forEach((c, x) => data.set([(c.ch.codePointAt(0) ?? 0) | (c.width << 22) | (c.bold ? 1 << 27 : 0), c.fg >>> 0, c.bg >>> 0], x * 3));
          return { getCell: (x: number) => { cur = cells[x]!; }, _line: { _data: data, _combined: {} } };
        },
      },
    };
  }
}

pinnedTest("a worker's screen sends upstream's frames, row for row, as it types, spins, recolours, scrolls and resizes", () => {
  const term = new Screen(40, 6);
  const w = { term, info: { id: "w1" }, lastLines: [] as string[], screenDirty: true, keyframeAt: Date.now() };
  const sent: unknown[] = [], theirs: unknown[] = [], last: string[] = [];
  const events = { screen: (_id: string, frame: unknown) => sent.push(frame) };
  const flush = () => {
    w.screenDirty = true;
    ours.flushScreens([w], events, () => {});
    const frame = upstream(term, last);
    if (frame) theirs.push(frame);
  };
  term.write(0, 0, "> fix the office's CPU in flushScreens, then readdir");
  term.write(1, 2, "Reading terminal.js", { fg: 2 });
  flush();
  for (const spin of ["|", "/", "-", "\\"]) { term.write(3, 0, `${spin} Thinking`, { fg: 0x1ff8800, bold: true }); flush(); }
  flush(); // nothing moved: no frame
  term.write(1, 2, "Reading terminal.js", { fg: 4 }); // same text, new colour
  flush();
  term.scroll(); term.write(5, 0, "done");
  flush();
  term.resize(30);
  flush();
  expect(sent).toEqual(theirs);
  expect(sent.length).toBe(8);
});

// #5762: upstream's snapshotScreen (server/workers/terminal.js) read every cell of every row of each busy worker's
// screen four times a second and JSON-encoded each row to see whether it changed: a third of the office's CPU with a
// dozen workers seated. This one hashes each row's raw cells (xterm keeps a row as a Uint32Array, three words a cell:
// content, fg, bg) and only reads the cells of a row whose hash moved; the rest keep the runs and key they had.
// The frames are the same as upstream's. A row that doesn't look like that (another xterm) is read cell by cell.
// Built to server/rb-screen.js; scripts/screen.ts swaps it in.

const RGB_FLAG = 0x1000000, FLAG_BOLD = 1, FLAG_INVERSE = 2, FLAG_DIM = 4;

type Run = [string, number, number, number];
interface Cell {
  getWidth(): number;
  getChars(): string;
  isFgDefault(): boolean; isFgRGB(): boolean; getFgColor(): number;
  isBgDefault(): boolean; isBgRGB(): boolean; getBgColor(): number;
  isBold(): number | boolean; isInverse(): number | boolean; isDim(): number | boolean;
}
interface Line { getCell(x: number, cell: Cell): unknown; _line?: { _data?: unknown; _combined?: Record<number, string> } }
interface Term { cols: number; rows: number; buffer: { active: { viewportY: number; cursorX: number; cursorY: number; getLine(y: number): Line | undefined; getNullCell(): Cell } } }
export interface Frame { cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }

/** A hash of the row's cells, or undefined when its cells can't be read raw. */
export function rowHash(line: Line, cols: number): bigint | number | undefined {
  const raw = line._line, data = raw?._data;
  if (!(data instanceof Uint32Array)) return undefined;
  let h = Bun.hash(data.subarray(0, cols * 3));
  // a cell of more than one code point keeps its text beside the row, not in it
  for (const _ in raw!._combined) { h = Bun.hash(JSON.stringify(raw!._combined), h); break; }
  return h;
}

/** The row as upstream sends it: runs of text with one style, trailing default-styled whitespace trimmed. */
export function rowRuns(line: Line | undefined, cols: number, cell: Cell): Run[] {
  const runs: Run[] = [];
  if (line) {
    let cur: Run | null = null;
    for (let x = 0; x < cols; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      const ch = cell.getChars() || " ";
      const fg = cell.isFgDefault() ? -1 : cell.isFgRGB() ? RGB_FLAG | cell.getFgColor() : cell.getFgColor();
      const bg = cell.isBgDefault() ? -1 : cell.isBgRGB() ? RGB_FLAG | cell.getBgColor() : cell.getBgColor();
      const flags = (cell.isBold() ? FLAG_BOLD : 0) | (cell.isInverse() ? FLAG_INVERSE : 0) | (cell.isDim() ? FLAG_DIM : 0);
      if (cur && cur[1] === fg && cur[2] === bg && cur[3] === flags) cur[0] += ch;
      else runs.push(cur = [ch, fg, bg, flags]);
    }
  }
  while (runs.length) {
    const r = runs[runs.length - 1]!;
    if (r[2] !== -1 || r[3] & FLAG_INVERSE) break;
    const trimmed = r[0].replace(/\s+$/, "");
    if (trimmed) { r[0] = trimmed; break; }
    runs.pop();
  }
  return runs;
}

interface Rows { cols: number; hash: (bigint | number | undefined)[]; runs: Run[][]; key: string[] }
const seen = new WeakMap<Term, Rows>();

/** The rows of the screen that changed since `last` (all of them when its size changed), or null when none did. */
export function snapshotScreen(term: Term, last: string[]): Frame | null {
  const buf = term.buffer.active, cols = term.cols, rows = term.rows, full = last.length !== rows;
  let rec = seen.get(term);
  if (rec?.cols !== cols) seen.set(term, rec = { cols, hash: [], runs: [], key: [] });
  const lines: Record<number, Run[]> = {};
  let changed = false, cell: Cell | undefined;
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const h = line ? rowHash(line, cols) : 0;
    let runs: Run[], key: string;
    if (h !== undefined && rec.hash[y] === h) { runs = rec.runs[y]!; key = rec.key[y]!; }
    else {
      runs = rowRuns(line, cols, cell ??= buf.getNullCell());
      key = JSON.stringify(runs);
      rec.hash[y] = h; rec.runs[y] = runs; rec.key[y] = key;
    }
    if (full || last[y] !== key) { lines[y] = runs; last[y] = key; changed = true; }
  }
  last.length = rows;
  rec.hash.length = rec.runs.length = rec.key.length = rows;
  return changed ? { cols, rows, lines, full, cursor: [buf.cursorX, buf.cursorY] } : null;
}

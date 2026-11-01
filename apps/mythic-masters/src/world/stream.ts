// Which regions' fine ground is in memory: the ones round the player. The bundled coarse ground draws the rest, so
// the far land is always there; a region comes in when you walk within one region of it and goes back to its
// coarse sample when you are two away. No three.js: src/world/view.ts draws the result and the tests walk it.
import { REGIONS } from "../regions.ts";
import { CELL, cell, groundFrom, refine, type World } from "./world.ts";
import { GRID } from "./places.ts";

/** Regions within this many grid cells of yours (so 3 × 3 of them) hold their fine ground. */
export const LOAD_R = 1;

/** The grid cell [column, row] that (x, z) is in, kept on the grid. */
export const cellAt = (x: number, z: number): [number, number] => [Math.min(GRID.w - 1, Math.max(0, Math.floor(x / CELL))), Math.min(GRID.h - 1, Math.max(0, Math.floor(z / CELL)))];

/** How many cells apart (the larger of columns and rows) two cells are. */
export const cellsApart = (a: readonly [number, number], b: readonly [number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** The regions whose fine ground belongs in memory with the player at (x, z). */
export const wantedAt = (x: number, z: number): number[] => { const me = cellAt(x, z); return REGIONS.filter((g) => cellsApart(cell(g), me) <= LOAD_R).map((g) => g.n); };

export type Box = [r0: number, r1: number, c0: number, c1: number];

/**
 * Keeps `w` refined round the player. `read` fetches a region's file (undefined when it is missing); `changed` hears
 * every region whose heights just moved, with the rows and columns of the world it touched. A file that arrives
 * after you walked on is dropped.
 */
export function createStream(w: World, read: (n: number) => Promise<Uint8Array | undefined>, changed: (n: number, box: Box) => void) {
  const loaded = new Set<number>(), pending = new Set<number>();
  let wanted = new Set<number>(), key = "";
  function apply(n: number, fine?: Int16Array) {
    const box = refine(w, n, fine);
    if (box) changed(n, box);
  }
  return {
    /** Call as the player moves; cheap while they stay in one cell. */
    update(x: number, z: number) {
      const k = cellAt(x, z).join();
      if (k === key) return;
      key = k;
      wanted = new Set(wantedAt(x, z));
      for (const n of [...loaded]) if (!wanted.has(n)) { loaded.delete(n); apply(n); }
      for (const n of wanted) {
        if (loaded.has(n) || pending.has(n)) continue;
        pending.add(n);
        void read(n).then((bytes) => {
          pending.delete(n);
          const fine = bytes && groundFrom(bytes);
          if (!fine || !wanted.has(n)) return;
          loaded.add(n); apply(n, fine);
        }, () => { pending.delete(n); });
      }
    },
    /** The regions holding their fine ground now. */
    loaded: () => [...loaded].sort((a, b) => a - b),
    /** Resolves once every requested file has come in. */
    async settled() { while (pending.size) await new Promise((r) => setTimeout(r, 0)); },
  };
}
export type Stream = ReturnType<typeof createStream>;

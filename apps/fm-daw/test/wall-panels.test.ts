// The sound wall's panels (circuits/wall-panels.ts) as a builder drills them (WALL.md): every jack and pot hole on its
// panel and clear of the case's rails, far enough from the next for a nut or a knob, and every one a part of its own
// on the board, its jack or pot body inside the board's edges.
import { expect, test } from "bun:test";
import { BOARD_H, PANEL_H, PANELS, boardWidth, panelHoles, panelWidth } from "../circuits/wall-panels.ts";

/** The rails cover about 10 mm at the top and bottom of a 3U panel. */
const RAIL = 10;
/** A jack's and a pot's body on the board about its hole (KiCad's courtyards): x either side, y below and above. */
const BODY = { jack: { x: 5, down: 6.5, up: 7.9 }, pot: { x: 6.7, down: 8.7, up: 5.1 } };

test("every module's panel drills clean and its parts fit its board", () => {
  for (const p of PANELS) {
    const w = panelWidth(p.hp), holes = panelHoles(p), parts = holes.filter((h) => h.name !== "screw");
    expect(parts).toHaveLength(p.jacks.length + p.knobs.length);
    for (const h of parts) {
      const r = h.drill / 2;
      expect([p.id, h.name, h.x - r > 1 && h.x + r < w - 1, h.y - r > RAIL && h.y + r < PANEL_H - RAIL]).toEqual([p.id, h.name, true, true]);
    }
    for (const [i, a] of holes.entries()) for (const b of holes.slice(i + 1)) {
      // Room between two holes for a jack's nut or a knob's skirt: 4 mm beyond their edges.
      expect([p.id, a.name, b.name, Math.hypot(a.x - b.x, a.y - b.y) >= (a.drill + b.drill) / 2 + 4]).toEqual([p.id, a.name, b.name, true]);
    }
    const names = [...p.jacks.map((j) => j.part), ...p.knobs.map((k) => k.part)];
    expect(new Set(names).size).toBe(names.length);
    const bw = boardWidth(p.hp) / 2, bh = BOARD_H / 2;
    for (const [kind, at] of [...p.jacks.map((j) => ["jack", j] as const), ...p.knobs.map((k) => ["pot", k] as const)]) {
      const b = BODY[kind];
      expect([p.id, at.part, Math.abs(at.x) + b.x <= bw && at.y - b.down >= -bh && at.y + b.up <= bh]).toEqual([p.id, at.part, true]);
    }
  }
  // The set fits one 84 HP row of the case with room to spare.
  expect(PANELS.reduce((n, p) => n + p.hp, 0)).toBeLessThanOrEqual(84);
});

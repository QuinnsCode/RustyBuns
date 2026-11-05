// The results screen's tally sheet: each count in pencil tally marks (four strokes and a fifth across), as a small
// inline SVG, with the number beside it so nothing has to be counted.

/** Marks past this many are left to the number beside them. */
export const MAX_MARKS = 25;

/** `n` as tally marks: an SVG string, one group of five per 26 px. */
export function marks(n: number): string {
  const shown = Math.max(0, Math.min(MAX_MARKS, Math.floor(n))), groups = Math.ceil(shown / 5), w = Math.max(1, groups) * 26;
  let d = "";
  for (let g = 0; g < groups; g++) {
    const x0 = g * 26 + 3, inGroup = Math.min(5, shown - g * 5);
    for (let k = 0; k < Math.min(4, inGroup); k++) d += `M${x0 + k * 5} 3 l${(k % 2) - 0.5} 14`;
    if (inGroup === 5) d += `M${x0 - 2} 14 L${x0 + 18} 5`;
  }
  return `<svg viewBox="0 0 ${w} 20" width="${w}" height="20" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

/** Fill `el` with one row per entry: the label, its marks (for counts) and its value. */
export function drawTally(el: HTMLElement, rows: [label: string, value: number | string][]) {
  el.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"), b = document.createElement("b");
    row.className = "tally-row"; dt.textContent = label; b.textContent = String(value);
    if (typeof value === "number") dd.innerHTML = marks(value);
    dd.append(b); row.append(dt, dd);
    return row;
  }));
}

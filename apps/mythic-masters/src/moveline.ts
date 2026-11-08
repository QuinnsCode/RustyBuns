// A move as the beast card prints it (docs/ATTACKS.md "The beast card"): its shape and numbers, its tempo, the damage
// range from its weak end to its strong one, and what it costs, plus a small drawing of its shape on the ground. The
// versus picker and the compendium's folio both read their move lines from here.
import { LOW, reachOf, type Delivery, type Move, type Tempo } from "./moves.ts";
import { COST, PULSE } from "./sim.ts";

const n = (x: number) => String(Math.round(x * 10) / 10);

/** "column 14 x 1.2 m", "cone 60 deg x 6 m", "blast r 2 m @ 9 m". */
export function shapeText(d: Delivery): string {
  switch (d.shape) {
    case "touch": return "touch";
    case "column": return `column ${n(d.length)} x ${n(d.width)} m`;
    case "wall": return `wall ${n(d.width)} m wide, ${n(d.travel)} m out`;
    case "cone": return `cone ${n(d.angle)} deg x ${n(d.length)} m`;
    case "blast": return `blast r ${n(d.radius)} m @ ${n(d.range)} m`;
    case "nova": return `nova r ${n(d.radius)} m`;
  }
}

/** "quick", "charge 1.2 s", "build-up 2 s", "fade 1 s". */
export function tempoText(t: Tempo): string {
  switch (t.kind) {
    case "quick": return "quick";
    case "charge": return `charge ${n(t.full)} s`;
    case "build": return `build-up ${n(t.run)} s`;
    case "fade": return `fade ${n(t.run)} s`;
  }
}

/** The damage range in power, weak end to strong, on the sim's own curves (sim `strength`): where they stand in a shape
 * (LOW of it at the edge), a tap to a full charge, a stream's first tick to its roar (each tick, so the line says so), a
 * fade's burst (what follows it is weaker, as its tempo says). A touch lands its power wherever it lands. */
export function range(mv: Move): [number, number] {
  const ranged = mv.delivery.shape !== "touch", p = mv.power * (ranged && mv.slot === "ultimate" ? 1.4 : 1), edge = ranged ? LOW : 1, t = mv.tempo;
  const [lo, hi] = t.kind === "charge" ? [p * edge, p * t.grow]
    : t.kind === "build" ? [p * PULSE.stream * t.from * edge, p * PULSE.stream]
    : [p * edge, p];
  return [Math.round(lo), Math.round(hi)];
}

/** "free", "15 energy", "35 over its run" (a stream pays as it pours), "100 energy". */
export function costText(mv: Move): string {
  const c = COST[mv.slot];
  return c === 0 ? "free" : mv.tempo.kind === "build" ? `${c} over its run` : `${c} energy`;
}

/** The whole line: "column 14 x 1.2 m · charge 1.2 s · 77-252 · 35 energy". */
export function moveLine(mv: Move): string {
  const [lo, hi] = range(mv), dmg = (lo === hi ? String(hi) : `${lo}-${hi}`) + (mv.tempo.kind === "build" ? " a tick" : "");
  return [shapeText(mv.delivery), tempoText(mv.tempo), dmg, costText(mv)].join(" · ");
}

/** The shape seen from above, the caster a dot on the left facing right, to one scale (16 m across) so a long column
 * reads longer than a short cone, cut to the shape's own reach. Strokes in currentColor, so it takes the text's ink. */
export function shapeSvg(d: Delivery): string {
  const W = 40, H = 20, x0 = 4, y = H / 2, s = (W - x0 - 1) / 16, r = (m: number) => n(Math.min(m * s, W));
  let mark: string;
  switch (d.shape) {
    case "touch": mark = `<path d="M${x0 + 3} ${y - 4} A5 5 0 0 1 ${x0 + 3} ${y + 4}"/>`; break;
    case "column": { const w = Math.max(1, d.width * s); mark = `<rect x="${x0}" y="${n(y - w / 2)}" width="${r(d.length)}" height="${n(w)}"/>`; break; }
    case "wall": { const w = Math.min(H - 2, d.width * s); mark = `<path class="lane" d="M${x0} ${y}H${n(x0 + d.travel * s)}"/><rect x="${n(x0 + d.travel * s)}" y="${n(y - w / 2)}" width="${r(d.depth)}" height="${n(w)}"/>`; break; }
    case "cone": {
      const a = (d.angle * Math.PI) / 360, l = Math.min(d.length * s, W - x0 - 1), dy = Math.min(H / 2 - 1, Math.tan(a) * l);
      mark = `<path d="M${x0} ${y}L${n(x0 + l)} ${n(y - dy)}L${n(x0 + l)} ${n(y + dy)}Z"/>`; break;
    }
    case "blast": { const cx = Math.min(x0 + d.range * s, W - 2); mark = `<path class="lane" d="M${x0} ${y}H${n(cx)}"/><circle cx="${n(cx)}" cy="${y}" r="${n(Math.min(H / 2 - 1, d.radius * s))}"/>`; break; }
    case "nova": mark = `<circle cx="${x0}" cy="${y}" r="${n(Math.min(H / 2 - 1, d.radius * s))}"/>`; break;
  }
  const w = d.shape === "touch" ? 12 : d.shape === "nova" ? x0 + Math.min(H / 2 - 1, d.radius * s) + 2 : Math.min(W, x0 + reachOf(d) * s + 2);
  return `<svg class="shape" viewBox="0 0 ${n(w)} ${H}" width="${n(w)}" height="${H}" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><circle class="me" cx="${x0}" cy="${y}" r="1.6"/>${mark}</svg>`;
}

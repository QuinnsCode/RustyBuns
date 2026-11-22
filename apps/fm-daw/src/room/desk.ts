// The desk view (Tab in the gear room): FM DAW's desk as strips, a channel per source (gain, Shape low / mid / high,
// pan, aux sends, fader, mute, solo), then a strip per aux return (what is cabled in, its fader, mute), then the master
// when the page has one. Every strip has a Shape button, a thumbnail of its curve, that opens the full Shape editor
// (src/ui/Shape.tsx) for it: the page says where (`shape`). Plain DOM: every change hands back a new Desk and the
// page redraws from it.
import { AUXES, faderDb, shapeName, withChannel, withReturn, withSend, type Channel, type Desk, type ShapeAt } from "../mixer.ts";
import { flatEq, response, type EqBand, type EqDoc } from "../engine/eq.ts";

/** The three Shape bands a strip turns: a low shelf, a mid bell and a high shelf, in the channel's first three slots. */
export const STRIP_SHAPE = [
  { label: "Low", kind: "lowShelf", f: 120, q: 0.7 },
  { label: "Mid", kind: "bell", f: 1000, q: 1 },
  { label: "High", kind: "highShelf", f: 8000, q: 0.7 },
] as const;
/**
 * A strip's band at `db` (0 takes it out). A band of the knob's kind already in the slot (moved in the full editor)
 * keeps its frequency and Q: the knob is its gain.
 */
export function withShapeBand(eq: EqDoc, i: number, db: number): EqDoc {
  const b = STRIP_SHAPE[i], was = eq[i];
  const band: EqBand | null = db === 0 ? null : was?.kind === b.kind ? { ...was, g: db, on: true } : { kind: b.kind, f: b.f, g: db, q: b.q, slope: 12, on: true };
  return eq.map((x, j) => (j === i ? band : x));
}
/** Whether a strip's knob turns slot `i`: it is empty or holds the knob's kind (another kind is the full editor's). */
export const knobTurns = (eq: EqDoc, i: number) => { const x = eq[i]; return !x || x.kind === STRIP_SHAPE[i].kind; };

// ---- a Shape's thumbnail: its real response, drawn small ----
const THUMB_W = 44, THUMB_H = 18, THUMB_DB = 18, THUMB_SR = 48000;
const THUMB_F = Array.from({ length: 40 }, (_, i) => 20 * Math.pow(1000, i / 39));
/** An SVG path of `eq`'s curve over 20 Hz to 20 kHz, ±18 dB high, in a 44 by 18 box. */
export function shapeThumbPath(eq: EqDoc): string {
  const { db } = response(eq, THUMB_SR, THUMB_F);
  return THUMB_F.map((_, i) => {
    const x = (i / (THUMB_F.length - 1)) * THUMB_W;
    const y = THUMB_H / 2 - (Math.max(-THUMB_DB, Math.min(THUMB_DB, db[i] ?? 0)) / THUMB_DB) * (THUMB_H / 2 - 1);
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}
const SVG = "http://www.w3.org/2000/svg";
/** The Shape button: the curve as its face, the word as its tooltip. */
function shapeButton(name: string, eq: EqDoc, open: () => void) {
  const b = el("button", `desk-shape${eq.some(Boolean) ? " on" : ""}`);
  b.type = "button";
  b.title = `Shape: the full EQ on ${name}`;
  b.setAttribute("aria-label", `Shape on ${name}`);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${THUMB_W} ${THUMB_H}`);
  svg.setAttribute("aria-hidden", "true");
  const mid = document.createElementNS(SVG, "path");
  mid.setAttribute("d", `M0 ${THUMB_H / 2} H${THUMB_W}`);
  mid.setAttribute("class", "desk-shape-zero");
  const line = document.createElementNS(SVG, "path");
  line.setAttribute("d", shapeThumbPath(eq));
  svg.append(mid, line);
  b.append(svg);
  b.addEventListener("click", open);
  return b;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const dbText = (f: number) => { const d = faderDb(f); return Number.isFinite(d) ? `${d > 0 ? "+" : ""}${d.toFixed(1)} dB` : "off"; };

function slider(label: string, min: number, max: number, step: number, v: number, show: (v: number) => string, set: (v: number) => void, vertical = false) {
  const wrap = el("label", vertical ? "desk-fader" : "desk-knob");
  const input = el("input", "");
  Object.assign(input, { type: "range", min: String(min), max: String(max), step: String(step), value: String(v) });
  input.setAttribute("aria-label", label);
  const out = el("span", "desk-val", show(v));
  input.addEventListener("input", () => { out.textContent = show(Number(input.value)); });
  input.addEventListener("change", () => set(Number(input.value)));
  wrap.append(el("span", "desk-label", label), input, out);
  return wrap;
}
function toggle(label: string, title: string, on: boolean, set: (v: boolean) => void) {
  const b = el("button", `desk-toggle${on ? " on" : ""}`, label);
  b.type = "button"; b.title = title; b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => set(!on));
  return b;
}

/** How the page opens a Shape: `shape` opens the full editor on one (src/ui/shape-overlay.tsx, or in place), `master` adds the master's strip. */
export interface DeskShape { shape?: (at: ShapeAt) => void; master?: EqDoc }

/**
 * Draw `desk` into `host`; `change` gets the desk after each move. `cabled` names what is cabled into each aux.
 * `spaceMute: false` leaves the Space return's mute off (the sesh's Space return is the project's Space amount, which has none).
 */
export function drawDesk(host: HTMLElement, desk: Desk, cabled: string[], change: (d: Desk) => void, { spaceMute = true, shape, master }: { spaceMute?: boolean } & DeskShape = {}) {
  host.replaceChildren();
  const head = (s: HTMLElement, at: ShapeAt, eq: EqDoc) => {
    const row = el("div", "desk-head");
    const name = shapeName(desk, at);
    row.append(el("h3", "", name));
    if (shape) row.append(shapeButton(name, eq, () => shape(at)));
    s.append(row);
  };
  const strip = (c: Channel) => {
    const s = el("div", "desk-strip");
    head(s, { channel: c.id }, c.eq);
    // a track's channel is the track (mixer.ts `trackChannel`): its fader is its level, so it has no input gain
    const track = c.source === "track";
    if (!track) s.append(slider("Gain", -24, 24, 0.5, c.gain, (v) => `${v > 0 ? "+" : ""}${v} dB`, (v) => change(withChannel(desk, c.id, { gain: v }))));
    STRIP_SHAPE.forEach((b, i) => {
      const k = slider(b.label, -12, 12, 0.5, knobTurns(c.eq, i) ? c.eq[i]?.g ?? 0 : 0, (v) => `${v > 0 ? "+" : ""}${v} dB`, (v) => change(withChannel(desk, c.id, { eq: withShapeBand(c.eq, i, v) })));
      if (!knobTurns(c.eq, i)) { k.querySelector("input")?.setAttribute("disabled", ""); k.title = `Shape's band ${i + 1} is set in the full editor`; }
      s.append(k);
    });
    s.append(slider("Pan", -1, 1, 0.05, c.pan, (v) => (Math.abs(v) < 0.01 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`), (v) => change(withChannel(desk, c.id, { pan: v }))));
    for (let a = 1; a <= AUXES; a++) s.append(slider(`Send ${desk.returns.find((r) => r.aux === a)?.name ?? a}`, 0, 1, 0.01, c.sends[a - 1] ?? 0, (v) => `${Math.round(v * 100)}%`, (v) => change(withSend(desk, c.id, a, v))));
    s.append(slider("Fader", 0, 1, 0.005, c.fader, dbText, (v) => change(withChannel(desk, c.id, { fader: v })), true));
    const row = el("div", "desk-row");
    row.append(toggle("M", "Mute", c.mute, (v) => change(withChannel(desk, c.id, { mute: v }))), toggle("S", "Solo", c.solo, (v) => change(withChannel(desk, c.id, { solo: v }))));
    s.append(row);
    return s;
  };
  for (const c of desk.channels) host.append(strip(c));
  for (const r of desk.returns) {
    const s = el("div", "desk-strip desk-return");
    head(s, { aux: r.aux }, r.eq ?? flatEq());
    s.append(el("p", "desk-what", r.fx === "space" ? "FM DAW's Space reverb" : cabled[r.aux - 1] || `Nothing cabled in: aux-send-${r.aux} to an effect, back into aux-return-${r.aux}`));
    s.append(slider("Fader", 0, 1, 0.005, r.fader, dbText, (v) => change(withReturn(desk, r.aux, { fader: v })), true));
    if (spaceMute || r.fx !== "space") {
      const row = el("div", "desk-row");
      row.append(toggle("M", "Mute", r.mute, (v) => change(withReturn(desk, r.aux, { mute: v }))));
      s.append(row);
    }
    host.append(s);
  }
  if (master && shape) {
    const s = el("div", "desk-strip desk-master");
    head(s, { master: true }, master);
    s.append(el("p", "desk-what", "Everything, after the returns"));
    host.append(s);
  }
}

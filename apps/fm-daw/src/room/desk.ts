// The desk view (Tab in the gear room): FM DAW's desk as strips, a channel per source (gain, Shape low / mid / high,
// pan, aux sends, fader, mute, solo), then a strip per aux return (what is cabled in, its fader, mute). Plain DOM: every
// change hands back a new Desk and the page redraws from it.
import { AUXES, faderDb, withChannel, withReturn, withSend, type Channel, type Desk } from "../mixer.ts";
import type { EqBand, EqDoc } from "../engine/eq.ts";

/** The three Shape bands a strip turns: a low shelf, a mid bell and a high shelf, in the channel's first three slots. */
export const STRIP_SHAPE = [
  { label: "Low", kind: "lowShelf", f: 120, q: 0.7 },
  { label: "Mid", kind: "bell", f: 1000, q: 1 },
  { label: "High", kind: "highShelf", f: 8000, q: 0.7 },
] as const;
/** A strip's band at `db` (0 takes it out). */
export function withShapeBand(eq: EqDoc, i: number, db: number): EqDoc {
  const b = STRIP_SHAPE[i];
  const band: EqBand | null = db === 0 ? null : { kind: b.kind, f: b.f, g: db, q: b.q, slope: 12, on: true };
  return eq.map((x, j) => (j === i ? band : x));
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

/** Draw `desk` into `host`; `change` gets the desk after each move. `cabled` names what is cabled into each aux. */
export function drawDesk(host: HTMLElement, desk: Desk, cabled: string[], change: (d: Desk) => void) {
  host.replaceChildren();
  const strip = (c: Channel) => {
    const s = el("div", "desk-strip");
    s.append(el("h3", "", c.name || c.id));
    s.append(slider("Gain", -24, 24, 0.5, c.gain, (v) => `${v > 0 ? "+" : ""}${v} dB`, (v) => change(withChannel(desk, c.id, { gain: v }))));
    STRIP_SHAPE.forEach((b, i) => s.append(slider(b.label, -12, 12, 0.5, c.eq[i]?.g ?? 0, (v) => `${v > 0 ? "+" : ""}${v} dB`, (v) => change(withChannel(desk, c.id, { eq: withShapeBand(c.eq, i, v) })))));
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
    s.append(el("h3", "", `Return ${r.aux}: ${r.name}`));
    s.append(el("p", "desk-what", r.fx === "space" ? "FM DAW's Space reverb" : cabled[r.aux - 1] || `Nothing cabled in: aux-send-${r.aux} to an effect, back into aux-return-${r.aux}`));
    s.append(slider("Fader", 0, 1, 0.005, r.fader, dbText, (v) => change(withReturn(desk, r.aux, { fader: v })), true));
    const row = el("div", "desk-row");
    row.append(toggle("M", "Mute", r.mute, (v) => change(withReturn(desk, r.aux, { mute: v }))));
    s.append(row);
    host.append(s);
  }
}

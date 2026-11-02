// Ochre handprints as health on a stone wall; stamina and energy are charcoal strokes.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import type { HudSide, HudSkin } from "../skin.ts";

const PIPS = 8;
const HAND = '<symbol id="mm-hand" viewBox="0 0 24 28"><path d="M6 27c-3-3-4-7-3-11l-1-6c0-1.5 2-1.5 2.4 0L5.5 13V4.5c0-1.6 2.4-1.6 2.4 0V12l.8-9.5c.1-1.7 2.5-1.5 2.4.2L10.6 12l1.4-8.3c.3-1.6 2.6-1.1 2.4.5L13.2 13l2.4-6.6c.6-1.5 2.7-.7 2.3.8L16 14c2-2 4.5-1.5 4.3.3-.6 3-1.8 6-3.3 8.2-1.5 2.2-3.5 4.5-6 4.500z"/></symbol>';
const stroke = (v: number, max: number, cls: string, t: string) => `<span class="ch ${cls}" title="${esc(t)}"><i style="width:${(Math.min(1, Math.max(0, v / (max || 1))) * 100).toFixed(1)}%"></i></span>`;
const side = (f: HudSide, i: number, age: number | undefined) => {
  const lit = (f.hp / f.hpMax) * PIPS;
  const hands = Array.from({ length: PIPS }, (_, k) => { const o = Math.min(1, Math.max(0, lit - k)); return `<svg class="hand${o > 0 && o < 1 ? " half" : ""}" viewBox="0 0 24 28" style="opacity:${(0.14 + 0.86 * o).toFixed(2)};--r:${(k * 37 % 13) - 6}deg"><use href="#mm-hand"/></svg>`; }).join("");
  return `<div class="side s${i}${age !== undefined ? " hurt" : ""}" style="--age:${(age ?? 99) / 60}s">
  <div class="nm"><b>${esc(f.name)}</b>${f.combo > 1 ? `<em>x${f.combo}</em>` : ""}${f.clipped ? icon("feather", "Wings clipped") : ""}<span class="pc">${Math.round(f.launch)}%</span></div>
  <div class="hands" title="Health: ${Math.round(f.hp)} of ${Math.round(f.hpMax)}">${hands}</div>
  ${stroke(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina")}${stroke(f.energy, f.energyMax, "en", "Energy")}</div>`;
};

const S = '.hud[data-skin="cave-paint"]';
export const skin: HudSkin = {
  id: "cave-paint", name: "Cave paint", idea: "Ochre handprints for health, charcoal strokes for the rest, on a rough stone wall.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 10px 56px 0 12px; font-family: "Grenze Gotisch", serif; }
${S} .defs { position: absolute; width: 0; height: 0; }
${S} .side { display: grid; gap: 4px; padding: 8px 12px; border-radius: 14px 6px 16px 8px; background: radial-gradient(ellipse at 30% 20%, #5b5249, #3a342e 70%); box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.6), 0 3px 10px rgba(0, 0, 0, 0.5); }
${S} .s1 { order: 3; text-align: right; }
${S} .nm { display: flex; gap: 8px; align-items: baseline; font-size: 19px; color: #e8dcc6; } ${S} .s1 .nm { flex-direction: row-reverse; }
${S} .nm em { color: #d9733a; font-style: normal; font-weight: 700; }
${S} .pc { margin-left: auto; font-size: 28px; font-weight: 700; color: #f0c27a; font-variant-numeric: tabular-nums; } ${S} .s1 .pc { margin: 0 auto 0 0; }
${S} .hands { display: flex; gap: 2px; } ${S} .s1 .hands { flex-direction: row-reverse; }
${S} .hand { flex: 1; min-width: 0; max-width: 30px; aspect-ratio: 24 / 28; fill: #c4572a; transform: rotate(var(--r)); }
${S} .hand.half { fill: #e08a3c; }
${S} .ch { display: block; height: 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.3); overflow: hidden; }
${S} .ch i { display: block; height: 100%; border-radius: 3px; background: repeating-linear-gradient(95deg, #1a1816 0 6px, #2c2926 6px 8px); box-shadow: 0 0 0 1px #8a7f70 inset; } ${S} .s1 .ch i { margin-left: auto; }
${S} .ch.st i { background: repeating-linear-gradient(95deg, #cbbfa8 0 6px, #a39682 6px 8px); } ${S} .ch.st.out i { background: #b03a2e; }
${S} .ch.en i { background: repeating-linear-gradient(95deg, #f0c27a 0 6px, #d29a45 6px 8px); }
${S} .hurt .hands { animation: cv-hit 0.4s ease-out calc(var(--age) * -1) 1; }
@keyframes cv-hit { 0% { transform: translateX(-5px); filter: brightness(2); } 25% { transform: translateX(5px); } 50% { transform: translateX(-3px); } 100% { transform: none; } }
${S} .clock { order: 2; align-self: start; min-width: 2.4ch; text-align: center; font-size: 30px; font-weight: 700; color: #e8dcc6; background: radial-gradient(ellipse, #5b5249, #3a342e); border-radius: 50% 40% 50% 45%; padding: 2px 12px; box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6); font-variant-numeric: tabular-nums; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: #3a342e; border: 2px solid #c4572a; border-radius: 10px; padding: 4px 12px; color: #e8dcc6; font-size: 17px; }
${S} .bind small { flex-basis: 100%; text-align: center; color: #b8aa94; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 50px 0 8px; gap: 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; font-size: 18px; padding: 0 10px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .side { padding: 6px 8px; } ${S} .nm { font-size: 15px; } ${S} .pc { font-size: 20px; }
}`,
  render: (v) => `<svg class="defs" aria-hidden="true">${HAND}</svg>`
    + v.sides.map((f, i) => side(f, i, v.hits.find((h) => h.by !== i)?.age)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

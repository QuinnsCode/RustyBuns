// Pencil on paper: a wobble filter bends every bar, hatching fills them, numbers are scribbled in a hand font.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin } from "../skin.ts";

const bar = (v: number, max: number, cls: string, t: string) => `<span class="bar ${cls}" title="${esc(t)}"><i style="width:${pct(v, max)}%"></i></span>`;
const side = (f: HudSide, i: number, age: number | undefined) => `<div class="side s${i}${age !== undefined ? " hurt" : ""}" style="--age:${(age ?? 99) / 60}s">
  <div class="nm"><b>${esc(f.name)}</b>${f.combo > 1 ? `<em>x${f.combo}!</em>` : ""}${f.clipped ? icon("feather", "Wings clipped") : ""}</div>
  ${bar(f.hp, f.hpMax, "hp", "Health")}
  <div class="nums"><span class="hpn">${Math.round(f.hp)} hp</span><span class="pc">${Math.round(f.launch)}%</span></div>
  ${bar(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina")}${bar(f.energy, f.energyMax, "en", "Energy")}
  ${f.exhausted ? '<span class="oops">out of puff</span>' : ""}</div>`;

const S = '.hud[data-skin="sketchbook"]';
export const skin: HudSkin = {
  id: "sketchbook", name: "Sketchbook", idea: "Wobbly pencil-drawn bars and scribbled numbers on a torn scrap of paper.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; padding: 10px 56px 0 14px; font-family: "Covered By Your Grace", "Comic Sans MS", cursive; color: #2b2a28; }
${S} .defs { position: absolute; width: 0; height: 0; }
${S} .side { position: relative; display: grid; gap: 3px; padding: 8px 12px 6px; background: #f1ead8 repeating-linear-gradient(0deg, transparent 0 17px, rgba(90, 120, 170, 0.18) 17px 18px); box-shadow: 1px 3px 0 rgba(0, 0, 0, 0.35); transform: rotate(-0.8deg); filter: url(#mm-pencil); }
${S} .s1 { order: 3; transform: rotate(0.9deg); text-align: right; }
${S} .nm { display: flex; gap: 8px; align-items: center; font-size: 22px; line-height: 1; } ${S} .s1 .nm { justify-content: flex-end; }
${S} .nm em { color: #b3261e; font-style: normal; font-size: 24px; }
${S} .bar { display: block; height: 10px; border: 2px solid #2b2a28; border-radius: 3px 9px 4px 8px; background: transparent; }
${S} .bar i { display: block; height: 100%; background: repeating-linear-gradient(-55deg, #2b2a28 0 2px, transparent 2px 5px); } ${S} .s1 .bar i { margin-left: auto; }
${S} .bar.hp { height: 20px; } ${S} .bar.hp i { background: repeating-linear-gradient(-55deg, #2f7d3a 0 3px, rgba(47, 125, 58, 0.25) 3px 6px); }
${S} .bar.st { height: 8px; } ${S} .bar.st i { background: repeating-linear-gradient(-55deg, #2d6aa3 0 2px, transparent 2px 5px); } ${S} .bar.st.out i { background: #b3261e; }
${S} .bar.en { height: 8px; } ${S} .bar.en i { background: repeating-linear-gradient(-55deg, #b8860b 0 2px, transparent 2px 5px); }
${S} .nums { display: flex; justify-content: space-between; align-items: baseline; } ${S} .s1 .nums { flex-direction: row-reverse; }
${S} .hpn { font-size: 20px; color: #2f7d3a; } ${S} .pc { font-size: 34px; line-height: 0.9; }
${S} .oops { font-size: 16px; color: #b3261e; }
${S} .hurt .pc { animation: sk-hit 0.5s ease-out calc(var(--age) * -1) 1; }
@keyframes sk-hit { 0% { transform: rotate(-9deg) scale(1.5); color: #b3261e; } 100% { transform: none; } }
${S} .clock { order: 2; align-self: start; font-size: 38px; line-height: 1; min-width: 2.4ch; text-align: center; background: #f1ead8; padding: 4px 10px; border: 2px solid #2b2a28; border-radius: 50%; transform: rotate(3deg); filter: url(#mm-pencil); }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: #f1ead8; border: 2px dashed #2f7d3a; padding: 4px 12px; font-size: 20px; }
${S} .bind small { flex-basis: 100%; text-align: center; font-size: 15px; color: #5a554b; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 50px 0 8px; gap: 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; font-size: 22px; padding: 0 8px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .nm { font-size: 17px; } ${S} .pc { font-size: 26px; } ${S} .hpn { font-size: 16px; }
}`,
  render: (v) => `<svg class="defs" aria-hidden="true"><filter id="mm-pencil"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter></svg>`
    + v.sides.map((f, i) => side(f, i, v.hits.find((h) => h.by !== i)?.age)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

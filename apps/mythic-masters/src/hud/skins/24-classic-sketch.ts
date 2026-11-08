// Classic's layout drawn in a sketchbook: the card art taped on, the HP bar hatched in green pencil with the chunk just
// lost shaded faintly behind it, four drawn energy boxes, hand-written numbers, a pencil wobble on everything.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView, type Party } from "../skin.ts";

const pips = (p: Party | null) => !p || p.size < 2 ? "" : `<span class="pips" title="The line-up: ${p.size - p.down.length} of ${p.size} still standing">${
  Array.from({ length: p.size }, (_, i) => `<i class="${p.down.includes(i) ? "down" : i === p.up ? "up" : ""}"></i>`).join("")}</span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const age = v.hits.find((h) => h.by !== i)?.age, low = f.hp / (f.hpMax || 1) < 0.25;
  const pic = f.art ? `<span class="pic" style="background-image:url('${esc(f.art)}')"></span>` : `<span class="pic"><b>${esc(f.name.slice(0, 1))}</b></span>`;
  return `<div class="side s${i}${age !== undefined ? " hurt" : ""}" style="--age:${(age ?? 99) / 60}s">${pic}<div class="body">
  <div class="nm"><b>${esc(f.name)}</b>${f.combo > 1 ? `<em>x${f.combo}!</em>` : ""}<span class="pc" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <div class="hp${low ? " low" : ""}" title="Health"><i class="trail" style="width:${pct(f.hpTrail, f.hpMax)}%"></i><i class="fill" style="width:${pct(f.hp, f.hpMax)}%"></i></div>
  <div class="meters"><span class="st${f.exhausted ? " out" : ""}" title="Stamina"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>
  <span class="en" title="Energy"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${pips(f.party)}${f.clipped ? `<span class="oops">${icon("feather", "Wings clipped")} grounded</span>` : f.exhausted ? '<span class="oops">out of puff</span>' : ""}</div></div>`;
};

const S = '.hud[data-skin="classic-sketch"]';
export const skin: HudSkin = {
  id: "classic-sketch", name: "Classic sketch", idea: "Classic's portraits, damage trail and energy cells, drawn in pencil on a scrap of sketchbook.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 14px; padding: 10px 60px 0 14px; color: #2b2a28; font-family: "Covered By Your Grace", "Comic Sans MS", cursive; }
${S} .defs { position: absolute; width: 0; height: 0; }
${S} .side { display: flex; gap: 10px; align-items: flex-start; min-width: 0; padding: 8px 12px 6px; background: #f1ead8; box-shadow: 1px 3px 0 rgba(0,0,0,.35); transform: rotate(-0.8deg) translateX(calc((var(--hud-in, 1) - 1) * 120%)); filter: url(#mm-pencil-ks); }
${S} .s1 { order: 3; flex-direction: row-reverse; transform: rotate(0.9deg) translateX(calc((1 - var(--hud-in, 1)) * 120%)); }
${S} .pic { position: relative; flex: none; width: 58px; height: 58px; background: #ddd3bb center / cover no-repeat; border: 2px solid #2b2a28; border-radius: 4px 10px 5px 9px; filter: grayscale(.6) contrast(1.1); display: grid; place-items: center; font-size: 30px; }
${S} .pic::before { content: ""; position: absolute; left: 14px; top: -7px; width: 28px; height: 11px; background: rgba(240, 225, 160, .8); transform: rotate(-6deg); }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 3px; }
${S} .nm { display: flex; gap: 8px; align-items: baseline; font-size: 21px; line-height: 1; } ${S} .s1 .nm { flex-direction: row-reverse; }
${S} .nm b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .nm em { color: #b3261e; font-style: normal; }
${S} .pc { margin-inline-start: auto; font-size: 30px; line-height: .8; } ${S} .s1 .pc { margin-inline-start: 0; margin-inline-end: auto; }
${S} .hp { position: relative; height: 18px; border: 2px solid #2b2a28; border-radius: 3px 9px 4px 8px; overflow: hidden; }
${S} .hp i { position: absolute; top: 0; bottom: 0; left: 0; } ${S} .s1 .hp i { left: auto; right: 0; }
${S} .hp .trail { background: repeating-linear-gradient(-55deg, rgba(43, 42, 40, .35) 0 1px, transparent 1px 4px); }
${S} .hp .fill { background: repeating-linear-gradient(-55deg, #2f7d3a 0 3px, rgba(47, 125, 58, .3) 3px 6px); transition: width .15s linear; }
${S} .hp.low .fill { background: repeating-linear-gradient(-55deg, #b3261e 0 3px, rgba(179, 38, 30, .3) 3px 6px); }
${S} .meters { display: grid; grid-template-columns: 1fr 1.4fr; gap: 6px; } ${S} .s1 .meters { direction: rtl; }
${S} .meters span { position: relative; height: 8px; border: 1.5px solid #2b2a28; border-radius: 2px 6px 3px 5px; overflow: hidden; }
${S} .meters i { position: absolute; top: 0; bottom: 0; left: 0; } ${S} .s1 .meters i { left: auto; right: 0; }
${S} .st i { background: repeating-linear-gradient(-55deg, #2d6aa3 0 2px, transparent 2px 4px); } ${S} .st.out i { background: #b3261e; }
${S} .en i { background: repeating-linear-gradient(-55deg, #b8860b 0 2px, transparent 2px 4px); }
${S} .en::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(25% - 1.5px), #2b2a28 calc(25% - 1.5px) 25%); }
${S} .pips { display: flex; gap: 5px; } ${S} .s1 .pips { flex-direction: row-reverse; }
${S} .pips i { width: 12px; height: 12px; border: 1.5px solid #2b2a28; border-radius: 50% 40% 55% 45%; } ${S} .pips i.up { background: #2f7d3a; }
${S} .pips i.down { background: linear-gradient(45deg, transparent 45%, #b3261e 45% 55%, transparent 55%), linear-gradient(-45deg, transparent 45%, #b3261e 45% 55%, transparent 55%); }
${S} .oops { font-size: 15px; color: #b3261e; display: flex; gap: 4px; align-items: center; }
${S} .hurt .pc { animation: ks-hit .5s ease-out calc(var(--age) * -1) 1; }
@keyframes ks-hit { 0% { transform: rotate(-9deg) scale(1.5); color: #b3261e; } 100% { transform: none; } }
${S} .clock { order: 2; align-self: start; font-size: 38px; line-height: 1; min-width: 2.4ch; text-align: center; background: #f1ead8; padding: 6px 10px 2px; border: 2px solid #2b2a28;
  clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%); transform: translateY(calc((var(--hud-in, 1) - 1) * 140%)); filter: url(#mm-pencil-ks); }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: #f1ead8; border: 2px dashed #2f7d3a; padding: 4px 12px; font-size: 20px; }
${S} .bind small { flex-basis: 100%; text-align: center; font-size: 15px; color: #5a554b; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 8px 50px 0 8px; gap: 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 22px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .side { gap: 6px; padding: 6px 8px; }
  ${S} .pic { width: 34px; height: 34px; font-size: 18px; } ${S} .pic::before { display: none; } ${S} .nm { font-size: 16px; } ${S} .pc { font-size: 22px; } ${S} .hp { height: 13px; }
}`,
  render: (v) => `<svg class="defs" aria-hidden="true"><filter id="mm-pencil-ks"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="2"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></svg>`
    + v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

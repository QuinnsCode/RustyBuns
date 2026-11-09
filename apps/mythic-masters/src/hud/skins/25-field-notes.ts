// All three picks at once: a field-notes page (sketchbook paper and pencil wobble) with the card art as a taped photo
// (classic), and a black life bar on bare paper that shrinks toward its own side with a faint pencil trail of the chunk
// just lost and the hit stamped on it (case file).
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const sev = (d: number) => (d >= 25 ? "CRITICAL" : d >= 12 ? "SEVERE" : "MINOR");
const side = (f: HudSide, i: number, v: HudView) => {
  const stamp = v.hits.find((h) => h.by !== i);
  const pic = f.art ? `<span class="pic" style="background-image:url('${esc(f.art)}')"></span>` : `<span class="pic"><b>${esc(f.name.slice(0, 1))}</b></span>`;
  return `<div class="side s${i}">${pic}<div class="body">
  <div class="nm"><b>${esc(f.name)}</b><span class="pc" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <div class="hp" title="Health"><i class="trail" style="width:${pct(f.hpTrail, f.hpMax)}%"></i><i class="fill" style="width:${pct(f.hp, f.hpMax)}%"></i><span class="n">${Math.round(f.hp)}</span></div>
  <div class="meters"><span class="st${f.exhausted ? " out" : ""}" title="Stamina"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>
  <span class="en" title="Energy"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${f.clipped ? `<span class="oops">${icon("feather", "Wings clipped")} grounded</span>` : ""}</div>
  ${stamp ? `<span class="stamp" style="animation-delay:-${(stamp.age / 60).toFixed(2)}s">${stamp.guarded ? "BLOCKED" : sev(stamp.damage)}</span>` : ""}</div>`;
};

const S = '.hud[data-skin="field-notes"]';
export const skin: HudSkin = {
  id: "field-notes", name: "Field notes", idea: "All three picks: a sketchbook page with a taped photo, a black life bar and a stamped hit.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 14px; padding: 12px 60px 0 14px; color: #2b2a28; font-family: "Covered By Your Grace", "Comic Sans MS", cursive; }
${S} .defs { position: absolute; width: 0; height: 0; }
${S} .side { position: relative; display: flex; gap: 10px; align-items: flex-start; min-width: 0; padding: 8px 12px 6px; background: #f1ead8 repeating-linear-gradient(0deg, transparent 0 17px, rgba(90, 120, 170, 0.18) 17px 18px);
  box-shadow: 1px 3px 0 rgba(0,0,0,.35); transform: rotate(-0.6deg) translateX(calc((var(--hud-in, 1) - 1) * 120%)); filter: url(#mm-pencil-fn); }
${S} .s1 { order: 3; flex-direction: row-reverse; transform: rotate(0.7deg) translateX(calc((1 - var(--hud-in, 1)) * 120%)); }
${S} .pic { position: relative; flex: none; width: 54px; height: 60px; background: #ddd3bb center / cover no-repeat; border: 4px solid #fbf8ef; border-bottom-width: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.4); transform: rotate(-4deg); display: grid; place-items: center; font-size: 26px; }
${S} .s1 .pic { transform: rotate(4deg); }
${S} .pic::before { content: ""; position: absolute; left: 10px; top: -9px; width: 26px; height: 11px; background: rgba(240, 225, 160, .8); transform: rotate(5deg); }
${S} .body { flex: 1; min-width: 0; display: grid; gap: 3px; }
${S} .nm { display: flex; gap: 8px; align-items: baseline; font-size: 21px; line-height: 1; } ${S} .s1 .nm { flex-direction: row-reverse; }
${S} .nm b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .pc { margin-inline-start: auto; font-size: 30px; line-height: .8; } ${S} .s1 .pc { margin-inline-start: 0; margin-inline-end: auto; }
${S} .hp { position: relative; height: 20px; background: #f8f3e4; border: 2px solid #14110d; border-radius: 3px 9px 4px 8px; overflow: hidden; }
${S} .hp i { position: absolute; top: 0; bottom: 0; left: 0; } ${S} .s1 .hp i { left: auto; right: 0; }
${S} .hp .trail { background: repeating-linear-gradient(-55deg, rgba(43, 42, 40, .4) 0 1px, transparent 1px 4px); }
${S} .hp .fill { background: repeating-linear-gradient(135deg, #14110d 0 5px, #2c271f 5px 10px); transition: width .15s linear; }
${S} .hp .n { position: absolute; left: 6px; top: 50%; translate: 0 -50%; font-size: 16px; color: #f1ead8; mix-blend-mode: difference; } ${S} .s1 .hp .n { left: auto; right: 6px; }
${S} .meters { display: grid; grid-template-columns: 1fr 1.4fr; gap: 6px; } ${S} .s1 .meters { direction: rtl; }
${S} .meters span { position: relative; height: 7px; border: 1.5px solid #2b2a28; border-radius: 2px 6px 3px 5px; overflow: hidden; }
${S} .meters i { position: absolute; top: 0; bottom: 0; left: 0; background: repeating-linear-gradient(-55deg, #2b2a28 0 2px, transparent 2px 4px); } ${S} .s1 .meters i { left: auto; right: 0; }
${S} .st.out i { background: #b3261e; } ${S} .en i { background: repeating-linear-gradient(-55deg, #8a6212 0 2px, transparent 2px 4px); }
${S} .en::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(25% - 1.5px), #2b2a28 calc(25% - 1.5px) 25%); }
${S} .oops { font-size: 15px; color: #b3261e; display: flex; gap: 4px; align-items: center; }
${S} .stamp { position: absolute; right: 16px; bottom: -8px; transform: rotate(-9deg); border: 3px solid #b3261e; border-radius: 4px 10px 5px 8px; color: #b3261e; padding: 0 8px; font: 700 17px/1.3 "Courier New", Courier, monospace; letter-spacing: .08em; opacity: 0; animation: fn-stamp 2s linear both; background: rgba(241,234,216,.7); }
${S} .s1 .stamp { right: auto; left: 16px; transform: rotate(7deg); }
@keyframes fn-stamp { 0% { opacity: 0; scale: 1.8; } 8% { opacity: .9; scale: 1; } 80% { opacity: .9; } 100% { opacity: 0; } }
${S} .clock { order: 2; align-self: start; font-size: 36px; line-height: 1; min-width: 2.4ch; text-align: center; background: #f1ead8; padding: 4px 10px; border: 2px solid #2b2a28; border-radius: 50%; transform: rotate(3deg) translateY(calc((var(--hud-in, 1) - 1) * 140%)); filter: url(#mm-pencil-fn); }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: #f1ead8; border: 2px dashed #2b2a28; padding: 4px 12px; font-size: 20px; }
${S} .bind small { flex-basis: 100%; text-align: center; font-size: 15px; color: #5a554b; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 10px 50px 0 8px; gap: 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 22px; padding: 0 8px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .side { gap: 6px; padding: 6px 8px; }
  ${S} .pic { width: 32px; height: 36px; border-width: 2px 2px 6px; } ${S} .pic::before { display: none; }
  ${S} .nm { font-size: 16px; } ${S} .pc { font-size: 22px; } ${S} .hp { height: 15px; } ${S} .hp .n { font-size: 12px; } ${S} .stamp { font-size: 12px; }
}`,
  render: (v) => `<svg class="defs" aria-hidden="true"><filter id="mm-pencil-fn"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="9"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></svg>`
    + v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

// Case file drawn in a sketchbook: the dossier strip on lined paper with a pencil wobble, health left a black bar
// scribbled in pencil that shrinks toward its own side (what's lost is bare paper), and each hit stamped in red marker.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const sev = (d: number) => (d >= 25 ? "CRITICAL" : d >= 12 ? "SEVERE" : "MINOR");
const line = (v: number, max: number, cls: string, tip: string) => `<span class="line ${cls}" title="${esc(tip)}"><i style="width:${pct(v, max)}%"></i></span>`;
const side = (f: HudSide, i: number, v: HudView) => {
  const stamp = v.hits.find((h) => h.by !== i);
  return `<div class="side s${i}">
  <div class="head"><span class="tab">FILE ${i + 1}</span><b>${esc(f.name)}</b>${f.combo > 1 ? `<em>x${f.combo}</em>` : ""}</div>
  <div class="hp" title="Health"><i style="width:${pct(f.hp, f.hpMax)}%"></i></div>
  <div class="nums"><span>${Math.round(f.hp)} hp</span><span class="pc" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  ${line(f.stamina, f.staminaMax, f.exhausted ? "st out" : "st", "Stamina: flying, sprinting and dashing spend it")}${line(f.energy, f.energyMax, "en", "Energy: landing and taking hits fill it")}
  ${f.clipped ? `<span class="note">${icon("feather", "Wings clipped")} grounded</span>` : ""}
  ${stamp ? `<span class="stamp" style="animation-delay:-${(stamp.age / 60).toFixed(2)}s">${stamp.guarded ? "BLOCKED" : sev(stamp.damage)}</span>` : ""}</div>`;
};

const S = '.hud[data-skin="case-sketch"]';
export const skin: HudSkin = {
  id: "case-sketch", name: "Case sketch", idea: "The case file drawn in pencil: a black scribbled life bar on lined paper, hits stamped in red marker.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; padding: 12px 60px 0 14px; color: #2b2a28; font-family: "Covered By Your Grace", "Comic Sans MS", cursive; }
${S} .defs { position: absolute; width: 0; height: 0; }
${S} .side { position: relative; display: grid; gap: 3px; padding: 8px 12px 6px; background: #f1ead8 repeating-linear-gradient(0deg, transparent 0 17px, rgba(90, 120, 170, 0.18) 17px 18px); box-shadow: 1px 3px 0 rgba(0, 0, 0, 0.35); transform: rotate(-0.7deg); filter: url(#mm-pencil-cs); }
${S} .s1 { order: 3; transform: rotate(0.8deg); }
${S} .head { display: flex; gap: 8px; align-items: baseline; font-size: 21px; line-height: 1; } ${S} .s1 .head { flex-direction: row-reverse; }
${S} .tab { font: 700 10px/1 "Courier New", Courier, monospace; letter-spacing: .15em; border: 1.5px solid #2b2a28; padding: 2px 5px; }
${S} .head em { color: #b3261e; font-style: normal; }
${S} .hp { display: flex; height: 20px; border: 2px solid #2b2a28; border-radius: 3px 9px 4px 8px; background: #f8f3e4; }
${S} .s1 .hp { flex-direction: row-reverse; }
${S} .hp i { display: block; height: 100%; background: repeating-linear-gradient(-55deg, #14110d 0 3px, #3a342b 3px 5px); transition: width .15s linear; }
${S} .nums { display: flex; justify-content: space-between; align-items: baseline; font-size: 18px; } ${S} .s1 .nums { flex-direction: row-reverse; }
${S} .pc { font-size: 30px; line-height: .9; }
${S} .line { display: flex; height: 7px; border: 1.5px solid #2b2a28; border-radius: 2px 6px 3px 5px; } ${S} .s1 .line { flex-direction: row-reverse; }
${S} .line i { display: block; height: 100%; background: repeating-linear-gradient(-55deg, #2b2a28 0 2px, transparent 2px 4px); }
${S} .line.st.out i { background: #b3261e; } ${S} .line.en i { background: repeating-linear-gradient(-55deg, #8a6212 0 2px, transparent 2px 4px); }
${S} .note { font-size: 15px; color: #b3261e; display: flex; gap: 4px; align-items: center; }
${S} .stamp { position: absolute; right: 14px; top: 26px; transform: rotate(-9deg); border: 3px solid #b3261e; border-radius: 4px 10px 5px 8px; color: #b3261e; padding: 0 8px; font-size: 22px; opacity: 0; animation: cs-stamp 2s linear both; }
${S} .s1 .stamp { right: auto; left: 14px; transform: rotate(7deg); }
@keyframes cs-stamp { 0% { opacity: 0; scale: 1.8; } 8% { opacity: .9; scale: 1; } 80% { opacity: .9; } 100% { opacity: 0; } }
${S} .clock { order: 2; align-self: start; font-size: 36px; line-height: 1; min-width: 2.4ch; text-align: center; background: #f1ead8; padding: 4px 10px; border: 2px solid #2b2a28; border-radius: 6px 14px 8px 12px; transform: rotate(2deg); filter: url(#mm-pencil-cs); }
${S} .clock small { display: block; font: 9px/1 "Courier New", Courier, monospace; letter-spacing: .15em; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #f1ead8; border: 2px dashed #2b2a28; padding: 4px 12px; font-size: 19px; text-align: center; }
${S} .bind small { display: block; font-size: 15px; color: #5a554b; }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; padding: 10px 50px 0 8px; gap: 8px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: center; font-size: 22px; padding: 0 8px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; } ${S} .head { font-size: 16px; } ${S} .tab { display: none; } ${S} .pc { font-size: 22px; } ${S} .stamp { font-size: 15px; }
}`,
  render: (v) => `<svg class="defs" aria-hidden="true"><filter id="mm-pencil-cs"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></svg>`
    + v.sides.map((f, i) => side(f, i, v)).join("")
    + `<div class="clock" title="Seconds left"><small>TIME</small>${v.clock}</div>`
    + (v.bind ? `<div class="bind">${icon("link")} may be recruited: <b>${Math.round(v.bind.chance * 100)}%</b> · ink ${v.bind.ink} · [${esc(v.bind.key)}]${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

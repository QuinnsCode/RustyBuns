// Bestiary card: each beast is its card, art as the portrait; the portrait's frame is the health bar.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const PAW = '<svg viewBox="0 0 24 24" class="paw" aria-hidden="true"><circle cx="6" cy="11" r="2"/><circle cx="10" cy="6.5" r="2"/><circle cx="15" cy="6.5" r="2"/><circle cx="19" cy="11" r="2"/><path d="M12.5 12c-3 0-6 3-6 5.5C6.5 19.5 8.5 20 12.5 20s6-.5 6-2.5c0-2.5-3-5.500-6-5.500z"/></svg>';

function side(v: HudView, f: HudSide, i: number) {
  const hurt = v.hits.find((h) => h.by !== i && !h.guarded);
  const art = f.art ? `<img src="${esc(f.art)}" alt="" draggable="false">` : PAW;
  return `<div class="side s${i} tier-${esc(f.tier)}${f.exhausted ? " out" : ""}"${hurt ? ` style="--age:${(hurt.age / 60).toFixed(2)}s"` : ""}>
  <div class="frame" style="--hp:${pct(f.hp, f.hpMax)}%" title="Health: ${Math.ceil(f.hp)}"><div class="pic">${art}${hurt ? '<span class="flash"></span>' : ""}</div></div>
  <div class="info">
    <div class="top"><b class="name">${esc(f.name)}</b>${f.combo > 1 ? `<span class="combo">x${f.combo}</span>` : ""}</div>
    <div class="nums"><span class="hpn" title="Health">${Math.ceil(f.hp)}<small>/${Math.ceil(f.hpMax)}</small></span><span class="launch" title="Launch: the higher, the further the next hit sends you">${icon("move-up-right", "Launch")}${Math.round(f.launch)}%</span></div>
    <span class="bar st" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i>${f.exhausted ? "<em>spent</em>" : ""}</span>
    <span class="bar en" title="Energy: specials, beams and the ultimate spend it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span>
    ${f.clipped ? `<span class="clip">${icon("feather", "Wings clipped")}clipped</span>` : ""}
  </div></div>`;
}

const S = '.hud[data-skin="bestiary-card"]';
export const skin: HudSkin = {
  id: "bestiary-card", name: "Bestiary card", idea: "Each beast is its own card; the portrait's frame is the health bar, filling round it.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 8px 56px 0 12px; align-items: start; font-family: "IM Fell English", Georgia, serif; color: #f4ead2; }
${S} .s1 { order: 3; } ${S} .clock { order: 2; }
${S} .side { display: flex; align-items: center; gap: 10px; background: linear-gradient(135deg, #2a2118, #17110b); border: 2px solid #8a6d3b; border-radius: 12px; padding: 5px 10px 5px 5px; box-shadow: 0 3px 8px #0009, inset 0 0 0 1px #00000099; }
${S} .s1 { flex-direction: row-reverse; padding: 5px 5px 5px 10px; }
${S} .tier-rare { border-color: #6aa9d8; } ${S} .tier-epic { border-color: #b184e8; } ${S} .tier-legend, ${S} .tier-legendary { border-color: #ffb347; } ${S} .tier-mythic { border-color: #ff6b6b; }
${S} .frame { flex: none; width: 72px; height: 72px; padding: 5px; border-radius: 12px; background: conic-gradient(from 0deg, #6ad37a var(--hp), #3a2c22 0); }
${S} .s1 .frame { background: conic-gradient(from 0deg at 50% 50%, #3a2c22 calc(100% - var(--hp)), #6ad37a 0); }
${S} .pic { position: relative; width: 100%; height: 100%; border-radius: 8px; overflow: hidden; background: #0e0a06; display: grid; place-items: center; }
${S} .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
${S} .paw { width: 60%; height: 60%; fill: #8a6d3b; }
${S} .flash { position: absolute; inset: 0; background: #ff3b30; animation: bestiary-card-flash 0.4s linear paused both; animation-delay: calc(var(--age) * -1); }
${S} .info { display: grid; gap: 3px; min-width: 0; flex: 1; }
${S} .top { display: flex; align-items: baseline; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .name { font-family: "Grenze Gotisch", serif; font-size: 18px; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .combo { font-family: "Covered By Your Grace", cursive; font-size: 19px; color: #ffb347; }
${S} .nums { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
${S} .s1 .nums { flex-direction: row-reverse; }
${S} .hpn { font-size: 26px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: #8ee89b; }
${S} .hpn small { font-size: 12px; color: #a99c80; font-weight: 400; }
${S} .launch { display: inline-flex; align-items: center; gap: 3px; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; color: #ffb347; }
${S} .bar { position: relative; height: 6px; background: #ffffff18; border-radius: 3px; display: flex; }
${S} .s1 .bar { justify-content: flex-end; }
${S} .bar i { display: block; height: 100%; border-radius: 3px; }
${S} .st i { background: #8fc4e8; } ${S} .en i { background: #f1c453; } ${S} .out .st i { background: #ff6b6b; }
${S} .bar em { position: absolute; top: -3px; left: 6px; font-size: 11px; line-height: 12px; color: #ff9b8a; font-style: italic; }
${S} .s1 .bar em { left: auto; right: 6px; }
${S} .clip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-style: italic; color: #ffb347; }
${S} .s1 .clip { justify-self: end; }
${S} .icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .clock { font-family: "Grenze Gotisch", serif; font-size: 30px; font-weight: 700; width: 56px; height: 56px; display: grid; place-items: center; background: #17110b; border: 2px solid #8a6d3b; border-radius: 50%; font-variant-numeric: tabular-nums; box-shadow: 0 3px 8px #0009; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #17110b; border: 2px solid #6ad37a; border-radius: 12px; padding: 4px 16px; font-size: 16px; text-align: center; box-shadow: 0 3px 8px #0009; }
${S} .bind small { display: block; font-style: italic; opacity: 0.8; }
@keyframes bestiary-card-flash { from { opacity: 0.7; } to { opacity: 0; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 58px 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; width: 38px; height: 38px; font-size: 21px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .side { gap: 6px; padding: 3px 6px 3px 3px; } ${S} .s1 { padding: 3px 3px 3px 6px; }
  ${S} .frame { width: 48px; height: 48px; padding: 4px; border-radius: 9px; } ${S} .pic { border-radius: 6px; }
  ${S} .name { font-size: 13px; } ${S} .hpn { font-size: 19px; } ${S} .hpn small { display: none; } ${S} .launch { font-size: 13px; } ${S} .icon { width: 11px; height: 11px; }
}`,
  render: (v) => v.sides.map((f, i) => side(v, f, i)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">Bind <b>${Math.round(v.bind.chance * 100)}%</b> · press <b>${esc(v.bind.key)}</b> · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

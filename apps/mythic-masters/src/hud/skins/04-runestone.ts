// Runestone: carved stone tablets; ten runes glow for health, five blue ones for energy.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

// Strokes for ten runes on a 12 x 20 grid.
const RUNES = [
  "M3 2v16M3 5l6 4-6 4", "M3 2v16M3 4l6 5M3 9l6 5", "M2 18l8-16M2 2l8 16", "M6 2v16M6 6l4-3M6 10l4-3",
  "M2 2l8 8-8 8", "M3 2v16l6-8z", "M6 2l-4 6 4 4-4 6M6 2l4 6-4 4", "M3 2v16M9 2v16M3 6l6 8",
  "M6 2v16M2 6l4 4 4-4", "M2 18l4-8 4 8M6 2v8",
];
const rune = (k: number, lit: boolean, cls: string) => `<svg viewBox="0 0 12 20" class="rune ${cls}${lit ? " lit" : ""}" aria-hidden="true"><path d="${RUNES[k % RUNES.length]}"/></svg>`;

function side(v: HudView, f: HudSide, i: number) {
  const hpRunes = Array.from({ length: 10 }, (_, k) => rune(k, f.hp > (k * f.hpMax) / 10 + 0.001, "hp"));
  const enRunes = Array.from({ length: 5 }, (_, k) => rune(k + 3, f.energy >= ((k + 1) * f.energyMax) / 5 - 0.001, "en"));
  if (i) { hpRunes.reverse(); enRunes.reverse(); }
  const hurt = v.hits.find((h) => h.by !== i && !h.guarded);
  return `<div class="side s${i}${f.exhausted ? " out" : ""}"${hurt ? ` data-hurt style="animation-delay:-${(hurt.age / 60).toFixed(2)}s"` : ""}>
  <div class="top"><b class="name">${esc(f.name)}</b>${f.combo > 1 ? `<span class="combo">x${f.combo}</span>` : ""}<span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <div class="row" title="Health: ${Math.ceil(f.hp)}"><span class="runes">${hpRunes.join("")}</span><span class="hpn">${Math.ceil(f.hp)}</span></div>
  <div class="row"><span class="runes small" title="Energy: specials, beams and the ultimate spend it">${enRunes.join("")}</span>
    <span class="groove" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>${f.exhausted ? "<em>spent</em>" : ""}</div>
  ${f.clipped ? `<span class="clip">${icon("feather", "Wings clipped")}clipped</span>` : ""}</div>`;
}

const S = '.hud[data-skin="runestone"]';
export const skin: HudSkin = {
  id: "runestone", name: "Runestone", idea: "Carved stone tablets: ten runes glow for health and go dark as it drains; energy lights five blue ones.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 8px 56px 0 12px; align-items: start; font-family: "Grenze Gotisch", Georgia, serif; color: #d8d4c8; }
${S} .s1 { order: 3; } ${S} .clock { order: 2; }
${S} .side { background: radial-gradient(ellipse at 30% 0%, #5a5a58, #3a3a3a 60%, #2a2a2a); border: 2px solid #1e1e1e; border-radius: 10px 4px 12px 5px; padding: 6px 10px 7px; display: grid; gap: 4px; box-shadow: inset 0 2px 0 #ffffff22, inset 0 -3px 6px #000a, 0 3px 8px #000a; }
${S} .side[data-hurt] { animation: runestone-chip 0.5s linear paused both; }
${S} .top { display: flex; align-items: baseline; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .name { font-size: 19px; flex: 1; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 -1px 0 #000, 0 1px 0 #ffffff33; }
${S} .s1 .name { text-align: right; }
${S} .launch { font-size: 21px; font-weight: 700; color: #ffb25b; font-variant-numeric: tabular-nums; line-height: 1; text-shadow: 0 -1px 0 #000; }
${S} .combo { font-size: 18px; color: #ff7a5b; }
${S} .row { display: flex; align-items: center; gap: 8px; }
${S} .s1 .row { flex-direction: row-reverse; }
${S} .runes { display: flex; flex: 1; gap: 1px; justify-content: space-between; background: #1d1d1d; border-radius: 4px; padding: 3px 4px; box-shadow: inset 0 2px 4px #000; }
${S} .runes.small { flex: none; width: 74px; padding: 2px 4px; }
${S} .rune { height: 20px; flex: 1; max-width: 14px; fill: none; stroke: #4a4a48; stroke-width: 1.8; stroke-linecap: square; }
${S} .runes.small .rune { height: 14px; }
${S} .rune.hp.lit { stroke: #ffc65b; filter: drop-shadow(0 0 3px #ff9d2e); }
${S} .rune.en.lit { stroke: #8fd3ff; filter: drop-shadow(0 0 3px #3aa6ff); }
${S} .hpn { font-size: 24px; font-weight: 700; min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; line-height: 1; text-shadow: 0 -1px 0 #000, 0 1px 0 #ffffff33; }
${S} .s1 .hpn { text-align: left; }
${S} .groove { flex: 1; height: 7px; background: #1d1d1d; border-radius: 4px; box-shadow: inset 0 2px 3px #000; overflow: hidden; display: flex; }
${S} .s1 .groove { justify-content: flex-end; }
${S} .groove i { display: block; height: 100%; background: #9cc0a0; } ${S} .out .groove i { background: #e0583f; }
${S} .row em { font-size: 12px; line-height: 1; color: #ff9b7a; font-style: normal; }
${S} .clip { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #ffb25b; }
${S} .s1 .clip { justify-self: end; }
${S} .icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .clock { width: 58px; height: 58px; display: grid; place-items: center; font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; background: radial-gradient(circle at 35% 25%, #5a5a58, #2a2a2a); border: 2px solid #1e1e1e; border-radius: 40% 50% 45% 55%; box-shadow: inset 0 2px 0 #ffffff22, 0 3px 8px #000a; text-shadow: 0 -1px 0 #000; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #2a2a2a; border: 2px solid #ffc65b; border-radius: 8px; padding: 4px 16px; font-size: 18px; text-align: center; box-shadow: 0 0 10px #ff9d2e66, 0 3px 8px #000a; }
${S} .bind small { display: block; font-size: 14px; opacity: 0.8; }
@keyframes runestone-chip { from { box-shadow: inset 0 0 0 3px #ffb25b, inset 0 2px 0 #ffffff22, 0 3px 8px #000a; } to { box-shadow: inset 0 0 0 0 #ffb25b00, inset 0 2px 0 #ffffff22, 0 3px 8px #000a; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 58px 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; width: 38px; height: 38px; font-size: 21px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .side { padding: 5px 6px 6px; gap: 3px; } ${S} .name { font-size: 15px; } ${S} .launch { font-size: 16px; } ${S} .hpn { font-size: 17px; min-width: 2.5ch; }
  ${S} .rune { height: 15px; } ${S} .runes.small { width: 44px; padding: 2px 3px; } ${S} .runes.small .rune { height: 10px; }
}`,
  render: (v) => v.sides.map((f, i) => side(v, f, i)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">Bind <b>${Math.round(v.bind.chance * 100)}%</b> · press <b>${esc(v.bind.key)}</b> · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

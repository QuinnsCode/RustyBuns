// Witch candles: health is five candles that burn down, energy is how big the flames are.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const CANDLES = 5;

function side(v: HudView, f: HudSide, i: number) {
  const share = f.hpMax / CANDLES, en = Math.min(1, Math.max(0, f.energy / (f.energyMax || 1)));
  // Flame size 0.35..1 so a candle with no energy still shows a lit ember.
  const flame = (0.35 + 0.65 * en).toFixed(2);
  const row = Array.from({ length: CANDLES }, (_, k) => {
    const left = Math.min(1, Math.max(0, (f.hp - k * share) / share)), lit = left > 0.001;
    // Flickers are frozen per frame; the tick shifts each candle's flame a little so the row shimmers.
    const sway = Math.sin((v.tick + k * 17) / 7) * 2;
    return `<span class="candle${lit ? "" : " dead"}"><span class="wax" style="height:${Math.round(8 + left * 92)}%">${lit ? `<span class="flame" style="transform:translateX(${sway.toFixed(1)}px) scale(${flame})"></span>` : '<span class="smoke"></span>'}</span></span>`;
  });
  if (i) row.reverse();
  const hurt = v.hits.find((h) => h.by !== i && !h.guarded);
  return `<div class="side s${i}${f.exhausted ? " out" : ""}"${hurt ? ` data-hurt style="animation-delay:-${(hurt.age / 60).toFixed(2)}s"` : ""}>
  <div class="candles" title="Health: ${Math.ceil(f.hp)}">${row.join("")}</div>
  <div class="read">
    <div class="top"><b class="name">${esc(f.name)}</b>${f.combo > 1 ? `<span class="combo">x${f.combo}</span>` : ""}</div>
    <div class="nums"><span class="hpn" title="Health">${Math.ceil(f.hp)}</span><span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
    <span class="wick" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i>${f.exhausted ? "<em>spent</em>" : ""}</span>
    <span class="flamebar" title="Energy: specials, beams and the ultimate spend it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span>
    ${f.clipped ? `<span class="clip">${icon("feather", "Wings clipped")}clipped</span>` : ""}
  </div></div>`;
}

const S = '.hud[data-skin="witch-candles"]';
export const skin: HudSkin = {
  id: "witch-candles", name: "Witch candles", idea: "Five candles per beast burn down as health drains; the flames swell with energy.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 8px 56px 0 12px; align-items: start; font-family: "IM Fell English", Georgia, serif; color: #efe3cf; }
${S} .s1 { order: 3; } ${S} .clock { order: 2; }
${S} .side { display: flex; align-items: flex-end; gap: 10px; background: linear-gradient(180deg, #1a1226e6, #0f0a17f2); border: 1px solid #5a4478; border-radius: 10px; padding: 6px 10px 6px; box-shadow: 0 3px 10px #000a; }
${S} .s1 { flex-direction: row-reverse; }
${S} .side[data-hurt] { animation: witch-candles-gust 0.5s linear paused both; }
${S} .candles { flex: none; display: flex; align-items: flex-end; gap: 5px; height: 62px; padding-top: 14px; border-bottom: 3px solid #3a2a1a; }
${S} .candle { position: relative; display: block; width: 13px; height: 100%; }
${S} .wax { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(90deg, #cdbfa3, #f3e9d2 45%, #bfae8c); border-radius: 3px 3px 1px 1px; box-shadow: 0 0 6px #0006; }
${S} .candle.dead .wax { background: #5b5144; }
${S} .flame { position: absolute; left: 50%; margin-left: -4px; bottom: calc(100% + 1px); width: 8px; height: 16px; background: radial-gradient(ellipse at 50% 70%, #fff3b0 15%, #ffb02e 55%, #ff5a1f 100%); border-radius: 50% 50% 50% 50% / 70% 70% 30% 30%; filter: drop-shadow(0 0 5px #ff9d2e); transform-origin: 50% 100%; transition: none; }
${S} .smoke { position: absolute; bottom: 100%; left: 50%; width: 2px; height: 8px; background: #9a8fb066; border-radius: 2px; }
${S} .read { display: grid; gap: 3px; min-width: 0; flex: 1; }
${S} .top { display: flex; align-items: baseline; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .name { font-family: "Grenze Gotisch", serif; font-size: 18px; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .combo { font-family: "Covered By Your Grace", cursive; font-size: 19px; color: #ffb02e; }
${S} .nums { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
${S} .s1 .nums { flex-direction: row-reverse; }
${S} .hpn { font-size: 28px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: #ffe29a; }
${S} .launch { font-size: 19px; font-weight: 700; color: #c9a4ff; font-variant-numeric: tabular-nums; }
${S} .wick, ${S} .flamebar { position: relative; height: 5px; background: #ffffff16; border-radius: 3px; display: flex; }
${S} .s1 .wick, ${S} .s1 .flamebar { justify-content: flex-end; }
${S} i { display: block; height: 100%; border-radius: 3px; }
${S} .wick i { background: #9fd0e8; } ${S} .out .wick i { background: #ff6b6b; }
${S} .flamebar i { background: linear-gradient(90deg, #ff5a1f, #ffb02e, #fff3b0); }
${S} .s1 .flamebar i { background: linear-gradient(270deg, #ff5a1f, #ffb02e, #fff3b0); }
${S} .wick em { position: absolute; top: -4px; left: 6px; font-size: 11px; line-height: 12px; color: #ff9b8a; font-style: italic; }
${S} .s1 .wick em { left: auto; right: 6px; }
${S} .clip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-style: italic; color: #ffb02e; }
${S} .s1 .clip { justify-self: end; }
${S} .icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .clock { font-family: "Grenze Gotisch", serif; font-size: 30px; font-weight: 700; width: 56px; height: 56px; display: grid; place-items: center; background: #0f0a17; border: 1px solid #5a4478; border-radius: 50%; font-variant-numeric: tabular-nums; color: #ffe29a; box-shadow: 0 3px 10px #000a, inset 0 0 12px #5a447855; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #0f0a17ee; border: 1px solid #ffb02e; border-radius: 10px; padding: 4px 16px; font-size: 16px; text-align: center; box-shadow: 0 0 12px #ff9d2e55; }
${S} .bind small { display: block; font-style: italic; opacity: 0.8; }
@keyframes witch-candles-gust { from { box-shadow: 0 0 0 3px #c9a4ffaa, 0 3px 10px #000a; } to { box-shadow: 0 0 0 0 #c9a4ff00, 0 3px 10px #000a; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 58px 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; width: 38px; height: 38px; font-size: 21px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .side { flex-direction: column-reverse; align-items: stretch; gap: 4px; padding: 5px 6px; } ${S} .s1 { flex-direction: column-reverse; }
  ${S} .candles { height: 40px; padding-top: 12px; gap: 3px; justify-content: space-between; } ${S} .candle { width: auto; flex: 1; max-width: 18px; }
  ${S} .name { font-size: 14px; } ${S} .hpn { font-size: 20px; } ${S} .launch { font-size: 14px; }
}`,
  render: (v) => v.sides.map((f, i) => side(v, f, i)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">Bind <b>${Math.round(v.bind.chance * 100)}%</b> · press <b>${esc(v.bind.key)}</b> · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

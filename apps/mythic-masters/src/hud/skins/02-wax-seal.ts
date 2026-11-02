// Wax seal: health is a row of ten wax seals that crack and fall away; the clock is an hourglass.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

const SEALS = 10;
const seal = (state: "whole" | "cracked" | "gone") => `<span class="seal ${state}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5" class="rim"/>${state === "cracked" ? '<path d="M13 2.5 10.5 9l3.5 2.5-3 4.5 1.5 6" class="crack"/>' : state === "whole" ? '<path d="m12 7.5 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3L7.7 10.6l3-.4z" class="mark"/>' : ""}</svg></span>`;

function side(v: HudView, f: HudSide, i: number) {
  const unit = f.hpMax / SEALS;
  const row = Array.from({ length: SEALS }, (_, k) => seal(f.hp >= (k + 1) * unit - 0.001 ? "whole" : f.hp > k * unit ? "cracked" : "gone"));
  const hurt = v.hits.find((h) => h.by !== i && !h.guarded);
  return `<div class="side s${i}${f.exhausted ? " out" : ""}"${hurt ? ` data-hurt style="animation-delay:-${(hurt.age / 60).toFixed(2)}s"` : ""}>
  <div class="top"><b class="name">${esc(f.name)}</b>${f.combo > 1 ? `<span class="combo">x${f.combo}</span>` : ""}<span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}%</span></div>
  <div class="seals" title="Health: ${Math.ceil(f.hp)}">${row.join("")}<span class="hpn">${Math.ceil(f.hp)}</span></div>
  <div class="ribbons"><span class="rib st" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>${f.exhausted ? `<em>spent</em>` : ""}<span class="rib en" title="Energy: specials, beams and the ultimate spend it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${f.clipped ? `<span class="clip">${icon("feather", "Wings clipped")}wings clipped</span>` : ""}</div>`;
}

/** An hourglass whose top empties as the clock runs down (the round is 99 seconds). */
function glass(clock: number) {
  const f = Math.min(1, Math.max(0, clock / 99)), top = 9 * f, bot = 9 * (1 - f);
  return `<svg viewBox="0 0 24 32" aria-hidden="true"><path class="sand" d="M${12 - 7 * f} ${16 - top}h${14 * f}L12 16z"/><path class="sand" d="M${12 - 7 * (1 - f)} 28h${14 * (1 - f)}L12 ${28 - bot * 1.2}z"/><path class="frame" d="M5 3h14M5 29h14M7 3c0 7 5 9 5 13s-5 6-5 13M17 3c0 7-5 9-5 13s5 6 5 13"/></svg>`;
}

const S = '.hud[data-skin="wax-seal"]';
export const skin: HudSkin = {
  id: "wax-seal", name: "Wax seal", idea: "Ten wax seals per beast that crack and fall away as health goes; the clock is an hourglass.",
  css: `
${S} { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 8px 56px 0 12px; align-items: start; font-family: "IM Fell English", Georgia, serif; color: #f3e6c8; }
${S} .s1 { order: 3; } ${S} .clock { order: 2; }
${S} .side { background: linear-gradient(180deg, #2b1a1c, #1b1012); border: 1px solid #7a5a3a; border-radius: 6px; padding: 6px 10px 7px; display: grid; gap: 4px; box-shadow: 0 3px 8px #0008; }
${S} .side[data-hurt] { animation: wax-seal-shake 0.5s linear paused both; }
${S} .top { display: flex; align-items: baseline; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .name { font-family: "Grenze Gotisch", serif; font-size: 19px; flex: 1; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .s1 .name { text-align: right; }
${S} .launch { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: #ffb36b; line-height: 1; }
${S} .combo { font-family: "Covered By Your Grace", cursive; font-size: 20px; color: #ff8a6b; }
${S} .seals { display: flex; align-items: center; gap: 2px; }
${S} .s1 .seals { flex-direction: row-reverse; }
${S} .seal { flex: 1; max-width: 26px; aspect-ratio: 1; display: block; }
${S} .seal svg { width: 100%; height: 100%; display: block; overflow: visible; }
${S} .seal circle { fill: #b3212b; stroke: #5d0d14; stroke-width: 1.2; }
${S} .seal .rim { fill: #c9323d; stroke: #8a1a22; stroke-width: 1; }
${S} .seal .mark { fill: #ffd7a8; stroke: none; }
${S} .seal .crack { fill: none; stroke: #1b1012; stroke-width: 1.6; stroke-linejoin: bevel; }
${S} .seal.cracked svg { transform: rotate(-8deg) scale(0.9); }
${S} .seal.cracked circle { fill: #7d1a22; }
${S} .seal.gone circle { fill: none; stroke: #5b4046; stroke-dasharray: 2 3; stroke-width: 1; }
${S} .seal.gone .rim { stroke: none; }
${S} .hpn { font-weight: 700; font-size: 20px; min-width: 3ch; text-align: right; font-variant-numeric: tabular-nums; }
${S} .s1 .hpn { text-align: left; }
${S} .ribbons { display: flex; align-items: center; gap: 6px; height: 8px; }
${S} .rib { flex: 1; height: 5px; background: #ffffff18; border-radius: 3px; overflow: hidden; display: flex; }
${S} .s1 .rib { justify-content: flex-end; }
${S} .rib i { display: block; height: 100%; }
${S} .st i { background: #8fc4e8; } ${S} .en i { background: #f1c453; } ${S} .out .st i { background: #ff6b6b; }
${S} .ribbons em { font-size: 12px; line-height: 1; color: #ff8a6b; font-style: italic; }
${S} .clip { display: flex; align-items: center; gap: 4px; font-size: 13px; font-style: italic; color: #ffb36b; }
${S} .icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .clock { width: 64px; display: grid; justify-items: center; background: #1b1012; border: 1px solid #7a5a3a; border-radius: 6px; padding: 2px 0 3px; box-shadow: 0 3px 8px #0008; }
${S} .clock svg { width: 22px; height: 30px; }
${S} .clock .frame { fill: none; stroke: #d9b97a; stroke-width: 1.6; stroke-linecap: round; }
${S} .clock .sand { fill: #f0cf7f; }
${S} .clock b { font-size: 20px; line-height: 1; font-variant-numeric: tabular-nums; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: #b3212b; border: 2px solid #5d0d14; border-radius: 22px; padding: 4px 16px; font-size: 16px; text-align: center; box-shadow: 0 3px 8px #0008; }
${S} .bind small { display: block; font-style: italic; opacity: 0.85; }
@keyframes wax-seal-shake { 0% { transform: translate(3px, 0); box-shadow: 0 0 0 2px #ff6b4aaa; } 25% { transform: translate(-3px, 0); } 50% { transform: translate(2px, 0); box-shadow: 0 0 0 0 #ff6b4a00; } 100% { transform: none; box-shadow: 0 0 0 0 #ff6b4a00; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 58px 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; width: auto; grid-auto-flow: column; gap: 6px; padding: 2px 10px; }
  ${S} .clock svg { height: 22px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .name { font-size: 15px; } ${S} .launch { font-size: 16px; } ${S} .hpn { font-size: 15px; min-width: 2.5ch; } ${S} .side { padding: 5px 6px 6px; }
}`,
  render: (v) => v.sides.map((f, i) => side(v, f, i)).join("")
    + `<div class="clock">${glass(v.clock)}<b>${v.clock}</b></div>`
    + (v.bind ? `<div class="bind">Bind <b>${Math.round(v.bind.chance * 100)}%</b> · press <b>${esc(v.bind.key)}</b> · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

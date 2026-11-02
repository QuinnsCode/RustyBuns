// Round gauges in the bottom corners: three rings (health, stamina, energy) around a big launch %.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import type { HudHit, HudSide, HudSkin } from "../skin.ts";

const ring = (r: number, w: number, v: number, max: number, cls: string) =>
  `<circle class="trk" cx="60" cy="60" r="${r}" stroke-width="${w}"/><circle class="arc ${cls}" cx="60" cy="60" r="${r}" stroke-width="${w}" pathLength="100" stroke-dasharray="${(Math.min(1, Math.max(0, v / (max || 1))) * 100).toFixed(1)} 100"/>`;
const dial = (f: HudSide, i: number, hit: HudHit | undefined) => `<div class="dial d${i}${f.exhausted ? " out" : ""}${hit ? " hurt" : ""}" style="--age:${hit ? hit.age / 60 : 9}s">
  <svg viewBox="0 0 120 120" role="img" aria-label="${esc(f.name)}">${ring(53, 9, f.hp, f.hpMax, "hp")}${ring(42, 5, f.stamina, f.staminaMax, "st")}${ring(34, 5, f.energy, f.energyMax, "en")}</svg>
  <div class="mid"><b class="pc">${Math.round(f.launch)}<small>%</small></b><span class="hpn">${Math.round(f.hp)}</span></div>
  <div class="nm">${esc(f.name)}${f.exhausted ? icon("wind", "Out of stamina") : ""}${f.clipped ? icon("feather", "Wings clipped") : ""}${f.combo > 1 ? `<em>x${f.combo}</em>` : ""}</div></div>`;

const S = '.hud[data-skin="dials"]';
export const skin: HudSkin = {
  id: "dials", name: "Dials", idea: "Round gauges in the bottom corners; launch % big in the middle of each, like a platform fighter.",
  css: `
${S} { text-align: center; }
${S} .clock { display: inline-block; margin-top: 8px; padding: 2px 14px; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; background: var(--panel); border-radius: 999px; }
${S} .dial { position: fixed; bottom: 56px; width: 168px; height: 168px; }
${S} .d0 { left: 10px; } ${S} .d1 { right: 10px; }
${S} svg { width: 100%; height: 100%; transform: rotate(-90deg); filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6)); }
${S} .trk { fill: none; stroke: rgba(10, 14, 20, 0.7); }
${S} .arc { fill: none; stroke-linecap: round; }
${S} .arc.hp { stroke: var(--hp); } ${S} .arc.st { stroke: var(--st); } ${S} .arc.en { stroke: var(--en); }
${S} .out .arc.st { stroke: #ff6b6b; }
${S} .mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-shadow: 0 2px 4px #000; }
${S} .pc { font-size: 38px; line-height: 1; font-variant-numeric: tabular-nums; }
${S} .pc small { font-size: 16px; }
${S} .hpn { font-size: 13px; color: #fff; font-variant-numeric: tabular-nums; }
${S} .nm { position: absolute; left: 0; right: 0; top: -22px; display: flex; justify-content: center; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; text-shadow: 0 1px 3px #000; }
${S} .nm em { color: var(--hot); font-style: normal; }
${S} .hurt .pc { animation: dial-hit 0.4s ease-out calc(var(--age) * -1) 1; }
@keyframes dial-hit { 0% { transform: scale(1.35); color: #ff6b6b; } 100% { transform: scale(1); } }
${S} .bind { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; background: var(--panel); border: 1px solid #7dffb0; border-radius: 10px; padding: 4px 10px; color: #cfe8d6; width: max-content; max-width: 90vw; }
${S} .bind small { flex-basis: 100%; color: var(--dim); }
@media (max-width: 640px) {
  ${S} .dial { width: 132px; height: 132px; bottom: 60px; } ${S} .pc { font-size: 28px; } ${S} .hpn { font-size: 11px; }
  ${S} .d0 { left: 4px; } ${S} .d1 { right: 4px; }
  ${S} .bind { bottom: 4px; left: auto; right: 4px; transform: none; max-width: 60vw; font-size: 12px; }
}`,
  render: (v) => `<div class="clock">${v.clock}</div>`
    + v.sides.map((f, i) => dial(f, i, v.hits.find((h) => h.by !== i))).join("")
    + (v.bind ? `<div class="bind">${icon("link")}<b>${esc(v.bind.key)}</b> bind ${Math.round(v.bind.chance * 100)}% · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};

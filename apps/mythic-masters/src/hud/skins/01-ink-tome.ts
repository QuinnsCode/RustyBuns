// Ink tome: each side is a strip of parchment, health is a pool of ink, and fresh damage bleeds out as a stain.
import { esc } from "@rustybuns/util";
import { icon } from "../../icons.ts";
import { pct, type HudSide, type HudSkin, type HudView } from "../skin.ts";

/** The hits this side took in the last two seconds (guarded ones do no harm). */
const taken = (v: HudView, i: number) => v.hits.filter((h) => h.by !== i && !h.guarded);

function side(v: HudView, f: HudSide, i: number) {
  const hurt = taken(v, i), lost = hurt.reduce((n, h) => n + h.damage, 0);
  const youngest = hurt.length ? Math.min(...hurt.map((h) => h.age)) : 120;
  const hp = Number(pct(f.hp, f.hpMax)), stain = Math.min(100 - hp, (lost / (f.hpMax || 1)) * 100);
  const edge = i ? "right" : "left";
  return `<div class="side s${i}${f.exhausted ? " out" : ""}">
  <div class="top"><b class="name">${esc(f.name)}</b>${f.combo > 1 ? `<span class="combo">x${f.combo}</span>` : ""}
    <span class="launch" title="Launch: the higher, the further the next hit sends you">${Math.round(f.launch)}<small>%</small></span></div>
  <div class="well" title="Health"><span class="pool" style="width:${hp}%"></span>${stain > 0 ? `<span class="stain" style="${edge}:${hp}%;width:${stain.toFixed(1)}%;animation-delay:-${(youngest / 60).toFixed(2)}s"></span>` : ""}<span class="num">${Math.ceil(f.hp)}</span></div>
  <div class="thin"><span class="line st" title="Stamina: flying, sprinting and dashing spend it"><i style="width:${pct(f.stamina, f.staminaMax)}%"></i></span>${f.exhausted ? `<em>spent</em>` : ""}</div>
  <div class="thin"><span class="line en" title="Energy: specials, beams and the ultimate spend it"><i style="width:${pct(f.energy, f.energyMax)}%"></i></span></div>
  ${f.clipped ? `<span class="clip">${icon("feather", "Wings clipped")}wings clipped</span>` : ""}</div>`;
}

const S = '.hud[data-skin="ink-tome"]';
export const skin: HudSkin = {
  id: "ink-tome", name: "Ink tome", idea: "Parchment strips; health is a pool of ink and fresh damage bleeds out as a stain.",
  css: `
${S} { --paper: #e8d8b0; --paper2: #d3bd8a; --ink: #2a1a10; --stain: #7a1f1a; display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; padding: 8px 56px 0 12px; align-items: start; font-family: "IM Fell English", Georgia, serif; color: var(--ink); }
${S} .s1 { order: 3; } ${S} .clock { order: 2; }
${S} .side { background: linear-gradient(180deg, var(--paper), var(--paper2)); border: 1px solid #6b5230; border-radius: 3px 8px 3px 8px; box-shadow: 0 2px 0 #00000055, inset 0 0 18px #8a6a3a77; padding: 6px 10px 7px; display: grid; gap: 3px; }
${S} .top { display: flex; align-items: baseline; gap: 8px; }
${S} .s1 .top { flex-direction: row-reverse; }
${S} .name { font-family: "Grenze Gotisch", serif; font-size: 20px; font-weight: 700; line-height: 1; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .s1 .name { text-align: right; }
${S} .launch { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--stain); line-height: 1; }
${S} .launch small { font-size: 13px; }
${S} .combo { font-family: "Covered By Your Grace", cursive; font-size: 20px; color: var(--stain); }
${S} .well { position: relative; height: 24px; background: #00000018; border: 1px solid #5a4020; border-radius: 12px 4px 12px 4px; overflow: hidden; }
${S} .s1 .well { display: flex; justify-content: flex-end; }
${S} .pool { display: block; height: 100%; background: radial-gradient(circle at 92% 40%, #3b2a22, #14090a 70%); border-radius: 0 12px 12px 0; box-shadow: inset 0 -4px 6px #000a; }
${S} .s1 .pool { border-radius: 12px 0 0 12px; }
${S} .stain { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(90deg, #7a1f1acc 0 3px, #7a1f1a77 3px 6px); animation: ink-tome-fade 2s linear paused both; }
${S} .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; color: #fff4d6; text-shadow: 0 0 3px #000, 0 0 3px #000; letter-spacing: 0.04em; }
${S} .thin { display: flex; align-items: center; gap: 6px; height: 8px; }
${S} .s1 .thin { flex-direction: row-reverse; }
${S} .line { flex: 1; height: 5px; border-bottom: 1px dashed #5a402088; position: relative; display: flex; }
${S} .s1 .line { justify-content: flex-end; }
${S} .line i { display: block; height: 100%; border-radius: 3px; }
${S} .st i { background: #24456b; } ${S} .en i { background: #b07a10; }
${S} .out .st i { background: var(--stain); }
${S} .thin em { font-size: 12px; line-height: 1; color: var(--stain); font-style: italic; }
${S} .clip { display: flex; align-items: center; gap: 4px; font-size: 13px; font-style: italic; color: var(--stain); }
${S} .icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .clock { font-family: "Grenze Gotisch", serif; font-size: 30px; font-weight: 700; min-width: 2.2ch; text-align: center; background: var(--paper); border: 1px solid #6b5230; border-radius: 50%; width: 52px; height: 52px; display: grid; place-items: center; box-shadow: inset 0 0 12px #8a6a3a99, 0 2px 0 #00000055; font-variant-numeric: tabular-nums; }
${S} .bind { grid-column: 1 / -1; order: 4; justify-self: center; background: var(--paper); border: 1px solid #6b5230; border-radius: 3px 10px 3px 10px; padding: 4px 14px; font-size: 16px; text-align: center; box-shadow: 0 2px 0 #00000055; }
${S} .bind b { font-family: "Grenze Gotisch", serif; } ${S} .bind small { display: block; font-style: italic; opacity: 0.8; }
@keyframes ink-tome-fade { from { opacity: 1; } to { opacity: 0; } }
@media (max-width: 640px) {
  ${S} { grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 58px 0 6px; }
  ${S} .clock { grid-column: 1 / -1; order: 0; justify-self: start; width: 40px; height: 40px; font-size: 22px; }
  ${S} .s0 { order: 1; } ${S} .s1 { order: 2; }
  ${S} .name { font-size: 16px; } ${S} .launch { font-size: 18px; } ${S} .side { padding: 5px 7px 6px; }
}`,
  render: (v) => v.sides.map((f, i) => side(v, f, i)).join("")
    + `<div class="clock">${v.clock}</div>`
    + (v.bind ? `<div class="bind">Bind <b>${Math.round(v.bind.chance * 100)}%</b> by pressing <b>${esc(v.bind.key)}</b> · ink ${v.bind.ink}${v.bind.note ? `<small>${esc(v.bind.note)}</small>` : ""}</div>` : ""),
};
